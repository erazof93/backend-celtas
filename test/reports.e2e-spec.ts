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
import {
  Order,
  OrderSource,
} from './../src/modules/orders/entities/order.entity';
import { percentChange } from './../src/modules/reports/reports.service';
import type {
  DailyMetricsDay,
  ReportComparison,
  ReportConversion,
  ReportSummary,
  ReportTopProduct,
} from './../src/modules/reports/reports.service';
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
  data: { accessToken: string };
}

interface Envelope {
  data: unknown;
}

interface ErrorResponse {
  message: string | string[];
  statusCode: number;
}

/**
 * Reportes (e2e). Usa FECHAS FIJAS de enero/febrero 2024 en America/Lima (ninguna
 * otra suite las usa) para que las aserciones sean absolutas. Los montos se
 * comparan contra el `total` real de cada pedido (incluye el delivery vigente).
 *
 * Datos (X = S/20, Y = S/10). A y B son clientes registrados; B tiene celular PB.
 * - o9: app A, X×1, entregado 15/01 (período anterior de comparison)
 * - o1: app A, X×2, entregado lun 05/02
 * - o2: app A, Y×1, entregado mar 06/02
 * - o3: teléfono anónimo P1 (sin cuenta), X×1, entregado 06/02
 * - o4: teléfono anónimo con el celular de B, Y×3, entregado lun 12/02 → cuenta como B
 * - o5: app B, X×1, entregado 20/02 → B se convirtió (8 días)
 * - o8: app A, X×1, entregado 29/02 23:30 Lima (= 01/03 04:30 UTC): es de febrero
 * - o6: app A cancelado y o7: app A pendiente, creados el 06/02
 */
describe('Reports (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let addressesRepo: Repository<Address>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let ordersRepo: Repository<Order>;
  let settingsRepo: Repository<Setting>;
  let businessHoursSnapshot: BusinessHoursSnapshot;

  let adminToken: string;
  let tokenA: string;
  let tokenB: string;
  let categoryId: string;
  let itemX: string;
  let itemY: string;
  let addressA: string;
  let addressB: string;
  const anonOrderIds: string[] = [];
  const total: Record<string, number> = {};

  const suffix = Date.now();
  const tail = String(suffix).slice(-8);
  const phoneB = `9${tail}`;
  const phoneP1 = `9${String((Number(tail) + 1) % 100_000_000).padStart(8, '0')}`;
  const emailA = `qa-reports-a-${suffix}@test.com`;
  const emailB = `qa-reports-b-${suffix}@test.com`;
  const adminEmail = `qa-reports-admin-${suffix}@test.com`;
  const password = 'password123';

  const lima = (date: string, time: string) =>
    new Date(`${date}T${time}-05:00`);
  const hoursBefore = (instant: Date, hours: number) =>
    new Date(instant.getTime() - hours * 3_600_000);
  const sum = (...keys: string[]) =>
    Math.round(keys.reduce((acc, key) => acc + total[key], 0) * 100) / 100;

  const register = async (email: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName })
      .expect(201);
    return (res.body as AuthTokensResponse).data.accessToken;
  };

  const createAddress = async (token: string) => {
    const res = await request(app.getHttpServer())
      .post('/users/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        alias: 'Casa',
        fullAddress: 'Av. Los Álamos 123',
        reference: 'Portón verde',
        district: 'San Juan de Miraflores',
        isDefault: true,
      })
      .expect(201);
    return ((res.body as Envelope).data as { id: string }).id;
  };

  const appOrder = async (
    token: string,
    addressId: string,
    items: { menuItemId: string; quantity: number }[],
  ) => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId, items })
      .expect(201);
    return (res.body as Envelope).data as Order;
  };

  const phoneOrder = async (
    customerPhone: string,
    items: { menuItemId: string; quantity: number }[],
  ) => {
    const res = await request(app.getHttpServer())
      .post('/orders/admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Cliente teléfono',
        customerPhone,
        addressSnapshot: JSON.stringify({
          alias: 'Casa',
          fullAddress: 'Jr. Las Flores 456',
          reference: 'Frente al parque',
          district: 'San Juan de Miraflores',
        }),
        items,
      })
      .expect(201);
    const order = (res.body as Envelope).data as Order;
    anonOrderIds.push(order.id);
    return order;
  };

  const setStatus = async (orderId: string, statuses: string[]) => {
    for (const status of statuses) {
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
    }
  };

  /** Entrega el pedido y fija sus fechas: creado 1h antes de `deliveredAt`. */
  const deliverAt = async (key: string, order: Order, deliveredAt: Date) => {
    await setStatus(order.id, ['confirmado', 'en_camino', 'entregado']);
    await ordersRepo.update(order.id, {
      deliveredAt,
      createdAt: hoursBefore(deliveredAt, 1),
    });
    total[key] = order.total;
  };

  const getReport = async <T>(path: string): Promise<T> => {
    const res = await request(app.getHttpServer())
      .get(`/admin/reports/${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return (res.body as Envelope).data as T;
  };

  const expect400 = async (path: string, messagePart: string) => {
    const res = await request(app.getHttpServer())
      .get(`/admin/reports/${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(JSON.stringify((res.body as ErrorResponse).message)).toContain(
      messagePart,
    );
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

    // Los pedidos se crean vía API (POST /orders bloquea si el local está cerrado).
    businessHoursSnapshot = await forceBusinessAlwaysOpen(settingsRepo);

    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: await bcrypt.hash(password, 10),
        fullName: 'Admin Reports QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;

    tokenA = await register(emailA, 'Cliente A Reports');
    tokenB = await register(emailB, 'Cliente B Reports');
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ phone: phoneB })
      .expect(200);
    addressA = await createAddress(tokenA);
    addressB = await createAddress(tokenB);

    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Reports ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;
    const createItem = async (name: string, price: number) => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name, price, categoryId })
        .expect(201);
      return ((res.body as Envelope).data as { id: string }).id;
    };
    itemX = await createItem(`Clásica Reports ${suffix}`, 20);
    itemY = await createItem(`Papas Reports ${suffix}`, 10);

    const X = (quantity: number) => [{ menuItemId: itemX, quantity }];
    const Y = (quantity: number) => [{ menuItemId: itemY, quantity }];

    await deliverAt(
      'o9',
      await appOrder(tokenA, addressA, X(1)),
      lima('2024-01-15', '12:00:00.000'),
    );
    await deliverAt(
      'o1',
      await appOrder(tokenA, addressA, X(2)),
      lima('2024-02-05', '12:00:00.000'),
    );
    await deliverAt(
      'o2',
      await appOrder(tokenA, addressA, Y(1)),
      lima('2024-02-06', '12:00:00.000'),
    );
    await deliverAt(
      'o3',
      await phoneOrder(phoneP1, X(1)),
      lima('2024-02-06', '13:00:00.000'),
    );
    await deliverAt(
      'o4',
      await phoneOrder(phoneB, Y(3)),
      lima('2024-02-12', '12:00:00.000'),
    );
    await deliverAt(
      'o5',
      await appOrder(tokenB, addressB, X(1)),
      lima('2024-02-20', '12:00:00.000'),
    );
    await deliverAt(
      'o8',
      await appOrder(tokenA, addressA, X(1)),
      lima('2024-02-29', '23:30:00.000'),
    );

    const cancelled = await appOrder(tokenA, addressA, X(1));
    await setStatus(cancelled.id, ['cancelado']);
    await ordersRepo.update(cancelled.id, {
      createdAt: lima('2024-02-06', '10:00:00.000'),
    });
    const pending = await appOrder(tokenA, addressA, Y(1));
    await ordersRepo.update(pending.id, {
      createdAt: lima('2024-02-06', '11:00:00.000'),
    });
  });

  afterAll(async () => {
    const users = await usersRepo.find({
      where: [{ email: emailA }, { email: emailB }, { email: adminEmail }],
    });
    for (const user of users) {
      await ordersRepo.delete({ userId: user.id });
      await addressesRepo.delete({ userId: user.id });
    }
    if (anonOrderIds.length > 0) await ordersRepo.delete(anonOrderIds);
    await itemsRepo.delete({ categoryId });
    await categoriesRepo.delete({ id: categoryId });
    for (const user of users) await usersRepo.delete({ id: user.id });
    await restoreBusinessHours(settingsRepo, businessHoursSnapshot);
    await app.close();
  });

  const FEB = 'startDate=2024-02-01&endDate=2024-02-29';

  describe('seguridad', () => {
    it.each([
      `summary?${FEB}`,
      'comparison?current=2024-02-01:2024-02-29&previous=2024-01-01:2024-01-31',
      `top-products?${FEB}`,
      `conversion?${FEB}`,
      `daily-metrics?${FEB}`,
    ])('%s rechaza sin token (401) y con rol cliente (403)', async (path) => {
      await request(app.getHttpServer())
        .get(`/admin/reports/${path}`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/admin/reports/${path}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
    });
  });

  describe('validación de fechas y parámetros (400)', () => {
    it('startDate/endDate obligatorios', async () => {
      await expect400('summary?endDate=2024-02-29', 'startDate es obligatorio');
      await expect400(
        'conversion?startDate=2024-02-01',
        'endDate es obligatorio',
      );
    });

    it('rechaza fechas inexistentes o con otro formato', async () => {
      await expect400(
        'summary?startDate=2024-02-30&endDate=2024-03-05',
        'startDate debe ser una fecha válida',
      );
      await expect400(
        'daily-metrics?startDate=01-02-2024&endDate=2024-02-29',
        'startDate debe ser una fecha válida',
      );
    });

    it('rechaza rango invertido y rango > 366 días', async () => {
      await expect400(
        'summary?startDate=2024-02-10&endDate=2024-02-01',
        'la fecha de inicio no puede ser posterior',
      );
      await expect400(
        'top-products?startDate=2023-01-01&endDate=2024-02-01',
        'no puede superar 366 días',
      );
    });

    it('rechaza groupBy, channel, limit e includeStatus inválidos', async () => {
      await expect400(`summary?${FEB}&groupBy=year`, 'groupBy debe ser');
      await expect400(`top-products?${FEB}&channel=web`, 'channel debe ser');
      await expect400(
        `top-products?${FEB}&limit=51`,
        'limit no puede superar 50',
      );
      await expect400(
        `daily-metrics?${FEB}&includeStatus=yes`,
        'includeStatus debe ser true o false',
      );
    });

    it('comparison rechaza períodos mal formados, inválidos o faltantes', async () => {
      await expect400(
        'comparison?current=2024-02-01&previous=2024-01-01:2024-01-31',
        'current inválido',
      );
      await expect400(
        'comparison?current=2024-02-29:2024-02-01&previous=2024-01-01:2024-01-31',
        'la fecha de inicio no puede ser posterior',
      );
      await expect400(
        'comparison?current=2024-02-01:2024-02-30&previous=2024-01-01:2024-01-31',
        'current inválido',
      );
      await expect400(
        'comparison?current=2024-02-01:2024-02-29',
        'previous es obligatorio',
      );
    });
  });

  describe('GET /admin/reports/summary', () => {
    it('groupBy=day (default): totales, canales, clientes distintos y un elemento por día', async () => {
      const report = await getReport<ReportSummary>(`summary?${FEB}`);
      const revenue = sum('o1', 'o2', 'o3', 'o4', 'o5', 'o8');

      expect(report.period).toEqual({ start: '2024-02-01', end: '2024-02-29' });
      expect(report.summary).toEqual({
        totalRevenue: revenue,
        totalOrders: 6,
        // A, B y P1: B compró por los dos canales y cuenta una sola vez.
        totalCustomers: 3,
        averageTicket: Math.round((revenue / 6) * 100) / 100,
      });
      expect(report.byChannel.app).toMatchObject({
        revenue: sum('o1', 'o2', 'o5', 'o8'),
        orders: 4,
        customers: 2,
      });
      expect(report.byChannel.phone).toMatchObject({
        revenue: sum('o3', 'o4'),
        orders: 2,
        customers: 2,
      });

      expect(report.data).toHaveLength(29);
      expect(report.data[0]).toMatchObject({ period: '2024-02-01', orders: 0 });
      const feb6 = report.data.find((d) => d.period === '2024-02-06')!;
      expect(feb6).toMatchObject({
        revenue: sum('o2', 'o3'),
        revenueApp: total.o2,
        revenuePhone: total.o3,
        orders: 2,
        ordersApp: 1,
        ordersPhone: 1,
        customers: 2,
        customersApp: 1,
        customersPhone: 1,
        averageTicketApp: total.o2,
        averageTicketPhone: total.o3,
      });
      // Entregado 29/02 23:30 Lima (ya 01/03 en UTC): cuenta el 29.
      expect(report.data[28]).toMatchObject({
        period: '2024-02-29',
        orders: 1,
        revenue: total.o8,
      });
    });

    it('groupBy=week agrupa desde el lunes (incluye semanas vacías)', async () => {
      const report = await getReport<ReportSummary>(
        `summary?${FEB}&groupBy=week`,
      );
      expect(report.data.map((d) => [d.period, d.orders])).toEqual([
        ['2024-01-29', 0],
        ['2024-02-05', 3],
        ['2024-02-12', 1],
        ['2024-02-19', 1],
        ['2024-02-26', 1],
      ]);
      expect(report.data[1].revenue).toBe(sum('o1', 'o2', 'o3'));
    });

    it('groupBy=month agrupa en un solo período desde el día 1', async () => {
      const report = await getReport<ReportSummary>(
        `summary?${FEB}&groupBy=month`,
      );
      expect(report.data).toHaveLength(1);
      expect(report.data[0]).toMatchObject({
        period: '2024-02-01',
        orders: 6,
        ordersApp: 4,
        ordersPhone: 2,
        customers: 3,
        revenue: report.summary.totalRevenue,
      });
    });
  });

  describe('GET /admin/reports/comparison', () => {
    it('calcula los cambios porcentuales total y por canal', async () => {
      const report = await getReport<ReportComparison>(
        'comparison?current=2024-02-01:2024-02-29&previous=2024-01-01:2024-01-31',
      );
      const current = sum('o1', 'o2', 'o3', 'o4', 'o5', 'o8');
      const previous = total.o9;

      expect(report.current).toEqual({
        period: '2024-02-01 al 2024-02-29',
        revenue: current,
        orders: 6,
        averageTicket: Math.round((current / 6) * 100) / 100,
      });
      expect(report.previous).toEqual({
        period: '2024-01-01 al 2024-01-31',
        revenue: previous,
        orders: 1,
        averageTicket: previous,
      });
      expect(report.comparison.ordersChange).toBe('+500.0%');
      expect(report.comparison.revenueChange).toBe(
        percentChange(current, previous),
      );
      expect(report.comparison.revenueChange).toMatch(/^\+\d+\.\d%$/);
      expect(report.byChannel.app).toEqual({
        current: {
          revenue: sum('o1', 'o2', 'o5', 'o8'),
          change: percentChange(sum('o1', 'o2', 'o5', 'o8'), previous),
        },
        previous: { revenue: previous },
      });
      // Sin pedidos por teléfono en enero: no hay base para un porcentaje.
      expect(report.byChannel.phone).toEqual({
        current: { revenue: sum('o3', 'o4'), change: null },
        previous: { revenue: 0 },
      });
    });
  });

  describe('GET /admin/reports/top-products', () => {
    const ours = (products: ReportTopProduct[]) =>
      products.filter((p) => p.id === itemX || p.id === itemY);

    it('channel=all: suma ambos canales, desglosa por canal y calcula porcentajes', async () => {
      const products = await getReport<ReportTopProduct[]>(
        `top-products?${FEB}`,
      );
      expect(ours(products)).toEqual([
        {
          id: itemX,
          name: `Clásica Reports ${suffix}`,
          quantity: 5,
          revenue: 100,
          revenuePercentage: 71.4,
          quantityPercentage: 55.6,
          averagePrice: 20,
          byChannel: {
            app: { quantity: 4, revenue: 80 },
            phone: { quantity: 1, revenue: 20 },
          },
        },
        {
          id: itemY,
          name: `Papas Reports ${suffix}`,
          quantity: 4,
          revenue: 40,
          revenuePercentage: 28.6,
          quantityPercentage: 44.4,
          averagePrice: 10,
          byChannel: {
            app: { quantity: 1, revenue: 10 },
            phone: { quantity: 3, revenue: 30 },
          },
        },
      ]);
    });

    it('channel=app: solo pedidos de la app', async () => {
      const products = await getReport<ReportTopProduct[]>(
        `top-products?${FEB}&channel=app`,
      );
      expect(ours(products).map((p) => [p.id, p.quantity, p.revenue])).toEqual([
        [itemX, 4, 80],
        [itemY, 1, 10],
      ]);
      for (const product of products) {
        expect(product.byChannel.phone).toEqual({ quantity: 0, revenue: 0 });
      }
    });

    it('channel=phone: solo pedidos cargados desde el panel', async () => {
      const products = await getReport<ReportTopProduct[]>(
        `top-products?${FEB}&channel=phone`,
      );
      expect(ours(products).map((p) => [p.id, p.quantity, p.revenue])).toEqual([
        [itemY, 3, 30],
        [itemX, 1, 20],
      ]);
      expect(ours(products)[0].quantityPercentage).toBe(75);
      for (const product of products) {
        expect(product.byChannel.app).toEqual({ quantity: 0, revenue: 0 });
      }
    });

    it('respeta limit', async () => {
      const products = await getReport<ReportTopProduct[]>(
        `top-products?${FEB}&limit=1`,
      );
      expect(products).toHaveLength(1);
      expect(products[0].id).toBe(itemX);
    });
  });

  describe('GET /admin/reports/conversion', () => {
    it('detecta al cliente de teléfono (anónimo con celular registrado) que luego pidió por app', async () => {
      const report = await getReport<ReportConversion>(`conversion?${FEB}`);
      expect(report).toEqual({
        period: '2024-02-01 al 2024-02-29',
        phoneOrders: 2,
        phoneCustomers: 2,
        convertedToApp: 1,
        conversionRate: '50.0%',
        timeline: [
          {
            phoneOrderDate: '2024-02-12',
            appOrderDate: '2024-02-20',
            daysDiff: 8,
          },
        ],
      });
    });

    it('un rango sin pedidos por teléfono devuelve 0.0%', async () => {
      const report = await getReport<ReportConversion>(
        'conversion?startDate=2024-01-01&endDate=2024-01-31',
      );
      expect(report).toMatchObject({
        phoneOrders: 0,
        phoneCustomers: 0,
        convertedToApp: 0,
        conversionRate: '0.0%',
        timeline: [],
      });
    });
  });

  describe('GET /admin/reports/daily-metrics', () => {
    const WEEK = 'startDate=2024-02-05&endDate=2024-02-11';

    it('devuelve un elemento por día (7+) sin campos de estado por defecto', async () => {
      const { days } = await getReport<{ days: DailyMetricsDay[] }>(
        `daily-metrics?${WEEK}`,
      );
      expect(days.map((d) => d.date)).toEqual([
        '2024-02-05',
        '2024-02-06',
        '2024-02-07',
        '2024-02-08',
        '2024-02-09',
        '2024-02-10',
        '2024-02-11',
      ]);
      expect(days[1]).toEqual({
        date: '2024-02-06',
        revenue: sum('o2', 'o3'),
        revenueApp: total.o2,
        revenuePhone: total.o3,
        orders: 2,
        ordersApp: 1,
        ordersPhone: 1,
        customers: 2,
        averageTicket: Math.round((sum('o2', 'o3') / 2) * 100) / 100,
      });
      expect(days[2]).toMatchObject({
        orders: 0,
        revenue: 0,
        averageTicket: 0,
      });
    });

    it('includeStatus=true cuenta los pedidos creados ese día por estado', async () => {
      const { days } = await getReport<{ days: DailyMetricsDay[] }>(
        `daily-metrics?${WEEK}&includeStatus=true`,
      );
      expect(days[0]).toMatchObject({
        date: '2024-02-05',
        deliveredOrders: 1,
        pendingOrders: 0,
        cancelledOrders: 0,
      });
      expect(days[1]).toMatchObject({
        date: '2024-02-06',
        deliveredOrders: 2,
        pendingOrders: 1,
        cancelledOrders: 1,
      });
      expect(days[2]).toMatchObject({
        deliveredOrders: 0,
        pendingOrders: 0,
        cancelledOrders: 0,
      });
    });
  });

  it('los pedidos por teléfono quedan con source admin y los de app con source app', async () => {
    const sources = await ordersRepo.find({
      select: { id: true, source: true, userId: true },
      where: anonOrderIds.map((id) => ({ id })),
    });
    expect(sources.every((o) => o.source === OrderSource.ADMIN)).toBe(true);
  });
});
