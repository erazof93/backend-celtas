# Celtas Backend

API de una dark kitchen de fast food en Lima, solo delivery. NestJS 11,
TypeScript, PostgreSQL y TypeORM. Clientes: panel React y aplicación Flutter.

## Desarrollo local

Requisitos: Node compatible con las dependencias instaladas (el README anterior
indicaba 20+; no hay engines/packageManager fijados), pnpm y Docker.

Desde PowerShell, para una instalación nueva:

```powershell
Copy-Item .env.example .env
# Ajustar valores locales y credenciales de integraciones antes de arrancar.
pnpm install
docker compose up -d postgres
pnpm run migration:run
pnpm run start:dev
```

No sobrescribir un .env existente. Identificar una BD local antes de ejecutar
migraciones o tests. El arranque valida variables con Joi; no subir secretos al repositorio.

Swagger con la aplicación levantada: [UI](http://localhost:3000/docs) y
[spec JSON](http://localhost:3000/docs-json). start:prod ejecuta node dist/main y
requiere un build previo; no aplica migraciones por sí mismo.

## Mapa del proyecto y documentación

- `src/modules/`: dominios, controllers, services, DTOs y entidades.
- `src/common/`: decoradores, guards, filtros, interceptores, validadores y utilidades.
- `src/shared/`: integraciones compartidas; `src/config/`: configuración validada.
- `src/data-source.ts` y `src/migrations/`: CLI y cambios de esquema.
- `src/**/*.spec.ts` y `test/`: unitarios y e2e.
- [AGENTS.md](AGENTS.md): instrucciones principales para Codex.
- [ROADMAP.md](ROADMAP.md): estado y prioridades actuales.
- [Convenciones](docs/backend-conventions.md), [negocio](docs/business-rules.md),
  [migraciones](docs/database-migrations.md) y [testing](docs/testing-checklist.md): consultar por tarea.
- `docs/planning/`: propuestas; `docs/history/`: antecedentes sin autoridad operativa.

Los scripts y sus argumentos están en package.json. `pnpm run lint` lleva --fix;
el comando sin correcciones y la selección de pruebas están en el checklist.
Para cambiar el esquema consultar el procedimiento de migraciones; synchronize
permanece desactivado en todos los entornos.
