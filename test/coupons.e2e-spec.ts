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
import { Address } from './../src/modules/users/entities/address.entity';
import {
  User,
  UserProvider,
  UserRole,
} from './../src/modules/users/entities/user.entity';
import {
  Coupon,
  CouponDiscountType,
  CouponStatus,
} from './../src/modules/coupons/entities/coupon.entity';

interface AuthTokensResponse {
  success: boolean;
  data: { accessToken: string };
}

interface ErrorResponse {
  success: boolean;
  message: string;
  statusCode: number;
}

interface Envelope {
  data: unknown;
}

interface CouponData {
  id: string;
  code: string;
  userId: string;
  discountType: string;
  discountValue: number;
  minPurchaseAmount: number | null;
  status: string;
  origin: string;
  expiresAt: string;
  usedAt: string | null;
  usedInOrderId: string | null;
}

interface OrderData {
  id: string;
  total: number;
  status: string;
}

describe('Coupons (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let couponsRepo: Repository<Coupon>;
  let ordersRepo: Repository<Order>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let addressesRepo: Repository<Address>;

  let clientAToken: string;
  let clientBToken: string;
  let adminToken: string;
  let clientAId: string;

  let categoryId: string;
  let itemId: string;
  let addressId: string;
  let manualCouponCode: string;

  const suffix = Date.now();
  const clientAEmail = `qa-coupons-a-${suffix}@test.com`;
  const clientBEmail = `qa-coupons-b-${suffix}@test.com`;
  const clientCEmail = `qa-coupons-c-${suffix}@test.com`;
  const adminEmail = `qa-coupons-admin-${suffix}@test.com`;
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
    couponsRepo = app.get<Repository<Coupon>>(getRepositoryToken(Coupon));
    ordersRepo = app.get<Repository<Order>>(getRepositoryToken(Order));
    categoriesRepo = app.get<Repository<Category>>(
      getRepositoryToken(Category),
    );
    itemsRepo = app.get<Repository<MenuItem>>(getRepositoryToken(MenuItem));
    addressesRepo = app.get<Repository<Address>>(getRepositoryToken(Address));

    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Coupons QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    clientAToken = await register(clientAEmail, 'Cliente A');
    clientBToken = await register(clientBEmail, 'Cliente B');
    const clientC = await register(clientCEmail, 'Cliente C');
    const clientA = await usersRepo.findOne({ where: { email: clientAEmail } });
    clientAId = clientA!.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;

    // Menú de prueba
    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Burgers ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;

    const item = await request(app.getHttpServer())
      .post('/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Clásica', price: 24.9, categoryId })
      .expect(201);
    itemId = ((item.body as Envelope).data as { id: string }).id;

    // Dirección de prueba para cliente A
    const addr = await request(app.getHttpServer())
      .post('/users/me/addresses')
      .set('Authorization', `Bearer ${clientAToken}`)
      .send({
        alias: 'Casa',
        fullAddress: 'Av. Los Álamos 123',
        reference: 'Portón verde',
        district: 'San Juan de Miraflores',
        isDefault: true,
      })
      .expect(201);
    addressId = ((addr.body as Envelope).data as { id: string }).id;

    void clientC;
  });

  afterAll(async () => {
    const users = await usersRepo.find({
      where: [
        { email: clientAEmail },
        { email: clientBEmail },
        { email: clientCEmail },
        { email: adminEmail },
        { email: `qa-coupons-c2-${suffix}@test.com` },
        { email: `qa-coupons-c3-${suffix}@test.com` },
        { email: `qa-coupons-c4-${suffix}@test.com` },
      ],
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await couponsRepo.delete(ids.map((id) => ({ userId: id })));
      await ordersRepo.delete(ids.map((id) => ({ userId: id })));
      await addressesRepo.delete(ids.map((id) => ({ userId: id })));
    }
    await itemsRepo.delete({ categoryId });
    await categoriesRepo.delete({ id: categoryId });
    await usersRepo.delete({ email: clientAEmail });
    await usersRepo.delete({ email: clientBEmail });
    await usersRepo.delete({ email: clientCEmail });
    await usersRepo.delete({ email: adminEmail });
    await usersRepo.delete({ email: `qa-coupons-c2-${suffix}@test.com` });
    await usersRepo.delete({ email: `qa-coupons-c3-${suffix}@test.com` });
    await usersRepo.delete({ email: `qa-coupons-c4-${suffix}@test.com` });
    await app.close();
  });

  describe('POST /coupons/generate (admin)', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/coupons/generate')
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
        })
        .expect(401);
    });

    it('403 para un cliente', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
        })
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('400 si discountValue es inválido', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: -5,
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si un percentage supera el 100% (validado en el DTO)', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 150,
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('permite un fixed_amount mayor a 100 (no se limita)', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'fixed_amount',
          discountValue: 150,
        })
        .expect(201);
      const data = (res.body as Envelope).data as CouponData;
      expect(data.discountType).toBe('fixed_amount');
      expect(data.discountValue).toBe(150);
    });

    it('404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: '11111111-1111-4111-8111-111111111111',
          discountType: 'percentage',
          discountValue: 10,
        })
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('genera un cupón manual para el usuario', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
        })
        .expect(201);
      const data = (res.body as Envelope).data as CouponData;
      expect(data.userId).toBe(clientAId);
      expect(data.discountType).toBe('percentage');
      expect(data.discountValue).toBe(10);
      expect(data.status).toBe('active');
      expect(data.code).toMatch(/^[0-9A-F]{8}$/);
      manualCouponCode = data.code;
    });

    it('genera un cupón manual con minPurchaseAmount cuando se indica', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: 50,
        })
        .expect(201);
      const data = (res.body as Envelope).data as CouponData;
      expect(data.minPurchaseAmount).toBe(50);
    });

    it('genera un cupón manual sin mínimo cuando no se indica (null)', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
        })
        .expect(201);
      const data = (res.body as Envelope).data as CouponData;
      expect(data.minPurchaseAmount).toBeNull();
    });

    it('400 si minPurchaseAmount es negativo', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: -5,
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('acepta minPurchaseAmount = 0 (se comporta como sin mínimo)', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: 0,
        })
        .expect(201);
      const data = (res.body as Envelope).data as CouponData;
      expect(data.minPurchaseAmount).toBe(0);
    });
  });

  describe('GET /coupons/me', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer()).get('/coupons/me').expect(401);
    });

    it('el cliente ve sus propios cupones', async () => {
      const res = await request(app.getHttpServer())
        .get('/coupons/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as CouponData[];
      expect(data.some((c) => c.code === manualCouponCode)).toBe(true);
    });

    it('un cliente no ve los cupones de otro', async () => {
      const res = await request(app.getHttpServer())
        .get('/coupons/me')
        .set('Authorization', `Bearer ${clientBToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as CouponData[];
      expect(data.some((c) => c.code === manualCouponCode)).toBe(false);
    });
  });

  describe('POST /coupons/validate', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/coupons/validate')
        .send({ code: manualCouponCode })
        .expect(401);
    });

    it('valida un cupón activo y devuelve el descuento', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ code: manualCouponCode })
        .expect(201);
      const data = (res.body as Envelope).data as {
        valid: boolean;
        discountType: string;
        discountValue: number;
        minPurchaseAmount: number | null;
      };
      expect(data.valid).toBe(true);
      expect(data.discountType).toBe('percentage');
      expect(data.discountValue).toBe(10);
      expect(data.minPurchaseAmount).toBeNull();
    });

    it('rechaza con mensaje claro si el subtotal es menor al mínimo de compra', async () => {
      const withMin = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: 50,
        })
        .expect(201);
      const minCoupon = (withMin.body as Envelope).data as CouponData;

      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ code: minCoupon.code, subtotal: 30 })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Este cupón requiere un pedido mínimo de S/50.00',
      );
    });

    it('acepta si el subtotal supera el mínimo de compra', async () => {
      const withMin = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: 50,
        })
        .expect(201);
      const minCoupon = (withMin.body as Envelope).data as CouponData;

      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ code: minCoupon.code, subtotal: 80 })
        .expect(201);
      const data = (res.body as Envelope).data as {
        valid: boolean;
        minPurchaseAmount: number | null;
      };
      expect(data.valid).toBe(true);
      expect(data.minPurchaseAmount).toBe(50);
    });

    it('sin subtotal no valida el mínimo (comportamiento previo intacto)', async () => {
      const withMin = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: 50,
        })
        .expect(201);
      const minCoupon = (withMin.body as Envelope).data as CouponData;

      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ code: minCoupon.code })
        .expect(201);
      expect(((res.body as Envelope).data as { valid: boolean }).valid).toBe(
        true,
      );
    });

    it('subtotal 0 con cupón sin mínimo no rompe', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ code: manualCouponCode, subtotal: 0 })
        .expect(201);
      expect(((res.body as Envelope).data as { valid: boolean }).valid).toBe(
        true,
      );
    });

    it('minPurchaseAmount = 0 acepta subtotal 0 (se comporta como sin mínimo)', async () => {
      const withZero = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: 0,
        })
        .expect(201);
      const zeroCoupon = (withZero.body as Envelope).data as CouponData;

      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ code: zeroCoupon.code, subtotal: 0 })
        .expect(201);
      expect(((res.body as Envelope).data as { valid: boolean }).valid).toBe(
        true,
      );
    });

    it('400 si el código no existe', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ code: 'ZZZZZZZZ' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si el cupón es de otro usuario', async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientBToken}`)
        .send({ code: manualCouponCode })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si el cupón está expirado', async () => {
      const clientA = await usersRepo.findOne({
        where: { email: clientAEmail },
      });
      const expired = await couponsRepo.save(
        couponsRepo.create({
          userId: clientA!.id,
          code: 'DEADBEEF',
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 10,
          status: CouponStatus.ACTIVE,
          expiresAt: new Date(Date.now() - 1000),
        } as Partial<Coupon>),
      );
      const res = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ code: expired.code })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });
  });

  describe('Canje en el pedido (POST /orders con couponCode)', () => {
    it('aplica el descuento y marca el cupón como usado con usedInOrderId', async () => {
      // Subtotal: 24.9 * 2 = 49.8 → con 10% = 44.82
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 2 }],
          couponCode: manualCouponCode,
        })
        .expect(201);
      const order = (res.body as Envelope).data as OrderData;
      expect(order.total).toBe(44.82);
      expect(order.status).toBe('pendiente');

      const stored = await couponsRepo.findOne({
        where: { code: manualCouponCode },
      });
      expect(stored!.status).toBe(CouponStatus.USED);
      expect(stored!.usedAt).not.toBeNull();
      expect(stored!.usedInOrderId).toBe(order.id);
    });

    it('400 si el cupón ya fue usado y no crea el pedido', async () => {
      const meBefore = await request(app.getHttpServer())
        .get('/orders/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const countBefore = ((meBefore.body as Envelope).data as OrderData[])
        .length;

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 1 }],
          couponCode: manualCouponCode, // ya fue usado arriba
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);

      const meAfter = await request(app.getHttpServer())
        .get('/orders/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const countAfter = ((meAfter.body as Envelope).data as OrderData[])
        .length;
      expect(countAfter).toBe(countBefore); // el pedido no se creó
    });

    it('400 si el cupón expirado se intenta canjear (rollback del pedido)', async () => {
      const meBefore = await request(app.getHttpServer())
        .get('/orders/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const countBefore = ((meBefore.body as Envelope).data as OrderData[])
        .length;

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 1 }],
          couponCode: 'DEADBEEF', // expirado
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);

      const meAfter = await request(app.getHttpServer())
        .get('/orders/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const countAfter = ((meAfter.body as Envelope).data as OrderData[])
        .length;
      expect(countAfter).toBe(countBefore); // transacción: cupón y pedido fallan juntos
    });

    it('aplica descuento de monto fijo', async () => {
      const fixed = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'fixed_amount',
          discountValue: 10,
        })
        .expect(201);
      const fixedCoupon = (fixed.body as Envelope).data as CouponData;

      // Subtotal: 24.9 * 2 = 49.8 → con S/10 fijo = 39.8
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 2 }],
          couponCode: fixedCoupon.code,
        })
        .expect(201);
      const order = (res.body as Envelope).data as OrderData;
      expect(order.total).toBe(39.8);
    });

    it('rechaza el canje con mensaje claro si el subtotal es menor al mínimo y no crea el pedido', async () => {
      const withMin = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: 50,
        })
        .expect(201);
      const minCoupon = (withMin.body as Envelope).data as CouponData;

      const meBefore = await request(app.getHttpServer())
        .get('/orders/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const countBefore = ((meBefore.body as Envelope).data as OrderData[])
        .length;

      // Subtotal: 24.9 * 1 = 24.9 < 50 → rechazado
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 1 }],
          couponCode: minCoupon.code,
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Este cupón requiere un pedido mínimo de S/50.00',
      );

      const meAfter = await request(app.getHttpServer())
        .get('/orders/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const countAfter = ((meAfter.body as Envelope).data as OrderData[])
        .length;
      expect(countAfter).toBe(countBefore); // el pedido no se creó (rollback)

      // El cupón sigue activo (no se marcó como usado).
      const stored = await couponsRepo.findOne({
        where: { code: minCoupon.code },
      });
      expect(stored!.status).toBe(CouponStatus.ACTIVE);
    });

    it('aplica el descuento si el subtotal supera el mínimo de compra', async () => {
      const withMin = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
          minPurchaseAmount: 50,
        })
        .expect(201);
      const minCoupon = (withMin.body as Envelope).data as CouponData;

      // Subtotal: 24.9 * 3 = 74.7 ≥ 50 → 10% = 67.23
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 3 }],
          couponCode: minCoupon.code,
        })
        .expect(201);
      const order = (res.body as Envelope).data as OrderData;
      expect(order.total).toBe(67.23);

      const stored = await couponsRepo.findOne({
        where: { code: minCoupon.code },
      });
      expect(stored!.status).toBe(CouponStatus.USED);
    });

    it('el cliente no puede usar el cupón de otro usuario en un pedido', async () => {
      const admin = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
        })
        .expect(201);
      const couponA = (admin.body as Envelope).data as CouponData;

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientBToken}`)
        .send({
          addressSnapshot:
            '{"fullAddress":"Jr. Los Olivos 456","district":"Surco"}',
          items: [{ menuItemId: itemId, quantity: 1 }],
          couponCode: couponA.code,
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });
  });

  describe('Reactivación del cupón al cancelar el pedido', () => {
    let reactivationCode: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'percentage',
          discountValue: 10,
        })
        .expect(201);
      reactivationCode = ((res.body as Envelope).data as CouponData).code;
    });

    it('cancelar un pedido con cupón reactiva el cupón (active y usedInOrderId null)', async () => {
      // Pedido con cupón: 24.9 * 2 = 49.8 → 10% = 44.82
      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 2 }],
          couponCode: reactivationCode,
        })
        .expect(201);
      const order = (created.body as Envelope).data as OrderData;
      expect(order.total).toBe(44.82);

      // El cupón quedó usado y vinculado al pedido.
      let stored = await couponsRepo.findOne({
        where: { code: reactivationCode },
      });
      expect(stored!.status).toBe(CouponStatus.USED);
      expect(stored!.usedInOrderId).toBe(order.id);

      // Se cancela el pedido (pendiente → cancelado).
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado' })
        .expect(200);

      // El cupón vuelve a estar activo y desvinculado del pedido cancelado.
      stored = await couponsRepo.findOne({
        where: { code: reactivationCode },
      });
      expect(stored!.status).toBe(CouponStatus.ACTIVE);
      expect(stored!.usedInOrderId).toBeNull();
      expect(stored!.usedAt).toBeNull();
    });

    it('el cupón reactivado puede volver a usarse en un pedido nuevo', async () => {
      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 2 }],
          couponCode: reactivationCode, // reactivado en el test anterior
        })
        .expect(201);
      const order = (created.body as Envelope).data as OrderData;
      expect(order.total).toBe(44.82);

      const stored = await couponsRepo.findOne({
        where: { code: reactivationCode },
      });
      expect(stored!.status).toBe(CouponStatus.USED);
      expect(stored!.usedInOrderId).toBe(order.id);
    });

    it('cancelar un pedido sin cupón no rompe nada', async () => {
      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId,
          items: [{ menuItemId: itemId, quantity: 1 }],
        })
        .expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;

      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado' })
        .expect(200);
      expect(((res.body as Envelope).data as OrderData).status).toBe(
        'cancelado',
      );
    });
  });

  describe('Generación automática (disparo tras entregar)', () => {
    let clientCId: string;

    beforeAll(async () => {
      const clientC = await usersRepo.findOne({
        where: { email: clientCEmail },
      });
      clientCId = clientC!.id;
    });

    const deliverOrder = async (
      token: string,
      quantity: number,
    ): Promise<string> => {
      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          addressSnapshot: '{"fullAddress":"Av. Prueba 1","district":"SJM"}',
          items: [{ menuItemId: itemId, quantity }],
        })
        .expect(201);
      const orderId = ((created.body as Envelope).data as OrderData).id;

      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmado' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'en_camino' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'entregado' })
        .expect(200);
      return orderId;
    };

    it('genera un cupón automático al superar el umbral (3x24.9=74.7 ≥ 50)', async () => {
      const clientCToken = await register(
        `qa-coupons-c2-${suffix}@test.com`,
        'Cliente C2',
      );
      await deliverOrder(clientCToken, 3);

      const res = await request(app.getHttpServer())
        .get('/coupons/me')
        .set('Authorization', `Bearer ${clientCToken}`)
        .expect(200);
      const coupons = (res.body as Envelope).data as CouponData[];
      const auto = coupons.filter(
        (c) => c.origin === 'auto' && c.status === 'active',
      );
      expect(auto).toHaveLength(1);
      expect(auto[0].discountType).toBe('percentage');
      expect(auto[0].discountValue).toBe(10);
      expect(auto[0].minPurchaseAmount).toBeNull(); // los automáticos no llevan mínimo
    });

    it('no genera un segundo cupón si ya hay uno activo sin usar', async () => {
      const clientCToken = await register(
        `qa-coupons-c3-${suffix}@test.com`,
        'Cliente C3',
      );
      await deliverOrder(clientCToken, 3); // primer umbral superado → cupón
      await deliverOrder(clientCToken, 3); // segundo umbral superado → NO duplica

      const res = await request(app.getHttpServer())
        .get('/coupons/me')
        .set('Authorization', `Bearer ${clientCToken}`)
        .expect(200);
      const coupons = (res.body as Envelope).data as CouponData[];
      const activeAuto = coupons.filter(
        (c) => c.origin === 'auto' && c.status === 'active',
      );
      expect(activeAuto).toHaveLength(1);
    });

    it('no genera cupón si el gasto no supera el umbral', async () => {
      const clientCToken = await register(
        `qa-coupons-c4-${suffix}@test.com`,
        'Cliente C4',
      );
      await deliverOrder(clientCToken, 1); // 24.9 < 50

      const res = await request(app.getHttpServer())
        .get('/coupons/me')
        .set('Authorization', `Bearer ${clientCToken}`)
        .expect(200);
      const coupons = (res.body as Envelope).data as CouponData[];
      expect(coupons.filter((c) => c.origin === 'auto')).toHaveLength(0);
    });

    void clientCId;
  });

  describe('GET /coupons (admin)', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer()).get('/coupons').expect(401);
    });

    it('403 para un cliente', async () => {
      const res = await request(app.getHttpServer())
        .get('/coupons')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('lista paginada y filtra por estado', async () => {
      const res = await request(app.getHttpServer())
        .get('/coupons?page=1&limit=10&status=active')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: CouponData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.meta.page).toBe(1);
      expect(data.meta.limit).toBe(10);
      expect(data.meta.total).toBeGreaterThanOrEqual(1);
      expect(data.items.every((c) => c.status === 'active')).toBe(true);
    });

    it('rechaza un status inválido (400)', async () => {
      const res = await request(app.getHttpServer())
        .get('/coupons?status=inexistente')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('filtra por userId: devuelve solo los cupones de ese usuario', async () => {
      const res = await request(app.getHttpServer())
        .get(`/coupons?userId=${clientAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: CouponData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.meta.total).toBeGreaterThanOrEqual(1);
      expect(data.items.every((c) => c.userId === clientAId)).toBe(true);
    });

    it('filtra por userId inexistente: lista vacía sin error', async () => {
      const res = await request(app.getHttpServer())
        .get('/coupons?userId=11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: CouponData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(data.items).toHaveLength(0);
      expect(data.meta.total).toBe(0);
    });

    it('combina userId con status', async () => {
      const res = await request(app.getHttpServer())
        .get(`/coupons?userId=${clientAId}&status=used`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: CouponData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(data.meta.total).toBeGreaterThanOrEqual(1);
      expect(data.items.every((c) => c.userId === clientAId)).toBe(true);
      expect(data.items.every((c) => c.status === 'used')).toBe(true);
    });

    it('rechaza un userId que no es UUID (400)', async () => {
      const res = await request(app.getHttpServer())
        .get('/coupons?userId=no-es-un-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('sin userId sigue listando cupones de todos los usuarios', async () => {
      const res = await request(app.getHttpServer())
        .get('/coupons?page=1&limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: CouponData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(data.meta.total).toBeGreaterThanOrEqual(1);
      // Al menos un cupón pertenece a clientA (creado en esta suite).
      expect(data.items.some((c) => c.userId === clientAId)).toBe(true);
    });
  });
});
