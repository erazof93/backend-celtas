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
import { NotificationsService } from './../src/modules/notifications/notifications.service';
import {
  User,
  UserProvider,
  UserRole,
} from './../src/modules/users/entities/user.entity';

interface AuthTokensResponse {
  success: boolean;
  data: { accessToken: string };
}

interface Envelope {
  data: unknown;
}

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let clientToken: string;
  let adminToken: string;
  let clientId: string;
  let sendPushMock: jest.Mock;
  let broadcastMock: jest.Mock;
  let broadcastHistoryMock: jest.Mock;

  const suffix = Date.now();
  const clientEmail = `qa-notif-client-${suffix}@test.com`;
  const adminEmail = `qa-notif-admin-${suffix}@test.com`;
  const password = 'password123';

  const register = async (email: string, fullName: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName })
      .expect(201);
    return (res.body as AuthTokensResponse).data;
  };

  beforeAll(async () => {
    sendPushMock = jest.fn().mockResolvedValue(true);
    broadcastMock = jest.fn().mockResolvedValue({ sent: 2, total: 2 });
    broadcastHistoryMock = jest.fn().mockResolvedValue([]);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(NotificationsService)
      .useValue({
        sendPushNotification: sendPushMock,
        sendMarketingBroadcast: broadcastMock,
        getBroadcastHistory: broadcastHistoryMock,
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

    const adminHash = await bcrypt.hash(password, 10);
    await usersRepo.save(
      usersRepo.create({
        email: adminEmail,
        password: adminHash,
        fullName: 'Admin Notif QA',
        provider: UserProvider.LOCAL,
        role: UserRole.ADMIN,
      } as Partial<User>),
    );

    const clientData = await register(clientEmail, 'Cliente Notif');
    clientToken = clientData.accessToken;
    const client = await usersRepo.findOne({ where: { email: clientEmail } });
    clientId = client!.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as AuthTokensResponse).data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PATCH /users/me/fcm-token', () => {
    it('guarda el token FCM del usuario autenticado', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/fcm-token')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ fcmToken: 'fcm-token-del-cliente' })
        .expect(200);
      const data = (res.body as Envelope).data as User;
      expect(data.fcmToken).toBe('fcm-token-del-cliente');
    });

    it('rechaza sin token de auth', async () => {
      await request(app.getHttpServer())
        .patch('/users/me/fcm-token')
        .send({ fcmToken: 'x' })
        .expect(401);
    });

    it('rechaza payload sin fcmToken', async () => {
      await request(app.getHttpServer())
        .patch('/users/me/fcm-token')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('POST /notifications/test (admin)', () => {
    it('envía una notificación de prueba a un usuario con token', async () => {
      sendPushMock.mockResolvedValue(true);
      const res = await request(app.getHttpServer())
        .post('/notifications/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: clientId, title: 'Prueba', body: 'Hola' })
        .expect(201);
      expect((res.body as Envelope).data).toEqual({ sent: true });
      expect(sendPushMock).toHaveBeenCalledWith(clientId, {
        title: 'Prueba',
        body: 'Hola',
      });
    });

    it('devuelve sent:false si el envío falla (no rompe el endpoint)', async () => {
      sendPushMock.mockResolvedValue(false);
      const res = await request(app.getHttpServer())
        .post('/notifications/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: clientId, title: 'Prueba', body: 'Hola' })
        .expect(201);
      expect((res.body as Envelope).data).toEqual({ sent: false });
    });

    it('rechaza con rol cliente (403)', async () => {
      await request(app.getHttpServer())
        .post('/notifications/test')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ userId: clientId, title: 'Prueba', body: 'Hola' })
        .expect(403);
    });

    it('rechaza sin token (401)', async () => {
      await request(app.getHttpServer())
        .post('/notifications/test')
        .send({ userId: clientId, title: 'Prueba', body: 'Hola' })
        .expect(401);
    });
  });

  describe('POST /notifications/broadcast (admin)', () => {
    it('envía la campaña y devuelve sent/total', async () => {
      broadcastMock.mockResolvedValue({ sent: 2, total: 2 });
      const res = await request(app.getHttpServer())
        .post('/notifications/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'A pocos días del día del padre y Celtas lo sabe',
          body: 'Promos especiales',
        })
        .expect(201);
      expect((res.body as Envelope).data).toEqual({ sent: 2, total: 2 });
      expect(broadcastMock).toHaveBeenCalledWith(expect.any(String), {
        title: 'A pocos días del día del padre y Celtas lo sabe',
        body: 'Promos especiales',
      });
    });

    it('rechaza con rol cliente (403)', async () => {
      await request(app.getHttpServer())
        .post('/notifications/broadcast')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ title: 'Título', body: 'Cuerpo' })
        .expect(403);
    });

    it('rechaza sin token (401)', async () => {
      await request(app.getHttpServer())
        .post('/notifications/broadcast')
        .send({ title: 'Título', body: 'Cuerpo' })
        .expect(401);
    });

    it('rechaza payload sin title/body (400)', async () => {
      await request(app.getHttpServer())
        .post('/notifications/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);
    });

    it('rechaza title vacío (string vacío, no solo ausente) con body válido (400)', async () => {
      // Regresión: `@IsString` por sí solo NO detecta un string vacío, solo un
      // tipo incorrecto/ausente. Verificado quitando `@IsNotEmpty` del DTO:
      // este test pasa a fallar (201 en vez de 400) si se revierte ese decorator.
      await request(app.getHttpServer())
        .post('/notifications/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: '', body: 'Cuerpo válido' })
        .expect(400);
    });

    it('rechaza body vacío (string vacío, no solo ausente) con title válido (400)', async () => {
      // Mismo caso que arriba mirroreado para `body` (también protegido con
      // `@IsNotEmpty`, ver `broadcast-notification.dto.ts`).
      await request(app.getHttpServer())
        .post('/notifications/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Título válido', body: '' })
        .expect(400);
    });
  });

  describe('GET /notifications/broadcast-history (admin)', () => {
    it('devuelve el historial', async () => {
      broadcastHistoryMock.mockResolvedValue([
        {
          id: 'm1',
          title: 'Campaña previa',
          body: 'Cuerpo',
          sentCount: 5,
          totalCount: 6,
        },
      ]);
      const res = await request(app.getHttpServer())
        .get('/notifications/broadcast-history')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((res.body as Envelope).data).toEqual([
        {
          id: 'm1',
          title: 'Campaña previa',
          body: 'Cuerpo',
          sentCount: 5,
          totalCount: 6,
        },
      ]);
    });

    it('rechaza con rol cliente (403)', async () => {
      await request(app.getHttpServer())
        .get('/notifications/broadcast-history')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });

    it('rechaza sin token (401)', async () => {
      await request(app.getHttpServer())
        .get('/notifications/broadcast-history')
        .expect(401);
    });
  });

  describe('Un usuario sin fcmToken no rompe el flujo', () => {
    it('generar un cupón manual sigue funcionando aunque el usuario no tenga token', async () => {
      // El cliente no tiene token (no se le guardó en este test). sendPush devuelve
      // false pero no debe romper la generación del cupón.
      sendPushMock.mockResolvedValue(false);
      const res = await request(app.getHttpServer())
        .post('/coupons/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: clientId,
          discountType: 'fixed_amount',
          discountValue: 10,
        })
        .expect(201);
      expect((res.body as Envelope).data).toBeDefined();
    });
  });
});
