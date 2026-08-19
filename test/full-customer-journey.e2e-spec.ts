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
import { Coupon } from './../src/modules/coupons/entities/coupon.entity';
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

interface OrderData {
  id: string;
  status: string;
  total: number;
  items: { name: string; unitPrice: number; quantity: number }[];
}

interface CouponData {
  code: string;
  discountType: string;
  discountValue: number;
  status: string;
  origin: string;
}

interface PublicMenuCategory {
  id: string;
  name: string;
  items: { id: string; name: string; price: number }[];
}

/**
 * Journey completo de un cliente real cruzando TODOS los módulos:
 * registro → login → ver menú → crear pedido → admin entrega → totalSpent sube →
 * se genera cupón automático por umbral → se usa el cupón en un segundo pedido →
 * se verifica el descuento. Prueba que los módulos se conectan de verdad entre sí.
 */
describe('Full Customer Journey (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let addressesRepo: Repository<Address>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let ordersRepo: Repository<Order>;
  let couponsRepo: Repository<Coupon>;
  let settingsRepo: Repository<Setting>;
  let businessHoursSnapshot: BusinessHoursSnapshot;

  let clientToken: string;
  let adminToken: string;
  let clientId: string;

  let categoryId: string;
  let itemId: string;
  let addressId: string;

  const suffix = Date.now();
  const clientEmail = `qa-journey-client-${suffix}@test.com`;
  const adminEmail = `qa-journey-admin-${suffix}@test.com`;
  const password = 'password123';

  // Precio del item: 30.0 → 2x = 60.0 ≥ umbral de S/50 → genera cupón automático.
  const ITEM_PRICE = 30.0;

  const register = async (email: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName })
      .expect(201);
    return (res.body as AuthTokensResponse).data.accessToken;
  };

  const deliver = async (orderId: string) => {
    for (const status of ['confirmado', 'en_camino', 'entregado']) {
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
    }
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
    couponsRepo = app.get<Repository<Coupon>>(getRepositoryToken(Coupon));
    settingsRepo = app.get<Repository<Setting>>(getRepositoryToken(Setting));

    // El journey crea pedidos reales vía POST /orders: forzar el local
    // "abierto siempre" para que la suite no dependa de la hora real de Lima
    // en la que corre (ver OrdersService.create, bloquea con 409 si está cerrado).
    businessHoursSnapshot = await forceBusinessAlwaysOpen(settingsRepo);

    // Admin real (con password hasheado) para las transiciones de estado.
    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Journey QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    // Cliente real vía el endpoint de registro (no insert directo).
    clientToken = await register(clientEmail, 'Cliente Journey');
    const client = await usersRepo.findOne({ where: { email: clientEmail } });
    clientId = client!.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;

    // Menú de prueba.
    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Journey Burgers ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;

    const item = await request(app.getHttpServer())
      .post('/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Journey Clásica', price: ITEM_PRICE, categoryId })
      .expect(201);
    itemId = ((item.body as Envelope).data as { id: string }).id;

    // Dirección del cliente.
    const addr = await request(app.getHttpServer())
      .post('/users/me/addresses')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        alias: 'Casa',
        fullAddress: 'Av. Journey 123',
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
      // order_items se borran en cascada; coupon.usedInOrderId se pone NULL (SET NULL).
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

  it('recorre el flujo completo de un cliente real', async () => {
    // 1) Login (además del registro ya hecho en beforeAll).
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: clientEmail, password })
      .expect(200);
    const loginToken = (login.body as AuthTokensResponse).data.accessToken;
    expect(loginToken).toBeTruthy();

    // 2) Ver el menú público: el item debe aparecer.
    const menu = await request(app.getHttpServer()).get('/menu').expect(200);
    const categories = (menu.body as Envelope).data as PublicMenuCategory[];
    const found = categories
      .flatMap((c) => c.items)
      .find((i) => i.id === itemId);
    expect(found).toBeDefined();
    expect(found!.price).toBe(ITEM_PRICE);

    // 3) Crear el primer pedido (2x30 = 60, sin cupón).
    const first = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${loginToken}`)
      .send({ addressId, items: [{ menuItemId: itemId, quantity: 2 }] })
      .expect(201);
    const firstOrder = (first.body as Envelope).data as OrderData;
    expect(firstOrder.status).toBe('pendiente');
    expect(firstOrder.total).toBe(60);

    // 4) Admin entrega el pedido (confirmado → en_camino → entregado).
    await deliver(firstOrder.id);

    // 5) totalSpent subió a 60.
    const profile = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${loginToken}`)
      .expect(200);
    const me = (profile.body as Envelope).data as { totalSpent: number };
    expect(me.totalSpent).toBe(60);

    // 6) Se generó un cupón automático (umbral S/50 superado).
    const couponsRes = await request(app.getHttpServer())
      .get('/coupons/me')
      .set('Authorization', `Bearer ${loginToken}`)
      .expect(200);
    const coupons = (couponsRes.body as Envelope).data as CouponData[];
    const auto = coupons.filter(
      (c) => c.origin === 'auto' && c.status === 'active',
    );
    expect(auto).toHaveLength(1);
    expect(auto[0].discountType).toBe('percentage');
    expect(auto[0].discountValue).toBe(10);

    // 7) Segundo pedido usando el cupón automático (1x30 = 30 → 10% = 27).
    const second = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${loginToken}`)
      .send({
        addressId,
        items: [{ menuItemId: itemId, quantity: 1 }],
        couponCode: auto[0].code,
      })
      .expect(201);
    const secondOrder = (second.body as Envelope).data as OrderData;
    expect(secondOrder.total).toBe(27);

    // 8) El cupón quedó marcado como usado en la BD.
    const stored = await couponsRepo.findOne({ where: { code: auto[0].code } });
    expect(stored!.status).toBe('used');
    expect(stored!.usedInOrderId).toBe(secondOrder.id);

    // 9) El cliente ve sus 2 pedidos.
    const myOrders = await request(app.getHttpServer())
      .get('/orders/me')
      .set('Authorization', `Bearer ${loginToken}`)
      .expect(200);
    const orders = (myOrders.body as Envelope).data as OrderData[];
    expect(orders.some((o) => o.id === firstOrder.id)).toBe(true);
    expect(orders.some((o) => o.id === secondOrder.id)).toBe(true);

    void clientId;
  });
});
