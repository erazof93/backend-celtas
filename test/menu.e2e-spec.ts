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
import { CloudinaryService } from './../src/shared/cloudinary/cloudinary.service';
import {
  User,
  UserProvider,
  UserRole,
} from './../src/modules/users/entities/user.entity';

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

interface PublicMenuCategory {
  id: string;
  name: string;
  items: { id: string; name: string; price: number; available?: boolean }[];
}

describe('Menu (e2e)', () => {
  let app: INestApplication<App>;
  let categoriesRepo: Repository<Category>;
  let itemsRepo: Repository<MenuItem>;
  let usersRepo: Repository<User>;
  let clientToken: string;
  let adminToken: string;
  let categoryId: string;
  let duplicateCategoryId: string;

  const suffix = Date.now();
  const clientEmail = `qa-menu-client-${suffix}@test.com`;
  const adminEmail = `qa-menu-admin-${suffix}@test.com`;
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
      .overrideProvider(CloudinaryService)
      .useValue({
        uploadImage: jest
          .fn()
          .mockResolvedValue(
            'https://res.cloudinary.com/celtas-test/menu-item.jpg',
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
    categoriesRepo = app.get<Repository<Category>>(
      getRepositoryToken(Category),
    );
    itemsRepo = app.get<Repository<MenuItem>>(getRepositoryToken(MenuItem));

    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Menu QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    clientToken = await register(clientEmail, 'Cliente Menu');
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;
  });

  afterAll(async () => {
    if (categoryId) {
      await itemsRepo.delete({ categoryId });
      await categoriesRepo.delete({ id: categoryId });
    }
    if (duplicateCategoryId) {
      await categoriesRepo.delete({ id: duplicateCategoryId });
    }
    await usersRepo.delete({ email: adminEmail });
    await usersRepo.delete({ email: clientEmail });
    await app.close();
  });

  describe('GET /menu (público)', () => {
    it('devuelve 200 sin token', async () => {
      const res = await request(app.getHttpServer()).get('/menu').expect(200);
      expect(Array.isArray((res.body as Envelope).data)).toBe(true);
    });
  });

  describe('CRUD administración (protegido)', () => {
    it('401 sin token para crear categoría', async () => {
      await request(app.getHttpServer())
        .post('/menu/categories')
        .send({ name: 'Bebidas' })
        .expect(401);
    });

    it('403 para un cliente al crear categoría', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/categories')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ name: 'Bebidas' })
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('admin crea una categoría', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Burgers', description: 'Hamburguesas', sortOrder: 1 })
        .expect(201);
      const data = (res.body as Envelope).data as {
        id: string;
        name: string;
        sortOrder: number;
      };
      categoryId = data.id;
      expect(data.name).toBe('Burgers');
      expect(data.sortOrder).toBe(1);
    });

    it('admin crea un producto en la categoría', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Celtas Clásica',
          price: 24.9,
          categoryId,
          available: true,
        })
        .expect(201);
      const data = (res.body as Envelope).data as {
        name: string;
        price: number;
        categoryId: string;
      };
      expect(data.name).toBe('Celtas Clásica');
      expect(data.price).toBe(24.9);
      expect(data.categoryId).toBe(categoryId);
    });

    it('404 al crear producto con categoría inexistente', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'X',
          price: 10,
          categoryId: '11111111-1111-4111-8111-111111111111',
        })
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('400 con precio <= 0', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'X', price: 0, categoryId })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 con nombre vacío', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '' })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('409 al crear una categoría con nombre duplicado', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Burgers' })
        .expect(409);
      expect((res.body as ErrorResponse).statusCode).toBe(409);
    });

    it('409 al renombrar una categoría a un nombre ya usado', async () => {
      const created = await request(app.getHttpServer())
        .post('/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bebidas' })
        .expect(201);
      duplicateCategoryId = ((created.body as Envelope).data as { id: string })
        .id;
      const res = await request(app.getHttpServer())
        .patch(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bebidas' })
        .expect(409);
      expect((res.body as ErrorResponse).statusCode).toBe(409);
    });

    it('GET /menu devuelve la categoría con el producto disponible', async () => {
      const res = await request(app.getHttpServer()).get('/menu').expect(200);
      const data = (res.body as Envelope).data as PublicMenuCategory[];
      const burgers = data.find((c) => c.id === categoryId);
      expect(burgers).toBeDefined();
      expect(burgers?.items).toHaveLength(1);
      expect(burgers?.items[0].price).toBe(24.9);
      expect(burgers?.items[0].available).toBeUndefined();
    });

    it('un producto no disponible no aparece en el menú público', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Oculta del menú',
          price: 10,
          categoryId,
          available: false,
        })
        .expect(201);
      const hiddenItemId = ((res.body as Envelope).data as { id: string }).id;

      const menu = await request(app.getHttpServer()).get('/menu').expect(200);
      const data = (menu.body as Envelope).data as PublicMenuCategory[];
      const burgers = data.find((c) => c.id === categoryId);
      expect(burgers?.items.find((i) => i.id === hiddenItemId)).toBeUndefined();

      await request(app.getHttpServer())
        .delete(`/menu/items/${hiddenItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('409 al eliminar una categoría con productos', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
      expect((res.body as ErrorResponse).statusCode).toBe(409);
    });

    it('404 al editar una categoría inexistente', async () => {
      const res = await request(app.getHttpServer())
        .patch('/menu/categories/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'X' })
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('400 si el id no es un UUID válido', async () => {
      const res = await request(app.getHttpServer())
        .delete('/menu/categories/foo')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('admin elimina el producto y luego la categoría queda vacía y desaparece del menú', async () => {
      const items = await itemsRepo.find({ where: { categoryId } });
      expect(items.length).toBeGreaterThanOrEqual(1);
      for (const item of items) {
        await request(app.getHttpServer())
          .delete(`/menu/items/${item.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      }
      await request(app.getHttpServer())
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer()).get('/menu').expect(200);
      const data = (res.body as Envelope).data as PublicMenuCategory[];
      expect(data.find((c) => c.id === categoryId)).toBeUndefined();
    });
  });

  describe('Subida de imagen (admin)', () => {
    let uploadCategoryId: string;
    let uploadItemId: string;

    beforeAll(async () => {
      const cat = await request(app.getHttpServer())
        .post('/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Imágenes ${suffix}` })
        .expect(201);
      uploadCategoryId = ((cat.body as Envelope).data as { id: string }).id;

      const item = await request(app.getHttpServer())
        .post('/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Con imagen', price: 15, categoryId: uploadCategoryId })
        .expect(201);
      uploadItemId = ((item.body as Envelope).data as { id: string }).id;
    });

    afterAll(async () => {
      await itemsRepo.delete({ categoryId: uploadCategoryId });
      await categoriesRepo.delete({ id: uploadCategoryId });
    });

    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .post(`/menu/items/${uploadItemId}/image`)
        .attach('image', Buffer.from('x'), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(401);
    });

    it('403 para un cliente', async () => {
      const res = await request(app.getHttpServer())
        .post(`/menu/items/${uploadItemId}/image`)
        .set('Authorization', `Bearer ${clientToken}`)
        .attach('image', Buffer.from('x'), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(403);
      expect((res.body as ErrorResponse).statusCode).toBe(403);
    });

    it('400 si el archivo no es una imagen', async () => {
      const res = await request(app.getHttpServer())
        .post(`/menu/items/${uploadItemId}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from('no soy imagen'), {
          filename: 'a.txt',
          contentType: 'text/plain',
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si el archivo supera los 5 MB', async () => {
      const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
      const res = await request(app.getHttpServer())
        .post(`/menu/items/${uploadItemId}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', big, {
          filename: 'grande.png',
          contentType: 'image/png',
        })
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('400 si no se adjunta archivo', async () => {
      const res = await request(app.getHttpServer())
        .post(`/menu/items/${uploadItemId}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect((res.body as ErrorResponse).statusCode).toBe(400);
    });

    it('404 si el producto no existe', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu/items/11111111-1111-4111-8111-111111111111/image')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from('x'), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(404);
      expect((res.body as ErrorResponse).statusCode).toBe(404);
    });

    it('sube la imagen y guarda la URL en el producto', async () => {
      const res = await request(app.getHttpServer())
        .post(`/menu/items/${uploadItemId}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from('imagen-falsa'), {
          filename: 'burger.png',
          contentType: 'image/png',
        })
        .expect(200);
      const data = (res.body as Envelope).data as { image: string };
      expect(data.image).toBe(
        'https://res.cloudinary.com/celtas-test/menu-item.jpg',
      );
    });

    it('sube imagen de categoría y guarda la URL', async () => {
      const res = await request(app.getHttpServer())
        .post(`/menu/categories/${uploadCategoryId}/image`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', Buffer.from('imagen-falsa'), {
          filename: 'cat.png',
          contentType: 'image/png',
        })
        .expect(200);
      const data = (res.body as Envelope).data as { image: string };
      expect(data.image).toBe(
        'https://res.cloudinary.com/celtas-test/menu-item.jpg',
      );
    });
  });
});
