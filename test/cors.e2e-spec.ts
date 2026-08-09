import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * CORS (e2e): verifica la whitelist explícita de orígenes configurada en main.ts.
 *
 * Un origen permitido recibe `Access-Control-Allow-Origin` (y el preflight responde
 * con los métodos permitidos); un origen fuera de la whitelist NO recibe la cabecera,
 * por lo que el navegador bloquea la respuesta (el servidor responde, pero el browser
 * no la expone al JS).
 */
describe('CORS (e2e)', () => {
  let app: INestApplication<App>;

  // Misma whitelist que se usa en producción (ver ALLOWED_ORIGINS en Render).
  const allowedOrigins = [
    'http://localhost:5173',
    'https://celtas-admin.vercel.app',
  ];

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Replicar la configuración de CORS de main.ts (whitelist explícita).
    app.enableCors({ origin: allowedOrigins });
    await app.init();
  });

  it('origen permitido recibe Access-Control-Allow-Origin con su propio origen', () => {
    return request(app.getHttpServer())
      .get('/')
      .set('Origin', 'https://celtas-admin.vercel.app')
      .expect(200)
      .expect((res) => {
        expect(res.headers['access-control-allow-origin']).toBe(
          'https://celtas-admin.vercel.app',
        );
      });
  });

  it('origen no permitido NO recibe Access-Control-Allow-Origin', () => {
    return request(app.getHttpServer())
      .get('/')
      .set('Origin', 'https://evil.example.com')
      .expect(200)
      .expect((res) => {
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      });
  });

  it('preflight de origen permitido responde 204 con métodos permitidos', () => {
    return request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)
      .expect((res) => {
        expect(res.headers['access-control-allow-origin']).toBe(
          'http://localhost:5173',
        );
        expect(res.headers['access-control-allow-methods']).toContain('POST');
      });
  });

  it('preflight de origen no permitido NO responde con cabeceras CORS', () => {
    return request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect((res) => {
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
