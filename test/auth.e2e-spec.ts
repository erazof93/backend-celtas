import {
  ClassSerializerInterceptor,
  INestApplication,
  UnauthorizedException,
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
import { GoogleAuthService } from './../src/modules/auth/google-auth.service';
import {
  User,
  UserProvider,
} from './../src/modules/users/entities/user.entity';

interface AuthTokensResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
    user: {
      id: string;
      email: string;
      fullName: string;
      provider: string;
      googleId: string | null;
      phone: string | null;
      totalSpent: number;
      role: string;
      createdAt: string;
      updatedAt: string;
    };
  };
}

interface MeResponse {
  success: boolean;
  data: {
    id: string;
    email: string;
    fullName: string;
    provider: string;
    googleId: string | null;
    phone: string | null;
    totalSpent: number;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
}

interface ErrorResponse {
  success: boolean;
  message: string;
  statusCode: number;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  const suffix = Date.now();
  const localEmail = `qa-local-${suffix}@test.com`;
  const googleEmail = `qa-google-${suffix}@test.com`;
  const newGoogleEmail = `qa-google-new-${suffix}@test.com`;
  const password = 'password123';
  // Perfil que devolverá el mock de GoogleAuthService.verifyIdToken.
  const mockGoogleProfile = {
    googleId: 'google-id-123',
    email: newGoogleEmail,
    name: 'Nuevo Google',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // El rate-limit (5/min por IP) rompería los e2e que hacen muchos requests a
      // login/register. Se desactiva en e2e; el comportamiento 429 se valida por separado.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      // La verificación real del idToken de Google requiere credenciales reales y una
      // llamada a Google. En e2e se mockea para probar la lógica de negocio del flujo.
      .overrideProvider(GoogleAuthService)
      .useValue({
        verifyIdToken: jest.fn().mockResolvedValue(mockGoogleProfile),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    // Replicar la configuración global de main.ts (incluye ClassSerializerInterceptor
    // para que @Exclude() quite el password de las respuestas).
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

    // Usuario de prueba con provider=google y password null (para probar el rechazo del login tradicional).
    await usersRepo.save(
      usersRepo.create({
        email: googleEmail,
        password: null,
        fullName: 'Google User',
        provider: UserProvider.GOOGLE,
      } as Partial<User>),
    );
  });

  afterAll(async () => {
    await usersRepo.delete({ email: localEmail });
    await usersRepo.delete({ email: googleEmail });
    await usersRepo.delete({ email: newGoogleEmail });
    await app.close();
  });

  it('POST /auth/register crea usuario y NO expone el password en la respuesta', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: localEmail, password, fullName: 'QA Local' })
      .expect(201);

    const body = res.body as AuthTokensResponse;
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.refreshToken).toBeDefined();
    expect(body.data.user.email).toBe(localEmail);
    // totalSpent debe venir como number (no "0.00" string) gracias al transformer.
    expect(typeof body.data.user.totalSpent).toBe('number');
    expect(body.data.user.password).toBeUndefined();
    // El password no debe aparecer en NINGÚN punto del JSON de respuesta.
    expect(JSON.stringify(body)).not.toContain(password);
  });

  it('POST /auth/register rechaza email duplicado con 409', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: localEmail, password, fullName: 'QA Local' })
      .expect(409);
    const body = res.body as ErrorResponse;
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(409);
  });

  it('POST /auth/register rechaza password < 8 con 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `short-${suffix}@test.com`,
        password: '123',
        fullName: 'QA',
      })
      .expect(400);
    expect((res.body as ErrorResponse).statusCode).toBe(400);
  });

  it('POST /auth/register rechaza email inválido con 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'no-es-email', password, fullName: 'QA' })
      .expect(400);
    expect((res.body as ErrorResponse).statusCode).toBe(400);
  });

  it('POST /auth/register rechaza campos extra (forbidNonWhitelisted) con 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `extra-${suffix}@test.com`,
        password,
        fullName: 'QA',
        hack: 'x',
      })
      .expect(400);
    expect((res.body as ErrorResponse).statusCode).toBe(400);
  });

  it('POST /auth/login devuelve tokens y NO expone el password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: localEmail, password })
      .expect(200);

    const body = res.body as AuthTokensResponse;
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.refreshToken).toBeDefined();
    expect(typeof body.data.user.totalSpent).toBe('number');
    expect(body.data.user.password).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(password);
  });

  it('POST /auth/login rechaza password incorrecto con 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: localEmail, password: 'wrong-password' })
      .expect(401);
    expect((res.body as ErrorResponse).statusCode).toBe(401);
  });

  it('POST /auth/login de cuenta google falla con 401 y mensaje claro', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: googleEmail, password })
      .expect(401);
    const body = res.body as ErrorResponse;
    expect(body.statusCode).toBe(401);
    expect(body.message).toContain('Google');
  });

  it('GET /auth/me devuelve 401 sin token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('GET /auth/me devuelve el perfil con token válido', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: localEmail, password })
      .expect(200);
    const accessToken = (login.body as AuthTokensResponse).data.accessToken;

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const data = (res.body as MeResponse).data;
    expect(data.email).toBe(localEmail);
    expect(data.role).toBe('cliente');
    // /auth/me lee el usuario real de la BD; totalSpent debe venir como number.
    expect(typeof data.totalSpent).toBe('number');
    expect(data.password).toBeUndefined();
  });

  it('POST /auth/refresh renueva tokens con un refresh token válido', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: localEmail, password })
      .expect(200);
    const refreshToken = (login.body as AuthTokensResponse).data.refreshToken;

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const data = (res.body as AuthTokensResponse).data;
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain(password);
  });

  it('POST /auth/refresh rechaza un refresh token inválido con 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'token-invalido' })
      .expect(401);
    expect((res.body as ErrorResponse).statusCode).toBe(401);
  });

  it('POST /auth/google crea un usuario nuevo (provider google, password null) y devuelve tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'id-token-mock' })
      .expect(200);

    const body = res.body as AuthTokensResponse;
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.refreshToken).toBeDefined();
    expect(body.data.user.email).toBe(newGoogleEmail);
    expect(body.data.user.provider).toBe('google');
    expect(body.data.user.googleId).toBe('google-id-123');
    expect(body.data.user.password).toBeUndefined();
    expect(typeof body.data.user.totalSpent).toBe('number');
  });

  it('POST /auth/google con un googleId ya existente hace login directo (no duplica)', async () => {
    // La segunda llamada con el mismo idToken (mismo googleId) no debe crear otra cuenta.
    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'id-token-mock' })
      .expect(200);
    const body = res.body as AuthTokensResponse;
    expect(body.data.user.email).toBe(newGoogleEmail);

    const count = await usersRepo.count({ where: { email: newGoogleEmail } });
    expect(count).toBe(1);
  });

  it('POST /auth/google con email ya registrado local rechaza con 409 (no fusiona cuentas)', async () => {
    // Mock temporal: el idToken devuelve un email que ya existe como cuenta local.
    const googleService = app.get(GoogleAuthService);
    (googleService.verifyIdToken as jest.Mock).mockResolvedValueOnce({
      googleId: 'google-id-otra',
      email: localEmail,
      name: 'Otro Google',
    });

    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'id-token-mock' })
      .expect(409);
    const body = res.body as ErrorResponse;
    expect(body.statusCode).toBe(409);
    expect(body.message).toContain('contraseña');

    // Restaurar el mock por defecto para no afectar otros tests.
    (googleService.verifyIdToken as jest.Mock).mockResolvedValue(
      mockGoogleProfile,
    );
  });

  it('POST /auth/google con idToken inválido devuelve 401', async () => {
    const googleService = app.get(GoogleAuthService);
    // El servicio real convierte cualquier fallo de verificación en UnauthorizedException.
    (googleService.verifyIdToken as jest.Mock).mockRejectedValueOnce(
      new UnauthorizedException('Token de Google inválido o expirado'),
    );

    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'id-token-malo' })
      .expect(401);
    expect((res.body as ErrorResponse).statusCode).toBe(401);

    (googleService.verifyIdToken as jest.Mock).mockResolvedValue(
      mockGoogleProfile,
    );
  });

  it('POST /auth/google rechaza idToken vacío con 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: '' })
      .expect(400);
    expect((res.body as ErrorResponse).statusCode).toBe(400);
  });
});
