# Celtas Backend

NestJS 11, TypeScript, PostgreSQL y TypeORM; usar **pnpm**. Monolito modular:
`src/modules/` contiene controllers, services, DTOs y entidades; `common/` reúne
utilidades transversales y `shared/` integraciones. Clientes: React y Flutter.

## Trabajo y reglas críticas

- Priorizar código, migraciones/configuración y tests sobre documentación antigua.
- Mantener contratos de API y patrones existentes; código en inglés, mensajes al usuario en español.
- Checkout actual: pedido pendiente y enlace de WhatsApp. No introducir pagos online sin decisión explícita.
- Preservar serialización de datos sensibles, guards, propiedad de recursos,
  snapshots históricos, transacciones e idempotencia.
- `synchronize` siempre false. Todo cambio de esquema requiere una migración
  revisada en `src/migrations/`; CLI en `src/data-source.ts`. Instantes: `timestamptz`.
- No añadir dependencias o abstracciones sin necesidad concreta. No modificar repositorios hermanos sin autorización.
- No hacer staging, commit, push, cambios de rama, descarte de cambios o deploy sin solicitud explícita.
- Respetar cambios del usuario. Reportar evidencia real y comprobaciones pendientes.

## Contexto y verificación

- Buscar archivos/símbolos con `rg`; leer solo lo necesario. No cargar todo `docs/`,
  el roadmap ni el historial por defecto. No se requieren skills o subagentes locales.
- Para código, ejecutar pruebas del área y ampliar según riesgo; consultar el checklist.
  Para documentación, revisar enlaces, coherencia y diff, sin arrancar la aplicación.
- `pnpm run lint` y `format` escriben; build genera `dist/`.
  Para lint sin correcciones: `pnpm exec eslint "{src,apps,libs,test}/**/*.ts"`.
- E2E y migraciones escriben datos: identificar una BD local/de prueba antes de ejecutarlos.
- Al terminar, resumir cambios, validación y límites. No declarar tests ejecutados por leer resultados históricos.

## Consultar según la tarea

- [README](README.md): setup y mapa del proyecto.
- [ROADMAP](ROADMAP.md): estado y próximos pendientes.
- [Convenciones](docs/backend-conventions.md): DTOs, PATCH, respuestas y fechas.
- [Negocio](docs/business-rules.md): comportamiento vigente por dominio.
- [Migraciones](docs/database-migrations.md): cambios de esquema y recuperación.
- [Testing](docs/testing-checklist.md): comandos, selección de pruebas y cierre.
- `docs/planning/`: propuestas; `docs/history/`: antecedentes, sin autoridad operativa.
