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
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { Order } from '../src/modules/orders/entities/order.entity';
import { RewardRedemption } from '../src/modules/rewards/entities/reward-redemption.entity';
import { StarPromotion } from '../src/modules/rewards/entities/star-promotion.entity';
import { RewardsService } from '../src/modules/rewards/rewards.service';
import { StarPromotionsService } from '../src/modules/rewards/star-promotions.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AddressesService } from '../src/modules/users/addresses.service';
import { Address } from '../src/modules/users/entities/address.entity';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));

// A barrier controls the interleaving without mocking PostgreSQL writes or locks.
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Phase 1C concurrency (real isolated PostgreSQL)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let customer: User;
  let admin: User;
  let customerToken: string;
  let adminToken: string;
  let category: Category;
  let products: MenuItem[];
  const userIds: string[] = [];
  const promotionIds: string[] = [];
  const address = { alias: 'QA', fullAddress: 'QA', district: 'QA' };
  const snapshot = JSON.stringify(address);
  const rewardIds = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ];
  const promo = {
    label: 'Phase1C',
    multiplier: 2,
    startDate: '2098-01-01',
    endDate: '2098-01-10',
    active: true,
  };
  const http = () => request(app.getHttpServer() as App);
  const createAddress = (isDefault = false) =>
    http()
      .post('/users/me/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ ...address, isDefault });
  const patchAddress = (id: string, patch: object) =>
    http()
      .patch(`/users/me/addresses/${id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(patch);
  const createPromo = (data: object) =>
    http()
      .post('/star-promotions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(data);
  const patchPromo = (id: string, data: object) =>
    http()
      .patch(`/star-promotions/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(data);
  const defaultCount = () =>
    ds.getRepository(Address).countBy({ userId: customer.id, isDefault: true });
  const remember = (response: request.Response) => {
    if (response.status === 201)
      promotionIds.push((response.body as { data: { id: string } }).data.id);
    return response;
  };
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
    expect(
      (await ds.query<{ db: string }[]>('SELECT current_database() AS db'))[0]
        .db,
    ).toBe(process.env.DB_DATABASE);
    const users = ds.getRepository(User);
    customer = await users.save(
      users.create({
        email: `phase1c-customer-${randomUUID()}@test.local`,
        fullName: 'QA',
        role: UserRole.CLIENTE,
      }),
    );
    admin = await users.save(
      users.create({
        email: `phase1c-admin-${randomUUID()}@test.local`,
        fullName: 'QA',
        role: UserRole.ADMIN,
      }),
    );
    userIds.push(customer.id, admin.id);
    const jwt = app.get(JwtService);
    customerToken = jwt.sign({
      sub: customer.id,
      email: customer.email,
      role: customer.role,
    });
    adminToken = jwt.sign({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    });
    category = await ds
      .getRepository(Category)
      .save(
        ds.getRepository(Category).create({ name: `Phase1C ${randomUUID()}` }),
      );
    products = await ds.getRepository(MenuItem).save(
      ['A', 'B'].map((name) =>
        ds.getRepository(MenuItem).create({
          name,
          categoryId: category.id,
          price: 10,
          redeemableWithStars: true,
        }),
      ),
    );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await ds.getRepository(Order).delete({ userId: customer.id });
    await ds.getRepository(RewardRedemption).delete({ userId: customer.id });
    await ds.getRepository(Address).delete({ userId: customer.id });
    if (promotionIds.length)
      await ds
        .getRepository(StarPromotion)
        .delete({ id: In(promotionIds.splice(0)) });
    await ds
      .getRepository(User)
      .update({ id: In(userIds) }, { fcmToken: null });
  });
  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(User).delete({ id: In(userIds) });
      if (products)
        await ds
          .getRepository(MenuItem)
          .delete({ id: In(products.map((product) => product.id)) });
      if (category) await ds.getRepository(Category).delete(category.id);
    }
    await app?.close();
  });
  it('serializes two HTTP creates of default addresses and retains nullable coordinates', async () => {
    const responses = await Promise.all([
      createAddress(true),
      createAddress(true),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(await defaultCount()).toBe(1);
    const rows = await ds
      .getRepository(Address)
      .findBy({ userId: customer.id });
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) => row.latitude === null && row.longitude === null),
    ).toBe(true);
  });
  it('serializes two HTTP default updates', async () => {
    const first = await createAddress().expect(201);
    const second = await createAddress().expect(201);
    const id = (response: request.Response) =>
      (response.body as { data: { id: string } }).data.id;
    const responses = await Promise.all([
      patchAddress(id(first), { isDefault: true }),
      patchAddress(id(second), { isDefault: true }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await defaultCount()).toBe(1);
  });
  it('editing a principal concurrently with selecting another cannot resurrect it', async () => {
    const service = app.get(AddressesService);
    const first = await service.create(customer.id, {
      ...address,
      isDefault: true,
    });
    const second = await service.create(customer.id, address);
    await Promise.all([
      service.update(customer.id, first.id, { alias: 'Edited' }),
      service.update(customer.id, second.id, { isDefault: true }),
    ]);
    expect(await defaultCount()).toBe(1);
    expect(
      (await ds.getRepository(Address).findOneByOrFail({ id: second.id }))
        .isDefault,
    ).toBe(true);
  });
  it('rolls back unsetDefault when saving the replacement fails', async () => {
    const service = app.get(AddressesService);
    const first = await service.create(customer.id, {
      ...address,
      isDefault: true,
    });
    const transaction = ds.manager.transaction.bind(
      ds.manager,
    ) as typeof ds.manager.transaction;
    const implementation = (
      isolation: 'READ COMMITTED',
      work: (manager: EntityManager) => Promise<Address>,
    ) =>
      transaction(isolation, async (manager) => {
        jest
          .spyOn(manager.getRepository(Address), 'save')
          .mockRejectedValue(
            new Error('controlled address persistence failure'),
          );
        return work(manager);
      });
    jest.spyOn(ds.manager, 'transaction').mockImplementation(implementation);
    await expect(
      service.create(customer.id, { ...address, isDefault: true }),
    ).rejects.toThrow('controlled address persistence failure');
    expect(await defaultCount()).toBe(1);
    expect(
      (await ds.getRepository(Address).findOneByOrFail({ id: first.id }))
        .isDefault,
    ).toBe(true);
    expect(
      await ds.getRepository(Address).countBy({ userId: customer.id }),
    ).toBe(1);
  });
  it('only one concurrent overlapping promotion create commits; nonoverlap remains allowed', async () => {
    const responses = (
      await Promise.all([createPromo(promo), createPromo(promo)])
    ).map(remember);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);
    expect(
      (
        responses.find((response) => response.status === 400)?.body as {
          message: string;
        }
      ).message,
    ).toContain('fechas');
    expect(
      await ds
        .getRepository(StarPromotion)
        .countBy({ id: In(promotionIds), active: true }),
    ).toBe(1);
    remember(
      await createPromo({
        ...promo,
        startDate: '2098-02-01',
        endDate: '2098-02-10',
      }).expect(201),
    );
  });
  it('serializes a create against an overlapping activation/update', async () => {
    const initial = remember(
      await createPromo({ ...promo, active: false }).expect(201),
    );
    const id = (initial.body as { data: { id: string } }).data.id;
    const responses = (
      await Promise.all([createPromo(promo), patchPromo(id, { active: true })])
    ).map(remember);
    expect(
      responses
        .map((response) => response.status)
        .filter((status) => status === 400),
    ).toHaveLength(1);
    expect(
      responses.filter(
        (response) => response.status === 200 || response.status === 201,
      ),
    ).toHaveLength(1);
    expect(
      await ds
        .getRepository(StarPromotion)
        .countBy({ id: In(promotionIds), active: true }),
    ).toBe(1);
  });
  it('serializes two overlapping activations', async () => {
    const first = remember(
      await createPromo({ ...promo, active: false }).expect(201),
    );
    const second = remember(
      await createPromo({ ...promo, active: false }).expect(201),
    );
    const id = (response: request.Response) =>
      (response.body as { data: { id: string } }).data.id;
    const responses = await Promise.all([
      patchPromo(id(first), { active: true }),
      patchPromo(id(second), { active: true }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    expect(
      await ds
        .getRepository(StarPromotion)
        .countBy({ id: In(promotionIds), active: true }),
    ).toBe(1);
  });
  it('promotion rollback releases the catalog lock', async () => {
    await expect(
      app
        .get(StarPromotionsService)
        .create({ ...promo, startDate: '2098-02-01' }),
    ).rejects.toThrow('startDate');
    remember(await createPromo(promo).expect(201));
    const locks = await ds.query<{ count: string }[]>(
      "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND classid = 731942 AND objid = 2 AND granted",
    );
    expect(Number(locks[0].count)).toBe(0);
  });
  const seedRewards = async (expiredSecond = false) =>
    ds.getRepository(RewardRedemption).save(
      rewardIds.map((id, index) =>
        ds.getRepository(RewardRedemption).create({
          id,
          userId: customer.id,
          earnedAt: new Date(),
          expiresAt: new Date(
            expiredSecond && index === 1 ? '2000-01-01' : '2099-01-01',
          ),
          milestoneStars: index + 1,
        }),
      ),
    );
  const place = (reversed: boolean) => {
    const items = products.map((product, index) => ({
      menuItemId: product.id,
      quantity: 1,
      rewardRedemptionId: rewardIds[index].toUpperCase(),
    }));
    if (reversed) items.reverse();
    return http()
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ addressSnapshot: snapshot, items });
  };
  it('opposite reward requests serialize on canonical UUID order without deadlock or double consumption', async () => {
    await seedRewards();
    jest
      .spyOn(app.get(SettingsService), 'isOpenNow')
      .mockResolvedValue({ open: true, message: null });
    const rewards = app.get(RewardsService);
    const original = rewards.validateForOrder.bind(
      rewards,
    ) as typeof rewards.validateForOrder;
    const secondStarted = signal();
    let calls = 0;
    const attempted: string[] = [];
    jest
      .spyOn(rewards, 'validateForOrder')
      .mockImplementation(async (manager, params) => {
        const call = ++calls;
        attempted.push(params.rewardRedemptionId);
        if (call === 2) secondStarted.resolve();
        const result = await original(manager, params);
        if (call === 1) await secondStarted.promise;
        return result;
      });
    const responses = await Promise.all([place(false), place(true)]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);
    expect(attempted.slice(0, 2)).toEqual([rewardIds[0], rewardIds[0]]);
    const winnerIndex = responses.findIndex(
      (response) => response.status === 201,
    );
    const body = responses[winnerIndex].body as {
      data: { id: string; items: { menuItemId: string }[] };
    };
    const expectedOrder = products.map((product) => product.id);
    if (winnerIndex === 1) expectedOrder.reverse();
    expect(body.data.items.map((item) => item.menuItemId)).toEqual(
      expectedOrder,
    );
    expect(await ds.getRepository(Order).countBy({ userId: customer.id })).toBe(
      1,
    );
    for (let index = 0; index < rewardIds.length; index++) {
      const reward = await ds
        .getRepository(RewardRedemption)
        .findOneByOrFail({ id: rewardIds[index] });
      expect(reward.usedInOrderId).toBe(body.data.id);
      expect(reward.menuItemId).toBe(products[index].id);
    }
  }, 15000);
  it('rolls back all reward consumption if a later canonical claim is expired', async () => {
    await seedRewards(true);
    jest
      .spyOn(app.get(SettingsService), 'isOpenNow')
      .mockResolvedValue({ open: true, message: null });
    await place(true).expect(400);
    expect(await ds.getRepository(Order).countBy({ userId: customer.id })).toBe(
      0,
    );
    const rewards = await ds
      .getRepository(RewardRedemption)
      .findBy({ userId: customer.id });
    expect(
      rewards.every(
        (reward) => reward.usedAt === null && reward.usedInOrderId === null,
      ),
    ).toBe(true);
  });
  const unregistered = () =>
    Object.assign(new Error('provider included local-private-token-A'), {
      code: 'messaging/registration-token-not-registered',
    });
  it.each([false, true])(
    'conditional single cleanup preserves a concurrent replacement (changed=%s)',
    async (changed) => {
      await app
        .get(UsersService)
        .updateFcmToken(customer.id, 'local-private-token-A');
      const started = signal();
      const release = signal();
      jest.mocked(getMessaging).mockReturnValue({
        send: jest.fn(async () => {
          started.resolve();
          await release.promise;
          throw unregistered();
        }),
      } as never);
      const logger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const sending = app
        .get(NotificationsService)
        .sendPushNotification(customer.id, { title: 'QA', body: 'QA' });
      await started.promise;
      if (changed)
        await app
          .get(UsersService)
          .updateFcmToken(customer.id, 'local-private-token-B');
      release.resolve();
      expect(await sending).toBe(false);
      expect(
        (await ds.getRepository(User).findOneByOrFail({ id: customer.id }))
          .fcmToken,
      ).toBe(changed ? 'local-private-token-B' : null);
      expect(logger).toHaveBeenCalled();
      expect(JSON.stringify(logger.mock.calls)).not.toContain(
        'local-private-token-A',
      );
    },
  );
  it('broadcast conditional cleanup clears unchanged A but retains concurrently replaced B', async () => {
    await app
      .get(UsersService)
      .updateFcmToken(customer.id, 'local-private-token-A');
    await app.get(UsersService).updateFcmToken(admin.id, 'local-admin-token-A');
    const started = signal();
    const release = signal();
    jest.mocked(getMessaging).mockReturnValue({
      sendEachForMulticast: jest.fn(async (message: { tokens: string[] }) => {
        started.resolve();
        await release.promise;
        return {
          successCount: 0,
          responses: message.tokens.map(() => ({
            success: false,
            error: unregistered(),
          })),
        };
      }),
    } as never);
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const sending = app
      .get(NotificationsService)
      .broadcastPushNotification({ title: 'QA', body: 'QA' });
    await started.promise;
    await app
      .get(UsersService)
      .updateFcmToken(customer.id, 'local-private-token-B');
    release.resolve();
    expect(await sending).toEqual({ sent: 0, total: 2 });
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: customer.id }))
        .fcmToken,
    ).toBe('local-private-token-B');
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: admin.id })).fcmToken,
    ).toBeNull();
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      'local-private-token-A',
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      'local-admin-token-A',
    );
  });
});
