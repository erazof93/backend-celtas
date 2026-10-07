import { assertDisposableEnvironment } from './helpers/disposable-database';
import {
  ClassSerializerInterceptor,
  INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { getMessaging } from 'firebase-admin/messaging';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { Category } from '../src/modules/menu/entities/category.entity';
import { MenuItem } from '../src/modules/menu/entities/menu-item.entity';
import {
  Order,
  OrderStatus,
} from '../src/modules/orders/entities/order.entity';
import { OrdersService } from '../src/modules/orders/orders.service';
import { RewardRedemption } from '../src/modules/rewards/entities/reward-redemption.entity';
import { SettingsService } from '../src/modules/settings/settings.service';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(),
}));

describe('Phase 1A integrity (isolated PostgreSQL)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let customer: User;
  let admin: User;
  let mutable: User;
  let category: Category;
  let product: MenuItem;
  let adminToken: string;
  let customerToken: string;
  let mutableToken: string;
  const ids: string[] = [];
  const snapshot = JSON.stringify({
    alias: 'QA',
    fullAddress: 'QA',
    district: 'QA',
  });

  beforeAll(async () => {
    assertDisposableEnvironment();
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new TransformInterceptor(),
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    ds = app.get(DataSource);
    const identity = await ds.query<{ db: string }[]>(
      'SELECT current_database() AS db',
    );
    expect(identity[0].db).toBe(process.env.DB_DATABASE);
    jest
      .spyOn(app.get(SettingsService), 'isOpenNow')
      .mockResolvedValue({ open: true, message: null });
    const users = ds.getRepository(User);
    const createUser = async (role: UserRole) => {
      const user = await users.save(
        users.create({
          email: `phase1a-${randomUUID()}@test.local`,
          fullName: 'QA',
          role,
        }),
      );
      ids.push(user.id);
      return user;
    };
    customer = await createUser(UserRole.CLIENTE);
    admin = await createUser(UserRole.ADMIN);
    mutable = await createUser(UserRole.ADMIN);
    const jwt = app.get(JwtService);
    const token = (user: User) =>
      jwt.sign({ sub: user.id, email: user.email, role: user.role });
    adminToken = token(admin);
    customerToken = token(customer);
    mutableToken = token(mutable);
    category = await ds
      .getRepository(Category)
      .save(
        ds.getRepository(Category).create({ name: `Phase1A ${randomUUID()}` }),
      );
    product = await ds.getRepository(MenuItem).save(
      ds.getRepository(MenuItem).create({
        name: 'QA',
        categoryId: category.id,
        price: 10,
        redeemableWithStars: true,
      }),
    );
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(User).delete({ id: In(ids) });
      if (product) await ds.getRepository(MenuItem).delete(product.id);
      if (category) await ds.getRepository(Category).delete(category.id);
    }
    await app?.close();
  });

  const deliver = (id: string) =>
    request(app.getHttpServer() as App)
      .patch(`/orders/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: OrderStatus.ENTREGADO });
  const createReadyOrder = (total: number) =>
    ds.getRepository(Order).save(
      ds.getRepository(Order).create({
        userId: customer.id,
        status: OrderStatus.EN_CAMINO,
        total,
        addressSnapshot: snapshot,
        whatsappUrl: 'https://wa.me/51999999999',
      }),
    );

  it('sums concurrent deliveries of independent orders without lost updates', async () => {
    await ds.getRepository(User).update(customer.id, { totalSpent: 0 });
    const first = await createReadyOrder(10.1);
    const second = await createReadyOrder(20.2);
    await Promise.all([
      deliver(first.id).expect(200),
      deliver(second.id).expect(200),
    ]);
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: customer.id }))
        .totalSpent,
    ).toBe(30.3);
  });

  it('serializes duplicate transitions of the same order', async () => {
    await ds.getRepository(User).update(customer.id, { totalSpent: 0 });
    const order = await createReadyOrder(7.25);
    const responses = await Promise.all([deliver(order.id), deliver(order.id)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: customer.id }))
        .totalSpent,
    ).toBe(7.25);
  });

  it('rolls back the increment if saving the transition fails', async () => {
    await ds.getRepository(User).update(customer.id, { totalSpent: 12.34 });
    const order = await createReadyOrder(5.67);
    const transaction = ds.transaction.bind(ds) as DataSource['transaction'];
    jest.spyOn(ds, 'transaction').mockImplementation(((
      work: (manager: EntityManager) => Promise<unknown>,
    ) =>
      transaction(async (manager) => {
        jest
          .spyOn(manager, 'save')
          .mockRejectedValue(new Error('controlled persistence failure'));
        return work(manager);
      })) as typeof ds.transaction);
    await expect(
      app
        .get(OrdersService)
        .updateStatus(order.id, { status: OrderStatus.ENTREGADO }),
    ).rejects.toThrow('controlled persistence failure');
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: customer.id }))
        .totalSpent,
    ).toBe(12.34);
    expect(
      (await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status,
    ).toBe(OrderStatus.EN_CAMINO);
  });

  it('keeps profile, FCM and role changes in concurrent partial updates', async () => {
    const users = app.get(UsersService);
    await Promise.all([
      users.updateProfile(customer.id, { fullName: 'Concurrent QA' }),
      users.updateFcmToken(customer.id, 'local-controlled-token'),
      users.updateRole(admin.id, customer.id, UserRole.ADMIN),
    ]);
    const fresh = await ds
      .getRepository(User)
      .findOneByOrFail({ id: customer.id });
    expect(fresh.fullName).toBe('Concurrent QA');
    expect(fresh.fcmToken).toBe('local-controlled-token');
    expect(fresh.role).toBe(UserRole.ADMIN);
    expect(fresh.updatedAt.getTime()).toBeGreaterThanOrEqual(
      customer.updatedAt.getTime(),
    );
    await ds
      .getRepository(User)
      .update(customer.id, { role: UserRole.CLIENTE, fcmToken: null });
  });

  it('uses current roles over old claims in real guarded HTTP requests', async () => {
    const users = ds.getRepository(User);
    await request(app.getHttpServer() as App)
      .get('/settings')
      .set('Authorization', `Bearer ${mutableToken}`)
      .expect(200);
    await request(app.getHttpServer() as App)
      .patch(`/users/${mutable.id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: UserRole.CLIENTE })
      .expect(200);
    await request(app.getHttpServer() as App)
      .get('/settings')
      .set('Authorization', `Bearer ${mutableToken}`)
      .expect(403);
    await users.update(customer.id, { role: UserRole.ADMIN });
    await request(app.getHttpServer() as App)
      .get('/settings')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    await users.update(customer.id, { role: UserRole.CLIENTE });
    await users.delete(mutable.id);
    await request(app.getHttpServer() as App)
      .get('/settings')
      .set('Authorization', `Bearer ${mutableToken}`)
      .expect(401);
  });

  it('rejects mixed-case reward UUID duplicates without persisting/consuming', async () => {
    const rewards = ds.getRepository(RewardRedemption);
    const reward = await rewards.save(
      rewards.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: customer.id,
        earnedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      }),
    );
    const before = await ds.getRepository(Order).count();
    jest
      .spyOn(app.get(SettingsService), 'isOpenNow')
      .mockResolvedValue({ open: true, message: null });
    await request(app.getHttpServer() as App)
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        addressSnapshot: snapshot,
        items: [
          {
            menuItemId: product.id,
            quantity: 1,
            rewardRedemptionId: reward.id,
          },
          {
            menuItemId: product.id,
            quantity: 1,
            rewardRedemptionId: reward.id.toUpperCase(),
          },
        ],
      })
      .expect(400);
    expect(await ds.getRepository(Order).count()).toBe(before);
    expect(
      (await rewards.findOneByOrFail({ id: reward.id })).usedAt,
    ).toBeNull();
  });

  it('returns HTTP 201 and persists the order despite recipient lookup failure', async () => {
    jest
      .spyOn(app.get(SettingsService), 'isOpenNow')
      .mockResolvedValue({ open: true, message: null });
    const repo = ds.getRepository(User);
    jest
      .spyOn(repo, 'find')
      .mockRejectedValue(
        new Error('controlled notification recipient failure'),
      );
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const response = await request(app.getHttpServer() as App)
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        addressSnapshot: snapshot,
        items: [{ menuItemId: product.id, quantity: 1 }],
      })
      .expect(201);
    const body = response.body as { data: { id: string } };
    expect(
      await ds.getRepository(Order).findOneBy({ id: body.data.id }),
    ).not.toBeNull();
    expect(logger).toHaveBeenCalled();
  });

  it.each(['token lookup', 'Firebase', 'cleanup'] as const)(
    'preserves HTTP success after controlled %s failure',
    async (failure) => {
      jest
        .spyOn(app.get(SettingsService), 'isOpenNow')
        .mockResolvedValue({ open: true, message: null });
      const repo = ds.getRepository(User);
      const update = repo.update.bind(repo) as typeof repo.update;
      const findOne = repo.findOne.bind(repo) as typeof repo.findOne;
      const token = 'local-sensitive-token-not-for-logs';
      await update(admin.id, { fcmToken: token });
      const providerError = Object.assign(
        new Error(`controlled failure ${token}`),
        {
          code:
            failure === 'cleanup'
              ? 'messaging/registration-token-not-registered'
              : 'messaging/internal-error',
        },
      );
      jest.mocked(getMessaging).mockReturnValue({
        send: jest.fn().mockRejectedValue(providerError),
      } as never);
      if (failure === 'token lookup') {
        jest
          .spyOn(repo, 'findOne')
          .mockImplementation((options) =>
            (options.where as { id?: string }).id === admin.id
              ? Promise.reject(new Error('controlled token lookup failure'))
              : findOne(options),
          );
      }
      if (failure === 'cleanup')
        jest
          .spyOn(repo, 'update')
          .mockRejectedValue(new Error('controlled cleanup failure'));
      const logger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        const response = await request(app.getHttpServer() as App)
          .post('/orders')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({
            addressSnapshot: snapshot,
            items: [{ menuItemId: product.id, quantity: 1 }],
          })
          .expect(201);
        const body = response.body as { data: { id: string } };
        expect(
          await ds.getRepository(Order).findOneBy({ id: body.data.id }),
        ).not.toBeNull();
        expect(logger).toHaveBeenCalled();
        expect(JSON.stringify(logger.mock.calls)).not.toContain(token);
      } finally {
        await update(admin.id, { fcmToken: null });
      }
    },
  );
});
