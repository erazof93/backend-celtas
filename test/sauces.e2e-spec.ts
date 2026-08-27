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
import { Like, Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { Category } from './../src/modules/menu/entities/category.entity';
import { MenuItem } from './../src/modules/menu/entities/menu-item.entity';
import { Order } from './../src/modules/orders/entities/order.entity';
import { Sauce } from './../src/modules/sauces/entities/sauce.entity';
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

interface SauceData {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

interface PublicMenuCategory {
  id: string;
  name: string;
  items: {
    id: string;
    name: string;
    price: number;
    sauces: { id: string; name: string }[];
  }[];
}

interface OrderData {
  id: string;
  whatsappUrl: string;
  items: {
    name: string;
    quantity: number;
    selectedSauces: string[] | null;
  }[];
}

describe('Sauces (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let ordersRepo: Repository<Order>;
  let saucesRepo: Repository<Sauce>;
  let settingsRepo: Repository<Setting>;
  let businessHoursSnapshot: BusinessHoursSnapshot;

  let adminToken: string;
  let clientToken: string;
  let clientId: string;
  let categoryId: string;

  const suffix = Date.now();
  const adminEmail = `qa-sauces-admin-${suffix}@test.com`;
  const clientEmail = `qa-sauces-client-${suffix}@test.com`;
  const password = 'password123';
  const genericAddress =
    '{"fullAddress":"Av. Prueba de Salsas 1","district":"SJM"}';

  const register = async (email: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName })
      .expect(201);
    return (res.body as AuthTokensResponse).data.accessToken;
  };

  const createSauce = async (body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .post('/sauces')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    return (res.body as Envelope).data as SauceData;
  };

  const createItem = async (body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .post('/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 20, categoryId, ...body })
      .expect(201);
    return (res.body as Envelope).data as { id: string };
  };

  const getMenuItem = async (itemId: string) => {
    const res = await request(app.getHttpServer()).get('/menu').expect(200);
    const cats = (res.body as Envelope).data as PublicMenuCategory[];
    const cat = cats.find((c) => c.id === categoryId);
    return cat?.items.find((i) => i.id === itemId);
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
    categoriesRepo = app.get<Repository<Category>>(
      getRepositoryToken(Category),
    );
    itemsRepo = app.get<Repository<MenuItem>>(getRepositoryToken(MenuItem));
    ordersRepo = app.get<Repository<Order>>(getRepositoryToken(Order));
    saucesRepo = app.get<Repository<Sauce>>(getRepositoryToken(Sauce));
    settingsRepo = app.get<Repository<Setting>>(getRepositoryToken(Setting));

    // Esta suite crea pedidos reales vía POST /orders con sauceIds por ítem:
    // forzar "abierto siempre" para no depender de la hora real de Lima.
    businessHoursSnapshot = await forceBusinessAlwaysOpen(settingsRepo);

    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Sauces QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    clientToken = await register(clientEmail, 'Cliente Sauces');
    const client = await usersRepo.findOne({ where: { email: clientEmail } });
    clientId = client!.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;

    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Burgers Sauces ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;
  });

  afterAll(async () => {
    const client = await usersRepo.findOne({ where: { email: clientEmail } });
    if (client) {
      // order_items se borran en cascada al eliminar los orders.
      await ordersRepo.delete({ userId: client.id });
    }
    // Borrar los items primero limpia las filas de menu_item_sauces (el lado
    // dueño de la ManyToMany cascadea), así el delete de sauces no choca con la FK.
    await itemsRepo.delete({ categoryId });
    await categoriesRepo.delete({ id: categoryId });
    await saucesRepo.delete({ name: Like(`%${suffix}%`) });
    await usersRepo.delete({ email: adminEmail });
    await usersRepo.delete({ email: clientEmail });
    await restoreBusinessHours(settingsRepo, businessHoursSnapshot);
    await app.close();
  });

  describe('CRUD /sauces (admin)', () => {
    let sauceId: string;

    it('401 sin token al crear', async () => {
      await request(app.getHttpServer())
        .post('/sauces')
        .send({ name: `Mayonesa ${suffix}` })
        .expect(401);
    });

    it('403 para un cliente al crear', async () => {
      const res = await request(app.getHttpServer())
        .post('/sauces')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ name: `Mayonesa ${suffix}` })
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('401 sin token al listar', async () => {
      await request(app.getHttpServer()).get('/sauces').expect(401);
    });

    it('403 para un cliente al listar', async () => {
      const res = await request(app.getHttpServer())
        .get('/sauces')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('admin crea una salsa (active default true, sortOrder default 0)', async () => {
      const data = await createSauce({ name: `Kétchup ${suffix}` });
      sauceId = data.id;
      expect(data.name).toBe(`Kétchup ${suffix}`);
      expect(data.active).toBe(true);
      expect(data.sortOrder).toBe(0);
    });

    it('400 al crear con nombre vacío', async () => {
      const res = await request(app.getHttpServer())
        .post('/sauces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('409 al crear una salsa con nombre duplicado', async () => {
      const res = await request(app.getHttpServer())
        .post('/sauces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Kétchup ${suffix}` })
        .expect(409);
      expect((res.body as ErrorResponse).statusCode).toBe(409);
    });

    it('admin lista las salsas ordenadas por sortOrder ASC y luego name ASC', async () => {
      await createSauce({ name: `Ají ${suffix}`, sortOrder: 5 });
      await createSauce({ name: `Mostaza ${suffix}`, sortOrder: 2 });

      const res = await request(app.getHttpServer())
        .get('/sauces')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const all = (res.body as Envelope).data as SauceData[];
      const mine = all.filter((s) => s.name.includes(`${suffix}`));
      const names = mine.map((s) => s.name);
      // Kétchup (sortOrder 0) → Mostaza (2) → Ají (5)
      expect(names).toEqual([
        `Kétchup ${suffix}`,
        `Mostaza ${suffix}`,
        `Ají ${suffix}`,
      ]);
    });

    it('admin edita una salsa (name, active, sortOrder)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/sauces/${sauceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Kétchup editada ${suffix}`,
          active: false,
          sortOrder: 9,
        })
        .expect(200);
      const data = (res.body as Envelope).data as SauceData;
      expect(data.name).toBe(`Kétchup editada ${suffix}`);
      expect(data.active).toBe(false);
      expect(data.sortOrder).toBe(9);
    });

    it('404 al editar una salsa inexistente', async () => {
      const res = await request(app.getHttpServer())
        .patch('/sauces/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `X ${suffix}` })
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('400 si el id no es un UUID válido', async () => {
      const res = await request(app.getHttpServer())
        .patch('/sauces/no-es-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `X ${suffix}` })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('409 al renombrar una salsa a un nombre ya usado', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/sauces/${sauceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Mostaza ${suffix}` })
        .expect(409);
      expect((res.body as ErrorResponse).statusCode).toBe(409);
    });

    it('401 / 403 al borrar sin rol admin', async () => {
      await request(app.getHttpServer())
        .delete(`/sauces/${sauceId}`)
        .expect(401);
      const res = await request(app.getHttpServer())
        .delete(`/sauces/${sauceId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('404 al borrar una salsa inexistente', async () => {
      const res = await request(app.getHttpServer())
        .delete('/sauces/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('admin borra una salsa que NO está asignada a ningún producto', async () => {
      await request(app.getHttpServer())
        .delete(`/sauces/${sauceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const res = await request(app.getHttpServer())
        .get('/sauces')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const all = (res.body as Envelope).data as SauceData[];
      expect(all.find((s) => s.id === sauceId)).toBeUndefined();
    });
  });

  describe('Regresión: borrar una salsa asignada a un producto no revienta con 500', () => {
    it('DELETE /sauces/:id sobre una salsa en uso → 200 y el producto queda con el resto', async () => {
      const mayo = await createSauce({
        name: `Reg Mayo ${suffix}`,
        sortOrder: 1,
      });
      const aji = await createSauce({
        name: `Reg Ají ${suffix}`,
        sortOrder: 2,
      });
      const item = await createItem({
        name: `Reg Burger ${suffix}`,
        sauceIds: [mayo.id, aji.id],
      });

      // La FK de menu_item_sauces.sauceId quedó ON DELETE NO ACTION; sin la
      // limpieza explícita de SaucesService.remove() esto daría 500.
      await request(app.getHttpServer())
        .delete(`/sauces/${mayo.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const menuItem = await getMenuItem(item.id);
      expect(menuItem).toBeDefined();
      expect(menuItem?.sauces.map((s) => s.name)).toEqual([
        `Reg Ají ${suffix}`,
      ]);
    });
  });

  describe('sauceIds en POST/PATCH /menu/items', () => {
    let mayoId: string;
    let ajiId: string;
    let itemId: string;

    beforeAll(async () => {
      mayoId = (
        await createSauce({ name: `Item Mayo ${suffix}`, sortOrder: 1 })
      ).id;
      ajiId = (await createSauce({ name: `Item Ají ${suffix}`, sortOrder: 2 }))
        .id;
    });

    it('POST /menu/items con sauceIds asigna las salsas (visibles en GET /menu)', async () => {
      const item = await createItem({
        name: `Item con salsas ${suffix}`,
        sauceIds: [mayoId, ajiId],
      });
      itemId = item.id;
      const menuItem = await getMenuItem(itemId);
      expect(menuItem?.sauces.map((s) => s.name).sort()).toEqual(
        [`Item Ají ${suffix}`, `Item Mayo ${suffix}`].sort(),
      );
    });

    it('PATCH que NO incluye sauceIds deja la relación intacta (guard explícito)', async () => {
      await request(app.getHttpServer())
        .patch(`/menu/items/${itemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 33 }) // sin sauceIds
        .expect(200);
      const menuItem = await getMenuItem(itemId);
      expect(menuItem?.price).toBe(33);
      expect(menuItem?.sauces).toHaveLength(2);
    });

    it('PATCH con sauceIds explícito reemplaza la relación', async () => {
      await request(app.getHttpServer())
        .patch(`/menu/items/${itemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sauceIds: [mayoId] })
        .expect(200);
      const menuItem = await getMenuItem(itemId);
      expect(menuItem?.sauces.map((s) => s.name)).toEqual([
        `Item Mayo ${suffix}`,
      ]);
    });

    it('PATCH con sauceIds: [] deja el producto sin salsas', async () => {
      await request(app.getHttpServer())
        .patch(`/menu/items/${itemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sauceIds: [] })
        .expect(200);
      const menuItem = await getMenuItem(itemId);
      expect(menuItem?.sauces).toEqual([]);
    });

    it('404 al crear/editar con un sauceId inexistente', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Item salsa fantasma ${suffix}`,
          price: 20,
          categoryId,
          sauceIds: ['22222222-2222-4222-8222-222222222222'],
        })
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });
  });

  describe('GET /menu: salsas activas por producto, ordenadas por sortOrder', () => {
    let s1Id: string;
    let s2Id: string;
    let s3Id: string;
    let itemWithSaucesId: string;
    let itemNoSaucesId: string;

    beforeAll(async () => {
      // sortOrder deliberadamente desordenado respecto al orden de creación
      s1Id = (await createSauce({ name: `Menu Zeta ${suffix}`, sortOrder: 30 }))
        .id;
      s2Id = (await createSauce({ name: `Menu Alfa ${suffix}`, sortOrder: 10 }))
        .id;
      s3Id = (await createSauce({ name: `Menu Beta ${suffix}`, sortOrder: 20 }))
        .id;
      itemWithSaucesId = (
        await createItem({
          name: `Menu item con salsas ${suffix}`,
          sauceIds: [s1Id, s2Id, s3Id],
        })
      ).id;
      itemNoSaucesId = (
        await createItem({ name: `Menu item sin salsas ${suffix}` })
      ).id;
    });

    it('las salsas vienen ordenadas por sortOrder ascendente', async () => {
      const menuItem = await getMenuItem(itemWithSaucesId);
      expect(menuItem?.sauces.map((s) => s.name)).toEqual([
        `Menu Alfa ${suffix}`, // 10
        `Menu Beta ${suffix}`, // 20
        `Menu Zeta ${suffix}`, // 30
      ]);
    });

    it('un producto sin salsas expone sauces: [] (nunca undefined)', async () => {
      const menuItem = await getMenuItem(itemNoSaucesId);
      expect(menuItem?.sauces).toEqual([]);
    });

    it('una salsa desactivada desaparece de GET /menu pero sigue asignada al producto', async () => {
      await request(app.getHttpServer())
        .patch(`/sauces/${s2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      const menuItem = await getMenuItem(itemWithSaucesId);
      expect(menuItem?.sauces.map((s) => s.name)).toEqual([
        `Menu Beta ${suffix}`,
        `Menu Zeta ${suffix}`,
      ]);

      // Sigue asignada: al reactivarla vuelve a aparecer.
      await request(app.getHttpServer())
        .patch(`/sauces/${s2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true })
        .expect(200);
      const reactivated = await getMenuItem(itemWithSaucesId);
      expect(reactivated?.sauces).toHaveLength(3);
    });
  });

  describe('POST /orders con sauceIds por ítem', () => {
    let offeredSauceId: string;
    let offeredSauceName: string;
    let notOfferedSauceId: string;
    let itemId: string;

    beforeAll(async () => {
      offeredSauceName = `Orden Mayo ${suffix}`;
      offeredSauceId = (await createSauce({ name: offeredSauceName })).id;
      notOfferedSauceId = (await createSauce({ name: `Orden Ají ${suffix}` }))
        .id;
      itemId = (
        await createItem({
          name: `Orden Burger ${suffix}`,
          sauceIds: [offeredSauceId],
        })
      ).id;
    });

    it('guarda el snapshot en OrderItem.selectedSauces y lo pone en el whatsappUrl', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          addressSnapshot: genericAddress,
          items: [
            { menuItemId: itemId, quantity: 2, sauceIds: [offeredSauceId] },
          ],
        })
        .expect(201);
      const data = (res.body as Envelope).data as OrderData;
      expect(data.items[0].selectedSauces).toEqual([offeredSauceName]);
      const decoded = decodeURIComponent(data.whatsappUrl);
      expect(decoded).toContain(`(Salsas: ${offeredSauceName})`);
    });

    it('400 si el ítem trae un sauceId que el producto NO ofrece', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          addressSnapshot: genericAddress,
          items: [
            { menuItemId: itemId, quantity: 1, sauceIds: [notOfferedSauceId] },
          ],
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
      expect((res.body as ErrorResponse).message).toContain('no ofrece');
    });

    it('sin sauceIds el snapshot queda null y el whatsappUrl no lleva sufijo de salsas', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          addressSnapshot: genericAddress,
          items: [{ menuItemId: itemId, quantity: 1 }],
        })
        .expect(201);
      const data = (res.body as Envelope).data as OrderData;
      expect(data.items[0].selectedSauces).toBeNull();
      const decoded = decodeURIComponent(data.whatsappUrl);
      expect(decoded).not.toContain('(Salsas:');
    });

    it('un sauceId inexistente en el pedido devuelve 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          addressSnapshot: genericAddress,
          items: [
            {
              menuItemId: itemId,
              quantity: 1,
              sauceIds: ['33333333-3333-4333-8333-333333333333'],
            },
          ],
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    void clientId;
  });
});
