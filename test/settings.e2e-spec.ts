import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { Category } from './../src/modules/menu/entities/category.entity';
import { MenuItem } from './../src/modules/menu/entities/menu-item.entity';
import { Order } from './../src/modules/orders/entities/order.entity';
import { Setting } from './../src/modules/settings/entities/setting.entity';
import {
  BUSINESS_HOURS_SCHEDULE_KEY,
  BUSINESS_MANUAL_CLOSED_KEY,
  BUSINESS_MANUAL_CLOSED_REASON_KEY,
  WHATSAPP_NUMBER_KEY,
} from './../src/modules/settings/settings.service';
import { Address } from './../src/modules/users/entities/address.entity';
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

interface AuthTokensResponse {
  success: boolean;
  data: { accessToken: string };
}

interface Envelope {
  data: unknown;
}

interface OrderData {
  id: string;
  whatsappUrl: string;
}

describe('Settings (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let settingsRepo: Repository<Setting>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let addressesRepo: Repository<Address>;
  let ordersRepo: Repository<Order>;
  let businessHoursSnapshot: BusinessHoursSnapshot;

  let adminToken: string;
  let clientToken: string;
  let adminId: string;
  let clientId: string;

  let categoryId: string;
  let itemId: string;
  let addressId: string;

  const suffix = Date.now();
  const adminEmail = `qa-settings-admin-${suffix}@test.com`;
  const clientEmail = `qa-settings-client-${suffix}@test.com`;
  const password = 'password123';

  const register = async (email: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName })
      .expect(201);
    return (res.body as AuthTokensResponse).data.accessToken;
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

    usersRepo = app.get<Repository<User>>(getRepositoryToken(User));
    settingsRepo = app.get<Repository<Setting>>(getRepositoryToken(Setting));
    categoriesRepo = app.get<Repository<Category>>(
      getRepositoryToken(Category),
    );
    itemsRepo = app.get<Repository<MenuItem>>(getRepositoryToken(MenuItem));
    addressesRepo = app.get<Repository<Address>>(getRepositoryToken(Address));
    ordersRepo = app.get<Repository<Order>>(getRepositoryToken(Order));

    // Esta suite crea pedidos reales vía POST /orders (además de probar el
    // horario en su propio describe block): forzar el local "abierto
    // siempre" primero para que la llamada inicial no dependa de la hora
    // real de Lima en la que corre (ver OrdersService.create, bloquea con
    // 409 si está cerrado). Los tests de `GET /settings/business-hours`
    // siguen pudiendo activar el cierre MANUAL por su cuenta: el override
    // manual siempre gana sobre el horario programado.
    businessHoursSnapshot = await forceBusinessAlwaysOpen(settingsRepo);

    const adminHash = await bcrypt.hash(password, 10);
    const admin = await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Settings QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );
    adminId = admin.id;

    clientToken = await register(clientEmail, 'Cliente Settings');
    const client = await usersRepo.findOne({ where: { email: clientEmail } });
    clientId = client!.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;

    // Menú y dirección para crear pedidos (verificar el número usado en whatsappUrl).
    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Settings Burgers ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;

    const item = await request(app.getHttpServer())
      .post('/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Settings Clásica', price: 24.9, categoryId })
      .expect(201);
    itemId = ((item.body as Envelope).data as { id: string }).id;

    const addr = await request(app.getHttpServer())
      .post('/users/me/addresses')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        alias: 'Casa',
        fullAddress: 'Av. Settings 123',
        district: 'San Juan de Miraflores',
        isDefault: true,
      })
      .expect(201);
    addressId = ((addr.body as Envelope).data as { id: string }).id;
  });

  afterAll(async () => {
    const users = await usersRepo.find({
      where: [{ email: clientEmail }, { email: adminEmail }],
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await ordersRepo.delete(ids.map((id) => ({ userId: id })));
      await addressesRepo.delete(ids.map((id) => ({ userId: id })));
    }
    await itemsRepo.delete({ categoryId });
    await categoriesRepo.delete({ id: categoryId });
    await usersRepo.delete({ email: clientEmail });
    await usersRepo.delete({ email: adminEmail });
    // Restaurar la setting de WhatsApp (este suite la muta/borra) para no dejar
    // estado compartido que afecte a otras suites sobre la misma BD.
    await settingsRepo.delete({ key: WHATSAPP_NUMBER_KEY });
    await settingsRepo.save(
      settingsRepo.create({
        key: WHATSAPP_NUMBER_KEY,
        value: '51999999999',
        description:
          'Número de WhatsApp del negocio (formato internacional sin +)',
      }),
    );
    // Restaurar el horario de atención (este suite lo fuerza "abierto
    // siempre" arriba, y lo muta para probar el cierre manual) por si algún
    // test falló antes de revertirlo por su cuenta.
    await restoreBusinessHours(settingsRepo, businessHoursSnapshot);
    await app.close();
  });

  describe('GET /settings/public', () => {
    it('devuelve solo las keys de la whitelist (sin auth)', async () => {
      const res = await request(app.getHttpServer())
        .get('/settings/public')
        .expect(200);
      const data = (res.body as Envelope).data as Record<string, string>;
      expect(data[WHATSAPP_NUMBER_KEY]).toBeTruthy();
      // Las 3 keys del horario de atención se siembran en onModuleInit y no
      // son sensibles: deben salir junto con el número de WhatsApp.
      expect(data[BUSINESS_HOURS_SCHEDULE_KEY]).toBeTruthy();
      const parseSchedule = (): void => {
        JSON.parse(data[BUSINESS_HOURS_SCHEDULE_KEY]) as unknown;
      };
      expect(parseSchedule).not.toThrow();
      expect(data[BUSINESS_MANUAL_CLOSED_KEY]).toBe('false');
      expect(data[BUSINESS_MANUAL_CLOSED_REASON_KEY]).toBeDefined();
    });

    it('NO expone keys fuera de la whitelist', async () => {
      // Admin crea una setting interna que NO está en la whitelist.
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'secret_internal', value: 'no-debe-salir' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/settings/public')
        .expect(200);
      const data = (res.body as Envelope).data as Record<string, string>;
      expect(data['secret_internal']).toBeUndefined();
    });
  });

  describe('GET /settings (admin)', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer()).get('/settings').expect(401);
    });

    it('403 para un cliente', async () => {
      await request(app.getHttpServer())
        .get('/settings')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });

    it('lista todas las settings para un admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as { key: string }[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.some((s) => s.key === WHATSAPP_NUMBER_KEY)).toBe(true);
    });
  });

  describe('PATCH /settings (admin)', () => {
    it('401 sin token y 403 para cliente', async () => {
      await request(app.getHttpServer())
        .patch('/settings')
        .send({ key: 'x', value: 'y' })
        .expect(401);
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ key: 'x', value: 'y' })
        .expect(403);
    });

    it('400 si falta key o value', async () => {
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'solo-key' })
        .expect(400);
    });
  });

  describe('WhatsApp number en pedidos', () => {
    it('un pedido nuevo usa el número de la tabla, no el de .env, si ambos existen', async () => {
      // Cambiar el número en la tabla a un valor distinto del .env (51999999999).
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: WHATSAPP_NUMBER_KEY, value: '51911111111' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ addressId, items: [{ menuItemId: itemId, quantity: 1 }] })
        .expect(201);
      const order = (res.body as Envelope).data as OrderData;
      expect(order.whatsappUrl).toContain('wa.me/51911111111');
      expect(order.whatsappUrl).not.toContain('wa.me/51999999999');
    });

    it('cae al .env como fallback si la tabla está vacía', async () => {
      // Simula un despliegue sin sembrar: borra la fila de la tabla.
      await settingsRepo.delete({ key: WHATSAPP_NUMBER_KEY });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ addressId, items: [{ menuItemId: itemId, quantity: 1 }] })
        .expect(201);
      const order = (res.body as Envelope).data as OrderData;
      // El .env tiene 51999999999.
      expect(order.whatsappUrl).toContain('wa.me/51999999999');
    });
  });

  describe('GET /settings/business-hours', () => {
    afterEach(async () => {
      // Dejar el override manual apagado para no afectar otros tests/suites.
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: BUSINESS_MANUAL_CLOSED_KEY, value: 'false' })
        .expect(200);
      // NOTA (hallazgo de QA): UpdateSettingDto.value tiene @IsNotEmpty, por lo
      // que PATCH /settings NO puede usarse para volver el motivo a "" (string
      // vacío real) — el admin real tampoco podría hacerlo vía API. Se limpia
      // directo por repositorio para no dejar estado sucio entre tests.
      await settingsRepo.update(
        { key: BUSINESS_MANUAL_CLOSED_REASON_KEY },
        { value: '' },
      );
    });

    it('sin auth, devuelve { open, message, schedule, manualClosed, nextChangeAt } reflejando el estado real', async () => {
      const res = await request(app.getHttpServer())
        .get('/settings/business-hours')
        .expect(200);
      const data = (res.body as Envelope).data as {
        open: boolean;
        message: string | null;
        schedule: Record<string, unknown>;
        manualClosed: boolean;
        nextChangeAt: string | null;
      };
      expect(typeof data.open).toBe('boolean');
      expect(data.manualClosed).toBe(false);
      expect(data.schedule).toBeTruthy();
      expect(data.schedule['5']).toBeTruthy();
      // Sin cierre manual, con el horario default (nunca los 7 días cerrados),
      // siempre hay un próximo cambio predecible: ISO 8601 UTC válido y futuro.
      expect(data.nextChangeAt).not.toBeNull();
      const nextChangeAt = new Date(data.nextChangeAt as string);
      expect(nextChangeAt.toISOString()).toBe(data.nextChangeAt);
      expect(nextChangeAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('activar el cierre manual (con motivo) vía PATCH /settings hace que el endpoint refleje open:false con el mensaje exacto', async () => {
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: BUSINESS_MANUAL_CLOSED_KEY, value: 'true' })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          key: BUSINESS_MANUAL_CLOSED_REASON_KEY,
          value: 'Cerrado por QA e2e',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/settings/business-hours')
        .expect(200);
      const data = (res.body as Envelope).data as {
        open: boolean;
        message: string | null;
        manualClosed: boolean;
        nextChangeAt: string | null;
      };
      expect(data.open).toBe(false);
      expect(data.manualClosed).toBe(true);
      expect(data.message).toBe(
        'El local está cerrado temporalmente: Cerrado por QA e2e',
      );
      // Un cierre manual puede levantarse en cualquier momento: no es predecible.
      expect(data.nextChangeAt).toBeNull();
    });

    it('POST /orders devuelve 409 con el mismo mensaje mientras el cierre manual está activo, y no crea el pedido', async () => {
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: BUSINESS_MANUAL_CLOSED_KEY, value: 'true' })
        .expect(200);

      const before = await ordersRepo.count({ where: { userId: clientId } });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ addressId, items: [{ menuItemId: itemId, quantity: 1 }] })
        .expect(409);
      expect((res.body as { message: string }).message).toContain(
        'cerrado temporalmente',
      );

      const after = await ordersRepo.count({ where: { userId: clientId } });
      expect(after).toBe(before);
    });

    it('POST /orders vuelve a funcionar normalmente (201) apenas se reabre el local manualmente', async () => {
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: BUSINESS_MANUAL_CLOSED_KEY, value: 'false' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ addressId, items: [{ menuItemId: itemId, quantity: 1 }] })
        .expect(201);
    });
  });

  describe('PATCH /users/:id/role (admin)', () => {
    it('401 sin token y 403 para cliente', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${clientId}/role`)
        .send({ role: 'admin' })
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/users/${clientId}/role`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ role: 'admin' })
        .expect(403);
    });

    it('400 si el admin intenta quitarse su propio rol', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${adminId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'cliente' })
        .expect(400);
    });

    it('400 si el rol no es válido', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${clientId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'superadmin' })
        .expect(400);
    });

    it('un admin puede cambiar el rol de otro usuario', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${clientId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' })
        .expect(200);
      const data = (res.body as Envelope).data as { role: string };
      expect(data.role).toBe('admin');
    });
  });
});
