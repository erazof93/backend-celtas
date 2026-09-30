import {
  ClassSerializerInterceptor,
  INestApplication,
  ServiceUnavailableException,
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
import { UserThrottlerGuard } from './../src/common/guards/user-throttler.guard';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { Category } from './../src/modules/menu/entities/category.entity';
import { MenuItem } from './../src/modules/menu/entities/menu-item.entity';
import { Order } from './../src/modules/orders/entities/order.entity';
import { GeoapifyService } from './../src/modules/orders/geoapify.service';
import { Sauce } from './../src/modules/sauces/entities/sauce.entity';
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

interface ErrorResponse {
  success: boolean;
  message: string;
  statusCode: number;
}

interface Envelope {
  data: unknown;
}

interface OrderData {
  id: string;
  userId: string;
  status: string;
  addressSnapshot: string;
  total: number;
  deliveryFee: number;
  whatsappUrl: string;
  items: {
    name: string;
    unitPrice: number;
    quantity: number;
    subtotal: number;
    comment: string | null;
  }[];
  user?: { phone: string | null; fullName: string };
  cancelReason?: string | null;
}

describe('Orders (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let addressesRepo: Repository<Address>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let ordersRepo: Repository<Order>;
  let settingsRepo: Repository<Setting>;
  let businessHoursSnapshot: BusinessHoursSnapshot;

  let clientAToken: string;
  let clientBToken: string;
  let adminToken: string;
  let clientAId: string;

  let categoryId: string;
  let itemAId: string;
  let itemBId: string;
  let addressId: string;
  const sauceIds: string[] = [];
  // Pedidos manuales anónimos (userId null): el afterAll borra por userId, así
  // que estos se borran aparte, ANTES de los productos (FK de order_items).
  const anonOrderIds: string[] = [];

  const suffix = Date.now();
  const clientAEmail = `qa-orders-a-${suffix}@test.com`;
  const clientBEmail = `qa-orders-b-${suffix}@test.com`;
  const adminEmail = `qa-orders-admin-${suffix}@test.com`;
  const password = 'password123';

  const register = async (email: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName })
      .expect(201);
    return (res.body as AuthTokensResponse).data.accessToken;
  };

  const createOrder = (token: string, body: Record<string, unknown>) => {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      // Rate limit de GET /orders/geocode: se valida en geocode-throttle.e2e-spec.ts.
      .overrideGuard(UserThrottlerGuard)
      .useValue({ canActivate: () => true })
      // Sin red real: Geoapify tiene rate limit compartido con la app y el CI no
      // tiene API key. Stub con la respuesta real verificada para Jr. Carabaya 250.
      .overrideProvider(GeoapifyService)
      .useValue({
        geocode: (text: string) =>
          text === '__QA_503__'
            ? Promise.reject(
                new ServiceUnavailableException(
                  'El servicio de geocodificación no está disponible, intenta de nuevo en unos segundos',
                ),
              )
            : Promise.resolve(
                text.startsWith('Jr. Carabaya 250')
                  ? ([-12.0466994, -77.03041] as [number, number])
                  : null,
              ),
      })
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

    // Esta suite crea pedidos reales vía POST /orders: forzar el local
    // "abierto siempre" para que no dependa de la hora real de Lima en la
    // que corre (ver OrdersService.create, bloquea con 409 si está cerrado).
    businessHoursSnapshot = await forceBusinessAlwaysOpen(settingsRepo);

    const adminHash = await bcrypt.hash(password, 10);
    const admin = await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Orders QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    clientAToken = await register(clientAEmail, 'Cliente A');
    clientBToken = await register(clientBEmail, 'Cliente B');
    const clientA = await usersRepo.findOne({ where: { email: clientAEmail } });
    clientAId = clientA!.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;

    // store_location se siembra SIN CONFIGURAR (ver SettingsService): esta
    // suite crea pedidos con direcciones con coordenadas, así que necesita
    // una ubicación real de prueba para que OrdersService pueda calcular el
    // delivery por distancia (si no, 404 — mismo criterio que WHATSAPP_NUMBER).
    await request(app.getHttpServer())
      .patch('/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'store_location',
        value: JSON.stringify({ latitude: -12.1631, longitude: -76.97 }),
      })
      .expect(200);

    // Menú de prueba
    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Burgers ${suffix}` })
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

    void admin;
  });

  afterAll(async () => {
    const users = await usersRepo.find({
      where: [
        { email: clientAEmail },
        { email: clientBEmail },
        { email: adminEmail },
      ],
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      // Los order_items se borran en cascada al eliminar los orders.
      await ordersRepo.delete(ids.map((id) => ({ userId: id })));
      await addressesRepo.delete(ids.map((id) => ({ userId: id })));
    }
    if (anonOrderIds.length > 0) {
      await ordersRepo.delete(anonOrderIds);
    }
    await itemsRepo.delete({ categoryId });
    if (sauceIds.length > 0) {
      await app
        .get<Repository<Sauce>>(getRepositoryToken(Sauce))
        .delete(sauceIds);
    }
    await categoriesRepo.delete({ id: categoryId });
    await usersRepo.delete({ email: clientAEmail });
    await usersRepo.delete({ email: clientBEmail });
    await usersRepo.delete({ email: adminEmail });
    await restoreBusinessHours(settingsRepo, businessHoursSnapshot);
    await app.close();
  });

  describe('POST /orders', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .send({ addressId, items: [{ menuItemId: itemAId, quantity: 1 }] })
        .expect(401);
    });

    it('crea el pedido en pendiente con snapshot, total calculado y whatsappUrl', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [
          { menuItemId: itemAId, quantity: 2 },
          { menuItemId: itemBId, quantity: 3 },
        ],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;

      expect(data.status).toBe('pendiente');
      expect(data.total).toBe(81.3); // 24.9*2 + 10.5*3, calculado en el backend
      expect(data.userId).toBe(clientAId);
      expect(data.addressSnapshot).toContain('Av. Los Álamos 123');
      expect(data.addressSnapshot).toContain('San Juan de Miraflores');
      expect(data.whatsappUrl).toContain('wa.me/51999999999');
      const decoded = decodeURIComponent(data.whatsappUrl);
      expect(decoded).toContain(
        `NUEVO PEDIDO #${data.id.slice(0, 8).toUpperCase()}`,
      );
      expect(decoded).toContain('2x Clásica');
      expect(decoded).toContain('Total a pagar:* S/ 81.30');
      expect(data.items).toHaveLength(2);
      expect(data.items[0].subtotal).toBe(49.8);
      expect(data.items[1].subtotal).toBe(31.5);
    });

    it('incluye los links de Google Maps y Waze cuando la dirección tiene coordenadas', async () => {
      const addrWithCoords = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Trabajo',
          fullAddress: 'Av. Los Álamos 456',
          district: 'San Juan de Miraflores',
          latitude: -12.169,
          longitude: -77.0089,
        })
        .expect(201);
      const addressWithCoordsId = (
        (addrWithCoords.body as Envelope).data as { id: string }
      ).id;

      const res = await createOrder(clientAToken, {
        addressId: addressWithCoordsId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;

      expect(data.addressSnapshot).toContain('"latitude":-12.169');
      expect(data.addressSnapshot).toContain('"longitude":-77.0089');
      const decoded = decodeURIComponent(data.whatsappUrl);
      expect(decoded).toContain(
        'Google Maps: https://www.google.com/maps/search/?api=1&query=-12.169,-77.0089',
      );
      expect(decoded).toContain(
        'Waze: https://waze.com/ul?ll=-12.169,-77.0089&navigate=yes',
      );
    });

    it('sin coordenadas en la dirección: deliveryFee = 0 (no bloquea el pedido)', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;
      expect(data.deliveryFee).toBe(0);
      expect(data.total).toBe(24.9);
    });

    it('calcula deliveryFee por distancia real (Haversine) contra store_location y lo suma al total', async () => {
      // store_location (seteado en beforeAll): -12.1631,-76.97. Esta dirección
      // queda a ~7.77m → tramo delivery_fee_tiers default <=100m → S/2.
      const addrNear = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Cerca del local',
          fullAddress: 'Av. Los Álamos 789',
          district: 'San Juan de Miraflores',
          latitude: -12.16315,
          longitude: -76.97005,
        })
        .expect(201);
      const addrNearId = ((addrNear.body as Envelope).data as { id: string })
        .id;

      const res = await createOrder(clientAToken, {
        addressId: addrNearId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;

      expect(data.deliveryFee).toBe(2);
      expect(data.total).toBe(26.9); // 24.9 (subtotal) + 2 (deliveryFee)
    });

    it('el mensaje de WhatsApp desglosa Subtotal y Envío cuando NO hay cupón (sin línea de Cupón)', async () => {
      const addrNear = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Desglose sin cupón',
          fullAddress: 'Av. Los Álamos 852',
          district: 'San Juan de Miraflores',
          latitude: -12.16315,
          longitude: -76.97005,
        })
        .expect(201);
      const addrNearId = ((addrNear.body as Envelope).data as { id: string })
        .id;

      const res = await createOrder(clientAToken, {
        addressId: addrNearId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;
      const decoded = decodeURIComponent(data.whatsappUrl);

      expect(decoded).toContain('Subtotal:* S/ 24.90');
      expect(decoded).toContain('Envío:* S/ 2.00');
      expect(decoded).not.toContain('Cupón');
      expect(decoded).toContain('Total a pagar:* S/ 26.90');
    });

    it('el mensaje de WhatsApp desglosa Subtotal, Cupón (código + monto descontado) y Envío cuando SÍ hay cupón', async () => {
      const addrNear = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Desglose con cupón',
          fullAddress: 'Av. Los Álamos 963',
          district: 'San Juan de Miraflores',
          latitude: -12.16315,
          longitude: -76.97005,
        })
        .expect(201);
      const addrNearId = ((addrNear.body as Envelope).data as { id: string })
        .id;

      const coupon = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientAId,
          discountType: 'fixed_amount',
          discountValue: 5,
        })
        .expect(201);
      const couponCode = ((coupon.body as Envelope).data as { code: string })
        .code;

      const res = await createOrder(clientAToken, {
        addressId: addrNearId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
        couponCode,
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;
      const decoded = decodeURIComponent(data.whatsappUrl);

      // subtotal 24.9 - descuento 5 = 19.9, + deliveryFee 2 = 21.9
      expect(data.total).toBe(21.9);
      expect(decoded).toContain('Subtotal:* S/ 24.90');
      expect(decoded).toContain(`Cupón (${couponCode}):* -S/ 5.00`);
      expect(decoded).toContain('Envío:* S/ 2.00');
      expect(decoded).toContain('Total a pagar:* S/ 21.90');
    });

    it('un pedido lejano (fuera de todos los tramos con techo) usa la tarifa plana y NUNCA se rechaza', async () => {
      // ~3.7km del store_location → supera el último tramo con techo (1000m):
      // cae en el tramo final (maxMeters: null) → S/8, y el pedido se crea igual.
      const addrFar = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Lejos del local',
          fullAddress: 'Av. Los Álamos 999',
          district: 'San Juan de Miraflores',
          latitude: -12.19,
          longitude: -76.95,
        })
        .expect(201);
      const addrFarId = ((addrFar.body as Envelope).data as { id: string }).id;

      const res = await createOrder(clientAToken, {
        addressId: addrFarId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;

      expect(data.deliveryFee).toBe(8);
      expect(data.status).toBe('pendiente');
    });

    it('store_location sin configurar + dirección CON coordenadas → 404, no crea el pedido', async () => {
      const addr = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Otra',
          fullAddress: 'Av. Los Álamos 111',
          district: 'San Juan de Miraflores',
          latitude: -12.169,
          longitude: -77.0089,
        })
        .expect(201);
      const addrId = ((addr.body as Envelope).data as { id: string }).id;

      // Desconfigura store_location temporalmente (se restaura al final del test).
      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'store_location', value: ' ' })
        .expect(200);

      const res = await createOrder(clientAToken, {
        addressId: addrId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);

      await request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          key: 'store_location',
          value: JSON.stringify({ latitude: -12.1631, longitude: -76.97 }),
        })
        .expect(200);
    });

    it('acepta addressSnapshot directo (sin direcciones guardadas)', async () => {
      const res = await createOrder(clientBToken, {
        addressSnapshot:
          '{"fullAddress":"Jr. Los Olivos 456","district":"Surco"}',
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;
      expect(data.addressSnapshot).toContain('Jr. Los Olivos 456');
      expect(data.total).toBe(24.9);
    });

    it('400 si no se indica dirección', async () => {
      const res = await createOrder(clientAToken, {
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('404 si el producto no existe', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [
          { menuItemId: '11111111-1111-4111-8111-111111111111', quantity: 1 },
        ],
      }).expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('400 si el producto no está disponible', async () => {
      const hidden = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Oculto', price: 5, categoryId, available: false })
        .expect(201);
      const hiddenId = ((hidden.body as Envelope).data as { id: string }).id;

      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: hiddenId, quantity: 1 }],
      }).expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);

      await request(app.getHttpServer())
        .delete(`/menu/items/${hiddenId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('400 si la cantidad es 0 o negativa', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 0 }],
      }).expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si el pedido no trae items', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [],
      }).expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('comment presente se persiste y aparece como "Nota:" en el mensaje de WhatsApp', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [
          {
            menuItemId: itemAId,
            quantity: 1,
            comment: 'Sin cebolla, bien cocida',
          },
        ],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;

      expect(data.items[0].comment).toBe('Sin cebolla, bien cocida');
      const decoded = decodeURIComponent(data.whatsappUrl);
      expect(decoded).toContain('1x Clásica — Nota: Sin cebolla, bien cocida');
    });

    it.each([
      ['ausente', undefined],
      ['vacío', ''],
      ['solo espacios', '   '],
    ])(
      'comment %s → null en la respuesta, sin "Nota:" en el mensaje de WhatsApp',
      async (_label, comment) => {
        const res = await createOrder(clientAToken, {
          addressId,
          items: [{ menuItemId: itemAId, quantity: 1, comment }],
        }).expect(201);
        const data = (res.body as Envelope).data as OrderData;

        expect(data.items[0].comment).toBeNull();
        const decoded = decodeURIComponent(data.whatsappUrl);
        expect(decoded).not.toContain('Nota:');
      },
    );

    it('400 si el comment supera los 140 caracteres', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1, comment: 'a'.repeat(141) }],
      }).expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si comment no es un string (tipo incorrecto)', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1, comment: 12345 }],
      }).expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('acepta un comment de exactamente 140 caracteres (límite inclusive)', async () => {
      const comment = 'a'.repeat(140);
      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1, comment }],
      }).expect(201);
      const data = (res.body as Envelope).data as OrderData;

      expect(data.items[0].comment).toBe(comment);
      expect(data.items[0].comment).toHaveLength(140);
    });
  });

  // BD real con la migración aplicada: el default NULL (salsas) vs NOT NULL
  // default 1 (bebidas/extras) lo pone la columna, no el service — un unit
  // test con repos mockeados no puede verificarlo.
  describe('sauceGroupMaxSelectable nullable (NULL = sin límite)', () => {
    let unlimitedItemId: string;
    let limitedItemId: string;

    interface MenuItemData {
      id: string;
      sauceGroupMaxSelectable: number | null;
      beverageGroupMaxSelectable: number;
      extraPortionsGroupMaxSelectable: number;
    }

    const createItem = async (body: Record<string, unknown>) => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 20, categoryId, sauceIds, ...body })
        .expect(201);
      return (res.body as Envelope).data as MenuItemData;
    };

    // Se borran en el afterAll global, DESPUÉS de los productos (FK de
    // menu_item_sauces sin cascade hacia sauces).
    beforeAll(async () => {
      for (let i = 1; i <= 10; i++) {
        const res = await request(app.getHttpServer())
          .post('/sauces')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: `Salsa QA ${i} ${suffix}` })
          .expect(201);
        sauceIds.push(((res.body as Envelope).data as { id: string }).id);
      }
    });

    it('crear producto SIN sauceGroupMaxSelectable → null en BD; bebidas/extras siguen en 1', async () => {
      const item = await createItem({ name: `Sin límite ${suffix}` });
      unlimitedItemId = item.id;

      const stored = await itemsRepo.findOneByOrFail({ id: item.id });
      expect(stored.sauceGroupMaxSelectable).toBeNull();
      expect(stored.beverageGroupMaxSelectable).toBe(1);
      expect(stored.extraPortionsGroupMaxSelectable).toBe(1);
    });

    it('crear producto con sauceGroupMaxSelectable: null explícito → 201 y null', async () => {
      const item = await createItem({
        name: `Null explícito ${suffix}`,
        sauceGroupMaxSelectable: null,
      });
      expect(item.sauceGroupMaxSelectable).toBeNull();
    });

    it('sauceGroupMaxSelectable: 0 sigue siendo inválido → 400', async () => {
      await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Cero ${suffix}`,
          price: 20,
          categoryId,
          sauceGroupMaxSelectable: 0,
        })
        .expect(400);
    });

    it('GET /menu devuelve sauceGroupMaxSelectable: null y beverageGroupMaxSelectable: 1', async () => {
      const res = await request(app.getHttpServer()).get('/menu').expect(200);
      const data = (res.body as Envelope).data as {
        id: string;
        items: MenuItemData[];
      }[];
      const item = data
        .find((c) => c.id === categoryId)
        ?.items.find((i) => i.id === unlimitedItemId);

      expect(item).toBeDefined();
      expect(item?.sauceGroupMaxSelectable).toBeNull();
      expect(item?.beverageGroupMaxSelectable).toBe(1);
      expect(item?.extraPortionsGroupMaxSelectable).toBe(1);
    });

    it.each([5, 10])(
      'POST /orders con max=null + %i salsas → 201 (acepta todas)',
      async (count) => {
        const res = await createOrder(clientAToken, {
          addressId,
          items: [
            {
              menuItemId: unlimitedItemId,
              quantity: 1,
              sauceIds: sauceIds.slice(0, count),
            },
          ],
        }).expect(201);
        const data = (res.body as Envelope).data as {
          items: { selectedSauces: string[] }[];
        };
        expect(data.items[0].selectedSauces).toHaveLength(count);
      },
    );

    it('POST /orders con max=1 explícito + 2 salsas → sigue siendo 400', async () => {
      limitedItemId = (
        await createItem({
          name: `Límite 1 ${suffix}`,
          sauceGroupMaxSelectable: 1,
        })
      ).id;

      const res = await createOrder(clientAToken, {
        addressId,
        items: [
          {
            menuItemId: limitedItemId,
            quantity: 1,
            sauceIds: sauceIds.slice(0, 2),
          },
        ],
      }).expect(400);
      expect((res.body as ErrorResponse).message).toContain(
        'como máximo 1 salsa(s)',
      );
    });

    it('PATCH con sauceGroupMaxSelectable: null quita el límite de un producto existente', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/menu/items/${limitedItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sauceGroupMaxSelectable: null })
        .expect(200);
      expect((res.body as Envelope).data).toMatchObject({
        sauceGroupMaxSelectable: null,
      });

      await createOrder(clientAToken, {
        addressId,
        items: [
          {
            menuItemId: limitedItemId,
            quantity: 1,
            sauceIds: sauceIds.slice(0, 2),
          },
        ],
      }).expect(201);

      // Persistido en BD (no solo en la respuesta del save).
      const stored = await itemsRepo.findOneByOrFail({ id: limitedItemId });
      expect(stored.sauceGroupMaxSelectable).toBeNull();
    });

    it('PATCH que OMITE sauceGroupMaxSelectable no toca el valor existente (ni un número ni null)', async () => {
      const item = await createItem({
        name: `Límite 3 ${suffix}`,
        sauceGroupMaxSelectable: 3,
      });

      await request(app.getHttpServer())
        .patch(`/menu/items/${item.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 21 })
        .expect(200);
      expect(
        (await itemsRepo.findOneByOrFail({ id: item.id }))
          .sauceGroupMaxSelectable,
      ).toBe(3);

      // Y un producto ya en null tampoco vuelve a número al omitirlo.
      await request(app.getHttpServer())
        .patch(`/menu/items/${unlimitedItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 22 })
        .expect(200);
      expect(
        (await itemsRepo.findOneByOrFail({ id: unlimitedItemId }))
          .sauceGroupMaxSelectable,
      ).toBeNull();
    });

    it('PATCH puede volver de null a un número (re-poner límite)', async () => {
      await request(app.getHttpServer())
        .patch(`/menu/items/${limitedItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sauceGroupMaxSelectable: 2 })
        .expect(200);
      expect(
        (await itemsRepo.findOneByOrFail({ id: limitedItemId }))
          .sauceGroupMaxSelectable,
      ).toBe(2);
    });

    it.each([0, -1, 1.5, '3', true])(
      'PATCH con sauceGroupMaxSelectable=%p inválido → 400',
      async (value) => {
        await request(app.getHttpServer())
          .patch(`/menu/items/${limitedItemId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ sauceGroupMaxSelectable: value })
          .expect(400);
      },
    );
  });

  describe('POST /orders/estimate-delivery-fee', () => {
    const estimate = (token: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/orders/estimate-delivery-fee')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/orders/estimate-delivery-fee')
        .send({ addressId })
        .expect(401);
    });

    it('dirección sin coordenadas: deliveryFee 0, isFarOrder false, distanceMeters null', async () => {
      const res = await estimate(clientAToken, { addressId }).expect(201);
      const data = (res.body as Envelope).data as {
        deliveryFee: number;
        isFarOrder: boolean;
        distanceMeters: number | null;
      };
      expect(data).toEqual({
        deliveryFee: 0,
        isFarOrder: false,
        distanceMeters: null,
      });
    });

    it('dirección cercana: calcula el mismo tramo que POST /orders (S/2), sin crear ningún pedido', async () => {
      const addrNear = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Estimación cerca',
          fullAddress: 'Av. Los Álamos 321',
          district: 'San Juan de Miraflores',
          latitude: -12.16315,
          longitude: -76.97005,
        })
        .expect(201);
      const addrNearId = ((addrNear.body as Envelope).data as { id: string })
        .id;
      const ordersBefore = await ordersRepo.count({
        where: { userId: clientAId },
      });

      const res = await estimate(clientAToken, {
        addressId: addrNearId,
      }).expect(201);
      const data = (res.body as Envelope).data as {
        deliveryFee: number;
        isFarOrder: boolean;
        distanceMeters: number;
      };

      expect(data.deliveryFee).toBe(2);
      expect(data.isFarOrder).toBe(false);
      expect(data.distanceMeters).toBe(0); // ~7.77 m exactos, expuesto redondeado a 50 m
      const ordersAfter = await ordersRepo.count({
        where: { userId: clientAId },
      });
      expect(ordersAfter).toBe(ordersBefore);
    });

    it('dirección lejana: isFarOrder true y tarifa del tramo sin techo (S/8)', async () => {
      const addrFar = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Estimación lejos',
          fullAddress: 'Av. Los Álamos 654',
          district: 'San Juan de Miraflores',
          latitude: -12.19,
          longitude: -76.95,
        })
        .expect(201);
      const addrFarId = ((addrFar.body as Envelope).data as { id: string }).id;

      const res = await estimate(clientAToken, {
        addressId: addrFarId,
      }).expect(201);
      const data = (res.body as Envelope).data as {
        deliveryFee: number;
        isFarOrder: boolean;
        distanceMeters: number;
      };

      expect(data.deliveryFee).toBe(8);
      expect(data.isFarOrder).toBe(true);
      expect(data.distanceMeters).toBeGreaterThan(2500);
    });

    it('404 si la dirección no existe', async () => {
      const res = await estimate(clientAToken, {
        addressId: '11111111-1111-4111-8111-111111111111',
      }).expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('404 si la dirección le pertenece a otro usuario', async () => {
      const res = await estimate(clientBToken, { addressId }).expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('400 si addressId no es un UUID', async () => {
      const res = await estimate(clientAToken, {
        addressId: 'no-es-un-uuid',
      }).expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });
  });

  describe('GET /delivery/estimate', () => {
    interface DeliveryEstimate {
      deliveryFee: number;
      isFarOrder: boolean;
      distanceMeters: number | null;
    }

    const estimate = (query: string, token: string | null = clientAToken) => {
      const req = request(app.getHttpServer()).get(
        `/delivery/estimate${query}`,
      );
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    it('coordenadas del local → 200 con fee del primer tramo (S/2) y distancia 0', async () => {
      const res = await estimate('?latitude=-12.1631&longitude=-76.97').expect(
        200,
      );
      expect((res.body as Envelope).data).toEqual({
        deliveryFee: 2,
        isFarOrder: false,
        distanceMeters: 0,
      });
    });

    it.each([
      ['~7.8 m', '?latitude=-12.16315&longitude=-76.97005', 0, 2],
      [
        '~120 m (borde de tramo)',
        '?latitude=-12.16418&longitude=-76.97',
        100,
        4,
      ],
      ['~852 m', '?latitude=-12.169&longitude=-76.965', 850, 6],
      ['~107 km', '?latitude=-12&longitude=-76', 107000, 8],
    ])(
      '%s → distanceMeters múltiplo de 50 (%i) y fee con la distancia exacta (S/%i)',
      async (_label, query, shown, fee) => {
        const res = await estimate(query).expect(200);
        const data = (res.body as Envelope).data as DeliveryEstimate;
        expect(data.distanceMeters).toBe(shown);
        expect(data.distanceMeters! % 50).toBe(0);
        expect(data.deliveryFee).toBe(fee);
      },
    );

    it('coordenadas lejanas (-12, -76) → 200, tramo sin techo (S/8) e isFarOrder true (nunca rechaza)', async () => {
      const res = await estimate('?latitude=-12&longitude=-76').expect(200);
      const data = (res.body as Envelope).data as DeliveryEstimate;
      expect(data.deliveryFee).toBe(8);
      expect(data.isFarOrder).toBe(true);
      expect(data.distanceMeters).toBeGreaterThan(100000);
    });

    it('mismo resultado que POST /orders/estimate-delivery-fee para la misma dirección', async () => {
      const addr = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: `Delivery ${suffix}`,
          fullAddress: 'Av. Estimate 300',
          district: 'San Juan de Miraflores',
          latitude: -12.1658,
          longitude: -76.97,
        })
        .expect(201);
      const byAddress = await request(app.getHttpServer())
        .post('/orders/estimate-delivery-fee')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          addressId: ((addr.body as Envelope).data as { id: string }).id,
        })
        .expect(201);
      const byCoords = await estimate(
        '?latitude=-12.1658&longitude=-76.97',
      ).expect(200);

      expect((byCoords.body as Envelope).data).toEqual(
        (byAddress.body as Envelope).data,
      );
      expect(
        ((byCoords.body as Envelope).data as DeliveryEstimate).deliveryFee,
      ).toBe(4);
    });

    it('sin params → 400 con mensajes en español', async () => {
      const res = await estimate('').expect(400);
      const message = (res.body as ErrorResponse).message;
      expect(message).toContain('latitude es obligatoria y debe ser un número');
      expect(message).toContain(
        'longitude es obligatoria y debe ser un número',
      );
    });

    it.each([
      ['solo latitude', '?latitude=-12.1631'],
      ['latitude no numérica', '?latitude=abc&longitude=-76.97'],
      ['latitude fuera de rango', '?latitude=100&longitude=-76.97'],
      ['longitude fuera de rango', '?latitude=-12&longitude=200'],
    ])('%s → 400', async (_label, query) => {
      await estimate(query).expect(400);
    });

    it('401 sin token (con login a propósito: evita triangular el local)', async () => {
      await estimate('?latitude=-12.1631&longitude=-76.97', null).expect(401);
    });

    // --- Auditoría tester: casos borde de la query ---

    it('cualquier rol autenticado: admin también → 200', async () => {
      await estimate('?latitude=-12.1631&longitude=-76.97', adminToken).expect(
        200,
      );
    });

    it.each([
      ['Infinity', '?latitude=Infinity&longitude=-76.97'],
      ['-Infinity', '?latitude=-12&longitude=-Infinity'],
      [
        'array (?latitude=1&latitude=2)',
        '?latitude=1&latitude=2&longitude=-76.97',
      ],
      [
        'param extra (forbidNonWhitelisted)',
        '?latitude=-12&longitude=-76.97&foo=1',
      ],
    ])('%s → 400', async (_label, query) => {
      await estimate(query).expect(400);
    });

    it('-0 y notación exponencial (1e1) son números válidos → 200', async () => {
      await estimate('?latitude=-0&longitude=-0').expect(200);
      await estimate('?latitude=-1.21631e1&longitude=-76.97').expect(200);
    });

    // El fix de "vacío → 400" no debe rechazar el 0 explícito (coordenada válida).
    it('0 explícito es una coordenada válida → 200 con distancia > 0', async () => {
      const res = await estimate('?latitude=0&longitude=0').expect(200);
      const data = (res.body as Envelope).data as DeliveryEstimate;
      expect(data.distanceMeters).toBeGreaterThan(0);
      expect(data.isFarOrder).toBe(true);
    });

    // Number('') === 0 y Number(' ') === 0: sin este chequeo un param vacío
    // cotiza el punto (0,0) en vez de rechazar.
    it.each([
      ['latitude vacía', '?latitude=&longitude=-76.97'],
      ['longitude vacía', '?latitude=-12.1631&longitude='],
      ['ambas vacías', '?latitude=&longitude='],
      ['latitude solo espacio', '?latitude=%20&longitude=-76.97'],
    ])('%s → 400 (no debe convertirse en 0)', async (_label, query) => {
      await estimate(query).expect(400);
    });

    it('store_location sin configurar → 404 (no 500)', async () => {
      const original = await settingsRepo.findOneByOrFail({
        key: 'store_location',
      });
      const originalValue = original.value;
      await settingsRepo.update({ key: 'store_location' }, { value: '' });
      try {
        const res = await estimate(
          '?latitude=-12.1631&longitude=-76.97',
        ).expect(404);
        expect((res.body as ErrorResponse).statusCode).toBe(404);
      } finally {
        await settingsRepo.update(
          { key: 'store_location' },
          { value: originalValue },
        );
      }
    });
  });

  describe('GET /orders/me y GET /orders/:id', () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      orderId = ((res.body as Envelope).data as OrderData).id;
    });

    it('GET /orders/me devuelve solo los pedidos del cliente', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as OrderData[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.every((o) => o.userId === clientAId)).toBe(true);
    });

    it('GET /orders/me?limit=20 devuelve como máximo 20 pedidos', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders/me')
        .query({ limit: 20 })
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as OrderData[];
      expect(data.length).toBeLessThanOrEqual(20);
    });

    it('GET /orders/me respeta un límite custom menor a la cantidad real de pedidos', async () => {
      // Un segundo pedido asegura que el cliente tiene al menos 2 en total.
      await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/orders/me')
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as OrderData[];
      expect(data).toHaveLength(1);
    });

    it('GET /orders/me?limit=0 rechaza con 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders/me')
        .query({ limit: 0 })
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('GET /orders/:id: el cliente ve su propio pedido', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      expect(((res.body as Envelope).data as OrderData).id).toBe(orderId);
    });

    it('GET /orders/:id: otro cliente recibe 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${clientBToken}`)
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('GET /orders/:id: el admin ve cualquier pedido', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(((res.body as Envelope).data as OrderData).id).toBe(orderId);
    });

    it('GET /orders/:id: 404 si no existe', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('GET /orders/:id: expone user (phone/fullName), sin password', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as OrderData;
      expect(data.user).toBeDefined();
      expect(data.user?.fullName).toBe('Cliente A');
      expect(data.user?.phone).toBeNull();
      expect((data.user as unknown as Record<string, unknown>).password).toBe(
        undefined,
      );
    });
  });

  describe('GET /orders (admin)', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer()).get('/orders').expect(401);
    });

    it('403 para un cliente', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('devuelve la lista paginada para el admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: OrderData[];
        meta: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      };
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.meta.page).toBe(1);
      expect(data.meta.limit).toBe(10);
      expect(data.meta.total).toBeGreaterThanOrEqual(1);
      // La relación user (phone/fullName) también se carga en el listado admin.
      const withUser = data.items.find((o) => o.user);
      expect(withUser?.user?.fullName).toBeTruthy();
    });

    it('filtra por estado', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders?status=pendiente')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as { items: OrderData[] };
      expect(data.items.every((o) => o.status === 'pendiente')).toBe(true);
    });

    it('rechaza un status inválido en el filtro (400)', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders?status=inexistente')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('filtra por userId: devuelve solo los pedidos de ese usuario', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders?userId=${clientAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: OrderData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.meta.total).toBeGreaterThanOrEqual(1);
      expect(data.items.every((o) => o.userId === clientAId)).toBe(true);
    });

    it('filtra por userId inexistente: lista vacía sin error', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders?userId=11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: OrderData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(data.items).toHaveLength(0);
      expect(data.meta.total).toBe(0);
    });

    it('combina userId con status', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders?userId=${clientAId}&status=pendiente`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: OrderData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(data.meta.total).toBeGreaterThanOrEqual(1);
      expect(data.items.every((o) => o.userId === clientAId)).toBe(true);
      expect(data.items.every((o) => o.status === 'pendiente')).toBe(true);
    });

    it('rechaza un userId que no es UUID (400)', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders?userId=no-es-un-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('sin userId sigue listando pedidos de todos los usuarios', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders?page=1&limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: OrderData[];
        meta: { page: number; limit: number; total: number };
      };
      expect(data.meta.total).toBeGreaterThanOrEqual(1);
      // Al menos un pedido pertenece a clientA (creado en esta suite).
      expect(data.items.some((o) => o.userId === clientAId)).toBe(true);
    });
  });

  describe('PATCH /orders/:id/status', () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 2 }],
      }).expect(201);
      orderId = ((res.body as Envelope).data as OrderData).id;
    });

    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .send({ status: 'confirmado' })
        .expect(401);
    });

    it('403 para un cliente', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ status: 'confirmado' })
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('400 si la transición es inválida (pendiente → entregado)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'entregado' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si el estado no es válido', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inexistente' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('404 si el pedido no existe', async () => {
      const res = await request(app.getHttpServer())
        .patch('/orders/11111111-1111-4111-8111-111111111111/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmado' })
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('recorre la transición válida y al llegar a entregado sube totalSpent', async () => {
      // totalSpent inicial del cliente A
      const meBefore = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const totalBefore = (
        (meBefore.body as Envelope).data as { totalSpent: number }
      ).totalSpent;

      // pendiente → confirmado → en_camino → entregado
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
      const delivered = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'entregado' })
        .expect(200);
      expect(((delivered.body as Envelope).data as OrderData).status).toBe(
        'entregado',
      );

      // totalSpent debe haber subido en 49.8 (24.9 * 2)
      const meAfter = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const totalAfter = (
        (meAfter.body as Envelope).data as { totalSpent: number }
      ).totalSpent;
      expect(totalAfter).toBe(Number((totalBefore + 49.8).toFixed(2)));
    });

    it('no permite transicionar un pedido ya entregado', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('reintentar entregado da 400 y no vuelve a sumar totalSpent', async () => {
      const meBefore = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const totalBefore = (
        (meBefore.body as Envelope).data as { totalSpent: number }
      ).totalSpent;

      // El pedido ya quedó "entregado" en el test anterior; reintentar debe fallar.
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'entregado' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);

      const meAfter = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const totalAfter = (
        (meAfter.body as Envelope).data as { totalSpent: number }
      ).totalSpent;
      expect(totalAfter).toBe(totalBefore); // sin acumulación doble
    });

    it('permite cancelar desde pendiente', async () => {
      const created = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const cancelId = ((created.body as Envelope).data as OrderData).id;

      const res = await request(app.getHttpServer())
        .patch(`/orders/${cancelId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado' })
        .expect(200);
      expect(((res.body as Envelope).data as OrderData).status).toBe(
        'cancelado',
      );
    });

    it('400 si cancelReason supera los 500 caracteres (DTO)', async () => {
      const created = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const id = ((created.body as Envelope).data as OrderData).id;

      const res = await request(app.getHttpServer())
        .patch(`/orders/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado', cancelReason: 'a'.repeat(501) })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);

      // El pedido no debe haber quedado cancelado a medias: sigue pendiente.
      const check = await request(app.getHttpServer())
        .get(`/orders/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(((check.body as Envelope).data as OrderData).status).toBe(
        'pendiente',
      );
    });

    it('acepta cancelReason de exactamente 500 caracteres', async () => {
      const created = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const id = ((created.body as Envelope).data as OrderData).id;
      const reason = 'a'.repeat(500);

      const res = await request(app.getHttpServer())
        .patch(`/orders/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado', cancelReason: reason })
        .expect(200);
      expect(((res.body as Envelope).data as OrderData).cancelReason).toBe(
        reason,
      );
    });

    it('GET de un pedido no cancelado devuelve cancelReason: null', async () => {
      const created = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const id = ((created.body as Envelope).data as OrderData).id;

      const res = await request(app.getHttpServer())
        .get(`/orders/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(((res.body as Envelope).data as OrderData).cancelReason).toBe(
        null,
      );
    });

    it('400 al cancelar un pedido en_camino sin motivo', async () => {
      const created = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const enCaminoId = ((created.body as Envelope).data as OrderData).id;
      await request(app.getHttpServer())
        .patch(`/orders/${enCaminoId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmado' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${enCaminoId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'en_camino' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/orders/${enCaminoId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);

      // El pedido sigue en_camino, no quedó a medio cancelar.
      const check = await request(app.getHttpServer())
        .get(`/orders/${enCaminoId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(((check.body as Envelope).data as OrderData).status).toBe(
        'en_camino',
      );
    });

    it('200 al cancelar un pedido en_camino con motivo, guarda cancelReason y no rompe en_camino → entregado en otro pedido', async () => {
      const created = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const enCaminoId = ((created.body as Envelope).data as OrderData).id;
      await request(app.getHttpServer())
        .patch(`/orders/${enCaminoId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmado' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${enCaminoId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'en_camino' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/orders/${enCaminoId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'cancelado',
          cancelReason: 'El cliente ya no se encuentra en la dirección',
        })
        .expect(200);
      const cancelled = (res.body as Envelope).data as OrderData;
      expect(cancelled.status).toBe('cancelado');
      expect(cancelled.cancelReason).toBe(
        'El cliente ya no se encuentra en la dirección',
      );

      // La transición en_camino → entregado de OTRO pedido (creado antes en esta
      // suite) no se ve afectada por haber habilitado en_camino → cancelado.
      const anotherOrder = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const anotherId = ((anotherOrder.body as Envelope).data as OrderData).id;
      await request(app.getHttpServer())
        .patch(`/orders/${anotherId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmado' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${anotherId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'en_camino' })
        .expect(200);
      const delivered = await request(app.getHttpServer())
        .patch(`/orders/${anotherId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'entregado' })
        .expect(200);
      expect(((delivered.body as Envelope).data as OrderData).status).toBe(
        'entregado',
      );
    });
  });

  describe('addressSnapshot inmutable', () => {
    it('no cambia si luego se edita o borra la Address original', async () => {
      const res = await createOrder(clientAToken, {
        addressId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      }).expect(201);
      const order = (res.body as Envelope).data as OrderData;
      const snapshotBefore = order.addressSnapshot;

      // Editar la dirección original
      await request(app.getHttpServer())
        .patch(`/users/me/addresses/${addressId}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ fullAddress: 'Av. CAMBIADA 999' })
        .expect(200);

      // Borrar la dirección original
      await request(app.getHttpServer())
        .delete(`/users/me/addresses/${addressId}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const snapshotAfter = ((detail.body as Envelope).data as OrderData)
        .addressSnapshot;

      expect(snapshotAfter).toBe(snapshotBefore);
      expect(snapshotAfter).toContain('Av. Los Álamos 123');
      expect(snapshotAfter).not.toContain('Av. CAMBIADA');
    });
  });

  describe('POST /orders/admin (pedido manual)', () => {
    interface ManualOrderData extends OrderData {
      userId: string;
      customerName: string | null;
      customerPhone: string | null;
      deliveredAt: string | null;
    }

    // Sin coordenadas → deliveryFee 0 (no bloquea): total = solo los productos.
    const snapshot = JSON.stringify({
      alias: 'Pedido telefónico',
      fullAddress: 'Jr. Los Pinos 456',
      district: 'San Juan de Miraflores',
    });
    const anonBody = {
      customerName: 'Juan Pérez',
      customerPhone: '+51 987 654 321',
      addressSnapshot: snapshot,
      items: [{ menuItemId: '', quantity: 2 }],
    };

    // Registra TODO pedido anónimo que se cree por acá (también si un test que
    // espera 401/403/400 recibe 201 por una regresión): el afterAll lo borra.
    // Sin esto, un fallo dejaba basura con userId NULL en la BD local.
    const createManual = async (token: string | null, body: object) => {
      const req = request(app.getHttpServer()).post('/orders/admin');
      if (token) req.set('Authorization', `Bearer ${token}`);
      const res = await req.send(body);
      const created = (res.body as Partial<Envelope>).data as
        { id?: string; userId?: string | null } | undefined;
      if (res.status === 201 && created?.id && created.userId === null) {
        anonOrderIds.push(created.id);
      }
      return res;
    };
    const withItemA = <T extends { items: object[] }>(body: T) => ({
      ...body,
      items: [{ menuItemId: itemAId, quantity: 2 }],
    });
    const data = (res: { body: unknown }) =>
      (res.body as Envelope).data as ManualOrderData;
    const waNumber = (url: string) => new URL(url).pathname.slice(1);

    // Dirección propia de clientA: el `addressId` compartido lo borra un test
    // anterior ("el snapshot sobrevive al borrado de la dirección"). Tiene que
    // EXISTIR para que "anónimo con addressId → 400" pruebe algo real: con el
    // check roto, el lookup sin dueño la encontraría y daría 201.
    let ownAddressId: string;
    beforeAll(async () => {
      const addr = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Trabajo',
          fullAddress: 'Av. San Juan 789',
          reference: 'Oficina 2',
          district: 'San Juan de Miraflores',
        })
        .expect(201);
      ownAddressId = ((addr.body as Envelope).data as { id: string }).id;
    });

    it('anónimo → 201: userId null, contacto normalizado, total del backend, whatsappUrl al cliente', async () => {
      const res = await createManual(adminToken, withItemA(anonBody));

      expect(res.status).toBe(201);
      const order = data(res);
      expect(order.userId).toBeNull();
      expect(order.customerName).toBe('Juan Pérez');
      expect(order.customerPhone).toBe('51987654321');
      expect(order.status).toBe('pendiente');
      expect(order.total).toBe(49.8);
      expect(order.addressSnapshot).toBe(snapshot);
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({
        name: 'Clásica',
        unitPrice: 24.9,
        quantity: 2,
      });
      expect(waNumber(order.whatsappUrl)).toBe('51987654321');
      expect(decodeURIComponent(order.whatsappUrl)).toContain(
        '*CONFIRMA TU PEDIDO #',
      );
    });

    it('con customerId → 201: pedido del cliente, con su addressId, sin customerName/Phone', async () => {
      const res = await createManual(adminToken, {
        customerId: clientAId,
        addressId: ownAddressId,
        items: [{ menuItemId: itemBId, quantity: 1 }],
      });

      expect(res.status).toBe(201);
      const order = data(res);
      expect(order.userId).toBe(clientAId);
      expect(order.customerName).toBeNull();
      expect(order.customerPhone).toBeNull();
      expect(order.addressSnapshot).toContain('Av. San Juan 789');
      // Aparece en el historial del cliente como cualquier pedido suyo.
      const mine = await request(app.getHttpServer())
        .get('/orders/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      expect(
        ((mine.body as Envelope).data as { id: string }[]).map((o) => o.id),
      ).toContain(order.id);
    });

    it('sin items → 400', async () => {
      const res = await createManual(adminToken, {
        ...anonBody,
        items: undefined,
      });

      expect(res.status).toBe(400);
    });

    it('items vacío → 400', async () => {
      const res = await createManual(adminToken, { ...anonBody, items: [] });

      expect(res.status).toBe(400);
    });

    it('sin dirección → 400', async () => {
      const res = await createManual(
        adminToken,
        withItemA({ ...anonBody, addressSnapshot: undefined }),
      );

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Debes indicar una dirección (addressId o addressSnapshot)',
      );
    });

    it('anónimo con celular extranjero (+58) → 201, guardado como 584129999999', async () => {
      const res = await createManual(
        adminToken,
        withItemA({ ...anonBody, customerPhone: '+58 412 999 9999' }),
      );

      expect(res.status).toBe(201);
      expect(data(res).customerPhone).toBe('584129999999');
      expect(waNumber(data(res).whatsappUrl)).toBe('584129999999');
    });

    it('anónimo con extranjero SIN + → 400 con el mensaje que pide el código de país', async () => {
      const res = await createManual(
        adminToken,
        withItemA({ ...anonBody, customerPhone: '58 412 999 9999' }),
      );

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toContain(
        'con + y código de país si es extranjero',
      );
    });

    it.each([
      ['sin customerName', { customerName: undefined }],
      ['sin customerPhone', { customerPhone: undefined }],
      ['celular inválido', { customerPhone: '12345' }],
    ])('anónimo %s → 400', async (_label, override) => {
      const res = await createManual(
        adminToken,
        withItemA({ ...anonBody, ...override }),
      );

      expect(res.status).toBe(400);
    });

    it('customerId + customerName → 400 (contacto ambiguo)', async () => {
      const res = await createManual(
        adminToken,
        withItemA({ ...anonBody, customerId: clientAId }),
      );

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toContain(
        'customerName y customerPhone solo se envían en pedidos sin customerId',
      );
    });

    it('anónimo con addressId → 400 (no puede usar direcciones de ningún cliente)', async () => {
      const res = await createManual(
        adminToken,
        withItemA({
          ...anonBody,
          addressSnapshot: undefined,
          addressId: ownAddressId,
        }),
      );

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Un pedido sin cliente no puede usar addressId: envía la dirección en addressSnapshot',
      );
    });

    it('customerId de una cuenta admin → 400, sin crear nada', async () => {
      const admin = await usersRepo.findOneByOrFail({ email: adminEmail });
      const before = await ordersRepo.count();

      const res = await createManual(adminToken, {
        customerId: admin.id,
        addressSnapshot: snapshot,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      });

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'customerId debe ser una cuenta de cliente, no de administrador',
      );
      expect(await ordersRepo.count()).toBe(before);
    });

    it('customerId inexistente → 404', async () => {
      const res = await createManual(
        adminToken,
        withItemA({
          customerId: '99999999-9999-4999-8999-999999999999',
          addressSnapshot: snapshot,
          items: [],
        }),
      );

      expect(res.status).toBe(404);
      expect((res.body as ErrorResponse).message).toBe('Cliente no encontrado');
    });

    it('token de cliente (no admin) → 403, sin crear nada', async () => {
      const before = await ordersRepo.count();
      const res = await createManual(clientAToken, withItemA(anonBody));

      expect(res.status).toBe(403);
      expect(await ordersRepo.count()).toBe(before);
    });

    it('sin token → 401', async () => {
      const res = await createManual(null, withItemA(anonBody));

      expect(res.status).toBe(401);
    });

    it('el anónimo se lista y se ve en detalle (admin) con user null, sin romper', async () => {
      const id = anonOrderIds[0];
      const list = await request(app.getHttpServer())
        .get('/orders')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const listed = (
        (list.body as Envelope).data as { items: ManualOrderData[] }
      ).items.find((o) => o.id === id);
      expect(listed).toBeDefined();
      expect(listed?.user ?? null).toBeNull();

      const detail = await request(app.getHttpServer())
        .get(`/orders/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(data(detail).customerName).toBe('Juan Pérez');
    });

    it('un cliente no puede ver el pedido anónimo (403)', async () => {
      await request(app.getHttpServer())
        .get(`/orders/${anonOrderIds[0]}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(403);
    });

    it('el anónimo recorre pendiente → confirmado → en_camino → entregado (deliveredAt, sin 404 de usuario)', async () => {
      const id = anonOrderIds[0];
      for (const status of ['confirmado', 'en_camino', 'entregado']) {
        const res = await request(app.getHttpServer())
          .patch(`/orders/${id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status });
        expect(res.status).toBe(200);
      }
      const saved = await ordersRepo.findOneByOrFail({ id });
      expect(saved.status).toBe('entregado');
      expect(saved.deliveredAt).toBeInstanceOf(Date);
    });

    // ── Auditoría QA ─────────────────────────────────────────────────────────
    const advanceToDelivered = async (id: string) => {
      for (const status of ['confirmado', 'en_camino', 'entregado']) {
        await request(app.getHttpServer())
          .patch(`/orders/${id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status })
          .expect(200);
      }
    };
    const todayRevenue = async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      return ((res.body as Envelope).data as { revenue: number }).revenue;
    };
    const todayQtyOfItemA = async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/dashboard/top-products')
        .query({ limit: 50 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const rows = (
        (res.body as Envelope).data as {
          items: { menuItemId: string; quantity: number }[];
        }
      ).items;
      return rows.find((r) => r.menuItemId === itemAId)?.quantity ?? 0;
    };

    it('QA: el anónimo entregado SUMA en las ventas del dashboard (revenue + top-products) y no toca el totalSpent de ningún cliente', async () => {
      const created = await createManual(adminToken, withItemA(anonBody));
      expect(created.status).toBe(201);
      const order = data(created);
      const clientBefore = await usersRepo.findOneByOrFail({ id: clientAId });
      const revenueBefore = await todayRevenue();
      const qtyBefore = await todayQtyOfItemA();

      await advanceToDelivered(order.id);

      const revenueAfter = await todayRevenue();
      expect(revenueAfter - revenueBefore).toBeCloseTo(order.total, 2);
      expect((await todayQtyOfItemA()) - qtyBefore).toBe(2);
      const clientAfter = await usersRepo.findOneByOrFail({ id: clientAId });
      expect(clientAfter.totalSpent).toBe(clientBefore.totalSpent);
    });

    it('QA: con customerId, el admin NO puede usar la dirección de OTRO cliente → 404, sin crear nada', async () => {
      const addrB = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientBToken}`)
        .send({
          alias: 'Casa B',
          fullAddress: 'Calle Ajena 1',
          district: 'San Juan de Miraflores',
        })
        .expect(201);
      const addrBId = ((addrB.body as Envelope).data as { id: string }).id;
      const before = await ordersRepo.count();

      const res = await createManual(adminToken, {
        customerId: clientAId,
        addressId: addrBId,
        items: [{ menuItemId: itemAId, quantity: 1 }],
      });

      expect(res.status).toBe(404);
      expect(await ordersRepo.count()).toBe(before);
    });

    it('QA: anónimo con couponCode → 400 con el mensaje propio (no el de CouponsService)', async () => {
      const res = await createManual(
        adminToken,
        withItemA({ ...anonBody, couponCode: 'A1B2C3D4' }),
      );

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Un pedido sin cliente no puede usar cupones',
      );
    });

    it('QA: un cliente NO puede colar customerId/customerName en POST /orders (400, sin crear nada)', async () => {
      const before = await ordersRepo.count();
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientBToken}`)
        .send({
          customerId: clientAId,
          customerName: 'Otro',
          customerPhone: '987654321',
          addressSnapshot: snapshot,
          items: [{ menuItemId: itemAId, quantity: 1 }],
        });

      expect(res.status).toBe(400);
      expect(await ordersRepo.count()).toBe(before);
    });

    it('QA: mensajes de validación en español (customerName faltante, customerPhone numérico, customerId no UUID)', async () => {
      const missingName = await createManual(
        adminToken,
        withItemA({ ...anonBody, customerName: undefined }),
      );
      expect(missingName.status).toBe(400);
      expect((missingName.body as ErrorResponse).message).toContain(
        'customerName es obligatorio en un pedido sin cliente',
      );

      const numericPhone = await createManual(
        adminToken,
        withItemA({ ...anonBody, customerPhone: 987654321 }),
      );
      expect(numericPhone.status).toBe(400);
      expect((numericPhone.body as ErrorResponse).message).toContain(
        'customerPhone debe ser texto',
      );

      const badId = await createManual(
        adminToken,
        withItemA({
          customerId: 'no-es-uuid',
          addressSnapshot: snapshot,
          items: [],
        }),
      );
      expect(badId.status).toBe(400);
      expect((badId.body as ErrorResponse).message).toContain(
        'customerId debe ser un UUID válido',
      );
    });

    it('QA: nombre de solo espacios → 400 (defensa del service)', async () => {
      const res = await createManual(
        adminToken,
        withItemA({ ...anonBody, customerName: '   ' }),
      );

      expect(res.status).toBe(400);
    });

    it('QA: el anónimo se puede cancelar desde pendiente (sin cupón/premio que reactivar)', async () => {
      const created = await createManual(adminToken, withItemA(anonBody));
      expect(created.status).toBe(201);
      const id = data(created).id;

      await request(app.getHttpServer())
        .patch(`/orders/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelado' })
        .expect(200);
      const saved = await ordersRepo.findOneByOrFail({ id });
      expect(saved.status).toBe('cancelado');
      expect(saved.deliveredAt).toBeNull();
    });

    it('QA: el anónimo NO aparece en GET /orders/me de ningún cliente', async () => {
      for (const token of [clientAToken, clientBToken]) {
        const mine = await request(app.getHttpServer())
          .get('/orders/me')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        const ids = ((mine.body as Envelope).data as { id: string }[]).map(
          (o) => o.id,
        );
        for (const anonId of anonOrderIds) {
          expect(ids).not.toContain(anonId);
        }
      }
    });
    describe('GET /orders/admin/:orderId/whatsapp-links + POST .../whatsapp-sent', () => {
      const links = (orderId: string, token: string | null = adminToken) => {
        const req = request(app.getHttpServer()).get(
          `/orders/admin/${orderId}/whatsapp-links`,
        );
        if (token) req.set('Authorization', `Bearer ${token}`);
        return req;
      };
      const markSent = (orderId: string, token: string | null = adminToken) => {
        const req = request(app.getHttpServer()).post(
          `/orders/admin/${orderId}/whatsapp-sent`,
        );
        if (token) req.set('Authorization', `Bearer ${token}`);
        return req;
      };
      interface LinksData {
        orderId: string;
        customer: { phone: string; url: string } | null;
        store: { phone: string; url: string };
        whatsappSentAt: string | null;
      }
      const linksData = (res: { body: unknown }) =>
        (res.body as Envelope).data as LinksData;
      const decodedText = (url: string) =>
        new URL(url).searchParams.get('text') ?? '';

      it('anónimo → 200: link al cliente idéntico al whatsappUrl del pedido + link a la tienda', async () => {
        const created = data(
          await createManual(adminToken, withItemA(anonBody)),
        );

        const res = await links(created.id);

        expect(res.status).toBe(200);
        const body = linksData(res);
        expect(body.orderId).toBe(created.id);
        expect(body.customer?.phone).toBe('51987654321');
        expect(body.customer?.url).toBe(created.whatsappUrl);
        expect(
          body.store.url.startsWith(`https://wa.me/${body.store.phone}?text=`),
        ).toBe(true);
        expect(decodedText(body.store.url)).toContain('*NUEVO PEDIDO #');
        expect(decodedText(body.store.url)).toContain('2x Clásica');
        expect(body.whatsappSentAt).toBeNull();
      });

      it('cliente registrado SIN celular → customer null, solo la tienda', async () => {
        const created = data(
          await createManual(adminToken, {
            customerId: clientAId,
            addressSnapshot: snapshot,
            items: [{ menuItemId: itemAId, quantity: 1 }],
          }),
        );

        const body = linksData(await links(created.id).expect(200));

        expect(body.customer).toBeNull();
        expect(decodedText(body.store.url)).toContain('*NUEVO PEDIDO #');
      });

      it('whatsapp-sent → 200 con fecha; repetido devuelve la MISMA fecha; links la refleja', async () => {
        const created = data(
          await createManual(adminToken, withItemA(anonBody)),
        );

        const first = await markSent(created.id);
        expect(first.status).toBe(200);
        const sentAt = (
          (first.body as Envelope).data as { whatsappSentAt: string }
        ).whatsappSentAt;
        expect(new Date(sentAt).getTime()).not.toBeNaN();

        const second = await markSent(created.id).expect(200);
        expect(
          ((second.body as Envelope).data as { whatsappSentAt: string })
            .whatsappSentAt,
        ).toBe(sentAt);

        expect(
          linksData(await links(created.id).expect(200)).whatsappSentAt,
        ).toBe(sentAt);
        const saved = await ordersRepo.findOneByOrFail({ id: created.id });
        expect(saved.whatsappSentAt?.toISOString()).toBe(sentAt);
      });

      it('pedido cancelado → 409 en ambos', async () => {
        const created = data(
          await createManual(adminToken, withItemA(anonBody)),
        );
        await request(app.getHttpServer())
          .patch(`/orders/${created.id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'cancelado' })
          .expect(200);

        await links(created.id).expect(409);
        await markSent(created.id).expect(409);
        const saved = await ordersRepo.findOneByOrFail({ id: created.id });
        expect(saved.whatsappSentAt).toBeNull();
      });

      it('pedido inexistente → 404; orderId no UUID → 400', async () => {
        const missing = '99999999-9999-4999-8999-999999999999';
        await links(missing).expect(404);
        await markSent(missing).expect(404);
        await links('no-es-uuid').expect(400);
        await markSent('no-es-uuid').expect(400);
      });

      it('token de cliente → 403 en ambos (y no marca nada)', async () => {
        const created = data(
          await createManual(adminToken, withItemA(anonBody)),
        );

        await links(created.id, clientAToken).expect(403);
        await markSent(created.id, clientAToken).expect(403);
        const saved = await ordersRepo.findOneByOrFail({ id: created.id });
        expect(saved.whatsappSentAt).toBeNull();
      });

      it('sin token → 401 en ambos', async () => {
        const created = data(
          await createManual(adminToken, withItemA(anonBody)),
        );

        await links(created.id, null).expect(401);
        await markSent(created.id, null).expect(401);
      });

      // ── Auditoría QA ───────────────────────────────────────────────────────
      it('QA: POST /orders con cupón → link de tienda IDÉNTICO al whatsappUrl (mismo texto de cupón)', async () => {
        const coupon = await request(app.getHttpServer())
          .post('/coupons/generate')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            userId: clientAId,
            discountType: 'fixed_amount',
            discountValue: 5,
          })
          .expect(201);
        const couponCode = ((coupon.body as Envelope).data as { code: string })
          .code;
        const res = await createOrder(clientAToken, {
          addressId: ownAddressId,
          items: [
            { menuItemId: itemAId, quantity: 2, comment: 'Sin cebolla' },
            { menuItemId: itemBId, quantity: 1 },
          ],
          couponCode,
        }).expect(201);
        const created = (res.body as Envelope).data as {
          id: string;
          whatsappUrl: string;
        };

        const body = linksData(await links(created.id).expect(200));

        // clientA no tiene celular → customer null; el link de tienda debe ser
        // byte a byte el guardado al crear (cupón, ítems, nota, totales).
        expect(body.customer).toBeNull();
        expect(body.store.url).toBe(created.whatsappUrl);
        expect(decodedText(body.store.url)).toContain(
          `Cupón (${couponCode}):* -S/ 5.00`,
        );
      });

      it('QA: POST /orders/admin con customerId + cupón + celular → link del cliente IDÉNTICO al whatsappUrl', async () => {
        const clientB = await usersRepo.findOneByOrFail({
          email: clientBEmail,
        });
        await usersRepo.update(clientB.id, { phone: '987 111 222' });
        const coupon = await request(app.getHttpServer())
          .post('/coupons/generate')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            userId: clientB.id,
            discountType: 'fixed_amount',
            discountValue: 3,
          })
          .expect(201);
        const couponCode = ((coupon.body as Envelope).data as { code: string })
          .code;
        const created = data(
          await createManual(adminToken, {
            customerId: clientB.id,
            addressSnapshot: snapshot,
            items: [
              { menuItemId: itemBId, quantity: 3 },
              { menuItemId: itemAId, quantity: 1 },
            ],
            couponCode,
          }).then((r) => {
            expect(r.status).toBe(201);
            return r;
          }),
        );

        const body = linksData(await links(created.id).expect(200));

        expect(body.customer?.phone).toBe('51987111222');
        expect(body.customer?.url).toBe(created.whatsappUrl);
        expect(decodedText(body.customer!.url)).toContain(
          `Cupón (${couponCode}):* -S/ 3.00`,
        );
        expect(decodedText(body.store.url)).toContain(
          `Cupón (${couponCode}):* -S/ 3.00`,
        );
        // Mismo cuerpo, solo cambia el encabezado.
        expect(decodedText(body.store.url).replace('NUEVO PEDIDO', 'X')).toBe(
          decodedText(body.customer!.url).replace('CONFIRMA TU PEDIDO', 'X'),
        );
      });

      it('QA: whatsapp-sent no toca status, total ni whatsappUrl; la respuesta no expone datos del usuario', async () => {
        const created = data(
          await createManual(adminToken, withItemA(anonBody)),
        );
        const before = await ordersRepo.findOneByOrFail({ id: created.id });

        const sent = await markSent(created.id).expect(200);
        const linksRes = await links(created.id).expect(200);

        const after = await ordersRepo.findOneByOrFail({ id: created.id });
        expect(after.status).toBe(before.status);
        expect(after.total).toBe(before.total);
        expect(after.whatsappUrl).toBe(before.whatsappUrl);
        expect(
          Object.keys((sent.body as Envelope).data as object).sort(),
        ).toEqual(['orderId', 'whatsappSentAt']);
        expect(Object.keys(linksData(linksRes)).sort()).toEqual([
          'customer',
          'orderId',
          'store',
          'whatsappSentAt',
        ]);
        expect(JSON.stringify(linksRes.body)).not.toContain('password');
      });

      it('QA: mensajes de error en español y sin afirmar que el backend "envió" algo', async () => {
        const missing = '99999999-9999-4999-8999-999999999999';
        const notFound = await links(missing).expect(404);
        expect((notFound.body as ErrorResponse).message).toBe(
          'Pedido no encontrado',
        );
        const created = data(
          await createManual(adminToken, withItemA(anonBody)),
        );
        await request(app.getHttpServer())
          .patch(`/orders/${created.id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'cancelado' })
          .expect(200);
        const conflict = await markSent(created.id).expect(409);
        const msg = String((conflict.body as ErrorResponse).message);
        expect(msg).toMatch(/cancelado/);
        expect(msg).not.toMatch(/\benviado\b|\benvió\b|\bsent\b/i);
      });

      it('QA: el cliente dueño del pedido tampoco accede (403)', async () => {
        const res = await createOrder(clientAToken, {
          addressId: ownAddressId,
          items: [{ menuItemId: itemAId, quantity: 1 }],
        }).expect(201);
        const id = ((res.body as Envelope).data as { id: string }).id;

        await links(id, clientAToken).expect(403);
        await markSent(id, clientAToken).expect(403);
        expect(
          (await ordersRepo.findOneByOrFail({ id })).whatsappSentAt,
        ).toBeNull();
      });
    });

    describe('Vincular anónimos a un cliente: GET /users/:id/anonymous-orders + POST /users/:id/link-anonymous-orders', () => {
      // Celular único por corrida: no se mezcla con los anónimos de otros tests.
      const s8 = String(suffix).slice(-8);
      const linkPhoneInput = `+51 9${s8.slice(0, 2)} ${s8.slice(2, 5)} ${s8.slice(5)}`;
      const linkPhone = `519${s8}`;
      const linkEmail = `qa-orders-link-${suffix}@test.com`;
      const noPhoneEmail = `qa-orders-link-nophone-${suffix}@test.com`;
      let linkUserId: string;
      let linkUserToken: string;
      let noPhoneUserId: string;
      let deliveredId: string;
      let pendingId: string;
      let deliveredTotal: number;

      interface PreviewData {
        userId: string;
        phone: string;
        orders: { id: string }[];
      }
      interface LinkData {
        userId: string;
        linkedOrderIds: string[];
        deliveredTotalAdded: number;
        totalSpent: number;
      }
      const preview = (userId: string, token: string | null = adminToken) => {
        const req = request(app.getHttpServer()).get(
          `/users/${userId}/anonymous-orders`,
        );
        if (token) req.set('Authorization', `Bearer ${token}`);
        return req;
      };
      const link = (
        userId: string,
        orderIds: string[],
        token: string | null = adminToken,
      ) => {
        const req = request(app.getHttpServer()).post(
          `/users/${userId}/link-anonymous-orders`,
        );
        if (token) req.set('Authorization', `Bearer ${token}`);
        return req.send({ orderIds });
      };
      const advanceTo = async (orderId: string, statuses: string[]) => {
        for (const status of statuses) {
          await request(app.getHttpServer())
            .patch(`/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status })
            .expect(200);
        }
      };

      beforeAll(async () => {
        const reg = await request(app.getHttpServer())
          .post('/auth/register')
          .send({
            email: linkEmail,
            password,
            fullName: 'Pedro Vinculado',
            phone: linkPhoneInput,
          })
          .expect(201);
        linkUserToken = (reg.body as AuthTokensResponse).data.accessToken;
        linkUserId = (await usersRepo.findOneByOrFail({ email: linkEmail })).id;
        noPhoneUserId = (
          await usersRepo.save(
            usersRepo.create({
              email: noPhoneEmail,
              fullName: 'Sin Telefono',
              provider: UserProvider.LOCAL,
            } as Partial<User>),
          )
        ).id;

        // Dos pedidos anónimos tomados por teléfono ANTES de que se registrara.
        const delivered = data(
          await createManual(
            adminToken,
            withItemA({ ...anonBody, customerPhone: linkPhoneInput }),
          ),
        );
        await advanceTo(delivered.id, ['confirmado', 'en_camino', 'entregado']);
        const pending = data(
          await createManual(adminToken, {
            ...anonBody,
            customerPhone: linkPhone,
            items: [{ menuItemId: itemBId, quantity: 1 }],
          }),
        );
        deliveredId = delivered.id;
        pendingId = pending.id;
        deliveredTotal = delivered.total;
      });

      afterAll(async () => {
        // Los pedidos vinculados caen en cascada al borrar el usuario.
        await usersRepo.delete({ email: linkEmail });
        await usersRepo.delete({ email: noPhoneEmail });
      });

      it('preview → 200 con los anónimos de su celular normalizado, sin vincular nada', async () => {
        const res = await preview(linkUserId).expect(200);
        const body = (res.body as Envelope).data as PreviewData;

        expect(body.phone).toBe(linkPhone);
        expect(body.orders.map((o) => o.id).sort()).toEqual(
          [deliveredId, pendingId].sort(),
        );
        const saved = await ordersRepo.findOneByOrFail({ id: deliveredId });
        expect(saved.userId).toBeNull();
      });

      it('token de cliente → 403 en ambos; sin token → 401', async () => {
        await preview(linkUserId, linkUserToken).expect(403);
        await link(linkUserId, [deliveredId], linkUserToken).expect(403);
        await preview(linkUserId, null).expect(401);
        await link(linkUserId, [deliveredId], null).expect(401);
        const saved = await ordersRepo.findOneByOrFail({ id: deliveredId });
        expect(saved.userId).toBeNull();
      });

      it('pedido anónimo de OTRO celular en la lista → 409 y no vincula ninguno', async () => {
        const foreign = data(
          await createManual(adminToken, withItemA(anonBody)),
        );

        await link(linkUserId, [deliveredId, foreign.id]).expect(409);

        for (const id of [deliveredId, foreign.id]) {
          const saved = await ordersRepo.findOneByOrFail({ id });
          expect(saved.userId).toBeNull();
        }
      });

      it('cliente sin celular → 400; cuenta admin → 400; usuario inexistente → 404', async () => {
        await preview(noPhoneUserId).expect(400);
        const admin = await usersRepo.findOneByOrFail({ email: adminEmail });
        await link(admin.id, [deliveredId]).expect(400);
        await preview('99999999-9999-4999-8999-999999999999').expect(404);
      });

      it('orderIds vacío o no UUID → 400', async () => {
        await link(linkUserId, []).expect(400);
        await link(linkUserId, ['no-es-uuid']).expect(400);
      });

      it('vincula → 200: suma SOLO el entregado a totalSpent y los pedidos pasan a ser del cliente', async () => {
        const before = await usersRepo.findOneByOrFail({ id: linkUserId });

        const res = await link(linkUserId, [deliveredId, pendingId]).expect(
          200,
        );
        const body = (res.body as Envelope).data as LinkData;

        expect(body.linkedOrderIds).toEqual([deliveredId, pendingId]);
        expect(body.deliveredTotalAdded).toBe(deliveredTotal);
        const after = await usersRepo.findOneByOrFail({ id: linkUserId });
        expect(after.totalSpent).toBeCloseTo(
          before.totalSpent + deliveredTotal,
          2,
        );
        expect(body.totalSpent).toBeCloseTo(after.totalSpent, 2);

        const mine = await request(app.getHttpServer())
          .get('/orders/me')
          .set('Authorization', `Bearer ${linkUserToken}`)
          .expect(200);
        expect(
          ((mine.body as Envelope).data as { id: string }[]).map((o) => o.id),
        ).toEqual(expect.arrayContaining([deliveredId, pendingId]));
      });

      it('repetir la vinculación → 409 y totalSpent NO se suma dos veces', async () => {
        const before = await usersRepo.findOneByOrFail({ id: linkUserId });

        await link(linkUserId, [deliveredId]).expect(409);

        const after = await usersRepo.findOneByOrFail({ id: linkUserId });
        expect(after.totalSpent).toBe(before.totalSpent);
        const res = await preview(linkUserId).expect(200);
        expect(((res.body as Envelope).data as PreviewData).orders).toEqual([]);
      });

      // --- QA: casos adicionales (tester) ---

      it('QA: pedido ya vinculado a OTRO cliente (mismo customerPhone) → 409, sigue siendo del otro', async () => {
        const other = data(
          await createManual(
            adminToken,
            withItemA({ ...anonBody, customerPhone: linkPhone }),
          ),
        );
        await ordersRepo.update({ id: other.id }, { userId: clientAId });

        await link(linkUserId, [other.id]).expect(409);

        const saved = await ordersRepo.findOneByOrFail({ id: other.id });
        expect(saved.userId).toBe(clientAId);
      });

      it('QA: payloads inválidos → 400 (sin orderIds, no array, repetidos, >100, UUID de id inválido en la ruta)', async () => {
        const post = (userId: string, body: object) =>
          request(app.getHttpServer())
            .post(`/users/${userId}/link-anonymous-orders`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send(body);
        const u = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
        await post(linkUserId, {}).expect(400);
        await post(linkUserId, { orderIds: u }).expect(400);
        await post(linkUserId, { orderIds: [u, u] }).expect(400);
        await post(linkUserId, { orderIds: [123] }).expect(400);
        await post(linkUserId, {
          orderIds: Array.from(
            { length: 101 },
            (_, i) => `3fa85f64-5717-4562-b3fc-${String(i).padStart(12, '0')}`,
          ),
        }).expect(400);
        await post('no-es-uuid', { orderIds: [u] }).expect(400);
        await preview('no-es-uuid').expect(400);
      });

      it('QA: POST /auth/register con el celular de un anónimo NO lo vincula (sin fusión automática)', async () => {
        const s8b = String(suffix + 1).slice(-8);
        const regPhone = `519${s8b}`;
        const regEmail = `qa-orders-link-reg-${suffix}@test.com`;
        const anon = data(
          await createManual(
            adminToken,
            withItemA({ ...anonBody, customerPhone: regPhone }),
          ),
        );
        try {
          const reg = await request(app.getHttpServer())
            .post('/auth/register')
            .send({
              email: regEmail,
              password,
              fullName: 'Registro Sin Fusion',
              phone: regPhone,
            })
            .expect(201);
          expect(JSON.stringify(reg.body)).not.toContain('password');

          const saved = await ordersRepo.findOneByOrFail({ id: anon.id });
          expect(saved.userId).toBeNull();
          const newUser = await usersRepo.findOneByOrFail({ email: regEmail });
          const res = await preview(newUser.id).expect(200);
          const body = (res.body as Envelope).data as PreviewData;
          expect(body.orders.map((o) => o.id)).toEqual([anon.id]);
          expect(JSON.stringify(res.body)).not.toContain('password');
        } finally {
          await usersRepo.delete({ email: regEmail });
        }
      });

      it('QA: dos POST simultáneos con el mismo entregado → uno 200 y otro 409; totalSpent suma UNA vez; estrellas reflejan el pedido', async () => {
        const order = data(
          await createManual(
            adminToken,
            withItemA({ ...anonBody, customerPhone: linkPhone }),
          ),
        );
        await advanceTo(order.id, ['confirmado', 'en_camino', 'entregado']);

        const progress = async () =>
          (
            (
              await request(app.getHttpServer())
                .get('/rewards/progress')
                .set('Authorization', `Bearer ${linkUserToken}`)
                .expect(200)
            ).body as Envelope
          ).data as { estrellasDelMes: number };
        const starsBefore = (await progress()).estrellasDelMes;
        const before = await usersRepo.findOneByOrFail({ id: linkUserId });

        const results = await Promise.all([
          link(linkUserId, [order.id]),
          link(linkUserId, [order.id]),
          link(linkUserId, [order.id]),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);

        const after = await usersRepo.findOneByOrFail({ id: linkUserId });
        expect(after.totalSpent).toBeCloseTo(
          before.totalSpent + order.total,
          2,
        );
        const saved = await ordersRepo.findOneByOrFail({ id: order.id });
        expect(saved.userId).toBe(linkUserId);

        // 2 x 24.90 = 49.80 de subtotal: con cualquier soles/estrella <= 49.80
        // (default 10) suma al menos una estrella en el mes en curso.
        const starsAfter = (await progress()).estrellasDelMes;
        expect(starsAfter).toBeGreaterThan(starsBefore);
      });
    });
  });

  describe('GET /orders/geocode', () => {
    const geocode = (address?: string, token?: string) => {
      const req = request(app.getHttpServer()).get('/orders/geocode');
      if (address !== undefined) req.query({ address });
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req;
    };

    it('con token + dirección válida → 200 { success, data: [lat, lng] }', async () => {
      const res = await geocode('Jr. Carabaya 250, Lima', clientAToken);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: [-12.0466994, -77.03041],
      });
    });

    it('sin token → 401', async () => {
      const res = await geocode('Jr. Carabaya 250, Lima');

      expect(res.status).toBe(401);
    });

    it('sin param address → 400', async () => {
      const res = await geocode(undefined, clientAToken);

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).success).toBe(false);
    });

    it('address solo espacios → 400 "Dirección es requerida"', async () => {
      const res = await geocode('   ', clientAToken);

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Dirección es requerida',
      );
    });

    it('dirección inexistente → 400 "Dirección no encontrada"', async () => {
      const res = await geocode('xyzabc123notreal', clientAToken);

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        'Dirección no encontrada: "xyzabc123notreal"',
      );
    });

    it('address > 200 caracteres → 400', async () => {
      const res = await geocode('a'.repeat(201), clientAToken);

      expect(res.status).toBe(400);
    });

    it('QA — proveedor caído → 503 con mensaje en español (no se reescribe a 400)', async () => {
      const res = await geocode('__QA_503__', clientAToken);

      expect(res.status).toBe(503);
      expect((res.body as ErrorResponse).success).toBe(false);
      expect((res.body as ErrorResponse).message).toMatch(
        /geocodificación no está disponible/,
      );
    });

    it('QA — address repetido (array) → 400; param extra → 400', async () => {
      const arr = await request(app.getHttpServer())
        .get('/orders/geocode?address=a&address=b')
        .set('Authorization', `Bearer ${clientAToken}`);
      expect(arr.status).toBe(400);

      const extra = await request(app.getHttpServer())
        .get('/orders/geocode')
        .query({ address: 'Jr. Carabaya 250, Lima', foo: 'x' })
        .set('Authorization', `Bearer ${clientAToken}`);
      expect(extra.status).toBe(400);
    });

    it('QA — address de exactamente 200 caracteres pasa el DTO y llega al servicio', async () => {
      const res = await geocode('a'.repeat(200), clientAToken);

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toMatch(
        /^Dirección no encontrada/,
      );
    });

    it('QA — GET /orders/:id intacto: UUID inválido → 400 de ParseUUIDPipe, no de geocode', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/Dirección/);
    });

    it('no choca con GET /orders/:id (admin tampoco recibe 400 de ParseUUIDPipe)', async () => {
      const res = await geocode('Jr. Carabaya 250, Lima', adminToken);

      expect(res.status).toBe(200);
    });
  });
});
