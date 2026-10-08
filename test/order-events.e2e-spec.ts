import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { AppDataSource } from '../src/data-source';
import {
  Order,
  OrderStatus,
} from '../src/modules/orders/entities/order.entity';
import { OrderEventsService } from '../src/modules/orders/events/order-events.service';
import { OrderEventRow } from '../src/modules/orders/events/order-events.types';
import {
  assertDisposableDatabase,
  assertDisposableEnvironment,
} from './helpers/disposable-database';
import {
  cleanupOrderEventFixtures,
  OrderEventBaseline,
} from './helpers/order-events-cleanup';

describe('Order outbox (real PostgreSQL, independent backend instances)', () => {
  let first: DataSource;
  let second: DataSource;
  let publisher: OrderEventsService;
  let other: OrderEventsService;
  let orderIds: string[];
  let baseline: OrderEventBaseline | undefined;
  let pending: Set<Promise<unknown>>;
  let transactionSpies: jest.SpyInstance[];
  const config = new ConfigService({
    orderEvents: { enabled: true, listenerMode: 'direct' },
  });
  const fixture = () => {
    const id = randomUUID();
    orderIds.push(id);
    return {
      id,
      userId: null,
      customerName: 'QA ficticio',
      customerPhone: '51999999999',
      addressSnapshot: '{}',
      status: OrderStatus.PENDIENTE,
      total: 10,
      deliveryFee: 0,
      whatsappUrl: 'https://wa.me/',
    };
  };
  beforeAll(async () => {
    assertDisposableEnvironment();
    if (process.env.DB_DATABASE !== 'celtas_e2e_test_sse_20261008_01')
      throw new Error('SSE E2E requires celtas_e2e_test_sse_20261008_01');
    first = new DataSource(AppDataSource.options);
    second = new DataSource(AppDataSource.options);
    await first.initialize();
    await second.initialize();
    await assertDisposableDatabase(first);
  });
  beforeEach(async () => {
    baseline = undefined;
    await assertDisposableDatabase(first);
    [baseline] = await first.query<OrderEventBaseline[]>(
      'SELECT singleton, "streamId", head::text, floor::text FROM order_event_state',
    );
    pending = new Set();
    transactionSpies = [first, second].map((db) => {
      return jest
        .spyOn(db, 'transaction')
        .mockImplementation(
          (
            isolationOrCallback:
              IsolationLevel | ((manager: EntityManager) => Promise<unknown>),
            callback?: (manager: EntityManager) => Promise<unknown>,
          ) => {
            // DataSource.transaction delegates to this same manager.
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
    });
    orderIds = [];
    publisher = new OrderEventsService(first, config);
    other = new OrderEventsService(second, config);
  });
  afterEach(async () => {
    if (!baseline) return; // Failed preflight must never authorize cleanup.
    try {
      const outstanding = [...pending];
      const stopped = await Promise.allSettled([
        publisher.onModuleDestroy(),
        other.onModuleDestroy(),
      ]);
      const failures = stopped.filter((result) => result.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason as unknown),
          'SSE cleanup: publisher shutdown failed',
        );
      // onModuleDestroy waits for publication, but an in-flight replay may remain.
      const finished = await Promise.allSettled(outstanding);
      const rejected = finished.filter(
        (result) => result.status === 'rejected',
      );
      if (rejected.length)
        throw new AggregateError(
          rejected.map((result) => result.reason as unknown),
          'SSE cleanup: outstanding transaction failed',
        );
      while (pending.size) {
        const settled = await Promise.allSettled([...pending]);
        const failed = settled.filter((result) => result.status === 'rejected');
        if (failed.length)
          throw new AggregateError(
            failed.map((result) => result.reason as unknown),
            'SSE cleanup: outstanding transaction failed',
          );
      }
      await cleanupOrderEventFixtures(first, orderIds, baseline);
      await assertDisposableDatabase(first);
    } finally {
      transactionSpies.forEach((spy) => spy.mockRestore());
    }
  });
  afterAll(async () => {
    const closed = await Promise.allSettled(
      [second, first]
        .filter((db) => db?.isInitialized)
        .map((db) => db.destroy()),
    );
    const failed = closed.filter((result) => result.status === 'rejected');
    if (failed.length)
      throw new AggregateError(
        failed.map((result) => result.reason as unknown),
        'SSE E2E connection shutdown failed',
      );
  });
  const state = async () =>
    (
      await first.query<{ head: string; floor: string }[]>(
        'SELECT head::text,floor::text FROM order_event_state WHERE singleton',
      )
    )[0];
  const rows = () =>
    first.query<OrderEventRow[]>(
      'SELECT "eventId",type,"orderId",status,"occurredAt",cursor::text FROM order_events WHERE "orderId" = ANY($1::uuid[]) ORDER BY order_events.cursor',
      [orderIds],
    );
  const create = async (db = first, service = publisher) => {
    const order = fixture();
    await db.transaction(async (manager) => {
      await manager.save(Order, order);
      await service.record(manager, 'order.created', order, 'created');
    });
    return order;
  };

  it('rolls back both business row and outbox; no cursor or notification escapes', async () => {
    const before = await state();
    const order = fixture();
    await expect(
      first.transaction(async (manager) => {
        await manager.save(Order, order);
        await publisher.record(manager, 'order.created', order, 'created');
        throw new Error('controlled rollback');
      }),
    ).rejects.toThrow('controlled rollback');
    await publisher.publish();
    expect(await rows()).toEqual([]);
    expect(await first.getRepository(Order).countBy({ id: order.id })).toBe(0);
    expect((await state()).head).toBe(before.head);
  });

  it('recovers committed events with a new publisher after the original process never published', async () => {
    const order = await create();
    expect((await rows())[0].cursor).toBeNull();
    await other.publish();
    expect((await rows())[0]).toMatchObject({
      orderId: order.id,
    });
    expect(typeof (await rows())[0].cursor).toBe('string');
    await other.publish();
    expect(await rows()).toHaveLength(1);
  });

  it('deduplicates transactional retries and serializes independent publishers', async () => {
    const order = await create();
    await first.transaction(async (manager) => {
      await publisher.record(manager, 'order.created', order, 'created');
    });
    await create(second, other);
    await Promise.all([publisher.publish(), other.publish()]);
    await publisher.publish();
    const persisted = await rows();
    expect(persisted).toHaveLength(2);
    expect(BigInt(persisted[1].cursor) - BigInt(persisted[0].cursor)).toBe(1n);
  });

  it('assigns the earlier cursor to a visible commit even if another event was inserted first', async () => {
    const runner = first.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const late = fixture();
    try {
      await runner.manager.save(Order, late);
      await publisher.record(runner.manager, 'order.created', late, 'created');
      const early = await create(second, other);
      await other.publish();
      expect(
        (await rows()).find((row) => row.orderId === late.id),
      ).toBeUndefined();
      const earlyCursor = (await rows()).find(
        (row) => row.orderId === early.id,
      )!.cursor;
      await runner.commitTransaction();
      await other.publish();
      const lateCursor = (await rows()).find(
        (row) => row.orderId === late.id,
      )!.cursor;
      expect(BigInt(lateCursor)).toBeGreaterThan(BigInt(earlyCursor));
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('rolls back a publication SQL failure and retries the original durable event', async () => {
    await create();
    const before = await state();
    transactionSpies[0].mockImplementationOnce(((
      callback: (manager: import('typeorm').EntityManager) => Promise<void>,
    ) =>
      first.manager.transaction(async (manager) => {
        const query = manager.query.bind(manager) as (
          sql: string,
          values?: unknown[],
        ) => Promise<unknown[]>;
        jest.spyOn(manager, 'query').mockImplementation(((
          sql: string,
          values: unknown[],
        ) => {
          if (sql.includes('pg_notify'))
            throw new Error('injected SQL transport failure');
          return query(sql, values);
        }) as typeof manager.query);
        await callback(manager);
      })) as typeof first.transaction);
    await expect(publisher.publish()).rejects.toThrow(
      'injected SQL transport failure',
    );
    expect((await state()).head).toBe(before.head);
    expect((await rows())[0].cursor).toBeNull();
    await publisher.publish();
    expect((await rows())[0].cursor).not.toBeNull();
  });

  it('replays durable events and resets an expired cursor after retention', async () => {
    const before = await state();
    await create();
    await publisher.publish();
    const replay = await other.replay(before.head);
    expect(replay.reset).toBe(false);
    expect(replay.rows).toHaveLength(1);
    await first.query(
      `UPDATE order_events SET "publishedAt"=now()-interval '49 hours' WHERE "orderId"=ANY($1::uuid[])`,
      [orderIds],
    );
    await publisher.publish();
    expect((await other.replay(before.head)).reset).toBe(true);
    expect(await rows()).toEqual([]);
  });

  it('fans out committed events to two independent listeners and persists publication', async () => {
    await publisher.onModuleInit();
    await other.onModuleInit();
    await publisher.publish();
    await other.publish();
    expect(publisher.ready && other.ready).toBe(true);
    const received = [new Set<string>(), new Set<string>()];
    const completed = [publisher, other].map(
      (service, index) =>
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('LISTEN/NOTIFY delivery timeout')),
            5_000,
          );
          const unsubscribe = service.subscribe((events) => {
            if (events?.length) {
              events.forEach((event) => received[index].add(event.eventId));
              clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          });
        }),
    );
    await create();
    await publisher.publish();
    await Promise.all(completed);
    const persisted = await rows();
    expect(persisted[0].cursor).not.toBeNull();
    expect([...received[0]]).toEqual([persisted[0].eventId]);
    expect([...received[1]]).toEqual([persisted[0].eventId]);
  });
});
