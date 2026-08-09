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
import {
  User,
  UserProvider,
  UserRole,
} from './../src/modules/users/entities/user.entity';
import { Address } from './../src/modules/users/entities/address.entity';

interface AuthTokensResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
    user: Record<string, unknown>;
  };
}

interface ErrorResponse {
  success: boolean;
  message: string;
  statusCode: number;
}

interface Envelope {
  data: unknown;
}

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let addressesRepo: Repository<Address>;
  let clientAToken: string;
  let clientBToken: string;
  let adminToken: string;
  let clientAId: string;

  const suffix = Date.now();
  const clientAEmail = `qa-users-a-${suffix}@test.com`;
  const clientBEmail = `qa-users-b-${suffix}@test.com`;
  const adminEmail = `qa-users-admin-${suffix}@test.com`;
  const password = 'password123';

  const login = async (email: string, pass: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: pass })
      .expect(200);
    return (res.body as AuthTokensResponse).data.accessToken;
  };

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
    addressesRepo = app.get<Repository<Address>>(getRepositoryToken(Address));

    // Admin real (con password hasheado) para probar GET /users.
    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    clientAToken = await register(clientAEmail, 'Cliente A');
    clientBToken = await register(clientBEmail, 'Cliente B');
    adminToken = await login(adminEmail, password);
    const clientA = await usersRepo.findOne({ where: { email: clientAEmail } });
    clientAId = clientA!.id;
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
      await addressesRepo.delete(ids.map((id) => ({ userId: id })));
    }
    await usersRepo.delete({ email: clientAEmail });
    await usersRepo.delete({ email: clientBEmail });
    await usersRepo.delete({ email: adminEmail });
    await app.close();
  });

  describe('GET /users/me', () => {
    it('devuelve 401 sin token', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('devuelve el perfil del usuario autenticado sin password', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as Record<string, unknown>;
      expect(data.email).toBe(clientAEmail);
      expect(data.role).toBe('cliente');
      expect(typeof data.totalSpent).toBe('number');
      expect(JSON.stringify(res.body)).not.toContain(password);
    });
  });

  describe('PATCH /users/me', () => {
    it('actualiza fullName y phone', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ fullName: 'Cliente Alpha', phone: '+51911111111' })
        .expect(200);
      const data = (res.body as Envelope).data as Record<string, unknown>;
      expect(data.fullName).toBe('Cliente Alpha');
      expect(data.phone).toBe('+51911111111');
      expect(data.email).toBe(clientAEmail); // el email no cambia
      expect(JSON.stringify(res.body)).not.toContain(password);
    });

    it('rechaza intentar cambiar role (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ role: 'admin' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('rechaza intentar cambiar totalSpent (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ totalSpent: 500 })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('rechaza intentar cambiar email (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ email: 'otro@test.com' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('rechaza intentar cambiar password (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ password: 'nuevo-password' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('rechaza fullName vacío (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ fullName: '' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('rechaza phone vacío (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ phone: '' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });
  });

  describe('Direcciones: GET/POST /users/me/addresses', () => {
    let addressIdA: string;

    it('empieza vacío para el cliente A', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      expect((res.body as Envelope).data).toEqual([]);
    });

    it('Crea una dirección para cliente A', async () => {
      const res = await request(app.getHttpServer())
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
      const data = (res.body as Envelope).data as Record<string, unknown>;
      addressIdA = data.id as string;
      expect(data.alias).toBe('Casa');
      expect(data.isDefault).toBe(true);
      expect(data.userId).toBeDefined();
    });

    it('Rechaza crear dirección sin distrito (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ alias: 'Casa', fullAddress: 'Dirección X' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('al marcar una nueva como principal, solo queda una isDefault=true', async () => {
      await request(app.getHttpServer())
        .post('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          alias: 'Trabajo',
          fullAddress: 'Jr. Los Olivos 456',
          district: 'Surco',
          isDefault: true,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const list = (res.body as Envelope).data as Array<{
        id: string;
        isDefault: boolean;
      }>;
      expect(list.filter((a) => a.isDefault)).toHaveLength(1);
      expect(list.filter((a) => a.isDefault)[0].alias).toBe('Trabajo');
    });

    it('rechaza 401 sin token al pedir direcciones', async () => {
      await request(app.getHttpServer()).get('/users/me/addresses').expect(401);
    });

    it('cliente B no puede editar la dirección del cliente A (403)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/me/addresses/${addressIdA}`)
        .set('Authorization', `Bearer ${clientBToken}`)
        .send({ district: 'Miraflores' })
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('cliente B no puede borrar la dirección del cliente A (403)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/users/me/addresses/${addressIdA}`)
        .set('Authorization', `Bearer ${clientBToken}`)
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('cliente A sí edita su propia dirección', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/me/addresses/${addressIdA}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ alias: 'Casa Principal' })
        .expect(200);
      expect(
        ((res.body as Envelope).data as Record<string, unknown>).alias,
      ).toBe('Casa Principal');
    });

    it('devuelve 404 al editar una dirección inexistente', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/addresses/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ district: 'X' })
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('devuelve 400 si el id no es un UUID válido', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/addresses/foo')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ district: 'X' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('cliente A elimina su propia dirección', async () => {
      await request(app.getHttpServer())
        .delete(`/users/me/addresses/${addressIdA}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/users/me/addresses')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const list = (res.body as Envelope).data as Array<{ id: string }>;
      expect(list.find((a) => a.id === addressIdA)).toBeUndefined();
    });
  });

  describe('GET /users (admin)', () => {
    it('devuelve 401 sin token', async () => {
      await request(app.getHttpServer()).get('/users').expect(401);
    });

    it('devuelve 403 para un usuario con rol cliente', async () => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${clientBToken}`)
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('devuelve la lista paginada sin password para un admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/users?page=1&limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: Array<Record<string, unknown>>;
        meta: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      };
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.meta.total).toBeGreaterThanOrEqual(3);
      expect(data.meta.page).toBe(1);
      expect(data.meta.limit).toBe(100);
      // El password (hash) no debe aparecer en NINGÚN punto del JSON.
      expect(JSON.stringify(res.body)).not.toContain(password);
      // El admin debe estar en el listado (limit alto para no depender de la página 1
      // cuando otras suites e2e comparten la BD en paralelo).
      expect(data.items.some((u) => u.email === adminEmail)).toBe(true);
    });

    it('respeta la paginación (page=1&limit=1)', async () => {
      const res = await request(app.getHttpServer())
        .get('/users?page=1&limit=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as {
        items: unknown[];
        meta: { limit: number; totalPages: number };
      };
      expect(data.items).toHaveLength(1);
      expect(data.meta.totalPages).toBeGreaterThanOrEqual(3);
    });

    it('rechaza limit > 100 con 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/users?limit=101')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });
  });

  describe('GET /users/:id/addresses (admin)', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .get(`/users/${clientAId}/addresses`)
        .expect(401);
    });

    it('403 para un usuario con rol cliente', async () => {
      const res = await request(app.getHttpServer())
        .get(`/users/${clientAId}/addresses`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/11111111-1111-4111-8111-111111111111/addresses')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('devuelve las direcciones del usuario (la "Trabajo" creada antes)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/users/${clientAId}/addresses`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const data = (res.body as Envelope).data as Array<{
        id: string;
        alias: string;
        userId: string;
      }>;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data.every((a) => a.userId === clientAId)).toBe(true);
      expect(data.some((a) => a.alias === 'Trabajo')).toBe(true);
    });

    it('array vacío si el usuario no tiene direcciones (cliente B)', async () => {
      const clientB = await usersRepo.findOne({
        where: { email: clientBEmail },
      });
      const res = await request(app.getHttpServer())
        .get(`/users/${clientB!.id}/addresses`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((res.body as Envelope).data).toEqual([]);
    });

    it('400 si el id no es un UUID válido', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/no-es-un-uuid/addresses')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });
  });
});
