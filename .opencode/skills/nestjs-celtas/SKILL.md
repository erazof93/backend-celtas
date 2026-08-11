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
- **`synchronize` está apagado siempre, incluso en desarrollo** (ver "Flujo de migraciones" abajo).
  No lo reactives ni siquiera temporalmente — rompe la detección de diffs de `migration:generate`.

## Flujo de migraciones (OBLIGATORIO para cualquier cambio de schema)

Producción (Render) corre `pnpm run migration:run && pnpm run start:prod` en cada deploy — las
migraciones se aplican solas contra Supabase al hacer `git push`. Pero el archivo de migración
tiene que existir y estar probado ANTES de ese push. Cada vez que se agregue/modifique una
entidad (columna, tabla, índice, FK, enum):

1. Modificar la entidad en código.
2. Generar la migración: `pnpm run migration:generate src/migrations/NombreDescriptivo`
3. Revisar el archivo generado a mano — nunca confiar ciegamente en el diff automático.
4. Correr `pnpm run migration:run` localmente y verificar que la app sigue funcionando con el
   cambio real aplicado (no solo con `synchronize`).
5. Commitear la entidad Y el archivo de migración JUNTOS, en el mismo commit — nunca sueltos.
6. `git push` → Render aplica la migración sola antes de arrancar la nueva versión.

Si `migration:generate` dice "no changes found" después de un cambio real de entidad, es señal
de que `synchronize` se reactivó en algún lado o de que la BD local no está al día con las
migraciones — no seguir adelante hasta resolver esa inconsistencia primero.

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
  @Column({
    type: 'decimal',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  totalSpent: number; // TypeORM devuelve 'decimal' como string sin este transformer
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
- **Snapshot de precios**: cada `OrderItem` guarda `name` y `unitPrice` copiados del `MenuItem` al
  momento del pedido (no una referencia que se recalcule después). Si el admin cambia el precio de
  un producto mañana, los pedidos viejos no deben cambiar de total retroactivamente.
- **Decisión: el link de WhatsApp se genera en el backend**, no en Flutter. `POST /orders` devuelve,
  junto con el pedido creado, un campo `whatsappUrl` ya armado (`https://wa.me/<número>?text=<mensaje
  codificado>`), usando `WHATSAPP_BUSINESS_NUMBER` de la config. Así el formato del mensaje y el
  número quedan en un solo lugar, no hardcodeados en el cliente.
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

## Validaciones cruzadas / condicionales en DTOs

⚠️ **Gotcha confirmado en este proyecto** (class-validator 0.15.1): `@Validate(callback)` con una
función flecha inline **no funciona** — se ignora en silencio, sin error, sin warning. El campo
queda sin validar aunque el código "parezca" correcto y los tests puedan pasar igual por casualidad
(si el service también valida lo mismo, como pasó con el `%>100` de Coupons y las fechas de Banners).

**Regla del proyecto**: toda validación cruzada o condicional (ej. "A es requerido si B es X",
"fecha1 < fecha2", "% ≤ 100 pero monto fijo no") se implementa con una clase real:

```ts
@ValidatorConstraint({ name: 'isDateRangeValid', async: false })
export class IsDateRangeValid implements ValidatorConstraintInterface {
  validate(endValue: any, args: ValidationArguments) {
    const obj = args.object as any;
    if (!obj.startDate || !endValue) return true;
    return new Date(obj.startDate) < new Date(endValue);
  }
  defaultMessage() {
    return 'La fecha de inicio debe ser anterior a la fecha de fin';
  }
}

// en el DTO:
@Validate(IsDateRangeValid)
endDate?: string;
```

Nunca uses `@Validate((obj) => ...)` con una función inline — aunque compile, no valida nada.
El chequeo redundante a nivel de servicio sigue siendo buena práctica (defensa en profundidad),
pero no reemplaza tener la validación real en el DTO.

## Actualizaciones parciales (PATCH) — NUNCA `Object.assign` sobre entidades

⚠️ **Gotcha confirmado en este proyecto (bug real de producción)**: el proyecto corre con
`target: ES2023` en `tsconfig.json`, lo que activa `useDefineForClassFields`. Consecuencia: un DTO
de clase con campos opcionales (`alias?: string`, etc.) queda con **propiedades propias `undefined`**
para los campos que el PATCH no envía. Por eso:

```ts
// ❌ MAL — pisaba con undefined los valores ya cargados de la entidad:
Object.assign(address, dto);
// La BD sí se actualizaba bien, pero la respuesta JSON salía incompleta
// (JSON.stringify descarta los undefined). Bug confirmado en PATCH /users/me/addresses/:id.
```

**Regla del proyecto**: para aplicar un DTO parcial sobre una entidad cargada, usar
`repository.merge(entity, dto)` (TypeORM solo copia columnas con valor `!== undefined`, verificable
en `PlainObjectToNewEntityTransformer`) o guards explícitos `if (dto.x !== undefined)` campo a campo
(patrón ya usado en `UsersService.updateProfile`). Nunca `Object.assign` ni spread `{ ...entity, ...dto }`
sobre la entidad que se va a devolver en la respuesta.

- Excepción válida: `repository.create({ ...dto })` al CREAR es correcto (no parte de una entidad
  cargada; `create` también ignora `undefined`).
- Atención extra: los DTOs generados con `PartialType` de `@nestjs/swagger` (menú) NO tienen
  propiedades propias `undefined` (no redeclaran class fields), por lo que hoy no disparan este bug;
  pero el código de update debe usar `merge` igual, como defensa en profundidad si mañana se
  reescriben como clases planas.
- Los mocks de repositorio en los specs unitarios deben incluir `merge` replicando este
  comportamiento (solo copiar `!== undefined`) — ver `addresses.service.spec.ts`.

## Swagger

- Todo controller lleva `@ApiTags('nombre-modulo')`.
- Todo endpoint lleva `@ApiOperation()` y `@ApiResponse()` para los casos de éxito y error principales.
