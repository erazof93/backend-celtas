# 🪓 Celtas Backend — Roadmap de desarrollo

Backend en **NestJS + TypeScript + PostgreSQL** para la dark kitchen Celtas (solo delivery).
Panel administrativo en **React**. App cliente en **Flutter**.

Este documento es la fuente de verdad del progreso. Cada vez que termines un módulo, marca el checklist
y haz commit. Trabajamos **de módulo en módulo**, sin saltar pasos, para mantener el proyecto profesional
y fácil de mantener.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Framework | NestJS (TypeScript) |
| Gestor de paquetes | **pnpm** |
| Base de datos | PostgreSQL (Supabase o Neon en free tier) |
| ORM | TypeORM |
| Auth | JWT (access + refresh) + Google OAuth2 |
| Validación | class-validator / class-transformer |
| Documentación API | Swagger (`@nestjs/swagger`) |
| Notificaciones | Firebase Cloud Messaging |
| Storage de imágenes | Cloudinary |
| Deploy | Render (free tier) |
| Panel admin | React + Vite + Axios/React Query |

---

## Convenciones del proyecto

- Arquitectura modular de NestJS: un módulo = una carpeta en `src/modules/`.
- Cada módulo trae: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/`.
- DTOs siempre validados con `class-validator`.
- Respuestas de la API con formato consistente (usar un `interceptor` de transformación global).
- Manejo de errores centralizado con `HttpExceptionFilter`.
- Variables de entorno validadas al arrancar (`Joi` o `zod` en `config/validation.schema.ts`).
- Nombrado en inglés para código (`orders`, `coupons`), textos de cara al usuario en español.
- Cada endpoint documentado con decoradores de Swagger.

---

## Estructura de carpetas

```
celtas-backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── configuration.ts
│   │   └── validation.schema.ts
│   ├── common/
│   │   ├── decorators/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   └── pipes/
│   ├── database/
│   │   ├── migrations/
│   │   └── seeds/
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── strategies/        # local, jwt, google
│   │   │   ├── dto/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   └── auth.module.ts
│   │   ├── users/
│   │   │   ├── entities/user.entity.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   └── users.module.ts
│   │   ├── menu/
│   │   │   ├── categories/
│   │   │   └── items/
│   │   ├── orders/
│   │   │   ├── entities/order.entity.ts
│   │   │   ├── orders.controller.ts
│   │   │   ├── orders.service.ts
│   │   │   └── orders.module.ts
│   │   ├── coupons/
│   │   │   ├── coupons.service.ts        # generación automática (cron)
│   │   │   ├── coupons.controller.ts
│   │   │   └── coupons.module.ts
│   │   ├── banners/
│   │   │   ├── banners.controller.ts     # CRUD desde panel admin
│   │   │   └── banners.module.ts
│   │   └── notifications/
│   │       └── fcm.service.ts
│   └── shared/
├── test/
├── .env.example
├── .opencode/
│   ├── agents/
│   │   └── celtas-backend.md
│   └── skills/
│       └── nestjs-celtas/
│           └── SKILL.md
├── opencode.json
├── ROADMAP.md
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

## Checklist por módulos

### 0. Setup inicial — ✅ COMPLETO
- [x] Crear proyecto con `nest new celtas-backend --package-manager pnpm`
- [x] Confirmar que existe `pnpm-lock.yaml`
- [x] Configurar ESLint + Prettier (venían de `nest new`, verificados en 0 errores)
- [x] Instalar `@nestjs/config`, `@nestjs/typeorm` + `typeorm` + `pg`, `@nestjs/swagger`
- [x] `docker compose up -d` para levantar PostgreSQL local
- [x] Copiar `.env.example` a `.env`
- [x] Conectar TypeORM al PostgreSQL local vía `ConfigService` (`TypeOrmModule.forRootAsync`)
- [x] `ValidationPipe` global + interceptor de respuesta + filtro de excepciones
- [x] Swagger en `/docs` (UI) + spec en `/docs-json` sin auth
- [x] Endpoint `GET /health` que valida conexión real a la BD (`SELECT 1`)
- [x] Auditado por `@tester`: build limpio, lint 0 errores, 14 tests unitarios + 3 e2e pasando

### 0.5 Validación de variables de entorno — ✅ COMPLETO
> `@tester` marcó esto como riesgo: agregarlo ahora, con pocas variables, es barato.
> Después de Auth (JWT_SECRET, JWT_REFRESH_SECRET, GOOGLE_CLIENT_ID) sale más caro retrofitear.
- [x] Crear `src/config/validation.schema.ts` con Joi (o Zod) validando TODAS las variables del `.env`
- [x] La app debe **fallar al arrancar** (no arrancar con defaults silenciosos) si falta o está vacía
      cualquier variable requerida — incluyendo `JWT_SECRET`/`JWT_REFRESH_SECRET` aunque el módulo
      Auth aún no exista (las declara igual, para que Auth las use sin fallback hardcodeado)
- [x] Conectar el schema en `ConfigModule.forRoot({ validationSchema })`
- [x] `@tester` verifica: arrancar sin una variable requerida debe tirar error claro, no arrancar "a medias"
- [x] Auditado por `@tester`: build limpio, lint 0 errores, 22 tests unitarios + 3 e2e pasando.
      Prueba real: comentar `JWT_SECRET` → `Config validation error: "JWT_SECRET" is required`

### 1. Módulo Auth
- [x] Entidad `User` (con `password` nullable, `provider`, `googleId`)
- [x] Registro tradicional (email + password, hash con bcrypt)
- [x] Login tradicional (retorna access + refresh JWT)
- [x] Login con Google (verificación de `idToken` con `google-auth-library`, audiencia + `email_verified`, crea usuario `provider: google` con `password: null` si no existe, 409 si el email ya es cuenta local)
- [x] Guard `JwtAuthGuard` y estrategia `Passport`
- [x] Endpoint `refresh-token`
- [x] Roles básicos: `cliente` / `admin`
- [x] Auditado por `@tester` (parte tradicional): build limpio, lint 0, 31 tests unitarios + 15 e2e. Login/refresh devuelven 200, register 201. Password nunca expuesto, guardado hasheado. Login de cuenta Google rechazado con 401 + mensaje claro.
- [x] Auditado por `@tester` (login con Google, **LISTO PARA MARCAR COMPLETO**): build/lint limpios, 36 unit + 20 e2e. `POST /auth/google` valida audiencia (`GOOGLE_CLIENT_ID`) y `email_verified`, crea usuario `provider: google` con `password: null`, 409 si el email ya es cuenta local (no fusiona), login directo si el `googleId` ya existe (sin duplicar), `ThrottlerGuard` + Swagger. Endurecido: índice único en `googleId`, mensajes de validación 100% en español.

### 1.1 Endurecimiento rápido (antes de Google)
- [x] Transformer de `totalSpent` en la entidad User → TypeORM lo devuelve como `number` (no string)
- [x] `GET /auth/me` devuelve el usuario real de la BD (no solo el payload del JWT), con `totalSpent` como número
- [x] Rate limiting con `@nestjs/throttler` en `POST /auth/login` y `POST /auth/register` (5 intentos/min por IP, mensaje 429 en español)
- [x] Auditado por `@tester` (**LISTO PARA MARCAR COMPLETO**): 429 al superar el límite (no 401 ni 200) con mensaje en español, `totalSpent` llega como number (verificado con decimal 123.45), `/auth/refresh` y `/auth/me` no limitados, build/lint/31 unit/15 e2e limpios

### 2. Módulo Users — ✅ COMPLETO
- [x] CRUD de perfil (nombre, teléfono, direcciones)
  - [x] `GET /users/me` perfil real desde la BD (patrón compartido con `GET /auth/me`)
  - [x] `PATCH /users/me` solo `fullName`/`phone` (DTO sin `email`/`password`/`provider`/`role`/`totalSpent`)
  - [x] Entidad `Address` (alias, dirección, referencia, distrito, `isDefault`, `ManyToOne` User)
  - [x] `GET/POST /users/me/addresses` y `PATCH/DELETE /users/me/addresses/:id` con verificación de propiedad (403) y una sola `isDefault`
- [x] Campo `totalSpent` (usado por el módulo de cupones)
- [ ] Endpoint para historial de pedidos del usuario (depende del módulo Orders)
- [x] `GET /users` solo admin, paginado, sin exponer password
- [x] Auditado por `@tester`: **LISTO PARA MARCAR COMPLETO** — build/lint limpios, 53 unit + 45 e2e. Cliente no edita/borra dirección de otro (403), DTO de perfil rechaza `role`/`totalSpent` (400), `GET /users` 403 para `cliente`. Corregido: `@IsNotEmpty` en `phone`/`reference`.
- [x] `GET /users/:id/addresses` (admin): vista 360 del cliente. `UsersService.ensureExists` (404 si no existe) + `AddressesService.findByUser` reutilizado. Auditado por `@tester`: **LISTO PARA MARCAR COMPLETO** — 191 unit + 190 e2e, build/lint limpios, Swagger 200/401/403/404, sin conflicto de rutas con `me/addresses`.
- [x] Ranking de usuarios por consumo: `GET /users` acepta `sortBy` opcional (whitelist estricta
  `totalSpent` | `createdAt`, 400 en cualquier otro valor — evita inyección de columna en el
  `ORDER BY`) y `order` opcional (`asc` | `desc`, default `desc`). Sin estos params el
  comportamiento previo (`createdAt DESC`) queda intacto. Auditado por `@tester`: **LISTO PARA
  MARCAR COMPLETO** — 223 unit + 241 e2e, build/lint limpios; probado con intentos de inyección
  de columna en `sortBy` (rechazados con 400 por `ValidationPipe` + `forbidNonWhitelisted`, nunca
  llegan al ORM).

### 3. Módulo Menu — ✅ COMPLETO
- [x] Entidad `Category` (Burgers, Chicken, Bebidas, etc.)
- [x] Entidad `MenuItem` (nombre, descripción, precio, imagen, disponible)
- [x] CRUD completo protegido para admin
- [x] Endpoint público `GET /menu` optimizado para la app (agrupado por categoría)
- [x] Subida de imágenes a Cloudinary (`CloudinaryService` reutilizable) + endpoints `POST /menu/items/:id/image` y `POST /menu/categories/:id/image` (multipart, solo imágenes, máx 5MB → 400, admin)
- [x] Auditado por `@tester` (**LISTO PARA MARCAR COMPLETO**): build/lint limpios, 84 unit + 69 e2e. `GET /menu` filtra inactivos/no disponibles, admin rechaza 401/403, borrar categoría con productos → 409, nombre duplicado → 409 (corregido: antes 500), subida de imagen 200/400/404, Swagger multipart usable, credenciales Cloudinary no expuestas.
- [x] Nota de concurrencia resuelta: fallback `QueryFailedError` 23505 → 409 en `createCategory`/`updateCategory`/`createItem`/`updateItem` (no reemplaza el chequeo previo). Confirmado por `@tester` (**NOTA DE CONCURRENCIA RESUELTA**): 88 unit + 69 e2e.
- [ ] **Mejora nueva (en curso): catálogo de salsas/cremas (`Sauce`) + selección por producto.**
      Módulo nuevo `sauces` (`entities/sauce.entity.ts`, CRUD admin en `/sauces`): catálogo global
      (`name` único, `active`, `sortOrder`) sin FK de historial — un pedido ya creado nunca
      depende de que la salsa siga existiendo (ver mejora del módulo Orders). `MenuItem` gana una
      relación `ManyToMany` (`sauces`, tabla de unión `menu_item_sauces`) — vacía = el producto no
      ofrece selector (ej. arroz chaufa). `CreateMenuItemDto`/`UpdateMenuItemDto` aceptan
      `sauceIds?: string[]`; el PATCH solo toca la relación si el campo viene explícito (mismo
      criterio "guard explícito" que el resto del proyecto para lo que `merge()` no cubre).
      `GET /menu` (público) expone `sauces: {id,name}[]` por producto, solo las activas, ordenadas
      por `sortOrder`. Migración `AddSaucesCatalog` generada contra una BD real, revisada y
      aplicada — **dos bugs reales encontrados y corregidos antes de aplicarla** (detalle completo
      en `docs/testing-checklist.md`, sección "Salsas/cremas"): (1) `src/data-source.ts` no tenía
      `Sauce` en su lista manual de entidades (el CLI de migraciones no usa
      `autoLoadEntities`) — `migration:generate` fallaba; (2) la FK del lado inverso del
      `@JoinTable` (`menu_item_sauces.sauceId`) quedó `ON DELETE NO ACTION` por default de
      TypeORM (el lado dueño sí cascadea) — sin corregirlo, borrar una salsa todavía asignada a
      un producto revienta con 500; `SaucesService.remove()` limpia la relación primero.
      Verificado end-to-end con curl contra el servidor real y Postgres local real (creación de
      categoría/salsas/productos, `GET /menu`, borrado de una salsa en uso, mensaje de WhatsApp
      con las salsas — ver mejora del módulo Orders). 253/253 tests unitarios, build/lint limpios.
      **Pendiente antes de marcar completo**: tests e2e (`test:e2e`) y pase real del subagente
      `@tester` (lo de arriba lo verifiqué yo directamente contra el código y una BD real, no es
      el pase habitual de `@tester` del proyecto).

### 4. Módulo Orders
- [x] Entidad `Order` + `OrderItem`
- [x] Endpoint `POST /orders` (crea pedido en estado `pendiente`)
- [x] Estados: `pendiente` → `confirmado` → `en_camino` → `entregado` / `cancelado`
- [x] Al pasar a `entregado`: sumar el monto a `user.totalSpent`
- [x] Endpoint para listar pedidos (admin) y pedidos propios (cliente)
- [x] Generar el texto/link de WhatsApp en el backend (para mantenerlo consistente) o dejarlo al frontend — **definir en el setup**
- [x] Filtro `userId` (UUID v4 validado) en `GET /orders` (admin): `OrdersService.findAll` agrega `where.userId` solo si el param viene presente; sin él el comportamiento previo queda intacto. Swagger documenta el param (`@ApiQuery` + `@ApiPropertyOptional`). Auditado por `@tester`: **LISTO PARA MARCAR COMPLETO** — 191 unit + 190 e2e, build/lint limpios.
- [ ] **Mejora nueva (en curso): salsas elegidas por ítem, snapshot + WhatsApp.**
      `CreateOrderItemDto.sauceIds?: string[]` (opcional, por ítem — aplica a las `quantity`
      unidades de ese ítem, no una selección por unidad individual). `OrdersService.buildItems`
      valida cada `sauceId` contra las salsas que el `MenuItem` realmente ofrece (400 con mensaje
      real si no está entre ellas — nunca guarda algo que el cliente no pudo haber visto en la
      app) y guarda el resultado como **snapshot de nombres** en la columna nueva
      `OrderItem.selectedSauces` (`text[]`, nullable) — mismo criterio que `name`/`unitPrice`:
      borrar o renombrar una salsa del catálogo después nunca altera un pedido ya creado.
      `buildWhatsappUrl` agrega `(Salsas: X, Y)` al final de la línea del ítem cuando corresponde
      (nada si el ítem no tiene ninguna). De paso, se simplificó la construcción del texto de
      `itemsText` (antes hacía `join(', ')` seguido de `split(', ')` para reconstruir líneas —
      fràgil si un nombre de producto contuviera literalmente `", "`; ahora arma cada línea
      directo). Verificado con un pedido real de 2 ítems (uno con 2 salsas, otro sin ninguna)
      contra el servidor corriendo: `selectedSauces` guardado correcto en ambos, mensaje de
      WhatsApp decodificado con el formato esperado — detalle completo en
      `docs/testing-checklist.md`, sección "Salsas/cremas". Mismo pendiente que la mejora del
      módulo Menu: falta `test:e2e` y el pase real de `@tester`.
- [ ] **Refinamiento (en curso): tri-state real de `sauceIds` — distinguir "no aplica" de "Sin
      salsas" elegido a propósito.** Antes, `sauceIds` no enviado (`undefined`) y `sauceIds: []`
      enviado explícito colapsaban al mismo `selectedSauces: null` — no había forma de saber si el
      cliente vio el selector y no quiso ninguna, o si el producto ni siquiera ofrece salsas.
      Pedido explícito del dueño del negocio: que "Sin salsas" viaje como dato real (visible/
      editable en el carrito mobile) y aparezca literal en el mensaje de WhatsApp para que el
      cocinero sepa que fue una elección, no un olvido. `resolveSelectedSauces` ahora distingue
      los tres casos reales: `undefined` → `null` (no aplica, sin sufijo); `[]` enviado explícito
      → `[]` (nunca colapsado a `null`); con ids → nombres validados (sin cambios). `buildWhatsappUrl`
      agrega `(Salsas: Sin salsas)` cuando `selectedSauces` es `[]` no-null, y sigue sin sufijo
      solo cuando es `null`. No hizo falta migración (la columna `selectedSauces` ya era `text[]`
      nullable, un array vacío es válido ahí). DTO: `sauceIds` nunca tuvo `@ArrayNotEmpty`, así que
      `[]` ya pasaba la validación; solo se actualizó la descripción de Swagger para reflejar el
      tri-state. Verificado con dos `POST /orders` reales lado a lado contra el servidor y Postgres
      local reales (mismo ítem, uno con `sauceIds: []`, otro sin el campo): el primero devolvió
      `selectedSauces: []` y `whatsappUrl` con `(Salsas: Sin salsas)`; el segundo, `selectedSauces:
      null` y sin sufijo. Auditado por `@tester` con mutación real (revirtió el chequeo de `[]` a
      `null` a propósito): los 2 tests nuevos fallaron exactamente como se esperaba y ningún otro
      de los 41 de `orders.service.spec.ts` se vio afectado — **veredicto "LISTO"** para este
      refinamiento puntual (255/255 unit, 241/241 e2e, build/lint limpios). Sigue pendiente, sin
      variación por este cambio, lo ya anotado arriba: casos e2e propios de `sauceIds` en
      `POST /orders` y el pase completo de `@tester` sobre la feature de salsas en conjunto.
      **Esta es la base de la que dependen `celtas-admin`** (mostrar "Sin salsas" en el detalle de
      pedido, distinto de no mostrar nada) **y `celtas-app`** (mandar `sauceIds: []` explícito
      desde el carrito cuando el cliente elige deliberadamente ninguna salsa) — ambos ya en curso
      con el mismo criterio.
- [x] **Horario de atención del negocio, backend como única fuente de
      verdad.** Antes se aceptaban pedidos a cualquier hora. Reutiliza la tabla `settings` (sin
      migración nueva): `business_hours_schedule` (JSON por día de la semana, mismas claves
      0=domingo...6=sábado que `Banner.daysOfWeek`, `open`/`close` en `HH:mm` hora de Lima,
      soporta cruce de medianoche cuando `close <= open`), `business_manual_closed` (interruptor
      manual "cerrado temporalmente" desde el panel, con prioridad sobre el horario programado) y
      `business_manual_closed_reason` (motivo opcional mostrado al cliente). Lógica de zona
      horaria extraída de `banners.service.ts` (`todayDayOfWeekInLima`) a un util compartido
      `src/common/utils/lima-time.util.ts` (`todayDayOfWeekInLima` + `currentMinutesInLima`,
      ambas con un parámetro `reference: Date` opcional para poder fijar la hora en los tests sin
      mockear `Date` globalmente) — `banners.service.ts` migrado para usar el mismo util, sin
      duplicar la lógica. `SettingsService.isOpenNow()` es la fuente única de verdad: evalúa el
      override manual primero (gana siempre) y luego el horario, revisando la entrada de HOY y la
      de AYER cuando el horario cruza medianoche (viernes 11:00–01:00: viernes 23:30 abierto por
      "hoy", sábado 00:30 abierto por arrastre de "ayer", sábado 02:00 cerrado). Nuevo endpoint
      público `GET /settings/business-hours` centraliza `{ open, message, schedule, manualClosed }`
      para uso futuro del panel/app (no bloquea nada por sí mismo). El bloqueo real está en
      `OrdersService.create()`: si `isOpenNow().open` es `false`, `ConflictException` (409) con el
      mismo mensaje de `isOpenNow()`, ANTES de validar items/dirección/cupón — el cliente sigue
      pudiendo navegar el menú libremente a cualquier hora, el bloqueo es solo al confirmar el
      pedido. Verificado con `curl` real contra el servidor y Postgres local reales: activar
      `business_manual_closed` vía `PATCH /settings` → `POST /orders` devuelve 409 con el mensaje
      esperado y `GET /settings/business-hours` refleja `open: false`; desactivarlo → un pedido
      normal vuelve a funcionar igual que antes (201). Auditado por `@tester`: **LISTO PARA
      MARCAR COMPLETO** — build/lint limpios, 274 unit (19 suites) + 245 e2e (12 suites, agregó 4
      tests e2e nuevos que no existían para este endpoint/feature). Verificado con mutación real
      en los 3 puntos más frágiles: el guard de `OrdersService.create()`, el override manual (con
      y sin motivo), y las tres variantes del cruce de medianoche (tramo de hoy, arrastre de
      ayer, y el caso límite "madrugada ya cerrada, hoy todavía no abre") — cada mutación rompió
      exactamente el/los test(s) esperado(s) y ningún otro. Confirmado además que
      `OrdersService.create()` llama `isOpenNow()` antes de tocar `addressesRepository`/
      `menuItemsRepository` (no solo que el test lo afirme). Dos hallazgos menores no bloqueantes,
      documentados en `docs/testing-checklist.md`: (1) `POST /orders` no documentaba el 409 en
      Swagger — corregido; (2) `UpdateSettingDto.value` tiene `@IsNotEmpty()`, por lo que un admin
      no puede vaciar `business_manual_closed_reason` a `""` real vía `PATCH /settings` una vez
      puesto un motivo (solo enviar espacios en blanco, que el servicio normaliza a `null`) — sin
      corregir, queda anotado para cuando `celtas-admin` construya el formulario. **Pendiente,
      fuera de este backend**: `celtas-admin` (formulario de horario + interruptor manual en el
      panel) y `celtas-app` (mostrar el 409 y su mensaje de forma clara en el checkout) quedan
      pendientes con el mismo criterio que las mejoras anteriores.

### 5. Módulo Coupons
- [x] Entidad `Coupon` (código, tipo de descuento, monto/%, expiración, usado, userId)
- [x] Cron job (`@nestjs/schedule`) que revisa usuarios que superaron el umbral (ej. S/50) desde el último cupón
- [x] Endpoint para generación manual de cupones desde el panel admin (campañas)
- [x] Endpoint de validación/canje de cupón al hacer un pedido
- [x] **Bug de negocio encontrado post-lanzamiento (vía uso real en producción) y corregido**:
  cancelar un pedido con cupón aplicado dejaba el cupón `used` para siempre, aunque el cliente
  nunca recibió el descuento. `CouponsService.reactivateForCancelledOrder()` reactiva el cupón
  (lock pesimista) dentro de la misma transacción del cambio de estado a `cancelado`. Confirmado
  que `entregado → cancelado` no es una transición válida (no se puede reactivar por error un
  cupón ya legítimamente usado). 198 unit + 201 e2e, sin regresiones

### 5.1 Endurecimiento Coupons
- [x] `@Max(100)` condicional en `GenerateCouponDto` para `percentage` (un `fixed_amount` > 100 sigue válido); el chequeo del servicio se mantiene como defensa en profundidad
- [x] Test e2e: `POST /coupons/generate` con `percentage` 150 → 400; `fixed_amount` 150 → 201
- [x] Aislamiento de datos e2e: cada suite ya usa prefijos de email únicos; fragilidad de `/users` resuelta con `limit` alto (mejora mayor anotada en módulo 10)
- ⚠️ **Corrección (módulo 8)**: el `@Validate` inline original no validaba nada de verdad (silencioso,
  ver skill `nestjs-celtas`) — el 400 funcionaba solo porque el servicio también lo rechazaba.
  Reemplazado por `is-percentage-within-limit.ts` (`@ValidatorConstraint` real). Confirmado por `@tester`.
- [x] Filtro `userId` (UUID v4 validado) en `GET /coupons` (admin): `CouponsService.findAll` agrega
  `where.userId` solo si el param viene presente; sin él el comportamiento previo queda intacto.
  Swagger documenta el param (`@ApiQuery` + `@ApiPropertyOptional`). Auditado por `@tester`:
  **LISTO PARA MARCAR COMPLETO** — 186 unit + 179 e2e, build/lint limpios.

### 5.2 Cupones de campaña masiva (`generate-bulk`) — ✅ COMPLETO
- [x] Columna `campaignName` (nullable) en `Coupon`: etiqueta para agrupar/filtrar cupones
  generados en masa (ej. "padre2026"); no reemplaza `code` (sigue siendo único random por
  cupón). Migración `AddCampaignNameToCoupons` generada, revisada y aplicada localmente
  (rollback verificado por `@tester`).
- [x] `POST /coupons/generate-bulk` (admin): genera un cupón individual (código único random)
  para CADA usuario `role: cliente` (excluye admins), dentro de una transacción con batch
  insert en chunks de 500 (no un loop de saves uno por uno). Devuelve `{ count }`, no la lista
  completa.
- [x] `expiresAt` opcional (ISO 8601) en `GenerateCouponDto` (endpoint individual) y en
  `GenerateBulkCouponDto`: si no se envía, se calcula automático (hoy + `COUPON_EXPIRATION_DAYS`),
  igual que antes. Los cupones automáticos (`CouponsService.checkAndGenerateForUser`, cron/umbral
  de gasto) no tienen ninguna ruta para recibir `expiresAt` manual — su cálculo automático quedó
  intacto.
- [x] Auditado por `@tester`: **LISTO PARA MARCAR COMPLETO** — 223 unit + 241 e2e, build/lint
  limpios. Confirmado con test de regresión manual (quitar el filtro `role: cliente` rompe el
  test correspondiente) que la exclusión de admins es real, no un test que pasa igual. Nota
  pendiente (no bloqueante): `campaignName` aún no es filtrable desde `GET /coupons` — agregar
  en una siguiente iteración si el panel admin lo necesita.

### 6. Módulo Banners
- [x] Entidad `Banner` (imagen, título, link/acción, fechas, activo, orden)
- [x] Endpoint `GET /banners/active` (público, consumido por la app)
- [x] CRUD protegido para admin (subida de imagen vía Cloudinary)
- ⚠️ **Corrección (módulo 8)**: la validación `startDate < endDate` tenía el mismo `@Validate`
  inline muerto que Coupons. Reemplazado por `is-banner-date-range-valid.ts`. Confirmado por `@tester`.
- [x] **Recurrencia por día de la semana (`daysOfWeek`)**: columna `int[]` nullable (null/vacío =
  todos los días, comportamiento previo intacto; 0=domingo...6=sábado). `GET /banners/active` agrega
  una 4ª condición independiente: si `daysOfWeek` está definido y no vacío, el día actual en
  `America/Lima` debe estar incluido (`:day = ANY(daysOfWeek)`). DTOs con `@IsArray @IsInt @Min(0)
  @Max(6)` each. Migración `AddDaysOfWeekToBanners` aplicada localmente y verificada. Auditado por
  `@tester`: **LISTO PARA MARCAR COMPLETO** — 212 unit + 226 e2e, build/lint limpios.

### 7. Módulo Notifications
- [x] Integración con Firebase Cloud Messaging
- [x] Guardar `fcmToken` por usuario
- [x] Servicio reutilizable `sendPushNotification(userId, payload)`
- [x] Disparo automático: cupón generado, cambio de estado de pedido
- [ ] Disparo automático: banner nuevo (broadcast) — PENDIENTE como decisión futura (probablemente FCM topics, no token a token). El método `sendPushNotification` ya está listo.

### 8. Panel Admin (endpoints) — ✅ COMPLETO
- [x] Guard de rol `admin` para todos los endpoints de gestión
- [x] Dashboard: pedidos del día, ventas totales, productos más vendidos (endpoints de estadísticas)
- [x] Endpoints ya cubiertos por los módulos de menú, banners y cupones
- [x] `deliveredAt` en `Order` como fuente de verdad para reportes (no `createdAt`)
- [x] Validación `from <= to` en `DashboardQueryDto` con `is-date-range-valid.ts` (`@ValidatorConstraint` real)
- [x] Sección "Admin / Dashboard" agregada a `docs/testing-checklist.md` (11 ítems)
- [x] **Bug de clase encontrado y corregido en los 3 DTOs**: `@Validate` con función inline no
  valida nada en `class-validator` 0.15.1 (silencioso). Reemplazado en Coupons, Banners y
  Dashboard por clases `@ValidatorConstraint` reales. Documentado como convención en la skill
  `nestjs-celtas` para no repetirlo.
- [x] Auditado por `@tester`: **LISTO PARA MARCAR COMPLETO** — 164 unit + 160 e2e, build/lint limpios

### 8.1 Settings (número de WhatsApp editable desde el panel) — ✅ COMPLETO
- [x] Entidad `Setting` (key único, value, description), sembrada al arrancar si no existe
- [x] `GET /settings/public` (sin auth, whitelist explícita en código, nunca expone todo el key-value)
- [x] `GET`/`PATCH /settings` (admin)
- [x] `OrdersService.buildWhatsappUrl` migrado a leer de `SettingsService`, con fallback a `.env` si la tabla está vacía (logueado)
- [x] `WHATSAPP_BUSINESS_NUMBER` pasó de requerida a opcional en el schema
- [x] `PATCH /users/:id/role` (admin, rechaza auto-degradación con 400)
- [x] `test/jest-e2e.json` con `maxWorkers: 1` — resuelve la fragilidad de BD compartida entre suites e2e (anotada como mejora opcional desde el módulo 5.1, reapareció con la 11ª suite)
- [x] Auditado por `@tester`: 183 unit (17 suites) + 174 e2e (11 suites), lint/build limpios

### 9. Deploy y DevOps
- [x] Migración inicial de TypeORM generada y verificada (9 tablas, 7 enums, 7 FKs, todos los índices únicos confirmados uno a uno contra las entidades)
- [x] `synchronize: false` forzado cuando `NODE_ENV=production` (schema solo por migraciones en prod)
- [x] SSL condicional en TypeORM (`NODE_ENV=production` → SSL con `rejectUnauthorized: false` para Supabase; override manual `DB_SSL` para pruebas)
- [x] `trust proxy` habilitado solo en producción (protege el `ThrottlerGuard` de auth detrás del proxy de Render)
- [x] `data-source.ts` (CLI de migraciones) carga `.env` de forma independiente y **falla explícito** si falta una variable — probado renombrando `.env` y confirmando el error, no un fallback silencioso a `localhost`
- [x] `pnpm run start:prod` verificado localmente en modo producción
- [x] Proyecto en Supabase creado (`celtas-backend`, São Paulo, Data API desactivado) — **hecho**
- [x] Web Service en Render creado y configurado (Build Command, Start Command con migración encadenada, Health Check `/health`) — **hecho**
- [x] Variables de entorno reales pegadas en Render (secrets de JWT nuevos, no reutilizar los de local)
- [x] **Gotcha resuelto**: conexión directa de Supabase (`db.xxx.supabase.co`) solo resuelve IPv6, y Render no soporta salida IPv6 (`ENETUNREACH`). Solución: usar el **Session Pooler** de Supabase (`aws-0-<region>.pooler.supabase.com:5432`, usuario `postgres.<project-ref>`) en vez de la conexión directa — es IPv4-compatible y funciona igual para una app persistente
- [x] Primer deploy exitoso: migración corrió sola en el arranque, las 9 tablas + enums + FKs se crearon correctamente, `"Your service is live 🎉"` — backend real en `https://backend-celtas.onrender.com`

### 10. Calidad — ✅ COMPLETO
- [x] Cobertura reforzada en lógica crítica: `google-auth.service.ts` 23% → ~95%, casos de `auth.service.ts` (email inexistente, usuario sin password)
- [x] Confirmado: cero usos de `@Validate` con función inline en todo `src/` (solo clases `@ValidatorConstraint` reales)
- [x] Auditoría manual de guards en los 8 controllers + `app.controller`: públicos/JwtAuthGuard/admin coinciden exactamente con el spec, sin `APP_GUARD` global oculto, **cero hallazgos**
- [x] `test/full-customer-journey.e2e-spec.ts`: registro → login → menú → pedido → entrega → `totalSpent` → cupón automático → canje en segundo pedido → descuento aplicado — todo el flujo cruzando módulos
- [x] `docs/testing-checklist.md`: sección "Menu" que estaba huérfana bajo Users, corregida; una sección por módulo confirmada
- [x] Swagger: status codes de error confirmados en endpoints principales (agregado 400 faltante en `POST /auth/register`)
- [x] Extra: `ThrottlerGuard` agregado a `POST /auth/refresh` (consistencia con register/login/google)
- [x] Auditado por `@tester`: veredicto **GLOBAL LISTO** — 171 unit + 161 e2e, build/lint limpios

---

## Cómo trabajar con OpenCode

1. Abre el repo y ejecuta `opencode` en la raíz.
2. Usa el agente **`celtas-backend`** (Tab para cambiar de agente si es necesario).
3. Pide avanzar módulo por módulo siguiendo este checklist, por ejemplo:
   > "Vamos con el módulo 0, setup inicial del proyecto NestJS"
4. Al terminar cada módulo, `celtas-backend` invoca automáticamente a **`@tester`** para auditarlo
   contra `docs/testing-checklist.md` (tests unitarios, e2e, validaciones de negocio, seguridad).
   También puedes invocarlo tú manualmente en cualquier momento:
   > "@tester revisa el módulo de auth"
5. Solo se marca un módulo como completo en este checklist cuando `@tester` da veredicto **LISTO**.
   Si reporta fallos, se corrigen y se vuelve a auditar antes de avanzar al siguiente módulo.
6. La skill `nestjs-celtas` se carga automáticamente cuando el agente trabaja en entidades, DTOs o endpoints — ahí están las convenciones específicas del proyecto (ver `.opencode/skills/nestjs-celtas/SKILL.md`).
