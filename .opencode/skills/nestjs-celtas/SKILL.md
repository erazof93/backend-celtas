---
name: nestjs-celtas
description: Convenciones y patrones específicos del backend NestJS de Celtas (auth híbrida con password nullable, sistema de cupones automáticos, banners, pedidos con checkout a WhatsApp). Usar siempre que se cree o modifique un módulo, entidad, DTO, endpoint o servicio del backend.
license: MIT
metadata:
  project: celtas-backend
  audience: opencode-agent
---

## Cuándo usar esta skill

Cargar esta skill antes de crear o modificar cualquier entidad, DTO, controller o service dentro de
`src/modules/`. Contiene las decisiones de diseño ya tomadas para este proyecto, para no reinventarlas
en cada módulo.

## Convenciones generales

- Todo módulo sigue: `entities/`, `dto/`, `<modulo>.controller.ts`, `<modulo>.service.ts`, `<modulo>.module.ts`.
- Los DTOs de entrada usan `class-validator` (`@IsString()`, `@IsNumber()`, `@IsOptional()`, etc.).
- Nunca devolver la entidad de TypeORM directamente en la respuesta si contiene campos sensibles
  (ej. `password`) — usar un `ClassSerializerInterceptor` con `@Exclude()` en la entidad `User`.
- Respuesta estándar de la API (vía interceptor global):
  ```json
  { "success": true, "data": { ... }, "message": "opcional" }
  ```
- Errores estandarizados vía `HttpExceptionFilter`:
  ```json
  { "success": false, "message": "Descripción del error", "statusCode": 400 }
  ```

## Configuración y conexión a base de datos

- Variables de entorno de la BD: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
  (no usar una `DATABASE_URL` única — el proyecto usa variables sueltas).
- `docker-compose.yml` en la raíz levanta Postgres local leyendo esas mismas variables desde `.env`.
- La conexión de TypeORM se arma en `config/configuration.ts` leyendo esas variables vía
  `ConfigService`, y se registra con `TypeOrmModule.forRootAsync()` (no `forRoot()` con valores
  hardcodeados), para que en el futuro (deploy) solo cambie el `.env` y no el código.

## Entidad User (auth híbrida)

```ts
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;

  @Exclude()
  @Column({ nullable: true }) password: string | null; // null si provider = 'google'

  @Column() fullName: string;
  @Column({ type: 'enum', enum: ['local', 'google'], default: 'local' }) provider: string;
  @Column({ nullable: true }) googleId: string | null;
  @Column({ nullable: true }) phone: string;
  @Column({ type: 'decimal', default: 0 }) totalSpent: number;
  @Column({ type: 'enum', enum: ['cliente', 'admin'], default: 'cliente' }) role: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
```

Reglas:
- El DTO de registro tradicional (`RegisterDto`) exige `password` (`@IsNotEmpty()`).
- El servicio de login con Google **nunca** pide password: verifica el `idToken` de Google con
  `google-auth-library`, busca por `googleId` o `email`, y si no existe lo crea con `provider: 'google'`
  y `password: null`.
- El login tradicional rechaza usuarios con `provider: 'google'` (deben usar el botón de Google).

## Órdenes y WhatsApp

- El pedido se guarda en el backend con estado `pendiente` **antes** de redirigir a WhatsApp — así
  siempre hay registro aunque el cliente no complete el envío del mensaje.
- Estados válidos: `pendiente`, `confirmado`, `en_camino`, `entregado`, `cancelado`. Modelar como
  `enum` en la entidad, no como string libre.
- Al transicionar a `entregado`: incrementar `user.totalSpent` en el mismo `service`, dentro de una
  transacción, y disparar el chequeo del módulo de cupones (evento o llamada directa al service).

## Cupones automáticos

- El umbral de monto (ej. S/50) debe vivir en `config/configuration.ts`, no hardcodeado.
- El cron (`@Cron(CronExpression.EVERY_DAY_AT_1AM)`) revisa usuarios cuyo `totalSpent` acumulado
  desde el último cupón supera el umbral, genera un código único (`nanoid` o similar) y dispara
  una notificación push.
- Un cupón siempre tiene fecha de expiración — no generar cupones sin `expiresAt`.

## Banners

- Endpoint público `GET /banners/active` filtra por `activo = true` y rango de fecha vigente
  (`startDate <= now <= endDate`), ordenado por el campo `order`.
- La subida de imagen se hace a Cloudinary desde el backend (no exponer credenciales al frontend);
  el endpoint recibe el archivo, lo sube, y guarda solo la URL resultante.

## Swagger

- Todo controller lleva `@ApiTags('nombre-modulo')`.
- Todo endpoint lleva `@ApiOperation()` y `@ApiResponse()` para los casos de éxito y error principales.
