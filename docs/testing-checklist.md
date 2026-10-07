# Estrategia de testing y cierre

Consultar según el cambio. Tests existentes: casos ejecutables;
[qa-audits.md](history/qa-audits.md): resultados históricos, no evidencia actual.

## Selección de verificación

| Cambio | Verificación mínima aplicable |
|---|---|
| Documentación/instrucciones | Enlaces, comandos, coherencia con código y diff; no arrancar servicios |
| Utilidad o servicio | Unitarios afectados y regresión del comportamiento cambiado |
| DTO o contrato HTTP | Validación y e2e afectados; Swagger, status y envelope |
| Auth, roles o bootstrap | Seguridad y endpoints afectados; ampliar e2e por impacto transversal |
| Pedidos, cupones o premios | Flujo, transacciones, idempotencia y efectos después del commit |
| Esquema | Migración aplicada en BD de prueba, datos preservados y e2e pertinentes |
| Fechas/reportes | Bordes y suites afectadas en TZ=UTC y TZ=America/Lima |

Para cambios TypeScript funcionales incluir build y lint sin correcciones.
Ampliar a suites completas para cambios de varios dominios, configuración global
o esquema. No repetir corridas sin cambios o una incertidumbre concreta.

## Comandos vigentes

Desde la raíz con dependencias instaladas:

```powershell
pnpm run build
pnpm exec eslint "{src,apps,libs,test}/**/*.ts"
pnpm run test -- --runInBand --runTestsByPath src/modules/orders/orders.service.spec.ts
pnpm run test:e2e:local run --runTestsByPath test/orders.e2e-spec.ts
# Suites completas cuando corresponda:
pnpm run test -- --runInBand
pnpm run test:e2e:local run
```

Build escribe dist y archivos de compilación. Jest puede escribir caché;
cobertura escribe coverage. `pnpm run lint` lleva --fix y `format` reformatea:
no utilizarlos para revisiones sin modificaciones.
En PowerShell, guardar/restaurar `$env:TZ` al probar UTC y America/Lima;
no cambiar archivos .env para ello.

## E2E: datos y entorno

### Procedimiento local reproducible (incluye Phase1A/B/C/D)

Requisitos: dependencias instaladas con pnpm, Node con `util.parseEnv` (20.12+
o 22+), PostgreSQL local y un usuario local autorizado para crear bases.
No requiere credenciales reales de Firebase, Google, Cloudinary o Geoapify:
el runner usa valores inertes y secretos JWT efímeros solo en su proceso.
No modifica `.env`. Los tests de proveedores usan sus mocks/overrides existentes.

Variables de conexión requeridas: `DB_HOST`, `DB_PORT`, `DB_USERNAME`,
`DB_PASSWORD`. Se toman del proceso, con fallback al `.env` local existente.
El host debe ser loopback (`127.0.0.1`, `localhost` o `::1`). No usar túneles
o proxies a servidores remotos. `DB_DATABASE` se exige en el proceso y **nunca**
se toma de `.env`; debe cumplir `celtas_e2e_test_[a-z0-9_]+`.

Ejemplo PowerShell, eligiendo un nombre NUEVO y sin escribir credenciales:

```powershell
$env:DB_DATABASE = 'celtas_e2e_test_ejecucion_nueva'
pnpm run test:e2e:local prepare
pnpm run test:e2e:local run
# Selección opcional:
pnpm run test:e2e:local run --runTestsByPath test/phase1c-concurrency.e2e-spec.ts
Remove-Item Env:DB_DATABASE
```

`prepare` muestra el destino, rechaza una base existente, crea exclusivamente
la base seleccionada, la marca como descartable, aplica las migraciones vigentes
mediante `AppDataSource.runMigrations()` y ejecuta los seeds de la aplicación.
No genera migraciones. No ejecutar `migration:run` sobre otra base para este flujo.
Si la preparación falla, revisar la base parcialmente preparada; no reutilizarla
automáticamente ni cambiarle la marca para eludir los guards.

`run` y el globalSetup de Jest verifican antes de escribir: entorno test, host
local, SSL desactivado, nombre permitido, identidad real, marca de preparación,
cero migraciones pendientes y tablas de negocio vacías. Solo se permiten settings
y el catálogo inicial intacto de tipos de papas. Un advisory lock de sesión
impide ejecutar dos runners sobre la misma base simultáneamente.

**Los E2E realizan cleanup destructivo**, incluido borrado completo de zonas en
Phase1B. Nunca usar `celtas_db`, bases de producción, bases manuales, ni bases con
fixtures que deban conservarse. Las bases históricas Phase1A/B/C y Delivery manual
no cumplen esta convención. No arrancar otro backend ni ejecutar clientes sobre
la base descartable durante las pruebas.

Las suites eliminan sus fixtures y el guard final compara conteos. El runner
restaura todos los settings iniciales (incluidos id y timestamps), comprueba que
no quedaron filas de negocio y conserva la DB para inspección; no la borra.
Una corrida limpia permite repetir `run`; si quedan fixtures, aborta antes de
otra corrida. El runner no elimina automáticamente esos restos para esconder fallos.

`pnpm run test:e2e` permanece como entrada directa a Jest, con los mismos guards
globales; usar preferentemente `test:e2e:local` para preparar entorno y restaurar
settings. Los unitarios no necesitan PostgreSQL: `pnpm run test -- --runInBand`.

- AppModule, Supertest y PostgreSQL real. Identificar DB_HOST/DB_DATABASE de una
  BD local/de prueba, sin exponer secretos; nunca ejecutar contra producción.
- Evitar escrituras concurrentes de backend/app en esa BD. maxWorkers=1
  serializa suites, no procesos externos.
- Conservar afterAll y snapshots/restauraciones de settings y horarios.
- globalSetup/globalTeardown comparan conteos: no detectan cambios de valores
  con igual cantidad de filas. Restaurar valores explícitamente.
- AppModule puede sembrar settings y registrar cron/integraciones; revisar
  overrides y limpieza antes de correr la suite.
- Overrides de guards no prueban su comportamiento real. No desactivarlos para
  hacer pasar pruebas de seguridad.

## Regresión y cierre

- Observar comportamiento público y distinguir el fallo anterior del esperado;
  evitar tests que solo repliquen la implementación.
- Cubrir omitidos/null/vacíos, límites y combinaciones pertinentes.
- Verificar envelope, códigos HTTP, español, ausencia de password y propiedad.
- Preservar snapshots, totales, transiciones y no duplicación de beneficios.
- Revisar Swagger si cambia el contrato; consultar el dominio pertinente de
  [business-rules.md](business-rules.md) para criterios específicos.
- Mutaciones temporales no son requisito habitual: solo con alcance autorizado
  y evidencia adicional que lo justifique.
- Cierre: diff acotado, comprobaciones aplicables aprobadas, documentación vigente
  y límites explícitos. Sin comprobaciones críticas, indicar “validación pendiente”.
- No marcar funcionalidades verificadas usando resultados históricos.
  No se exige auditoría de subagentes.
