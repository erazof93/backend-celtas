import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { Setting } from './../src/modules/settings/entities/setting.entity';
import {
  User,
  UserProvider,
  UserRole,
} from './../src/modules/users/entities/user.entity';
import {
  BusinessHoursSnapshot,
  forceBusinessAlwaysOpen,
  restoreBusinessHours,
} from './helpers/business-hours.helper';

interface Envelope {
  data: { id: string; accessToken: string; code: string };
}

/**
 * Complemento QA de `null-fields.e2e-spec.ts`: la guardia original solo cubre
 * los endpoints CRUD de catálogo/banners/premios/direcciones/perfil. Esta suite
 * manda `null` a los endpoints de escritura restantes (pedidos, cupones,
 * settings, auth, roles, fcm-token, reorder de banners) y exige que NINGUNO
 * responda 5xx. `POST /notifications/broadcast` y `/notifications/test` quedan
 * fuera a propósito: mandan push reales (revisados estáticamente).
 */
describe('null en endpoints de escritura no cubiertos por la guardia (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let usersRepo: Repository<User>;
  let settingsRepo: Repository<Setting>;
  let businessHours: BusinessHoursSnapshot;
  let adminToken: string;
  let clientToken: string;
  let clientId: string;
  let categoryId: string;
  let itemId: string;
  let addressId: string;

  const suffix = Date.now();
  const adminEmail = `qa-nullx-admin-${suffix}@test.com`;
  const clientEmail = `qa-nullx-client-${suffix}@test.com`;
  const registerEmail = `qa-nullx-reg-${suffix}@test.com`;
  const settingKey = `qa_nullx_${suffix}`;
  const password = 'password123';

  const send = (
    method: 'post' | 'patch',
    path: string,
    token: string | null,
    body: object,
  ) => {
    const r = request(app.getHttpServer())[method](path);
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r.send(body);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleFixture.createNestApplication();
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

    dataSource = app.get(DataSource);
    usersRepo = app.get<Repository<User>>(getRepositoryToken(User));
    settingsRepo = app.get<Repository<Setting>>(getRepositoryToken(Setting));
    businessHours = await forceBusinessAlwaysOpen(settingsRepo);

    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: await bcrypt.hash(password, 10),
        fullName: 'Admin NullX QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );
    const login = await send('post', '/auth/login', null, {
      email: adminEmail,
      password,
    }).expect(200);
    adminToken = (login.body as Envelope).data.accessToken;
    const reg = await send('post', '/auth/register', null, {
      email: clientEmail,
      password,
      fullName: 'Cliente NullX QA',
    }).expect(201);
    clientToken = (reg.body as Envelope).data.accessToken;
    clientId = (await usersRepo.findOneByOrFail({ email: clientEmail })).id;

    const cat = await send('post', '/menu/categories', adminToken, {
      name: `NullX cat ${suffix}`,
    }).expect(201);
    categoryId = (cat.body as Envelope).data.id;
    const item = await send('post', '/menu/items', adminToken, {
      name: `NullX item ${suffix}`,
      price: 10,
      categoryId,
    }).expect(201);
    itemId = (item.body as Envelope).data.id;
    const addr = await send('post', '/users/me/addresses', clientToken, {
      alias: 'Casa',
      fullAddress: 'Av. NullX 1',
      district: 'San Juan de Miraflores',
    }).expect(201);
    addressId = (addr.body as Envelope).data.id;
  });

  afterAll(async () => {
    for (const email of [adminEmail, clientEmail, registerEmail]) {
      const user = await usersRepo.findOneBy({ email });
      if (!user) continue;
      // Los order_items se borran en cascada con el pedido.
      await dataSource.query(`DELETE FROM "orders" WHERE "userId" = $1`, [
        user.id,
      ]);
      await dataSource.query(`DELETE FROM "coupons" WHERE "userId" = $1`, [
        user.id,
      ]);
      await dataSource.query(`DELETE FROM "addresses" WHERE "userId" = $1`, [
        user.id,
      ]);
      await usersRepo.delete({ id: user.id });
    }
    await dataSource.query(`DELETE FROM "menu_items" WHERE "categoryId" = $1`, [
      categoryId,
    ]);
    await dataSource.query(`DELETE FROM "categories" WHERE id = $1`, [
      categoryId,
    ]);
    await dataSource.query(`DELETE FROM "settings" WHERE key = $1`, [
      settingKey,
    ]);
    await restoreBusinessHours(settingsRepo, businessHours);
    await app.close();
  });

  it('Swagger: los Update DTOs no marcan ningún campo como requerido', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const schemas = doc.components?.schemas ?? {};
    for (const name of [
      'UpdateMenuItemDto',
      'UpdateCategoryDto',
      'UpdateSauceDto',
      'UpdateBeverageDto',
      'UpdateExtraPortionDto',
      'UpdateBannerDto',
      'UpdateRewardMilestoneDto',
      'UpdateStarPromotionDto',
      'UpdateAddressDto',
      'UpdateProfileDto',
    ]) {
      const schema = schemas[name] as {
        properties?: object;
        required?: string[];
      };
      expect(schema).toBeDefined();
      expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
      expect(schema.required ?? []).toEqual([]);
    }
  });

  it('POST /orders: null en campos opcionales de items[] nunca da 500', async () => {
    const failures: string[] = [];
    for (const field of [
      'sauceIds',
      'beverageIds',
      'extraPortionIds',
      'comment',
      'rewardRedemptionId',
      'quantity',
      'menuItemId',
    ]) {
      const res = await send('post', '/orders', clientToken, {
        addressId,
        items: [{ menuItemId: itemId, quantity: 1, [field]: null }],
      });
      if (res.status >= 500) failures.push(`items[0].${field} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  describe('POST /orders: tri-state de sauceIds/beverageIds/extraPortionIds', () => {
    const cases = [
      ['sauceIds', 'selectedSauces', 'sauceIds debe ser una lista'],
      ['beverageIds', 'selectedBeverages', 'beverageIds debe ser una lista'],
      [
        'extraPortionIds',
        'selectedExtraPortions',
        'extraPortionIds debe ser una lista',
      ],
    ] as const;

    const itemOf = (res: request.Response, key: string): unknown =>
      (res.body as { data: { items: Record<string, unknown>[] } }).data
        .items[0][key];

    it.each(cases)('%s: null → 400 en español', async (field, _key, msg) => {
      const res = await send('post', '/orders', clientToken, {
        addressId,
        items: [{ menuItemId: itemId, quantity: 1, [field]: null }],
      }).expect(400);
      expect((res.body as { message: string }).message).toContain(msg);
    });

    it.each(cases)('%s: omitido → 201 y snapshot null', async (_f, key) => {
      const res = await send('post', '/orders', clientToken, {
        addressId,
        items: [{ menuItemId: itemId, quantity: 1 }],
      }).expect(201);
      expect(itemOf(res, key)).toBeNull();
    });

    it.each(cases)('%s: [] → 201 y snapshot []', async (field, key) => {
      const res = await send('post', '/orders', clientToken, {
        addressId,
        items: [{ menuItemId: itemId, quantity: 1, [field]: [] }],
      }).expect(201);
      expect(itemOf(res, key)).toEqual([]);
    });
  });

  it('resto de endpoints de escritura: null nunca da 500', async () => {
    const items = [{ menuItemId: itemId, quantity: 1 }];
    const snapshot = JSON.stringify({
      alias: 'x',
      fullAddress: 'Av 1',
      district: 'SJM',
    });
    const coupon = {
      userId: clientId,
      discountType: 'fixed_amount',
      discountValue: 5,
    };
    const bulk = {
      discountType: 'fixed_amount',
      discountValue: 5,
      campaignName: `qa-nullx-${suffix}`,
    };
    type Case = [string, 'post' | 'patch', string, string | null, object];
    const cases: Case[] = [
      [
        'orders items',
        'post',
        '/orders',
        clientToken,
        { addressId, items: null },
      ],
      [
        'orders items[null]',
        'post',
        '/orders',
        clientToken,
        { addressId, items: [null] },
      ],
      [
        'orders couponCode',
        'post',
        '/orders',
        clientToken,
        { addressId, items, couponCode: null },
      ],
      [
        'orders addressId',
        'post',
        '/orders',
        clientToken,
        { addressId: null, addressSnapshot: snapshot, items },
      ],
      [
        'orders addressSnapshot',
        'post',
        '/orders',
        clientToken,
        { addressId, addressSnapshot: null, items },
      ],
      [
        'orders ambos',
        'post',
        '/orders',
        clientToken,
        { addressId: null, addressSnapshot: null, items },
      ],
      [
        'estimate addressId',
        'post',
        '/orders/estimate-delivery-fee',
        clientToken,
        { addressId: null },
      ],
      ...[
        'userId',
        'discountType',
        'discountValue',
        'minPurchaseAmount',
        'expiresAt',
      ].map(
        (f) =>
          [
            `generate ${f}`,
            'post',
            '/coupons/generate',
            adminToken,
            { ...coupon, [f]: null },
          ] as Case,
      ),
      ...['discountType', 'discountValue', 'campaignName'].map(
        (f) =>
          [
            `generate-bulk ${f}`,
            'post',
            '/coupons/generate-bulk',
            adminToken,
            { ...bulk, [f]: null },
          ] as Case,
      ),
      [
        'validate code',
        'post',
        '/coupons/validate',
        clientToken,
        { code: null },
      ],
      [
        'validate subtotal',
        'post',
        '/coupons/validate',
        clientToken,
        { code: 'NOEXISTE', subtotal: null },
      ],
      [
        'settings description (nueva)',
        'patch',
        '/settings',
        adminToken,
        { key: settingKey, value: 'x', description: null },
      ],
      [
        'settings description (existente)',
        'patch',
        '/settings',
        adminToken,
        { key: settingKey, value: 'y', description: null },
      ],
      [
        'settings value',
        'patch',
        '/settings',
        adminToken,
        { key: settingKey, value: null },
      ],
      [
        'settings key',
        'patch',
        '/settings',
        adminToken,
        { key: null, value: 'x' },
      ],
      [
        'register phone',
        'post',
        '/auth/register',
        null,
        { email: registerEmail, password, fullName: 'R', phone: null },
      ],
      [
        'register fullName',
        'post',
        '/auth/register',
        null,
        { email: `x${registerEmail}`, password, fullName: null },
      ],
      [
        'login password',
        'post',
        '/auth/login',
        null,
        { email: adminEmail, password: null },
      ],
      ['google idToken', 'post', '/auth/google', null, { idToken: null }],
      [
        'refresh refreshToken',
        'post',
        '/auth/refresh',
        null,
        { refreshToken: null },
      ],
      [
        'users role',
        'patch',
        `/users/${clientId}/role`,
        adminToken,
        { role: null },
      ],
      [
        'fcm-token',
        'patch',
        '/users/me/fcm-token',
        clientToken,
        { fcmToken: null },
      ],
      [
        'banners reorder order',
        'patch',
        '/banners/reorder',
        adminToken,
        { items: [{ id: itemId, order: null }] },
      ],
      [
        'banners reorder item',
        'patch',
        '/banners/reorder',
        adminToken,
        { items: [null] },
      ],
    ];
    const failures: string[] = [];
    for (const [label, method, path, token, body] of cases) {
      const res = await send(method, path, token, body);
      if (res.status >= 500) failures.push(`${label} → ${res.status}`);
    }

    // PATCH /orders/:id/status con cancelReason null (desde pendiente y en_camino).
    const statusPath = async () => {
      const res = await send('post', '/orders', clientToken, {
        addressId,
        items,
      }).expect(201);
      return `/orders/${(res.body as Envelope).data.id}/status`;
    };
    const pending = await statusPath();
    for (const body of [
      { status: null },
      { status: 'cancelado', cancelReason: null },
    ]) {
      const res = await send('patch', pending, adminToken, body);
      if (res.status >= 500)
        failures.push(`status ${JSON.stringify(body)} → ${res.status}`);
    }
    const onTheWay = await statusPath();
    await send('patch', onTheWay, adminToken, { status: 'confirmado' }).expect(
      200,
    );
    await send('patch', onTheWay, adminToken, { status: 'en_camino' }).expect(
      200,
    );
    const res = await send('patch', onTheWay, adminToken, {
      status: 'cancelado',
      cancelReason: null,
    });
    if (res.status >= 500)
      failures.push(`status en_camino cancelReason → ${res.status}`);

    expect(failures).toEqual([]);
  });
});
