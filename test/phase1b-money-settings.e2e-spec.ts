import { assertDisposableEnvironment } from './helpers/disposable-database';
import { DeliveryPolygon } from '../src/modules/delivery/polygon.util';
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { MAX_MONEY, toCents } from '../src/common/utils/money.util';
import {
  Coupon,
  CouponDiscountType,
  CouponStatus,
} from '../src/modules/coupons/entities/coupon.entity';
import { DeliveryZone } from '../src/modules/delivery/entities/delivery-zone.entity';
import { Category } from '../src/modules/menu/entities/category.entity';
import { MenuItem } from '../src/modules/menu/entities/menu-item.entity';
import {
  Order,
  OrderStatus,
} from '../src/modules/orders/entities/order.entity';
import { Setting } from '../src/modules/settings/entities/setting.entity';
import { SettingsService } from '../src/modules/settings/settings.service';
import { User, UserRole } from '../src/modules/users/entities/user.entity';

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));

interface CreatedOrder {
  id: string;
  total: number;
  deliveryFee: number;
  whatsappUrl: string;
  items: { subtotal: number }[];
  deliverySnapshot: {
    deliveryMode: string;
    zone: { id: string; name: string } | null;
  };
}
interface Envelope<T> {
  data: T;
}

describe('Phase 1B money/settings (isolated PostgreSQL)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let customer: User;
  let admin: User;
  let product: MenuItem;
  let category: Category;
  let settings: Setting[];
  let customerToken: string;
  let adminToken: string;
  const polygon: DeliveryPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  };
  const snapshot = JSON.stringify({
    alias: 'QA',
    fullAddress: 'QA',
    district: 'QA',
    latitude: 0.5,
    longitude: 0.5,
  });
  const patchSetting = (key: string, value: string) =>
    request(app.getHttpServer() as App)
      .patch('/settings')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ key, value });
  const checkout = (quantity = 1, couponCode?: string, latitude = 0.5) =>
    request(app.getHttpServer() as App)
      .post('/orders')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        addressSnapshot: JSON.stringify({
          ...(JSON.parse(snapshot) as Record<string, unknown>),
          latitude,
        }),
        items: [{ menuItemId: product.id, quantity }],
        ...(couponCode ? { couponCode } : {}),
      });
  beforeAll(async () => {
    assertDisposableEnvironment();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
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
    settings = await ds.getRepository(Setting).find();
    customer = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: 'phase1b-customer@test.local',
        fullName: 'QA',
        role: UserRole.CLIENTE,
      }),
    );
    admin = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: 'phase1b-admin@test.local',
        fullName: 'QA',
        role: UserRole.ADMIN,
      }),
    );
    const jwt = app.get(JwtService);
    customerToken = jwt.sign({ sub: customer.id, role: customer.role });
    adminToken = jwt.sign({ sub: admin.id, role: admin.role });
    category = await ds
      .getRepository(Category)
      .save(ds.getRepository(Category).create({ name: 'Phase1B QA' }));
    product = await ds
      .getRepository(MenuItem)
      .save(
        ds
          .getRepository(MenuItem)
          .create({ name: 'QA', categoryId: category.id, price: 10.01 }),
      );
  });
  beforeEach(async () => {
    jest
      .spyOn(app.get(SettingsService), 'isOpenNow')
      .mockResolvedValue({ open: true, message: null });
    await patchSetting('delivery_mode', 'DISTANCE').expect(200);
    await patchSetting(
      'store_location',
      JSON.stringify({ latitude: 0.5, longitude: 0.5 }),
    ).expect(200);
    await patchSetting(
      'delivery_fee_tiers',
      JSON.stringify([{ maxMeters: null, fee: 2 }]),
    ).expect(200);
    await ds.getRepository(MenuItem).update(product.id, { price: 10.01 });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await ds.getRepository(Setting).save(settings.map((row) => ({ ...row })));
    await ds.getRepository(DeliveryZone).deleteAll();
    await ds.getRepository(Order).delete({ userId: customer.id });
    await ds.getRepository(Coupon).delete({ userId: customer.id });
  });
  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(User).delete(customer.id);
      await ds.getRepository(User).delete(admin.id);
      await ds.getRepository(MenuItem).delete(product.id);
      await ds.getRepository(Category).delete(category.id);
    }
    await app?.close();
  });

  it.each(['null', '{}', '[]', '{', '[{"maxMeters":null,"fee":-1}]'])(
    'rejects invalid tiers without persisting %s',
    async (value) => {
      const before = await ds
        .getRepository(Setting)
        .findOneByOrFail({ key: 'delivery_fee_tiers' });
      await patchSetting('delivery_fee_tiers', value).expect(400);
      expect(
        (
          await ds
            .getRepository(Setting)
            .findOneByOrFail({ key: 'delivery_fee_tiers' })
        ).value,
      ).toBe(before.value);
    },
  );
  it.each([
    ['store_location', JSON.stringify({ latitude: 91, longitude: 0 })],
    ['store_location', JSON.stringify({ latitude: -91, longitude: 0 })],
    ['store_location', JSON.stringify({ latitude: 0, longitude: 181 })],
    ['store_location', JSON.stringify({ latitude: 0, longitude: -181 })],
    ['delivery_alert_radius_meters', 'NaN'],
    ['delivery_alert_radius_meters', 'Infinity'],
    ['delivery_alert_radius_meters', '0'],
    ['delivery_alert_radius_meters', '-1'],
    ['business_hours_schedule', '{}'],
    ['delivery_mode', 'UNKNOWN'],
    ['delivery_fee_tiers', '[{"maxMeters":null,"fee":1e309}]'],
    ['delivery_fee_tiers', '[{"maxMeters":100,"fee":2}]'],
    [
      'delivery_fee_tiers',
      '[{"maxMeters":200,"fee":2},{"maxMeters":100,"fee":3},{"maxMeters":null,"fee":4}]',
    ],
  ])(
    'rejects invalid %s via HTTP without changing the row',
    async (key, value) => {
      const repo = ds.getRepository(Setting);
      const before = await repo.findOneByOrFail({ key });
      const response = await patchSetting(key, value).expect(400);
      expect((response.body as { statusCode: number }).statusCode).toBe(400);
      const after = await repo.findOneByOrFail({ key });
      expect(after.value).toBe(before.value);
      expect(after.updatedAt).toEqual(before.updatedAt);
    },
  );

  it.each(['/menu/items', '/beverages', '/extra-portions'])(
    'rejects price overflow on %s',
    async (path) => {
      await request(app.getHttpServer() as App)
        .post(path)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({
          name: 'Overflow',
          ...(path === '/menu/items' ? { categoryId: category.id } : {}),
          price: MAX_MONEY + 0.01,
        })
        .expect(400);
    },
  );
  it('rejects zone fee overflow and accepts the exact maximum', async () => {
    await request(app.getHttpServer() as App)
      .post('/delivery/zones')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: 'QA', polygon, fee: MAX_MONEY + 0.01 })
      .expect(400);
    await request(app.getHttpServer() as App)
      .post('/delivery/zones')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: 'QA', polygon, fee: MAX_MONEY })
      .expect(201);
  });
  it.each([
    [50, 2, 7],
    [50, 0, 5],
    [0, 0, 10.01],
    [100, 2, 2],
  ])(
    'percentage %s and delivery %s stays coherent',
    async (percentage, fee, total) => {
      await patchSetting(
        'delivery_fee_tiers',
        JSON.stringify([{ maxMeters: null, fee }]),
      ).expect(200);
      const code = 'QA1BPCT';
      await ds.getRepository(Coupon).save(
        ds.getRepository(Coupon).create({
          userId: customer.id,
          code,
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: percentage,
          status: CouponStatus.ACTIVE,
          expiresAt: new Date('2099-01-01'),
        }),
      );
      const result = await checkout(1, code).expect(201);
      const order = (result.body as Envelope<CreatedOrder>).data;
      expect(order.total).toBe(total);
      expect(order.deliveryFee).toBe(fee);
      const discount = toCents(10.01) + toCents(fee) - toCents(total);
      expect(toCents(10.01) - discount + toCents(fee)).toBe(
        toCents(order.total),
      );
      const stored = await ds
        .getRepository(Order)
        .findOneByOrFail({ id: order.id });
      expect(stored.total).toBe(total);
      expect(stored.deliveryFee).toBe(fee);
      const regenerated = await request(app.getHttpServer() as App)
        .get('/orders/admin/' + order.id + '/whatsapp-links')
        .set('Authorization', 'Bearer ' + adminToken)
        .expect(200);
      const links = (regenerated.body as Envelope<{ store: { url: string } }>)
        .data;
      expect(decodeURIComponent(links.store.url)).toBe(
        decodeURIComponent(order.whatsappUrl),
      );
      if (percentage === 50)
        expect(decodeURIComponent(order.whatsappUrl)).toContain('-S/ 5.01');
    },
  );
  it('fixed discount is capped at subtotal and leaves delivery untouched', async () => {
    await ds.getRepository(Coupon).save(
      ds.getRepository(Coupon).create({
        userId: customer.id,
        code: 'QA1BFIX',
        discountType: CouponDiscountType.FIXED_AMOUNT,
        discountValue: 20,
        status: CouponStatus.ACTIVE,
        expiresAt: new Date('2099-01-01'),
      }),
    );
    const result = await checkout(1, 'QA1BFIX').expect(201);
    expect((result.body as Envelope<CreatedOrder>).data.total).toBe(2);
  });
  it.each([
    ['quantity', 2, 0],
    ['total', 1, 0.01],
  ])(
    'rejects %s overflow before order persistence',
    async (_label, quantity, fee) => {
      await ds.getRepository(MenuItem).update(product.id, { price: MAX_MONEY });
      await patchSetting(
        'delivery_fee_tiers',
        JSON.stringify([{ maxMeters: null, fee }]),
      ).expect(200);
      await checkout(quantity).expect(400);
      expect(
        await ds.getRepository(Order).countBy({ userId: customer.id }),
      ).toBe(0);
    },
  );
  it('rejects aggregated subtotal overflow without consuming coupon', async () => {
    await ds.getRepository(MenuItem).update(product.id, { price: MAX_MONEY });
    const coupon = await ds.getRepository(Coupon).save(
      ds.getRepository(Coupon).create({
        userId: customer.id,
        code: 'QA1BOVER',
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 100,
        status: CouponStatus.ACTIVE,
        expiresAt: new Date('2099-01-01'),
      }),
    );
    await request(app.getHttpServer() as App)
      .post('/orders')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        addressSnapshot: snapshot,
        couponCode: coupon.code,
        items: [
          { menuItemId: product.id, quantity: 1 },
          { menuItemId: product.id, quantity: 1 },
        ],
      })
      .expect(400);
    expect(await ds.getRepository(Order).countBy({ userId: customer.id })).toBe(
      0,
    );
    expect(
      (await ds.getRepository(Coupon).findOneByOrFail({ id: coupon.id }))
        .status,
    ).toBe(CouponStatus.ACTIVE);
  });
  it('accepts maximum order total', async () => {
    await ds.getRepository(MenuItem).update(product.id, { price: MAX_MONEY });
    await patchSetting(
      'delivery_fee_tiers',
      JSON.stringify([{ maxMeters: null, fee: 0 }]),
    ).expect(200);
    expect(
      ((await checkout().expect(201)).body as Envelope<CreatedOrder>).data
        .total,
    ).toBe(MAX_MONEY);
  });
  it('rolls back delivery transition when totalSpent would overflow', async () => {
    await ds.getRepository(User).update(customer.id, { totalSpent: MAX_MONEY });
    const order = await ds.getRepository(Order).save(
      ds.getRepository(Order).create({
        userId: customer.id,
        status: OrderStatus.EN_CAMINO,
        total: 0.01,
        addressSnapshot: snapshot,
        whatsappUrl: 'https://wa.me/51999999999',
      }),
    );
    await request(app.getHttpServer() as App)
      .patch('/orders/' + order.id + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: OrderStatus.ENTREGADO })
      .expect(400);
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: customer.id }))
        .totalSpent,
    ).toBe(MAX_MONEY);
    expect(
      (await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status,
    ).toBe(OrderStatus.EN_CAMINO);
  });
  it('serializes concurrent deliveries at the monetary limit without partial delivery', async () => {
    await ds
      .getRepository(User)
      .update(customer.id, { totalSpent: MAX_MONEY - 0.01 });
    const repo = ds.getRepository(Order);
    const orders = await repo.save(
      [0, 1].map(() =>
        repo.create({
          userId: customer.id,
          status: OrderStatus.EN_CAMINO,
          total: 0.01,
          addressSnapshot: snapshot,
          whatsappUrl: 'https://wa.me/51999999999',
        }),
      ),
    );
    const responses = await Promise.all(
      orders.map((order) =>
        request(app.getHttpServer() as App)
          .patch('/orders/' + order.id + '/status')
          .set('Authorization', 'Bearer ' + adminToken)
          .send({ status: OrderStatus.ENTREGADO }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    const rejected = responses.find((response) => response.status === 400);
    expect((rejected?.body as { message: string }).message).toContain(
      'totalSpent',
    );
    expect(
      (await ds.getRepository(User).findOneByOrFail({ id: customer.id }))
        .totalSpent,
    ).toBe(MAX_MONEY);
    const fresh = await Promise.all(
      orders.map((order) => repo.findOneByOrFail({ id: order.id })),
    );
    expect(
      fresh.filter((order) => order.status === OrderStatus.ENTREGADO),
    ).toHaveLength(1);
    const pending = fresh.find(
      (order) => order.status === OrderStatus.EN_CAMINO,
    );
    expect(pending).toBeDefined();
    expect(pending?.deliveredAt).toBeNull();
  });

  it('keeps ZONES fee zero, coverage, snapshot and no DISTANCE fallback', async () => {
    const zone = await ds
      .getRepository(DeliveryZone)
      .save(
        ds
          .getRepository(DeliveryZone)
          .create({ name: 'Free QA', polygon, fee: 0, active: true }),
      );
    await patchSetting('delivery_mode', 'ZONES').expect(200);
    const estimate = await request(app.getHttpServer() as App)
      .get('/delivery/estimate')
      .set('Authorization', 'Bearer ' + customerToken)
      .query({ latitude: 0.5, longitude: 0.5 })
      .expect(200);
    expect(
      (estimate.body as Envelope<Record<string, unknown>>).data,
    ).toMatchObject({
      deliveryFee: 0,
      isCovered: true,
      deliveryMode: 'ZONES',
      zone: { id: zone.id, name: zone.name },
    });
    const covered = await checkout().expect(201);
    expect((covered.body as Envelope<CreatedOrder>).data).toMatchObject({
      total: 10.01,
      deliveryFee: 0,
      deliverySnapshot: {
        deliveryMode: 'ZONES',
        zone: { id: zone.id, name: zone.name },
      },
    });
    const uncovered = await request(app.getHttpServer() as App)
      .get('/delivery/estimate')
      .set('Authorization', 'Bearer ' + customerToken)
      .query({ latitude: 2, longitude: 0.5 })
      .expect(200);
    expect(
      (uncovered.body as Envelope<Record<string, unknown>>).data,
    ).toMatchObject({
      deliveryFee: 0,
      isFarOrder: true,
      isCovered: false,
      deliveryMode: 'ZONES',
      zone: null,
    });
    await checkout(1, undefined, 2).expect(400);
    await patchSetting('delivery_mode', 'DISTANCE').expect(200);
    expect(
      (
        await ds
          .getRepository(Setting)
          .findOneByOrFail({ key: 'delivery_fee_tiers' })
      ).value,
    ).toBe(JSON.stringify([{ maxMeters: null, fee: 2 }]));
    expect(await ds.getRepository(DeliveryZone).count()).toBe(1);
    expect(
      ((await checkout().expect(201)).body as Envelope<CreatedOrder>).data
        .deliveryFee,
    ).toBe(2);
  });
});
