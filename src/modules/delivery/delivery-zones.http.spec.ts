import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { UsersService } from '../users/users.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { DeliveryController } from '../orders/delivery.controller';
import { OrdersService } from '../orders/orders.service';
import { DeliveryZonesController } from './delivery-zones.controller';
import { DeliveryZonesService } from './delivery-zones.service';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { UserRole } from '../users/entities/user.entity';

/** HTTP contracts with real JWT/role guards and service, in-memory persistence only.
 * Does not import AppModule, contact PostgreSQL, or register external integrations.
 */
describe('Delivery zones HTTP (isolated)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let clientToken: string;
  const rows = new Map<string, DeliveryZone>();
  const polygon: DeliveryZone['polygon'] = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  };
  const adjacent: DeliveryZone['polygon'] = {
    type: 'Polygon',
    coordinates: [
      [
        [2, 0],
        [4, 0],
        [4, 2],
        [2, 2],
        [2, 0],
      ],
    ],
  };
  const body = { name: 'Centro', polygon, fee: 5 };
  const estimator = { estimateDeliveryByCoords: jest.fn() };

  const send = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path = '/delivery/zones',
    token: string | null = adminToken,
  ) => {
    const req = request(app.getHttpServer())[method](path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  beforeAll(async () => {
    const repo = {
      find: ({ where }: { where?: { active: boolean } } = {}) =>
        Promise.resolve(
          [...rows.values()]
            .filter((z) => !where || z.active === where.active)
            .sort((a, b) => a.id.localeCompare(b.id)),
        ),
      findOneBy: ({ id }: { id: string }) =>
        Promise.resolve(rows.get(id) ?? null),
    };
    const manager = {
      query: () => Promise.resolve([]),
      find: () => Promise.resolve([...rows.values()]),
      findOneBy: (_type: unknown, { id }: { id: string }) =>
        Promise.resolve(rows.has(id) ? { ...rows.get(id)! } : null),
      create: (_type: unknown, dto: Partial<DeliveryZone>) => ({
        ...dto,
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      merge: (
        _type: unknown,
        entity: DeliveryZone,
        dto: Partial<DeliveryZone>,
      ) => {
        for (const [key, value] of Object.entries(dto))
          if (value !== undefined) Object.assign(entity, { [key]: value });
        return entity;
      },
      save: (_type: unknown, entity: DeliveryZone) => {
        rows.set(entity.id, entity);
        return Promise.resolve(entity);
      },
      remove: (_type: unknown, entity: DeliveryZone) => {
        rows.delete(entity.id);
        return Promise.resolve(entity);
      },
    };
    const adminId = randomUUID();
    const clientId = randomUUID();
    const secret = 'delivery-http-test-secret-local-only';
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [DeliveryZonesController, DeliveryController],
      providers: [
        JwtStrategy,
        {
          provide: UsersService,
          useValue: {
            findById: (id: string) =>
              Promise.resolve(
                id === adminId
                  ? { id, email: 'admin@test.local', role: UserRole.ADMIN }
                  : id === clientId
                    ? { id, email: 'client@test.local', role: UserRole.CLIENTE }
                    : null,
              ),
          },
        },
        DeliveryZonesService,
        { provide: ConfigService, useValue: { get: () => secret } },
        { provide: getRepositoryToken(DeliveryZone), useValue: repo },
        {
          provide: DataSource,
          useValue: {
            transaction: (
              _isolation: string,
              cb: (m: typeof manager) => Promise<unknown>,
            ) => cb(manager),
          },
        },
        { provide: OrdersService, useValue: estimator },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    const jwt = app.get(JwtService);
    adminToken = jwt.sign({
      sub: adminId,
      email: 'admin@test.local',
      role: UserRole.ADMIN,
    });
    clientToken = jwt.sign({
      sub: clientId,
      email: 'client@test.local',
      role: UserRole.CLIENTE,
    });
  });
  beforeEach(() => {
    rows.clear();
    estimator.estimateDeliveryByCoords.mockReset();
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(['get', 'post', 'patch', 'delete'] as const)(
    'requires real auth and admin role: %s',
    async (method) => {
      const path =
        method === 'patch' || method === 'delete'
          ? `/delivery/zones/${randomUUID()}`
          : '/delivery/zones';
      await send(method, path, null).send(body).expect(401);
      await send(method, path, 'invalid-token').send(body).expect(401);
      await send(method, path, clientToken).send(body).expect(403);
    },
  );

  it('creates, lists, gets, patches, deactivates and deletes with explicit contracts', async () => {
    const created = await send('post')
      .send({ ...body, name: '  Centro  ' })
      .expect(201);
    const data = (created.body as { success: boolean; data: DeliveryZone })
      .data;
    expect(created.body).toMatchObject({
      success: true,
      data: { name: 'Centro', polygon, fee: 5, active: true },
    });
    expect(typeof data.createdAt).toBe('string');
    expect((await send('get').expect(200)).body).toMatchObject({
      success: true,
      data: [{ id: data.id }],
    });
    await send('get', `/delivery/zones/${data.id}`).expect(200);
    const patched = await send('patch', `/delivery/zones/${data.id}`)
      .send({ name: 'Sur', fee: 6, active: false })
      .expect(200);
    expect(patched.body).toMatchObject({
      data: { id: data.id, name: 'Sur', fee: 6, polygon, active: false },
    });
    expect(await app.get(DeliveryZonesService).resolve(1, 1)).toBeNull();
    await send('delete', `/delivery/zones/${data.id}`).expect(200);
    await send('get', `/delivery/zones/${data.id}`).expect(404);
  });

  it.each([
    { ...body, name: ' ' },
    { ...body, name: 'x'.repeat(101) },
    { ...body, fee: '5' },
    { ...body, fee: -1 },
    { ...body, fee: 1.001 },
    { ...body, fee: 100000000 },
    { ...body, fee: null },
    { ...body, active: null },
    { ...body, active: 'true' },
    { ...body, polygon: null },
    { ...body, polygon: {} },
    { ...body, polygon: { type: 'MultiPolygon', coordinates: [] } },
    {
      ...body,
      polygon: {
        ...polygon,
        coordinates: [polygon.coordinates[0], polygon.coordinates[0]],
      },
    },
    { ...body, extra: true },
  ])('rejects invalid creation payload %j', async (payload) => {
    const res = await send('post').send(payload).expect(400);
    expect(res.body).toMatchObject({ success: false, statusCode: 400 });
    expect(rows.size).toBe(0);
  });

  it('rejects null PATCH fields and bad UUIDs; omitted fields remain unchanged', async () => {
    const created = await send('post').send(body).expect(201);
    const id = (created.body as { data: DeliveryZone }).data.id;
    for (const field of ['name', 'polygon', 'fee', 'active']) {
      await send('patch', `/delivery/zones/${id}`)
        .send({ [field]: null })
        .expect(400);
    }
    await send('get', '/delivery/zones/not-a-uuid').expect(400);
    await send('patch', `/delivery/zones/${randomUUID()}`)
      .send({ fee: 6 })
      .expect(404);
    await send('delete', `/delivery/zones/${randomUUID()}`).expect(404);
  });

  it('rejects overlapping creation/edit but permits shared borders with deterministic resolution', async () => {
    const first = (await send('post').send(body).expect(201)).body as {
      data: DeliveryZone;
    };
    await send('post')
      .send({ ...body, name: 'Duplicada', active: false })
      .expect(409);
    const second = (
      await send('post')
        .send({ ...body, name: 'Vecina', polygon: adjacent })
        .expect(201)
    ).body as { data: DeliveryZone };
    await send('patch', `/delivery/zones/${second.data.id}`)
      .send({ polygon })
      .expect(409);
    const result = await app.get(DeliveryZonesService).resolve(1, 2);
    expect(result?.id).toBe([first.data.id, second.data.id].sort()[0]);
    expect(await app.get(DeliveryZonesService).resolve(0, 0)).toMatchObject({
      id: first.data.id,
    });
    expect(await app.get(DeliveryZonesService).resolve(3, 3)).toBeNull();
  });

  it('keeps the authenticated estimate envelope and rejects invalid coordinates', async () => {
    const estimate = {
      deliveryFee: 5,
      distanceMeters: 100,
      isFarOrder: false,
      deliveryMode: 'ZONES',
      isCovered: true,
      zone: { id: randomUUID(), name: 'Centro' },
    };
    estimator.estimateDeliveryByCoords.mockResolvedValue(estimate);
    const path = '/delivery/estimate?latitude=-12&longitude=-77';
    expect((await send('get', path, clientToken).expect(200)).body).toEqual({
      success: true,
      data: estimate,
    });
    await send('get', path, null).expect(401);
    for (const query of [
      '',
      '?latitude=&longitude=0',
      '?latitude=91&longitude=0',
      '?latitude=0&longitude=181',
      '?latitude=Infinity&longitude=0',
    ]) {
      await send('get', `/delivery/estimate${query}`, clientToken).expect(400);
    }
    expect(estimator.estimateDeliveryByCoords).toHaveBeenCalledTimes(1);
  });

  it('publishes explicit request and response DTOs in Swagger', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(document.paths['/delivery/zones'].post?.requestBody).toBeDefined();
    expect(document.components?.schemas?.CreateDeliveryZoneDto).toBeDefined();
    expect(document.components?.schemas?.DeliveryZoneResponseDto).toBeDefined();
    expect(document.components?.schemas?.DeliveryEstimateDto).toBeDefined();
    expect(document.components?.schemas?.DeliveryPolygonDto).toMatchObject({
      properties: {
        type: { enum: ['Polygon'] },
        coordinates: { minItems: 1, maxItems: 1 },
      },
    });
    expect(
      document.paths['/delivery/estimate'].get?.responses['200'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/DeliveryEstimateResponseDto' },
        },
      },
    });
  });
});
