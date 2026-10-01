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
import type {
  DailyMetricsDay,
  ReportConversion,
  ReportSummary,
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

interface Envelope {
  data: unknown;
}

/**
 * QA de reportes: casos borde. Fechas fijas de junio 2023 (ninguna otra suite las usa).
 * - L: cliente con celular VIEJO guardado en formato libre ("9xx xxx xxx"), pedido por
 *   teléfono anónimo con ese celular el 10/06 y pedido por app el 12/06.
 * - M: cliente registrado; pedido por teléfono CON customerId el 08/06 y por app el 14/06
 *   (mismo cliente en ambos canales; además se convierte).
 * - N: cliente registrado; pedido por app el 06/06 y por teléfono (customerId) el 09/06:
 *   NO se convierte (la app fue antes).
 */
describe('Reports QA (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let addressesRepo: Repository<Address>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let ordersRepo: Repository<Order>;
  let settingsRepo: Repository<Setting>;
  let snapshot: BusinessHoursSnapshot;
  let adminToken: string;
  let categoryId: string;
  let itemX: string;
  const anonOrderIds: string[] = [];
  const suffix = Date.now();
  const tail = String(suffix).slice(-8);
  const legacyDigits = `9${String((Number(tail) + 7) % 100_000_000).padStart(8, '0')}`;
  const digitsPlus = (n: number) =>
    `9${String((Number(tail) + n) % 100_000_000).padStart(8, '0')}`;
  const phoneR = digitsPlus(11);
  const phoneS = digitsPlus(13);
  const emails = {
    admin: `qa-rq-admin-${suffix}@test.com`,
    L: `qa-rq-l-${suffix}@test.com`,
    M: `qa-rq-m-${suffix}@test.com`,
    N: `qa-rq-n-${suffix}@test.com`,
    P: `qa-rq-p-${suffix}@test.com`,
    Q: `qa-rq-q-${suffix}@test.com`,
    admin2: `qa-rq-admin2-${suffix}@test.com`,
    R: `qa-rq-r-${suffix}@test.com`,
    S1: `qa-rq-s1-${suffix}@test.com`,
    S2: `qa-rq-s2-${suffix}@test.com`,
    T: `qa-rq-t-${suffix}@test.com`,
  };
  const password = 'password123';
  const lima = (date: string, time = '12:00:00.000') =>
    new Date(`${date}T${time}-05:00`);

  const http = () => request(app.getHttpServer());
  const register = async (email: string) =>
    (
      (
        await http()
          .post('/auth/register')
          .send({ email, password, fullName: 'QA RQ' })
          .expect(201)
      ).body as { data: { accessToken: string } }
    ).data.accessToken;
  const createAddress = async (token: string) =>
    (
      (
        await http()
          .post('/users/me/addresses')
          .set('Authorization', `Bearer ${token}`)
          .send({
            alias: 'Casa',
            fullAddress: 'Av. Los Álamos 123',
            reference: 'Portón verde',
            district: 'San Juan de Miraflores',
            isDefault: true,
          })
          .expect(201)
      ).body as Envelope
    ).data as { id: string };
  const deliver = async (orderId: string, at: Date) => {
    for (const status of ['confirmado', 'en_camino', 'entregado']) {
      await http()
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
    }
    await ordersRepo.update(orderId, {
      deliveredAt: at,
      createdAt: new Date(at.getTime() - 3_600_000),
    });
  };
  const appOrder = async (token: string, addressId: string) =>
    (
      (
        await http()
          .post('/orders')
          .set('Authorization', `Bearer ${token}`)
          .send({ addressId, items: [{ menuItemId: itemX, quantity: 1 }] })
          .expect(201)
      ).body as Envelope
    ).data as Order;
  const adminOrder = async (body: Record<string, unknown>) =>
    (
      (
        await http()
          .post('/orders/admin')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ ...body, items: [{ menuItemId: itemX, quantity: 1 }] })
          .expect(201)
      ).body as Envelope
    ).data as Order;
  const get = async <T>(path: string, status = 200) => {
    const res = await http()
      .get(`/admin/reports/${path}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(status);
    return (res.body as Envelope).data as T;
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
    usersRepo = app.get(getRepositoryToken(User));
    addressesRepo = app.get(getRepositoryToken(Address));
    categoriesRepo = app.get(getRepositoryToken(Category));
    itemsRepo = app.get(getRepositoryToken(MenuItem));
    ordersRepo = app.get(getRepositoryToken(Order));
    settingsRepo = app.get(getRepositoryToken(Setting));
    snapshot = await forceBusinessAlwaysOpen(settingsRepo);

    await usersRepo.save(
      usersRepo.create({
        email: emails.admin,
        password: await bcrypt.hash(password, 10),
        fullName: 'Admin RQ',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );
    adminToken = (
      (
        await http()
          .post('/auth/login')
          .send({ email: emails.admin, password })
          .expect(200)
      ).body as { data: { accessToken: string } }
    ).data.accessToken;

    const cat = await http()
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `RQ ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;
    const item = await http()
      .post('/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `RQ X ${suffix}`, price: 20, categoryId })
      .expect(201);
    itemX = ((item.body as Envelope).data as { id: string }).id;

    const tokenL = await register(emails.L);
    const tokenM = await register(emails.M);
    const tokenN = await register(emails.N);
    const addrL = (await createAddress(tokenL)).id;
    const addrM = (await createAddress(tokenM)).id;
    const addrN = (await createAddress(tokenN)).id;
    const userL = await usersRepo.findOneByOrFail({ email: emails.L });
    const userM = await usersRepo.findOneByOrFail({ email: emails.M });
    const userN = await usersRepo.findOneByOrFail({ email: emails.N });
    // Celular viejo con formato libre (previo a normalizePhone, no migrado).
    const legacy = `${legacyDigits.slice(0, 3)} ${legacyDigits.slice(3, 6)} ${legacyDigits.slice(6)}`;
    await usersRepo.update(userL.id, { phone: legacy });

    const anon = await adminOrder({
      customerName: 'L por teléfono',
      customerPhone: legacyDigits,
      addressSnapshot: JSON.stringify({
        alias: 'Casa',
        fullAddress: 'Jr. Las Flores 456',
        reference: 'Frente al parque',
        district: 'San Juan de Miraflores',
      }),
    });
    anonOrderIds.push(anon.id);
    await deliver(anon.id, lima('2023-06-10'));
    await deliver((await appOrder(tokenL, addrL)).id, lima('2023-06-12'));

    await deliver(
      (await adminOrder({ customerId: userM.id, addressId: addrM })).id,
      lima('2023-06-08'),
    );
    await deliver((await appOrder(tokenM, addrM)).id, lima('2023-06-14'));

    await deliver((await appOrder(tokenN, addrN)).id, lima('2023-06-06'));
    await deliver(
      (await adminOrder({ customerId: userN.id, addressId: addrN })).id,
      lima('2023-06-09'),
    );

    // Julio: P teléfono 03/07, app 05/07, teléfono 07/07 (convierte desde el 03/07).
    // Q teléfono y app entregados en el MISMO instante el 10/07 (no convierte).
    const tokenP = await register(emails.P);
    const tokenQ = await register(emails.Q);
    const addrP = (await createAddress(tokenP)).id;
    const addrQ = (await createAddress(tokenQ)).id;
    const userP = await usersRepo.findOneByOrFail({ email: emails.P });
    const userQ = await usersRepo.findOneByOrFail({ email: emails.Q });
    await deliver(
      (await adminOrder({ customerId: userP.id, addressId: addrP })).id,
      lima('2023-07-03'),
    );
    await deliver((await appOrder(tokenP, addrP)).id, lima('2023-07-05'));
    await deliver(
      (await adminOrder({ customerId: userP.id, addressId: addrP })).id,
      lima('2023-07-07'),
    );
    await deliver(
      (await adminOrder({ customerId: userQ.id, addressId: addrQ })).id,
      lima('2023-07-10'),
    );
    await deliver((await appOrder(tokenQ, addrQ)).id, lima('2023-07-10'));

    // Agosto: celulares compartidos (users.phone no es único).
    // - phoneR: un ADMIN (cuenta más antigua) y el cliente R. Anónimo 02/08, app R 05/08.
    // - phoneS: clientes S1 (más antiguo) y S2. Anónimo 10/08, app S2 11/08, app S1 12/08.
    const anonWith = async (customerPhone: string, at: Date) => {
      const order = await adminOrder({
        customerName: 'Compartido',
        customerPhone,
        addressSnapshot: JSON.stringify({
          alias: 'Casa',
          fullAddress: 'Jr. Las Flores 456',
          reference: 'Frente al parque',
          district: 'San Juan de Miraflores',
        }),
      });
      anonOrderIds.push(order.id);
      await deliver(order.id, at);
    };
    const admin2 = await usersRepo.save(
      usersRepo.create({
        email: emails.admin2,
        password: await bcrypt.hash(password, 10),
        fullName: 'Admin2 RQ',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
        phone: `51${phoneR}`,
      } as Partial<User>),
    );
    const tokenR = await register(emails.R);
    const tokenS1 = await register(emails.S1);
    const tokenS2 = await register(emails.S2);
    const addrR = (await createAddress(tokenR)).id;
    const addrS1 = (await createAddress(tokenS1)).id;
    const addrS2 = (await createAddress(tokenS2)).id;
    const userR = await usersRepo.findOneByOrFail({ email: emails.R });
    const userS1 = await usersRepo.findOneByOrFail({ email: emails.S1 });
    const userS2 = await usersRepo.findOneByOrFail({ email: emails.S2 });
    await usersRepo.update(admin2.id, { createdAt: lima('2020-01-01') });
    await usersRepo.update(userR.id, {
      phone: `51${phoneR}`,
      createdAt: lima('2021-01-01'),
    });
    await usersRepo.update(userS1.id, {
      phone: `51${phoneS}`,
      createdAt: lima('2021-01-01'),
    });
    await usersRepo.update(userS2.id, {
      phone: `51${phoneS}`,
      createdAt: lima('2022-01-01'),
    });
    await anonWith(phoneR, lima('2023-08-02'));
    await deliver((await appOrder(tokenR, addrR)).id, lima('2023-08-05'));
    await anonWith(phoneS, lima('2023-08-10'));
    await deliver((await appOrder(tokenS2, addrS2)).id, lima('2023-08-11'));
    await deliver((await appOrder(tokenS1, addrS1)).id, lima('2023-08-12'));

    // Septiembre: anónimo VIEJO con customerPhone guardado sin normalizar ("9xx xxx xxx")
    // y cliente T con el celular ya normalizado. Anónimo 02/09, app T 04/09.
    const phoneT = digitsPlus(17);
    const tokenT = await register(emails.T);
    const addrT = (await createAddress(tokenT)).id;
    const userT = await usersRepo.findOneByOrFail({ email: emails.T });
    await usersRepo.update(userT.id, { phone: `51${phoneT}` });
    await anonWith(phoneT, lima('2023-09-02'));
    await ordersRepo.update(anonOrderIds[anonOrderIds.length - 1], {
      customerPhone: `${phoneT.slice(0, 3)} ${phoneT.slice(3, 6)} ${phoneT.slice(6)}`,
    });
    await deliver((await appOrder(tokenT, addrT)).id, lima('2023-09-04'));
  });

  afterAll(async () => {
    const users = await usersRepo.find({
      where: Object.values(emails).map((email) => ({ email })),
    });
    for (const user of users) {
      await ordersRepo.delete({ userId: user.id });
      await addressesRepo.delete({ userId: user.id });
    }
    if (anonOrderIds.length) await ordersRepo.delete(anonOrderIds);
    await itemsRepo.delete({ categoryId });
    await categoriesRepo.delete({ id: categoryId });
    for (const user of users) await usersRepo.delete({ id: user.id });
    await restoreBusinessHours(settingsRepo, snapshot);
    await app.close();
  });

  const JUNE = 'startDate=2023-06-01&endDate=2023-06-30';

  it('celular compartido: nunca se atribuye a un admin y entre clientes gana la cuenta más antigua', async () => {
    const r = await get<ReportConversion>(
      'conversion?startDate=2023-08-01&endDate=2023-08-31',
    );
    expect(r.phoneOrders).toBe(2);
    expect(r.phoneCustomers).toBe(2); // R y S1
    expect(r.convertedToApp).toBe(2);
    expect(r.timeline).toEqual([
      // R (no el admin más antiguo con el mismo celular)
      { phoneOrderDate: '2023-08-02', appOrderDate: '2023-08-05', daysDiff: 3 },
      // S1 (más antiguo), no S2 que pidió por app el 11/08
      { phoneOrderDate: '2023-08-10', appOrderDate: '2023-08-12', daysDiff: 2 },
    ]);
  });

  it('anónimo viejo con customerPhone sin normalizar se resuelve al cliente (T)', async () => {
    const r = await get<ReportSummary>(
      'summary?startDate=2023-09-01&endDate=2023-09-30&groupBy=month',
    );
    expect(r.summary.totalOrders).toBe(2);
    expect(r.summary.totalCustomers).toBe(1);
    const c = await get<ReportConversion>(
      'conversion?startDate=2023-09-01&endDate=2023-09-30',
    );
    expect(c.timeline).toEqual([
      { phoneOrderDate: '2023-09-02', appOrderDate: '2023-09-04', daysDiff: 2 },
    ]);
  });

  it('conversion usa el PRIMER pedido por teléfono del rango (P) y exige app estrictamente posterior (Q, mismo instante)', async () => {
    const r = await get<ReportConversion>(
      'conversion?startDate=2023-07-01&endDate=2023-07-31',
    );
    expect(r.phoneOrders).toBe(3); // P×2, Q×1
    expect(r.phoneCustomers).toBe(2);
    expect(r.convertedToApp).toBe(1); // solo P
    expect(r.conversionRate).toBe('50.0%');
    expect(r.timeline).toEqual([
      { phoneOrderDate: '2023-07-03', appOrderDate: '2023-07-05', daysDiff: 2 },
    ]);
  });

  it('cliente con pedidos por ambos canales cuenta una sola vez en el total (M y N)', async () => {
    const r = await get<ReportSummary>(
      'summary?startDate=2023-06-06&endDate=2023-06-09&groupBy=month',
    );
    // 06/06 app N, 08/06 phone M, 09/06 phone N
    expect(r.summary.totalOrders).toBe(3);
    expect(r.summary.totalCustomers).toBe(2);
    expect(r.byChannel.app.customers).toBe(1);
    expect(r.byChannel.phone.customers).toBe(2);
  });

  it('groupBy=week con inicio a mitad de semana: período = lunes previo, solo pedidos del rango', async () => {
    const r = await get<ReportSummary>(
      'summary?startDate=2023-06-07&endDate=2023-06-20&groupBy=week',
    );
    expect(r.data.map((d) => d.period)).toEqual([
      '2023-06-05',
      '2023-06-12',
      '2023-06-19',
    ]);
    // Semana del 05/06: 08 M phone, 09 N phone, 10 L phone (sin el 06 app N)
    expect(r.data[0].orders).toBe(3);
    expect(r.data[0].ordersApp).toBe(0);
    expect(r.data[1].orders).toBe(2);
    expect(r.data[2].orders).toBe(0);
  });

  it('includeStatus=false no agrega campos de estado', async () => {
    const { days } = await get<{ days: DailyMetricsDay[] }>(
      `daily-metrics?startDate=2023-06-10&endDate=2023-06-10&includeStatus=false`,
    );
    expect(days).toHaveLength(1);
    expect(days[0]).not.toHaveProperty('deliveredOrders');
  });

  it('conversion: app antes del teléfono NO convierte; teléfono con customerId y luego app SÍ', async () => {
    const r = await get<ReportConversion>(
      'conversion?startDate=2023-06-08&endDate=2023-06-09',
    );
    expect(r.phoneCustomers).toBe(2); // M y N
    expect(r.convertedToApp).toBe(1); // solo M
    expect(r.timeline).toEqual([
      { phoneOrderDate: '2023-06-08', appOrderDate: '2023-06-14', daysDiff: 6 },
    ]);
  });

  it('anónimo con el celular de un cliente cuyo phone viejo quedó en formato libre: se resuelve a ese cliente (como /users/:id/anonymous-orders)', async () => {
    const r = await get<ReportSummary>(`summary?${JUNE}&groupBy=month`);
    // L(phone 10/06 + app 12/06), M, N → 3 clientes
    expect(r.summary.totalCustomers).toBe(3);
    const c = await get<ReportConversion>(
      'conversion?startDate=2023-06-10&endDate=2023-06-10',
    );
    expect(c.convertedToApp).toBe(1);
  });

  it('parámetros raros devuelven 400, nunca 500', async () => {
    for (const path of [
      `top-products?${JUNE}&limit=0`,
      `top-products?${JUNE}&limit=abc`,
      `top-products?${JUNE}&limit=1.5`,
      'summary?startDate=2023-06-01&startDate=2023-06-02&endDate=2023-06-30',
      'summary?startDate=&endDate=2023-06-30',
      'summary?startDate=2023-06-01T00:00&endDate=2023-06-30',
      'comparison?current=2023-06-01:2023-06-30&previous=2023-06-01:2023-06-30&previous=2023-05-01:2023-05-31',
      'comparison?current=2022-01-01:2023-01-02&previous=2023-05-01:2023-05-31',
      `summary?${JUNE}&foo=bar`,
    ]) {
      const res = await http()
        .get(`/admin/reports/${path}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect({ path, status: res.status }).toEqual({ path, status: 400 });
    }
  });

  it('rango de 366 días exactos (incl. bisiesto) responde 200 y rápido en todos los endpoints', async () => {
    const R = 'startDate=2023-03-01&endDate=2024-02-29';
    for (const path of [
      `summary?${R}`,
      `summary?${R}&groupBy=week`,
      `top-products?${R}&limit=50`,
      `conversion?${R}`,
      `daily-metrics?${R}&includeStatus=true`,
      'comparison?current=2023-03-01:2024-02-29&previous=2022-03-01:2023-02-28',
    ]) {
      const t0 = Date.now();
      await get(path);
      expect({ path, slow: Date.now() - t0 >= 5000 }).toEqual({
        path,
        slow: false,
      });
    }
    const { days } = await get<{ days: DailyMetricsDay[] }>(
      `daily-metrics?${R}`,
    );
    expect(days).toHaveLength(366);
    expect(days[365].date).toBe('2024-02-29');
    await get('summary?startDate=2023-03-01&endDate=2024-03-01', 400);
  });
});
