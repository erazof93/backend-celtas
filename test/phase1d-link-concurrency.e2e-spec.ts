import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  Order,
  OrderStatus,
} from '../src/modules/orders/entities/order.entity';
import { OrdersService } from '../src/modules/orders/orders.service';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import {
  assertDisposableDatabase,
  assertDisposableEnvironment,
} from './helpers/disposable-database';

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));

describe('Phase 1D anonymous linking (real PostgreSQL)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let user: User;
  let orders: Order[];

  beforeAll(async () => {
    assertDisposableEnvironment();
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    ds = app.get(DataSource);
  });
  beforeEach(async () => {
    const users = ds.getRepository(User);
    user = await users.save(
      users.create({
        email: `phase1d-${randomUUID()}@test.local`,
        fullName: 'QA',
        role: UserRole.CLIENTE,
        phone: '51912345678',
        totalSpent: 0,
      }),
    );
    const repository = ds.getRepository(Order);
    orders = await repository.save(
      [10, 20].map((total) =>
        repository.create({
          userId: null,
          customerPhone: user.phone,
          customerName: 'QA',
          status: OrderStatus.PENDIENTE,
          addressSnapshot: '{}',
          total,
          deliveryFee: 0,
          whatsappUrl: 'https://wa.me/',
        }),
      ),
    );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (orders)
      await ds.getRepository(Order).delete({ id: In(orders.map((o) => o.id)) });
    if (user) await ds.getRepository(User).delete({ id: user.id });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('rejects unsafe destinations without opening a database connection', () => {
    const original = {
      NODE_ENV: process.env.NODE_ENV,
      DB_HOST: process.env.DB_HOST,
      DB_DATABASE: process.env.DB_DATABASE,
    };
    try {
      for (const name of [
        'celtas_db',
        'celtas_delivery_test_20261006_01',
        'celtas_phase1c_test_20261006_2130',
      ]) {
        process.env.DB_DATABASE = name;
        expect(assertDisposableEnvironment).toThrow('local disposable');
      }
      process.env.DB_DATABASE = original.DB_DATABASE;
      process.env.DB_HOST = 'remote.invalid';
      expect(assertDisposableEnvironment).toThrow('local disposable');
      process.env.DB_HOST = original.DB_HOST;
      process.env.NODE_ENV = 'production';
      expect(assertDisposableEnvironment).toThrow('local disposable');
    } finally {
      Object.assign(process.env, original);
    }
  });

  it('preflight rejects a database with business fixtures using read-only queries', async () => {
    await expect(assertDisposableDatabase(ds)).rejects.toThrow(
      'E2E requires empty business tables',
    );
    expect(
      await ds
        .getRepository(Order)
        .countBy({ id: In(orders.map((o) => o.id)) }),
    ).toBe(2);
  });

  it('legacy FK lock upgrade produces SQLSTATE 40P01 on disjoint orders', async () => {
    const runners = [ds.createQueryRunner(), ds.createQueryRunner()];
    try {
      for (const runner of runners) {
        await runner.connect();
        await runner.startTransaction();
        await runner.query("SET LOCAL lock_timeout = '10s'");
      }
      // Both FK KEY SHARE locks must exist before either attempts FOR UPDATE.
      for (const [index, runner] of runners.entries()) {
        await runner.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [
          orders[index].id,
        ]);
        await runner.query('UPDATE orders SET "userId"=$1 WHERE id=$2', [
          user.id,
          orders[index].id,
        ]);
      }
      const results = await Promise.allSettled(
        runners.map(async (runner) => {
          try {
            await runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
              user.id,
            ]);
          } catch (error) {
            // Release the aborted transaction so its peer can finish as well.
            await runner.rollbackTransaction();
            throw error;
          }
        }),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.status).toBe('rejected');
      if (rejected?.status === 'rejected') {
        expect(rejected.reason).toHaveProperty('driverError.code', '40P01');
      }
    } finally {
      for (const runner of runners) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    }
    expect(await ds.getRepository(Order).countBy({ userId: user.id })).toBe(0);
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: user.id }))
        .totalSpent,
    ).toBe(0);
  }, 20000);

  it('serializes disjoint links before the FK update and keeps both delivered totals', async () => {
    await ds.getRepository(Order).update(
      { id: In(orders.map((o) => o.id)) },
      {
        status: OrderStatus.ENTREGADO,
      },
    );
    const holder = ds.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
      user.id,
    ]);
    const service = app.get(OrdersService);
    const pending = Promise.allSettled(
      orders.map((order) => service.linkAnonymousOrders(user.id, [order.id])),
    );
    try {
      const deadline = Date.now() + 10000;
      let blocked = 0;
      do {
        const [row] = await ds.query<{ count: string }[]>(
          `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
            AND state='active' AND wait_event_type='Lock'
            AND query LIKE '%users%' AND query LIKE '%FOR UPDATE%'`,
        );
        blocked = Number(row.count);
      } while (blocked < 2 && Date.now() < deadline);
      // PostgreSQL itself proves both transactions reached the user-lock boundary.
      expect(blocked).toBe(2);
      expect(await ds.getRepository(Order).countBy({ userId: user.id })).toBe(
        0,
      );
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
      // Always drain in-flight work, including when a barrier assertion fails.
      await pending;
    }
    const results = await pending;
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(await ds.getRepository(Order).countBy({ userId: user.id })).toBe(2);
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: user.id }))
        .totalSpent,
    ).toBe(30);
    const linked = await ds
      .getRepository(Order)
      .findBy({ id: In(orders.map((o) => o.id)) });
    expect(linked.map((order) => order.customerPhone)).toEqual([
      user.phone,
      user.phone,
    ]);
  }, 20000);

  it('rolls back FK changes when a later operation fails', async () => {
    await ds.getRepository(Order).update(
      { id: In(orders.map((o) => o.id)) },
      {
        status: OrderStatus.ENTREGADO,
      },
    );
    const service = app.get(OrdersService);
    // The domain overflow check runs after a real FK UPDATE and forces rollback.
    await ds
      .getRepository(User)
      .update({ id: user.id }, { totalSpent: 99999999.99 });
    await expect(
      service.linkAnonymousOrders(user.id, [orders[0].id]),
    ).rejects.toThrow('totalSpent');
    expect(await ds.getRepository(Order).countBy({ userId: user.id })).toBe(0);
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: user.id }))
        .totalSpent,
    ).toBe(99999999.99);
    expect(
      await ds
        .getRepository(Order)
        .countBy({ id: In(orders.map((o) => o.id)) }),
    ).toBe(2);
  });

  it('rejects mixed ownership without linking any order', async () => {
    await ds
      .getRepository(Order)
      .update({ id: orders[1].id }, { userId: user.id });
    await expect(
      app.get(OrdersService).linkAnonymousOrders(
        user.id,
        orders.map((order) => order.id),
      ),
    ).rejects.toThrow('No se vinculó ninguno');
    expect(
      (await ds.getRepository(Order).findOneByOrFail({ id: orders[0].id }))
        .userId,
    ).toBeNull();
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: user.id }))
        .totalSpent,
    ).toBe(0);
  });
});
