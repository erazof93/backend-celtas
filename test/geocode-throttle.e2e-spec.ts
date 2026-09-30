import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { GEOCODE_LIMIT_PER_MINUTE } from './../src/modules/orders/orders.controller';
import { GeoapifyService } from './../src/modules/orders/geoapify.service';
import { User } from './../src/modules/users/entities/user.entity';

interface AuthTokensResponse {
  data: { accessToken: string };
}

interface ErrorResponse {
  success: boolean;
  message: string;
  statusCode: number;
}

/**
 * Rate limit REAL de GET /orders/geocode (UserThrottlerGuard sin override).
 * Suite propia: orders.e2e-spec.ts desactiva el guard porque hace más de
 * GEOCODE_LIMIT_PER_MINUTE requests con el mismo usuario.
 */
describe('GET /orders/geocode — rate limit por usuario (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let tokenA: string;
  let tokenB: string;

  const suffix = Date.now();
  const emailA = `qa-geocode-throttle-a-${suffix}@test.com`;
  const emailB = `qa-geocode-throttle-b-${suffix}@test.com`;

  const geocode = (token: string) =>
    request(app.getHttpServer())
      .get('/orders/geocode')
      .query({ address: 'Jr. Carabaya 250, Lima' })
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Solo se desactiva el throttler de /auth (register), para poder crear los
      // dos usuarios. UserThrottlerGuard es otra clase: no la afecta este override.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(GeoapifyService)
      .useValue({
        geocode: () =>
          Promise.resolve([-12.0466994, -77.03041] as [number, number]),
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

    const register = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'password123', fullName: 'QA Geocode' })
        .expect(201);
      return (res.body as AuthTokensResponse).data.accessToken;
    };
    tokenA = await register(emailA);
    tokenB = await register(emailB);
  });

  afterAll(async () => {
    await usersRepo.delete({ email: emailA });
    await usersRepo.delete({ email: emailB });
    await app.close();
  });

  it(`las primeras ${GEOCODE_LIMIT_PER_MINUTE} requests del usuario → 200`, async () => {
    for (let i = 0; i < GEOCODE_LIMIT_PER_MINUTE; i++) {
      const res = await geocode(tokenA);
      expect(res.status).toBe(200);
    }
  });

  it('la siguiente → 429 con mensaje en español', async () => {
    const res = await geocode(tokenA);

    expect(res.status).toBe(429);
    expect(res.body as ErrorResponse).toEqual({
      success: false,
      message: 'Demasiados intentos. Intenta de nuevo en un minuto.',
      statusCode: 429,
    });
  });

  it('otro usuario desde la MISMA IP sigue pasando (el límite es por usuario, no por IP)', async () => {
    const res = await geocode(tokenB);

    expect(res.status).toBe(200);
  });

  it('sin token sigue siendo 401, no 429 (JwtAuthGuard corre primero)', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders/geocode')
      .query({ address: 'Jr. Carabaya 250, Lima' });

    expect(res.status).toBe(401);
  });

  it(`sin token, ${GEOCODE_LIMIT_PER_MINUTE + 2} veces seguidas → siempre 401 (el throttler no llega a correr ni cuenta por IP)`, async () => {
    // Si UserThrottlerGuard corriera antes que JwtAuthGuard, no habría req.user,
    // contaría por IP y la request N+1 sería 429 en vez de 401.
    for (let i = 0; i < GEOCODE_LIMIT_PER_MINUTE + 2; i++) {
      const res = await request(app.getHttpServer())
        .get('/orders/geocode')
        .query({ address: 'Jr. Carabaya 250, Lima' });
      expect(res.status).toBe(401);
    }
  });
});

/**
 * Aislamiento entre contadores: el @Throttle de geocode reusa el throttler nombrado
 * 'auth', pero la clave de storage incluye clase + handler, así que agotar geocode no
 * debe consumir los intentos de /auth/login ni cambiar su límite (5/min por IP).
 * Suite con app propia (storage en memoria nuevo) y SIN override de ThrottlerGuard.
 */
describe('GET /orders/geocode vs /auth/login — contadores independientes (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let token: string;

  const email = `qa-geocode-isolation-${Date.now()}@test.com`;
  const password = 'password123';
  const AUTH_LIMIT = 5;

  const login = () =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  const geocodeWithToken = () =>
    request(app.getHttpServer())
      .get('/orders/geocode')
      .query({ address: 'Jr. Carabaya 250, Lima' })
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GeoapifyService)
      .useValue({
        geocode: () =>
          Promise.resolve([-12.0466994, -77.03041] as [number, number]),
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

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, fullName: 'QA Geocode Isolation' })
      .expect(201);
    token = (res.body as AuthTokensResponse).data.accessToken;
  });

  afterAll(async () => {
    await usersRepo.delete({ email });
    await app.close();
  });

  it('agotar geocode (→ 429) no consume los intentos de login, y login mantiene su límite de 5', async () => {
    for (let i = 0; i < GEOCODE_LIMIT_PER_MINUTE; i++) {
      expect((await geocodeWithToken()).status).toBe(200);
    }
    expect((await geocodeWithToken()).status).toBe(429);

    for (let i = 0; i < AUTH_LIMIT; i++) {
      expect((await login()).status).toBe(200);
    }
    expect((await login()).status).toBe(429);
  });
});
