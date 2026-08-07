import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Render está detrás de un reverse proxy. Sin `trust proxy`, Express ve la IP del
  // proxy para todas las conexiones y el ThrottlerGuard de auth contaría la misma IP
  // para todos los usuarios (bloqueando a todo el mundo juntos tras N requests).
  // Solo en producción: en desarrollo local no hay proxy y no debe confiarse en X-Forwarded-For.
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // CORS habilitado para el panel admin (React) y la app (Flutter) en desarrollo.
  app.enableCors();

  // Validación global de DTOs: elimina campos no declarados, rechaza campos extra
  // y transforma los payloads a las clases DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Formato de respuesta estándar { success, data, message } y errores normalizados.
  // ClassSerializerInterceptor corre primero sobre la respuesta (serializa entidades y aplica
  // @Exclude(), p. ej. el password de User); luego TransformInterceptor envuelve en { success, data }.
  app.useGlobalInterceptors(
    new TransformInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger en /docs (UI) y /docs-json (spec JSON consumido por el frontend Flutter).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Celtas API')
    .setDescription('API del backend de la dark kitchen Celtas (solo delivery)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const documentFactory = () =>
    SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, documentFactory);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`🚀 Celtas API corriendo en http://localhost:${port}`);
  console.log(`📚 Swagger UI: http://localhost:${port}/docs`);
  console.log(`📄 Swagger JSON: http://localhost:${port}/docs-json`);
}

void bootstrap();
