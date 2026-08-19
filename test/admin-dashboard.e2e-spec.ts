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

interface SummaryData {
  ordersCount: number;
  ordersByStatus: { status: string; count: number }[];
  revenue: number;
}

interface TopProductsData {
  items: {
    menuItemId: string;
    name: string;
    quantity: number;
    revenue: number;
  }[];
  limit: number;
}

/**
 * Dashboard (e2e). Usa FECHAS FIJAS en America/Lima (UTC-5) para que el test sea
 * determinista e independiente de la hora real (evita cruzar la medianoche de Lima).
 * Las aserciones son absolutas porque los pedidos se fijan a esas fechas.
 */
describe('Admin Dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let addressesRepo: Repository<Address>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let ordersRepo: Repository<Order>;
  let settingsRepo: Repository<Setting>;
  let businessHoursSnapshot: BusinessHoursSnapshot;

  let clientToken: string;
  let adminToken: string;
  let categoryId: string;
  let itemAId: string;
  let itemBId: string;
  let addressId: string;

  const suffix = Date.now();
  const clientEmail = `qa-dash-client-${suffix}@test.com`;
  const adminEmail = `qa-dash-admin-${suffix}@test.com`;
  const password = 'password123';

  // Fechas fijas en Lima (UTC-5).
  const DAY = '2026-08-01'; // "hoy" del test
  const PREV = '2026-07-31'; // "ayer" del test
  const lima = (date: string, time: string) =>
    new Date(`${date}T${time}-05:00`);

  const register = async (email: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName })
      .expect(201);
    return (res.body as AuthTokensResponse).data.accessToken;
  };

  const createOrder = (body: Record<string, unknown>) => {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(body);
  };

  const markDelivered = async (orderId: string) => {
    // Transiciones válidas: pendiente → confirmado → en_camino → entregado.
    for (const status of ['confirmado', 'en_camino', 'entregado']) {
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
    }
  };

  const getSummary = async (date: string): Promise<SummaryData> => {
    const res = await request(app.getHttpServer())
      .get(`/admin/dashboard/summary?from=${date}&to=${date}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return (res.body as Envelope).data as SummaryData;
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
    addressesRepo = app.get<Repository<Address>>(getRepositoryToken(Address));
    categoriesRepo = app.get<Repository<Category>>(
      getRepositoryToken(Category),
    );
    itemsRepo = app.get<Repository<MenuItem>>(getRepositoryToken(MenuItem));
    ordersRepo = app.get<Repository<Order>>(getRepositoryToken(Order));
    settingsRepo = app.get<Repository<Setting>>(getRepositoryToken(Setting));

    // Esta suite crea pedidos reales vía POST /orders (y luego reescribe su
    // createdAt a fechas fijas): forzar el local "abierto siempre" para que
    // la llamada inicial no dependa de la hora real de Lima en la que corre
    // (ver OrdersService.create, bloquea con 409 si está cerrado).
    businessHoursSnapshot = await forceBusinessAlwaysOpen(settingsRepo);

    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Dash QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    clientToken = await register(clientEmail, 'Cliente Dash');
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;

    // Menú de prueba
    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Dash ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;

    const itemA = await request(app.getHttpServer())
      .post('/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Clásica', price: 24.9, categoryId })
      .expect(201);
    itemAId = ((itemA.body as Envelope).data as { id: string }).id;

    const itemB = await request(app.getHttpServer())
      .post('/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Doble', price: 10.5, categoryId })
      .expect(201);
    itemBId = ((itemB.body as Envelope).data as { id: string }).id;

    const addr = await request(app.getHttpServer())
      .post('/users/me/addresses')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        alias: 'Casa',
        fullAddress: 'Av. Los Álamos 123',
        reference: 'Portón verde',
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
    await restoreBusinessHours(settingsRepo, businessHoursSnapshot);
    await app.close();
  });

  describe('GET /admin/dashboard/summary', () => {
    it('rechaza sin token (401) y con rol cliente (403)', async () => {
      await request(app.getHttpServer())
        .get('/admin/dashboard/summary')
        .expect(401);
      await request(app.getHttpServer())
        .get('/admin/dashboard/summary')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });

    it('rechaza formato de fecha inválido (400)', async () => {
      await request(app.getHttpServer())
        .get('/admin/dashboard/summary?from=01-08-2026')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('rechaza rango invertido from > to (400)', async () => {
      await request(app.getHttpServer())
        .get('/admin/dashboard/summary?from=2026-08-10&to=2026-08-01')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('revenue NO cuenta cancelados ni pendientes; cuenta entregados del día', async () => {
      // A: creado y entregado el día DAY (24.9 + 10.5 = 35.4)
      const orderA = await createOrder({
        addressId,
        items: [
          { menuItemId: itemAId, quantity: 1 },
          { menuItemId: itemBId, quantity: 1 },
        ],
      });
      const aId = ((orderA.body as Envelope).data as Order).id;
      await markDelivered(aId);
      await ordersRepo.update(aId, {
        createdAt: lima(DAY, '10:00:00.000'),
        deliveredAt: lima(DAY, '11:00:00.000'),
      });

      // C: cancelado (no debe contar en revenue)
      const orderC = await createOrder({
        addressId,
        items: [{ menuItemId: itemAId, quantity: 5 }],
      });
      const cId = ((orderC.body as Envelope).data as Order).id;
      await request(app.getHttpServer())
        .patch(`/orders/${cId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado' })
        .expect(200);
      await ordersRepo.update(cId, { createdAt: lima(DAY, '12:00:00.000') });

      // D: pendiente (no debe contar en revenue)
      const orderD = await createOrder({
        addressId,
        items: [{ menuItemId: itemAId, quantity: 3 }],
      });
      const dId = ((orderD.body as Envelope).data as Order).id;
      await ordersRepo.update(dId, { createdAt: lima(DAY, '13:00:00.000') });

      const data = await getSummary(DAY);

      // Revenue = solo A (35.4). C y D sin deliveredAt.
      expect(data.revenue).toBeCloseTo(35.4, 2);
      // Pedidos creados el DAY: A, C, D = 3.
      expect(data.ordersCount).toBe(3);
      const byStatus = Object.fromEntries(
        data.ordersByStatus.map((s) => [s.status, s.count]),
      );
      expect(byStatus['entregado']).toBe(1);
      expect(byStatus['cancelado']).toBe(1);
      expect(byStatus['pendiente']).toBe(1);
    });

    it('un pedido creado ayer pero entregado hoy cuenta en las ventas de hoy', async () => {
      // E: creado el PREV, entregado el DAY → revenue de DAY sí, ordersCount de DAY no.
      const orderE = await createOrder({
        addressId,
        items: [{ menuItemId: itemBId, quantity: 2 }], // 21.0
      });
      const eId = ((orderE.body as Envelope).data as Order).id;
      await markDelivered(eId);
      await ordersRepo.update(eId, {
        createdAt: lima(PREV, '12:00:00.000'),
        deliveredAt: lima(DAY, '14:00:00.000'),
      });

      const dayData = await getSummary(DAY);
      const prevData = await getSummary(PREV);

      // Entregado hoy → suma 21.0 al revenue de DAY (además de los 35.4 del test anterior).
      expect(dayData.revenue).toBeCloseTo(35.4 + 21.0, 2);
      // NO se creó el DAY → ordersCount de DAY no lo incluye.
      expect(dayData.ordersCount).toBe(3);
      // Se creó el PREV → +1 en ordersCount de PREV, pero revenue de PREV no cambia.
      expect(prevData.ordersCount).toBe(1);
      expect(prevData.revenue).toBe(0);
    });

    it('respeta la zona horaria de Lima: entregado ayer 23:59 cuenta en ayer, no en hoy', async () => {
      // B: entregado el PREV a las 23:59 Lima (= 04:59 UTC del DAY). Con UTC se contaría mal.
      const orderB = await createOrder({
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }], // 24.9
      });
      const bId = ((orderB.body as Envelope).data as Order).id;
      await markDelivered(bId);
      await ordersRepo.update(bId, {
        createdAt: lima(DAY, '09:00:00.000'),
        deliveredAt: lima(PREV, '23:59:00.000'),
      });

      const prevData = await getSummary(PREV);
      const dayData = await getSummary(DAY);

      // B entregado PREV 23:59 Lima → cuenta en revenue de PREV.
      expect(prevData.revenue).toBeCloseTo(24.9, 2);
      // B NO debe contar en revenue de DAY (aunque en UTC su deliveredAt sea del DAY).
      expect(dayData.revenue).toBeCloseTo(35.4 + 21.0, 2);
    });
  });

  describe('GET /admin/dashboard/top-products', () => {
    it('agrupa por producto, suma quantity/revenue y ordena descendente', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/dashboard/top-products?from=${DAY}&to=${DAY}&limit=10`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as TopProductsData;

      expect(data.limit).toBe(10);
      expect(data.items.length).toBeGreaterThan(0);
      // Orden descendente por quantity.
      const quantities = data.items.map((i) => i.quantity);
      for (let i = 1; i < quantities.length; i++) {
        expect(quantities[i - 1]).toBeGreaterThanOrEqual(quantities[i]);
      }
      // Usa el nombre del snapshot (nuestro item A se vendió el DAY).
      const clásica = data.items.find((i) => i.name === 'Clásica');
      expect(clásica).toBeDefined();
      expect(clásica!.revenue).toBeGreaterThan(0);
    });

    it('rechaza limit fuera de rango (400)', async () => {
      await request(app.getHttpServer())
        .get('/admin/dashboard/top-products?limit=0')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });
});
