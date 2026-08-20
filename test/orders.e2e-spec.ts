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
  whatsappUrl: string;
  items: {
    name: string;
    unitPrice: number;
    quantity: number;
    subtotal: number;
    comment: string | null;
  }[];
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
    await itemsRepo.delete({ categoryId });
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
});
