import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface ApiBody {
  success: boolean;
  data?: unknown;
  message?: string;
  statusCode?: number;
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Replicar la configuración global de main.ts para probar el contrato real.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  it('/ (GET) devuelve el formato estándar { success, data }', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect((res) => {
        const body = res.body as ApiBody;
        expect(body).toEqual({
          success: true,
          data: { app: 'Celtas API', version: '1.0.0', status: 'ok' },
        });
      });
  });

  it('/health (GET) reporta la base de datos conectada', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as ApiBody;
        expect(body.success).toBe(true);
        expect(body.data).toEqual({ database: 'connected' });
      });
  });

  it('/ruta-inexistente (GET) devuelve error estandarizado 404', () => {
    return request(app.getHttpServer())
      .get('/ruta-inexistente')
      .expect(404)
      .expect((res) => {
        const body = res.body as ApiBody;
        expect(body.success).toBe(false);
        expect(body.statusCode).toBe(404);
        expect(typeof body.message).toBe('string');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
