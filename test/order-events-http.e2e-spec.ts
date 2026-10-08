import { ClassSerializerInterceptor, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { AppDataSource } from '../src/data-source';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import {
  Order,
  OrderStatus,
} from '../src/modules/orders/entities/order.entity';
import { OrderEventsController } from '../src/modules/orders/events/order-events.controller';
import { OrderEventsGuard } from '../src/modules/orders/events/order-events.guard';
import { OrderEventsService } from '../src/modules/orders/events/order-events.service';
import { OrderEventsStreamService } from '../src/modules/orders/events/order-events-stream.service';
import { STREAM_LIMITS } from '../src/modules/orders/events/order-events.types';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';
import {
  assertDisposableDatabase,
  assertDisposableEnvironment,
} from './helpers/disposable-database';
import {
  cleanupOrderEventFixtures,
  OrderEventBaseline,
} from './helpers/order-events-cleanup';
import { openSse } from './helpers/sse-client';

describe('Order events HTTP SSE with real PostgreSQL and JWT', () => {
  let db: DataSource;
  let app: INestApplication | undefined;
  let events: OrderEventsService;
  let jwt: JwtService;
  let admin: User;
  let client: User;
  let url: string;
  let orderIds: string[];
  let userIds: string[];
  let baseline: OrderEventBaseline | undefined;
  let connections: Awaited<ReturnType<typeof openSse>>[];
  let pending: Set<Promise<unknown>>;
  let transactionSpy: jest.SpyInstance;
  const endpoint = '/admin/orders/events';

  beforeAll(async () => {
    assertDisposableEnvironment();
    if (
      process.env.DB_DATABASE !== 'celtas_e2e_test_sse_20261008_01' ||
      process.env.DB_HOST !== '127.0.0.1' ||
      process.env.DB_PORT !== '5432'
    )
      throw new Error(
        'HTTP SSE requires the explicitly authorized local database',
      );
    db = new DataSource(AppDataSource.options);
    await db.initialize();
    await assertDisposableDatabase(db);
  });

  beforeEach(async () => {
    app = undefined;
    baseline = undefined;
    await assertDisposableDatabase(db);
    [baseline] = await db.query<OrderEventBaseline[]>(
      'SELECT singleton, "streamId", head::text, floor::text FROM order_event_state',
    );
    orderIds = [];
    userIds = [];
    connections = [];
    pending = new Set();
    transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(
        (
          isolationOrCallback:
            IsolationLevel | ((manager: EntityManager) => Promise<unknown>),
          callback?: (manager: EntityManager) => Promise<unknown>,
        ) => {
          const operation =
            typeof isolationOrCallback === 'function'
              ? db.manager.transaction(isolationOrCallback)
              : db.manager.transaction(isolationOrCallback, callback!);
          pending.add(operation);
          void operation.then(
            () => pending.delete(operation),
            () => pending.delete(operation),
          );
          return operation;
        },
      );
    // Only periodic timers are virtual. JWT time, timeouts, sockets and DB are real.
    jest.useFakeTimers({
      doNotFake: [
        'Date',
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
      ],
    });
    const secret = process.env.JWT_SECRET!;
    jwt = new JwtService({ secret });
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [OrderEventsController],
      providers: [
        JwtStrategy,
        OrderEventsGuard,
        RolesGuard,
        UsersService,
        OrderEventsService,
        OrderEventsStreamService,
        { provide: DataSource, useValue: db },
        { provide: getRepositoryToken(User), useValue: db.getRepository(User) },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            jwt: { secret },
            orderEvents: { enabled: true, listenerMode: 'direct' },
          }),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(
      new TransformInterceptor(),
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    events = app.get(OrderEventsService);
    expect(events.ready).toBe(true);
    await events.publish();
    const createUser = async (role: UserRole) => {
      const id = randomUUID();
      userIds.push(id);
      return db.getRepository(User).save({
        id,
        email: `${id}@test.local`,
        fullName: 'Private QA name',
        phone: '51987654321',
        password: 'private-password',
        role,
      });
    };
    admin = await createUser(UserRole.ADMIN);
    client = await createUser(UserRole.CLIENTE);
  });

  afterEach(async () => {
    if (!baseline) return;
    try {
      await Promise.all(connections.map((connection) => connection.close()));
      const outstanding = [...pending];
      await app?.close();
      const settled = await Promise.allSettled(outstanding);
      const failed = settled.filter((result) => result.status === 'rejected');
      if (failed.length)
        throw new AggregateError(
          failed.map((result) => result.reason as unknown),
          'HTTP SSE teardown transaction failed',
        );
      while (pending.size) await Promise.all([...pending]);
      await cleanupOrderEventFixtures(db, orderIds, baseline);
      await db.getRepository(User).delete(userIds);
      await assertDisposableDatabase(db);
    } finally {
      transactionSpy.mockRestore();
      jest.useRealTimers();
    }
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  const token = (user = admin, expiresIn = 120) =>
    jwt.sign({ sub: user.id, email: user.email, role: 'admin' }, { expiresIn });
  const connect = async (cursor?: string, bearer = token()) => {
    const connection = await openSse(`${url}${endpoint}`, {
      Authorization: `Bearer ${bearer}`,
      ...(cursor === undefined ? {} : { 'Last-Event-ID': cursor }),
    });
    connections.push(connection);
    expect(connection.status).toBe(200);
    await connection.waitFor((frames) =>
      frames.some((frame) => frame.event === 'stream.ready'),
    );
    return connection;
  };
  const createEvents = async (count: number) => {
    await db.transaction(async (manager) => {
      for (let index = 0; index < count; index++) {
        const id = randomUUID();
        orderIds.push(id);
        const order = await manager.save(Order, {
          id,
          userId: null,
          customerName: 'Private customer',
          customerPhone: '51987654321',
          addressSnapshot: JSON.stringify({ fullAddress: 'Private address' }),
          status: OrderStatus.PENDIENTE,
          total: 10,
          deliveryFee: 0,
          whatsappUrl: 'https://wa.me/51987654321',
        });
        await events.record(manager, 'order.created', order, 'created');
      }
    });
  };

  it('accepts a real admin JWT with SSE headers and no REST envelope', async () => {
    const connection = await connect();
    expect(connection.headers['content-type']).toContain('text/event-stream');
    expect(connection.headers['cache-control']).toBe('no-cache, no-transform');
    expect(connection.headers['x-accel-buffering']).toBe('no');
    expect(connection.frames[0].data).toEqual({
      v: 1,
      headCursor: '0',
      floorCursor: '0',
      recovery: 'rest',
    });
  });

  it('rejects missing, invalid and expired JWTs and the real insufficient DB role', async () => {
    for (const bearer of [undefined, 'invalid', token(admin, -1)]) {
      const call = request(url).get(endpoint);
      if (bearer) call.set('Authorization', `Bearer ${bearer}`);
      await call.expect(401);
    }
    // The signed admin claim must not override the real cliente role in PostgreSQL.
    await request(url)
      .get(endpoint)
      .set('Authorization', `Bearer ${token(client)}`)
      .expect(403);
  });

  it('rejects query credentials even with a valid Authorization header', async () => {
    await request(url).get(`${endpoint}?token=${token()}`).expect(400);
    await request(url)
      .get(`${endpoint}?token=redacted`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(400);
  });

  it('replays twelve events in numeric order and exposes only allowlisted payload fields', async () => {
    await createEvents(12);
    await events.publish();
    const connection = await connect('0');
    await connection.waitFor(
      (frames) =>
        frames.filter((frame) => frame.event === 'order.created').length === 12,
    );
    const rows = connection.frames.filter(
      (frame) => frame.event === 'order.created',
    );
    expect(rows.map((frame) => frame.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => String(index + 1)),
    );
    expect(rows.slice(8).map((frame) => frame.id)).toEqual([
      '9',
      '10',
      '11',
      '12',
    ]);
    for (const frame of rows) {
      expect(Object.keys(frame.data).sort()).toEqual([
        'eventId',
        'occurredAt',
        'orderId',
        'status',
        'v',
      ]);
      expect(frame.data.orderId).toBeDefined();
      expect(frame.data.status).toBe('pendiente');
      expect(JSON.stringify(frame.data)).not.toMatch(
        /Private|51987654321|password|email|address|whatsapp/i,
      );
    }
  });

  it('rejects malformed Last-Event-ID and resets future and retained-away cursors', async () => {
    for (const cursor of ['-1', '01', '1.5', 'invalid', '9223372036854775808'])
      await request(url)
        .get(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .set('Last-Event-ID', cursor)
        .expect(400);
    const future = await connect('1');
    await future.waitFor((frames) =>
      frames.some((frame) => frame.event === 'stream.reset'),
    );
    await future.waitForClose();
    await createEvents(1);
    await events.publish();
    await db.query(
      `UPDATE order_events SET "publishedAt"=now()-interval '49 hours' WHERE "orderId"=ANY($1::uuid[])`,
      [orderIds],
    );
    await events.publish();
    const expired = await connect('0');
    await expired.waitFor((frames) =>
      frames.some((frame) => frame.event === 'stream.reset'),
    );
    expect(
      expired.frames.find((frame) => frame.event === 'stream.ready')?.data
        .floorCursor,
    ).toBe('1');
    expect(
      expired.frames.find((frame) => frame.event === 'stream.reset')?.data
        .reason,
    ).toBe('cursor_unavailable');
    await expired.waitForClose();
  });

  it('reconnects with the last received cursor and recovers events committed while offline', async () => {
    const first = await connect();
    await createEvents(1);
    await events.publish();
    await first.waitFor((frames) => frames.some((frame) => frame.id === '1'));
    await first.close();
    await createEvents(2); // Durable pending events exist while no HTTP client is connected.
    const [pendingRow] = await db.query<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM order_events WHERE cursor IS NULL',
    );
    expect(pendingRow.count).toBe(2);
    await events.publish();
    const second = await connect('1');
    await second.waitFor(
      (frames) =>
        frames.filter((frame) => frame.event === 'order.created').length === 2,
    );
    expect(
      second.frames
        .filter((frame) => frame.event === 'order.created')
        .map((frame) => frame.id),
    ).toEqual(['2', '3']);
  });

  it('closes an active HTTP stream when its real JWT expires', async () => {
    const connection = await connect(undefined, token(admin, 3));
    await connection.waitFor((frames) =>
      frames.some((frame) => frame.event === 'auth.expiring'),
    );
    await connection.waitForClose();
    expect(
      connection.frames.find((frame) => frame.event === 'auth.expiring')?.data
        .reason,
    ).toBe('reconnect_required');
  });

  it('revokes an active admin stream at the periodic role check, not immediately', async () => {
    const bearer = token();
    const connection = await connect(undefined, bearer);
    await db.getRepository(User).update(admin.id, { role: UserRole.CLIENTE });
    await request(url)
      .get(endpoint)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(403);
    // The existing connection keeps its authorization until the scheduled DB check.
    await createEvents(1);
    await events.publish();
    await connection.waitFor((frames) =>
      frames.some((frame) => frame.id === '1'),
    );
    await jest.advanceTimersByTimeAsync(STREAM_LIMITS.roleCheckMs);
    await connection.waitFor((frames) =>
      frames.some((frame) => frame.event === 'access.revoked'),
    );
    await connection.waitForClose();
    expect(
      connection.frames.find((frame) => frame.event === 'access.revoked')?.data
        .reason,
    ).toBe('role_changed');
  });
});
