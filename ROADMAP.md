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

### 0. Setup inicial
- [x] Crear proyecto con `nest new celtas-backend --package-manager pnpm` (ya hecho)
- [x] Confirmar que existe `pnpm-lock.yaml` (no `package-lock.json` ni `yarn.lock`)
- [x] Configurar ESLint + Prettier
- [x] Instalar `@nestjs/config`, `@nestjs/typeorm` + `typeorm` + `pg`, `@nestjs/swagger` (+ `class-validator` / `class-transformer` para el ValidationPipe)
- [x] `docker compose up -d` para levantar PostgreSQL local (ver `docker-compose.yml` en la raíz)
- [x] Copiar `.env.example` a `.env` y ajustar `JWT_SECRET`/`JWT_REFRESH_SECRET`
- [x] Conectar TypeORM al PostgreSQL local vía `ConfigService` leyendo `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
- [x] Configurar `ValidationPipe` global + interceptor de respuesta + filtro de excepciones
- [x] Configurar Swagger en `/docs` (UI) y confirmar que el spec queda expuesto en `/docs-json` — el frontend lo va a leer directamente para probar los endpoints

### 1. Módulo Auth
- [ ] Entidad `User` (con `password` nullable, `provider`, `googleId`)
- [ ] Registro tradicional (email + password, hash con bcrypt)
- [ ] Login tradicional (retorna access + refresh JWT)
- [ ] Login con Google (verificación de `idToken`, crea usuario si no existe)
- [ ] Guard `JwtAuthGuard` y estrategia `Passport`
- [ ] Endpoint `refresh-token`
- [ ] Roles básicos: `cliente` / `admin`

### 2. Módulo Users
- [ ] CRUD de perfil (nombre, teléfono, direcciones)
- [ ] Campo `totalSpent` (usado por el módulo de cupones)
- [ ] Endpoint para historial de pedidos del usuario

### 3. Módulo Menu
- [ ] Entidad `Category` (Burgers, Chicken, Bebidas, etc.)
- [ ] Entidad `MenuItem` (nombre, descripción, precio, imagen, disponible)
- [ ] CRUD completo protegido para admin
- [ ] Endpoint público `GET /menu` optimizado para la app (agrupado por categoría)

### 4. Módulo Orders
- [ ] Entidad `Order` + `OrderItem`
- [ ] Endpoint `POST /orders` (crea pedido en estado `pendiente`)
- [ ] Estados: `pendiente` → `confirmado` → `en_camino` → `entregado` / `cancelado`
- [ ] Al pasar a `entregado`: sumar el monto a `user.totalSpent`
- [ ] Endpoint para listar pedidos (admin) y pedidos propios (cliente)
- [ ] Generar el texto/link de WhatsApp en el backend (para mantenerlo consistente) o dejarlo al frontend — **definir en el setup**

### 5. Módulo Coupons
- [ ] Entidad `Coupon` (código, tipo de descuento, monto/%, expiración, usado, userId)
- [ ] Cron job (`@nestjs/schedule`) que revisa usuarios que superaron el umbral (ej. S/50) desde el último cupón
- [ ] Endpoint para generación manual de cupones desde el panel admin (campañas)
- [ ] Endpoint de validación/canje de cupón al hacer un pedido

### 6. Módulo Banners
- [ ] Entidad `Banner` (imagen, título, link/acción, fechas, activo, orden)
- [ ] Endpoint `GET /banners/active` (público, consumido por la app)
- [ ] CRUD protegido para admin (subida de imagen vía Cloudinary)

### 7. Módulo Notifications
- [ ] Integración con Firebase Cloud Messaging
- [ ] Guardar `fcmToken` por usuario
- [ ] Servicio reutilizable `sendPushNotification(userId, payload)`
- [ ] Disparo automático: cupón generado, cambio de estado de pedido, banner nuevo

### 8. Panel Admin (endpoints)
- [ ] Guard de rol `admin` para todos los endpoints de gestión
- [ ] Dashboard: pedidos del día, ventas totales, productos más vendidos (endpoints de estadísticas)
- [ ] Endpoints ya cubiertos por los módulos de menú, banners y cupones

### 9. Deploy y DevOps
- [ ] Deploy backend en Render (free tier) — configurar Build Command `pnpm install && pnpm run build` y Start Command `pnpm run start:prod`
- [ ] Base de datos en Supabase/Neon (free tier)
- [ ] Variables de entorno configuradas en Render
- [ ] Migraciones automatizadas en el deploy

### 10. Calidad
- [ ] Tests unitarios de servicios críticos (`auth`, `coupons`, `orders`)
- [ ] Tests e2e de los endpoints principales
- [ ] Documentación Swagger completa y actualizada
- [ ] Todos los módulos auditados por `@tester` con veredicto LISTO (ver `docs/testing-checklist.md`)

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
