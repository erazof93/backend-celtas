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
import { DataSource, In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { FriesType } from './../src/modules/fries-types/entities/fries-type.entity';
import { FriesTypesService } from './../src/modules/fries-types/fries-types.service';
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

interface Envelope {
  data: unknown;
}
interface ErrorResponse {
  message: string;
}
interface FriesTypeData {
  id: string;
  name: string;
  isDefault: boolean;
}
interface PublicItem {
  id: string;
  friesTypes: FriesTypeData[];
  friesTypeGroupRequired: boolean;
  friesTypeGroupMaxSelectable: number;
}

describe('Tipos de papas (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let usersRepo: Repository<User>;
  let friesRepo: Repository<FriesType>;
  let settingsRepo: Repository<Setting>;
  let businessHours: BusinessHoursSnapshot;

  let adminToken: string;
  let clientToken: string;
  let categoryId: string;
  let itemId: string;
  let addressId: string;
  let fritasId: string;
  let hiloId: string;
  /** Default original del catálogo, para restaurarlo si un test lo cambia. */
  let originalDefaultIds: string[] = [];
  const qaFriesIds: string[] = [];

  const suffix = Date.now();
  const adminEmail = `qa-fries-admin-${suffix}@test.com`;
  const clientEmail = `qa-fries-client-${suffix}@test.com`;
  const password = 'password123';

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const client = () => ({ Authorization: `Bearer ${clientToken}` });
  const createOrder = (item: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/orders')
      .set(client())
      .send({
        addressId,
        items: [{ menuItemId: itemId, quantity: 1, ...item }],
      });
  const patchItem = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/menu/items/${itemId}`)
      .set(admin())
      .send(body)
      .expect(200);

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
    await app.init(); // dispara FriesTypesService.onModuleInit (seed si la tabla está vacía)

    dataSource = app.get(DataSource);
    usersRepo = app.get<Repository<User>>(getRepositoryToken(User));
    friesRepo = app.get<Repository<FriesType>>(getRepositoryToken(FriesType));
    settingsRepo = app.get<Repository<Setting>>(getRepositoryToken(Setting));
    businessHours = await forceBusinessAlwaysOpen(settingsRepo);
    originalDefaultIds = (await friesRepo.findBy({ isDefault: true })).map(
      (f) => f.id,
    );

    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: await bcrypt.hash(password, 10),
        fullName: 'Admin Papas QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = ((login.body as Envelope).data as { accessToken: string })
      .accessToken;
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: clientEmail, password, fullName: 'Cliente Papas QA' })
      .expect(201);
    clientToken = ((reg.body as Envelope).data as { accessToken: string })
      .accessToken;

    await request(app.getHttpServer())
      .patch('/settings')
      .set(admin())
      .send({
        key: 'store_location',
        value: JSON.stringify({ latitude: -12.1631, longitude: -76.97 }),
      })
      .expect(200);
    const cat = await request(app.getHttpServer())
      .post('/menu/categories')
      .set(admin())
      .send({ name: `Papas QA ${suffix}` })
      .expect(201);
    categoryId = ((cat.body as Envelope).data as { id: string }).id;
    const addr = await request(app.getHttpServer())
      .post('/users/me/addresses')
      .set(client())
      .send({
        alias: 'Casa',
        fullAddress: 'Av. Papas 1',
        district: 'San Juan de Miraflores',
      })
      .expect(201);
    addressId = ((addr.body as Envelope).data as { id: string }).id;
  });

  afterAll(async () => {
    const users = await usersRepo.find({
      where: [{ email: adminEmail }, { email: clientEmail }],
    });
    for (const u of users) {
      await dataSource.query(`DELETE FROM "orders" WHERE "userId" = $1`, [
        u.id,
      ]);
      await dataSource.query(`DELETE FROM "addresses" WHERE "userId" = $1`, [
        u.id,
      ]);
    }
    await dataSource.query(`DELETE FROM "menu_items" WHERE "categoryId" = $1`, [
      categoryId,
    ]);
    await dataSource.query(`DELETE FROM "categories" WHERE id = $1`, [
      categoryId,
    ]);
    if (qaFriesIds.length > 0) {
      await dataSource.query(
        `DELETE FROM "menu_item_fries_types" WHERE "friesTypeId" = ANY($1)`,
        [qaFriesIds],
      );
      await friesRepo.delete({ id: In(qaFriesIds) });
    }
    // Restaurar el default original del catálogo (un test lo mueve).
    // (TypeORM no acepta criterio vacío en update: filtrar por isDefault true)
    await friesRepo.update({ isDefault: true }, { isDefault: false });
    if (originalDefaultIds.length > 0) {
      await friesRepo.update(
        { id: In(originalDefaultIds) },
        { isDefault: true },
      );
    }
    await usersRepo.delete({ email: adminEmail });
    await usersRepo.delete({ email: clientEmail });
    await restoreBusinessHours(settingsRepo, businessHours);
    await app.close();
  });

  describe('catálogo /fries-types (admin)', () => {
    it('seed: el catálogo trae "Papas fritas" (default) y "Papas al hilo"', async () => {
      const res = await request(app.getHttpServer())
        .get('/fries-types')
        .set(admin())
        .expect(200);
      const list = (res.body as Envelope).data as FriesTypeData[];
      const fritas = list.find((f) => f.name === 'Papas fritas');
      const hilo = list.find((f) => f.name === 'Papas al hilo');

      expect(fritas).toMatchObject({ isDefault: true });
      expect(hilo).toMatchObject({ isDefault: false });
      expect(list[0].isDefault).toBe(true); // default primero
      fritasId = fritas!.id;
      hiloId = hilo!.id;
    });

    it('401 sin token y 403 para un cliente', async () => {
      await request(app.getHttpServer()).get('/fries-types').expect(401);
      await request(app.getHttpServer())
        .get('/fries-types')
        .set(client())
        .expect(403);
    });

    it('crear → 201; nombre repetido → 409; nombre vacío → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/fries-types')
        .set(admin())
        .send({ name: `Papas QA ${suffix}` })
        .expect(201);
      const created = (res.body as Envelope).data as FriesTypeData;
      qaFriesIds.push(created.id);
      expect(created).toMatchObject({ isDefault: false });

      await request(app.getHttpServer())
        .post('/fries-types')
        .set(admin())
        .send({ name: `Papas QA ${suffix}` })
        .expect(409);
      await request(app.getHttpServer())
        .post('/fries-types')
        .set(admin())
        .send({ name: '' })
        .expect(400);
    });

    it('marcar otro como default desmarca el anterior (a lo sumo un default)', async () => {
      await request(app.getHttpServer())
        .patch(`/fries-types/${qaFriesIds[0]}`)
        .set(admin())
        .send({ isDefault: true })
        .expect(200);

      const defaults = await friesRepo.findBy({ isDefault: true });
      expect(defaults.map((f) => f.id)).toEqual([qaFriesIds[0]]);

      // Volver a dejar "Papas fritas" como default para el resto de la suite.
      await request(app.getHttpServer())
        .patch(`/fries-types/${fritasId}`)
        .set(admin())
        .send({ isDefault: true })
        .expect(200);
    });
  });

  describe('producto con tipos de papas', () => {
    it('crear producto con friesTypeIds → los expone GET /menu con isDefault y la config de grupo', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set(admin())
        .send({
          name: `Burger papas ${suffix}`,
          price: 13,
          categoryId,
          friesTypeIds: [hiloId, fritasId],
        })
        .expect(201);
      itemId = ((res.body as Envelope).data as { id: string }).id;

      const menu = await request(app.getHttpServer()).get('/menu').expect(200);
      const item = ((menu.body as Envelope).data as { items: PublicItem[] }[])
        .flatMap((c) => c.items)
        .find((i) => i.id === itemId)!;

      expect(item.friesTypes).toEqual([
        { id: fritasId, name: 'Papas fritas', isDefault: true },
        { id: hiloId, name: 'Papas al hilo', isDefault: false },
      ]);
      expect(item.friesTypeGroupRequired).toBe(false); // default: no rompe la app vieja
      expect(item.friesTypeGroupMaxSelectable).toBe(1);
    });

    it('friesTypeIds con un UUID inexistente → 404', async () => {
      await request(app.getHttpServer())
        .patch(`/menu/items/${itemId}`)
        .set(admin())
        .send({ friesTypeIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] })
        .expect(404);
    });
  });

  describe('[QA] contrato: payloads inválidos → 400', () => {
    it.each([
      ['name > 100 caracteres', { name: 'x'.repeat(101) }],
      ['name numérico', { name: 123 }],
      ['name ausente', { isDefault: true }],
      ['isDefault string', { name: `QA inv ${suffix}`, isDefault: 'true' }],
      ['isDefault null', { name: `QA inv ${suffix}`, isDefault: null }],
      ['campo desconocido', { name: `QA inv ${suffix}`, price: 3 }],
    ])('POST /fries-types con %s → 400', async (_label, body) => {
      await request(app.getHttpServer())
        .post('/fries-types')
        .set(admin())
        .send(body)
        .expect(400);
    });

    it('PATCH /fries-types/:id con id no-UUID → 400; UUID inexistente → 404', async () => {
      await request(app.getHttpServer())
        .patch('/fries-types/no-es-uuid')
        .set(admin())
        .send({ name: 'x' })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/fries-types/3fa85f64-5717-4562-b3fc-2c963f66afa6')
        .set(admin())
        .send({ name: 'x' })
        .expect(404);
    });

    it.each([
      ['friesTypeIds no-lista', { friesTypeIds: 'abc' }],
      ['friesTypeIds con no-UUID', { friesTypeIds: ['abc'] }],
      ['friesTypeIds null', { friesTypeIds: null }],
      ['friesTypeGroupRequired string', { friesTypeGroupRequired: 'si' }],
      ['friesTypeGroupMaxSelectable 0', { friesTypeGroupMaxSelectable: 0 }],
      ['friesTypeGroupMaxSelectable 1.5', { friesTypeGroupMaxSelectable: 1.5 }],
      [
        'friesTypeGroupMaxSelectable null',
        { friesTypeGroupMaxSelectable: null },
      ],
    ])('PATCH /menu/items con %s → 400', async (_label, body) => {
      await request(app.getHttpServer())
        .patch(`/menu/items/${itemId}`)
        .set(admin())
        .send(body)
        .expect(400);
    });

    it.each([
      ['friesTypeIds no-lista', { friesTypeIds: 'abc' }],
      ['friesTypeIds con no-UUID', { friesTypeIds: ['abc'] }],
    ])('POST /orders con %s → 400', async (_label, item) => {
      await createOrder(item).expect(400);
    });

    it('el cliente no puede crear/editar/borrar tipos de papas (403)', async () => {
      await request(app.getHttpServer())
        .post('/fries-types')
        .set(client())
        .send({ name: `QA hack ${suffix}` })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/fries-types/${fritasId}`)
        .set(client())
        .send({ isDefault: false })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/fries-types/${fritasId}`)
        .set(client())
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/fries-types/${fritasId}`)
        .expect(401);
    });
  });

  describe('[QA] seed contra la BD real', () => {
    it('re-ejecutar onModuleInit con un tipo renombrado NO resucita el nombre original ni duplica', async () => {
      const seeder = app.get(FriesTypesService);
      const renamed = `Papas al hilo QA ${suffix}`;
      await friesRepo.update({ id: hiloId }, { name: renamed });
      try {
        const before = await friesRepo.count();
        await seeder.onModuleInit();
        expect(await friesRepo.count()).toBe(before);
        expect(await friesRepo.findOneBy({ name: 'Papas al hilo' })).toBeNull();
      } finally {
        await friesRepo.update({ id: hiloId }, { name: 'Papas al hilo' });
      }
    });
  });

  describe('POST /orders con tipo de papas', () => {
    it('friesTypeIds válido → 201, snapshot con el nombre y "(Papas: …)" en el WhatsApp', async () => {
      const res = await createOrder({ friesTypeIds: [hiloId] }).expect(201);
      const data = (res.body as Envelope).data as {
        whatsappUrl: string;
        items: { selectedFriesTypes: string[] | null }[];
      };

      expect(data.items[0].selectedFriesTypes).toEqual(['Papas al hilo']);
      expect(decodeURIComponent(data.whatsappUrl)).toContain(
        `(Papas: Papas al hilo)`,
      );
    });

    it('omitido y grupo no obligatorio (app vieja) → 201 con snapshot null', async () => {
      const res = await createOrder({}).expect(201);
      const data = (res.body as Envelope).data as {
        items: { selectedFriesTypes: string[] | null }[];
      };
      expect(data.items[0].selectedFriesTypes).toBeNull();
    });

    it('tipo que el producto no ofrece → 400', async () => {
      const res = await createOrder({ friesTypeIds: [qaFriesIds[0]] }).expect(
        400,
      );
      expect((res.body as ErrorResponse).message).toContain(
        'no ofrece el tipo de papas seleccionado',
      );
    });

    it('fritas y al hilo con máximo 1 → 400', async () => {
      const res = await createOrder({
        friesTypeIds: [fritasId, hiloId],
      }).expect(400);
      expect((res.body as ErrorResponse).message).toContain(
        'como máximo 1 tipo(s) de papas',
      );
    });

    it('friesTypeIds: null → 400', async () => {
      await createOrder({ friesTypeIds: null }).expect(400);
    });

    it('friesTypeGroupRequired: true + omitido → 400 con mensaje en español', async () => {
      await patchItem({ friesTypeGroupRequired: true });

      const res = await createOrder({}).expect(400);
      expect((res.body as ErrorResponse).message).toContain(
        'requiere elegir al menos un tipo de papas',
      );

      await createOrder({ friesTypeIds: [fritasId] }).expect(201);
      await patchItem({ friesTypeGroupRequired: false });
    });
  });

  describe('borrado de un tipo en uso', () => {
    it('DELETE de un tipo asignado a un producto → 200 (no 500) y el producto deja de ofrecerlo; los pedidos conservan el snapshot', async () => {
      await patchItem({ friesTypeIds: [fritasId, hiloId, qaFriesIds[0]] });
      const order = await createOrder({ friesTypeIds: [qaFriesIds[0]] }).expect(
        201,
      );
      const orderId = ((order.body as Envelope).data as { id: string }).id;

      await request(app.getHttpServer())
        .delete(`/fries-types/${qaFriesIds[0]}`)
        .set(admin())
        .expect(200);
      const deletedId = qaFriesIds.pop()!;

      const menu = await request(app.getHttpServer()).get('/menu').expect(200);
      const item = ((menu.body as Envelope).data as { items: PublicItem[] }[])
        .flatMap((c) => c.items)
        .find((i) => i.id === itemId)!;
      expect(item.friesTypes.map((f) => f.id)).not.toContain(deletedId);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set(client())
        .expect(200);
      expect(
        (
          (detail.body as Envelope).data as {
            items: { selectedFriesTypes: string[] }[];
          }
        ).items[0].selectedFriesTypes,
      ).toEqual([`Papas QA ${suffix}`]);
    });
  });
});
