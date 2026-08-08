# Celtas Backend

API del backend de la dark kitchen **Celtas** (fast food, solo delivery) en San Juan de
Miraflores, Lima. NestJS + TypeScript + PostgreSQL + TypeORM.

## Stack

- **NestJS 11** + TypeScript
- **PostgreSQL 17** (local vía docker-compose, producción en Supabase)
- **TypeORM** (migraciones, `synchronize` SIEMPRE apagado)
- Autenticación híbrida: email+password y Google OAuth (`password` nullable para usuarios Google)
- Checkout sin pago en la app: el pedido se guarda como `pendiente` y se redirige a WhatsApp
- Banners promocionales, cupones automáticos (umbral de gasto vía cron), notificaciones FCM

## Requisitos

- Node.js 20+
- pnpm
- Docker (para el Postgres local)

## Setup

```bash
# 1. Copia el .env de ejemplo y ajusta los valores
cp .env.example .env

# 2. Instala dependencias
pnpm install

# 3. Levanta el Postgres local (lee DB_* del .env)
docker compose up -d postgres
```

## Flujo de migraciones (OBLIGATORIO)

> **`synchronize` está apagado siempre, incluso en desarrollo.** El schema se gestiona solo
> por migraciones. Reactivar `synchronize` rompe la detección de diffs de `migration:generate`.

Cada vez que agregues o modifiques una entidad (columna, tabla, índice, FK, enum):

1. Modifica la entidad en código.
2. Genera la migración:

   ```bash
   pnpm run migration:generate src/migrations/NombreDescriptivo
   ```

3. **Revisa el archivo generado a mano** — nunca confíes ciegamente en el diff automático.
4. Aplica la migración localmente y prueba el cambio real:

   ```bash
   pnpm run migration:run
   pnpm run start:dev
   ```

5. Commitea la entidad **y** el archivo de migración juntos, en el mismo commit.
6. Al hacer `git push`, el deploy corre `migration:run` antes de arrancar la nueva versión.

Si `migration:generate` dice "No changes in database schema were found" después de un cambio
real de entidad, es señal de que `synchronize` se reactivó o de que la BD local no está al día
con las migraciones — resolvé esa inconsistencia antes de seguir.

### Nota sobre la BD local

La BD local de Docker fue creada originalmente con `synchronize`, así que tiene el schema pero
**no** tiene la tabla `migrations`. Para dejarla en el mismo "estado conocido" que producción:

1. Crear la tabla `migrations` (schema de TypeORM: `id` serial PK, `timestamp` bigint, `name` varchar).
2. Insertar la fila `('timestamp_de_InitialSchema', 'InitialSchema...')` para marcarla como ya ejecutada
   sin volver a correr su `CREATE TABLE`.

Después de eso, `pnpm run migration:generate` contra la BD local debe decir
"No changes in database schema were found" si no hay cambios de entidades pendientes.

## Scripts

```bash
pnpm run start:dev          # desarrollo con watch
pnpm run start:prod         # build de producción (node dist/main)
pnpm run build              # compila a dist/
pnpm run migration:generate # genera una migración desde el diff de entidades vs BD local
pnpm run migration:run      # aplica las migraciones pendientes
pnpm run migration:revert   # deshace la última migración aplicada
pnpm run test               # tests unitarios
pnpm run test:e2e           # tests e2e (con la BD local; si tu .env apunta a otro host,
                            # antepón los DB_* correctos al comando)
pnpm run lint               # eslint + prettier
```

## Swagger

Con la app corriendo:

- UI: `http://localhost:3000/docs`
- Spec JSON (consumido por Flutter): `http://localhost:3000/docs-json`

## Estructura

- `src/modules/<modulo>/` — cada módulo: `entities/`, `dto/`, `<modulo>.controller.ts`, `<modulo>.service.ts`, `<modulo>.module.ts`
- `src/migrations/` — migraciones de TypeORM
- `src/config/` — `configuration.ts` (lectura de env) y `validation.schema.ts` (validación Joi)
- `src/data-source.ts` — DataSource para el CLI de TypeORM (carga `.env` con dotenv)
- `test/` — tests e2e
