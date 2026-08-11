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
import { CloudinaryService } from './../src/shared/cloudinary/cloudinary.service';
import {
  User,
  UserProvider,
  UserRole,
} from './../src/modules/users/entities/user.entity';
import {
  Banner,
  BannerActionType,
} from './../src/modules/banners/entities/banner.entity';

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

describe('Banners (e2e)', () => {
  let app: INestApplication<App>;
  let bannersRepo: Repository<Banner>;
  let usersRepo: Repository<User>;
  let clientToken: string;
  let adminToken: string;

  const suffix = Date.now();
  const clientEmail = `qa-banners-client-${suffix}@test.com`;
  const adminEmail = `qa-banners-admin-${suffix}@test.com`;
  const password = 'password123';

  const register = async (email: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName })
      .expect(201);
    return (res.body as AuthTokensResponse).data.accessToken;
  };

  const createBanner = async (body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .post('/banners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    return (res.body as Envelope).data as Banner;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(CloudinaryService)
      .useValue({
        uploadImage: jest
          .fn()
          .mockResolvedValue(
            'https://res.cloudinary.com/celtas-test/banner.jpg',
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
    bannersRepo = app.get<Repository<Banner>>(getRepositoryToken(Banner));

    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Banners QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    clientToken = await register(clientEmail, 'Cliente Banners');
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /banners/active (público)', () => {
    it('devuelve banners sin fechas (siempre vigentes) ordenados por order', async () => {
      const titleA = `Banner A ${suffix}`;
      const titleB = `Banner B ${suffix}`;
      await bannersRepo.save(
        bannersRepo.create({
          title: titleA,
          active: true,
          order: 2,
        } as Partial<Banner>),
      );
      await bannersRepo.save(
        bannersRepo.create({
          title: titleB,
          active: true,
          order: 1,
        } as Partial<Banner>),
      );

      const res = await request(app.getHttpServer())
        .get('/banners/active')
        .expect(200);
      const banners = (res.body as Envelope).data as Banner[];
      const titles = banners.map((b) => b.title);
      expect(titles).toContain(titleA);
      expect(titles).toContain(titleB);
      // El banner con order menor debe aparecer antes.
      expect(titles.indexOf(titleB)).toBeLessThan(titles.indexOf(titleA));
    });

    it('no requiere autenticación', async () => {
      const res = await request(app.getHttpServer())
        .get('/banners/active')
        .expect(200);
      expect((res.body as Envelope).data).toBeDefined();
    });

    it('excluye banners con endDate en el pasado', async () => {
      const title = `Expirado ${suffix}`;
      await createBanner({
        title,
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2020-01-02T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get('/banners/active')
        .expect(200);
      const titles = ((res.body as Envelope).data as Banner[]).map(
        (b) => b.title,
      );
      expect(titles).not.toContain(title);
    });

    it('excluye banner con startDate en el futuro', async () => {
      const title = `Futuro ${suffix}`;
      await createBanner({
        title,
        startDate: '2099-01-01T00:00:00.000Z',
        endDate: '2099-12-31T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get('/banners/active')
        .expect(200);
      const titles = ((res.body as Envelope).data as Banner[]).map(
        (b) => b.title,
      );
      expect(titles).not.toContain(title);
    });

    it('excluye banner con active=false', async () => {
      const title = `Desactivado ${suffix}`;
      await createBanner({ title, active: false });

      const res = await request(app.getHttpServer())
        .get('/banners/active')
        .expect(200);
      const titles = ((res.body as Envelope).data as Banner[]).map(
        (b) => b.title,
      );
      expect(titles).not.toContain(title);
    });

    it('incluye banner dentro de su rango de fechas vigente', async () => {
      const title = `Vigente ${suffix}`;
      await createBanner({
        title,
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2099-12-31T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get('/banners/active')
        .expect(200);
      const titles = ((res.body as Envelope).data as Banner[]).map(
        (b) => b.title,
      );
      expect(titles).toContain(title);
    });
  });

  describe('CRUD admin', () => {
    it('rechaza crear sin token', async () => {
      await request(app.getHttpServer())
        .post('/banners')
        .send({ title: 'X' })
        .expect(401);
    });

    it('rechaza crear con rol cliente', async () => {
      await request(app.getHttpServer())
        .post('/banners')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ title: 'X' })
        .expect(403);
    });

    it('crea un banner con actionType != none y actionValue', async () => {
      const banner = await createBanner({
        title: 'Promo categoría',
        actionType: BannerActionType.CATEGORY,
        actionValue: 'burgers',
      });
      expect(banner.id).toBeDefined();
      expect(banner.actionValue).toBe('burgers');
    });

    it('rechaza con 400 si actionType != none sin actionValue', async () => {
      const res = await request(app.getHttpServer())
        .post('/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Mal', actionType: BannerActionType.CATEGORY })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('rechaza con 400 si startDate >= endDate', async () => {
      const res = await request(app.getHttpServer())
        .post('/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Mal',
          startDate: '2026-08-31T00:00:00.000Z',
          endDate: '2026-08-01T00:00:00.000Z',
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('lista todos los banners (incluye inactivos)', async () => {
      const res = await request(app.getHttpServer())
        .get('/banners')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const banners = (res.body as Envelope).data as Banner[];
      expect(banners.length).toBeGreaterThanOrEqual(1);
    });

    it('obtiene un banner por id', async () => {
      const created = await createBanner({ title: 'Para obtener' });
      const res = await request(app.getHttpServer())
        .get(`/banners/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(((res.body as Envelope).data as Banner).title).toBe(
        'Para obtener',
      );
    });

    it('edita un banner', async () => {
      const created = await createBanner({ title: 'Antes' });
      const res = await request(app.getHttpServer())
        .patch(`/banners/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Después' })
        .expect(200);
      expect(((res.body as Envelope).data as Banner).title).toBe('Después');
    });

    it('PATCH parcial devuelve el banner COMPLETO (regresión Object.assign→merge)', async () => {
      // Bug de clase igual al de Addresses: BannersService.update() usaba
      // Object.assign(banner, dto) y el PATCH de un solo campo pisaba con undefined
      // los campos cargados (actionType, active, order, fechas), dejando la respuesta
      // incompleta aunque la BD se actualizara bien. Con repository.merge() no pasa.
      const created = await createBanner({
        title: 'Regresión banner',
        actionType: BannerActionType.CATEGORY,
        actionValue: 'burgers',
        active: true,
        order: 7,
      });

      const res = await request(app.getHttpServer())
        .patch(`/banners/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Regresión banner editado' }) // solo UN campo
        .expect(200);
      const data = (res.body as Envelope).data as Banner;
      expect(data.id).toBe(created.id);
      expect(data.title).toBe('Regresión banner editado');
      expect(data.actionType).toBe(BannerActionType.CATEGORY);
      expect(data.actionValue).toBe('burgers');
      expect(data.active).toBe(true);
      expect(data.order).toBe(7);
      expect(data.createdAt).toBeDefined();
      expect(data.updatedAt).toBeDefined();
    });

    it('rechaza editar con startDate >= endDate', async () => {
      const created = await createBanner({ title: 'Editar mal' });
      await request(app.getHttpServer())
        .patch(`/banners/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: '2026-08-31T00:00:00.000Z',
          endDate: '2026-08-01T00:00:00.000Z',
        })
        .expect(400);
    });

    it('reordena banners en batch', async () => {
      const a = await createBanner({ title: 'Reorder A' });
      const b = await createBanner({ title: 'Reorder B' });
      const res = await request(app.getHttpServer())
        .patch('/banners/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { id: a.id, order: 5 },
            { id: b.id, order: 3 },
          ],
        })
        .expect(200);
      const banners = (res.body as Envelope).data as Banner[];
      expect(banners).toHaveLength(2);
    });

    it('elimina un banner', async () => {
      const created = await createBanner({ title: 'Eliminar' });
      await request(app.getHttpServer())
        .delete(`/banners/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/banners/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('sube la imagen y guarda la URL en el banner', async () => {
      const created = await createBanner({ title: 'Con imagen' });
      const res = await request(app.getHttpServer())
        .post(`/banners/${created.id}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from('imagen-falsa'), {
          filename: 'banner.png',
          contentType: 'image/png',
        })
        .expect(200);
      const data = (res.body as Envelope).data as Banner;
      expect(data.imageUrl).toBe(
        'https://res.cloudinary.com/celtas-test/banner.jpg',
      );
    });

    it('400 si el archivo no es una imagen', async () => {
      const created = await createBanner({ title: 'Imagen inválida' });
      const res = await request(app.getHttpServer())
        .post(`/banners/${created.id}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from('no soy imagen'), {
          filename: 'banner.txt',
          contentType: 'text/plain',
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('404 si el banner no existe al subir imagen', async () => {
      await request(app.getHttpServer())
        .post('/banners/11111111-1111-4111-8111-111111111111/image')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from('imagen-falsa'), {
          filename: 'banner.png',
          contentType: 'image/png',
        })
        .expect(404);
    });
  });
});
