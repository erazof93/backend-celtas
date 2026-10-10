# Fase 7C.3A — preparación local del backend

## Resumen y veredicto

**PASS para las correcciones locales verificables de TLS y shutdown. NO-GO para
el primer push/despliegue hasta completar el checklist productivo.** No se ejecutó
ninguna operación sobre Render, Vercel o Supabase; tampoco commit ni push.

Se leyeron AGENTS.md, ROADMAP.md y documentación especializada de testing,
migraciones y SSE. La evidencia vigente prevalece sobre el roadmap histórico.

## Archivos y diseño TLS

- `src/config/postgres-tls.ts`: política compartida con verificación del servidor.
- `src/app.module.ts` y `src/data-source.ts`: consumen esa misma política.
- `src/config/validation.schema.ts`: admite `DB_SSL_CA_FILE` opcional.
- `.env.example`: documenta el archivo externo sin incluir certificados.
- `src/config/postgres-tls.spec.ts`: defaults, overrides, CA pública, configuración
  inválida y errores sin revelar contenido ni ruta.

SSL sigue activado por defecto con NODE_ENV=production y apagado en desarrollo/test.
DB_SSL acepta solo true/false; false conserva el override local explícito existente,
pero no se recomienda para producción. Cuando SSL está activo, siempre se construye
`rejectUnauthorized: true`; no se ofrece un override inseguro de verificación.

Sin DB_SSL_CA_FILE se utiliza la confianza de Node. Si el endpoint necesita una CA
propia, el operador debe montar un archivo PEM externo y proporcionar su ruta. Se
admiten bundles de certificados públicos; archivos ilegibles, vacíos, inválidos o
con material adicional se rechazan sin imprimir su contenido ni ruta. Proporcionar
una CA con SSL apagado también se rechaza. No se guardó ningún certificado real.

El listener hereda `options.ssl` del DataSource, incluidos CA y verificación. Host,
puerto y usuario pueden diferir mediante ORDER_EVENTS_LISTENER_*, pero la base y el
streamId deben coincidir. Si API y listener necesitan raíces diferentes, el bundle
debe incluir las CA pertinentes, aprobadas por el operador.

Supabase admite conexión directa o Session Pooler para sesiones persistentes.
Transaction Pooler no sirve para el listener LISTEN. Los tres tipos requieren
comprobar TLS contra su hostname real; no se inventó una CA, host ni topología.
La configuración estricta puede impedir el arranque si no se aprovisiona confianza
adecuada antes del despliegue: este es un bloqueo deliberado, no un motivo para
restaurar silenciosamente rejectUnauthorized=false.

Referencias oficiales consultadas:

- [Supabase: conexiones y SSL](https://supabase.com/docs/guides/database/connecting-to-postgres).
- [Supabase: SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).
- [Nest: lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events).

Además de TypeORM runtime/CLI y el listener, `scripts/e2e-local.cjs` construye clientes
pg exclusivamente locales con SSL apagado, protegidos por host/nombre/marcador de
base descartable. No se convirtió ese runner en una herramienta productiva.

## Shutdown

`src/main.ts` registra una vez `enableShutdownHooks([SIGTERM, SIGINT])`. No añade
manejadores de señales propios, timers de terminación forzada ni cambios del
contrato HTTP. Nest coordina los hooks y evita repetir el cierre cuando recibe
otra señal durante el mismo apagado.

Los servicios existentes cierran streams, cancelan heartbeats/revalidaciones,
detienen publicación/reintentos y terminan el listener. TypeORM y ScheduleModule
participan en el lifecycle de Nest. El cierre del servidor HTTP sucede después
de los hooks previos; solicitudes en curso pueden demorar el cierre. No se garantiza
todavía un presupuesto máximo de apagado para cargas lentas o red degradada.

Tests nuevos: `src/main.spec.ts` verifica registro único antes de listen;
`src/shutdown.spec.ts` prueba Nest close, herencia TLS, cancelación de trabajo
periódico y cierre idempotente de respuestas SSE y sus timers/listeners.

Una mejora opcional para hacer idempotente la invocación manual repetida de
OrderEventsService.onModuleDestroy no pudo escribirse: apply_patch devolvió
`Failed to write file D:\proyecto-celtas\backend-celtas\src\modules\orders\events\order-events.service.ts`.
También rechazó crear un test en esa carpeta. Se detuvieron esas operaciones;
no se cambió ACL, no se reemplazó ni renombró ningún archivo. El servicio quedó
intacto. Su cierre normal por Nest fue comprobado; invocaciones manuales repetidas
del hook del listener no quedan garantizadas por esta fase.

## Resultados ejecutados

| Verificación                              | Resultado                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Tests relacionados finales                | PASS: 50 tests, 6 suites                                                              |
| Suite unitaria completa                   | PASS: 1.023 tests, 52 suites, cero fallos                                             |
| TypeScript completo                       | PASS: salida 0                                                                        |
| Lint sin fixes                            | PASS: salida 0, sin advertencias                                                      |
| Build Nest                                | PASS: salida 0                                                                        |
| Prettier de archivos de esta fase         | PASS                                                                                  |
| git diff --check                          | PASS; avisos LF/CRLF sin errores de espacios                                          |
| Preparación PostgreSQL nueva              | PASS: 28 migraciones en base nueva aislada                                            |
| AppModule real y señal simulada duplicada | PASS: listener detenido, pool TypeORM cerrado, proceso terminó con salida 0           |
| SIGTERM real del sistema operativo/Render | NOT TESTED                                                                            |
| TLS contra Supabase real                  | NOT TESTED                                                                            |
| E2E antiguos SSE                          | BLOCKED: 15 tests, 2 suites; ejecución terminó con salida 1 por guards de nombre fijo |

Comandos ejecutados desde backend:

```powershell
pnpm exec jest --runInBand --runTestsByPath src/config/postgres-tls.spec.ts src/config/validation.schema.spec.ts src/main.spec.ts src/shutdown.spec.ts src/modules/orders/events/order-events-listener.spec.ts src/modules/orders/events/order-events-stream.service.spec.ts
pnpm exec jest --runInBand --json --outputFile=../phase7c3a-unit.json
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint "{src,apps,libs,test}/**/*.ts"
pnpm run build
git diff --check
```

Prettier se ejecutó únicamente sobre los archivos nuevos/modificados de esta fase.
No se utilizó el lint oficial con --fix sobre todo el repositorio.

Los fallos iniciales nuevos fueron de test CommonJS/import dinámico y tipos TLS/mocks,
corregidos antes de las verificaciones finales. Los logs de errores de proveedores
en la suite son escenarios mock de fallos; no indican contacto productivo.

Se preparó `celtas_e2e_test_phase7c3a_20261009` con el runner oficial. Los tests
order-events.e2e-spec.ts y order-events-http.e2e-spec.ts exigen el nombre histórico
`celtas_e2e_test_sse_20261008_01` y abortaron antes de sus escenarios. No se cambió
ese guard ni se reutilizó la base histórica. El runner verificó cleanup de 25 tablas
y restauró settings; la nueva base permanece para inspección, sin borrarla.

El probe temporal `.phase7c3a-shutdown.cjs`, fuera del repositorio, utilizó AppModule,
listener y PostgreSQL reales con proveedores inertes. Emitió dos eventos SIGTERM en
memoria del proceso hijo y comprobó el cierre; utilizó useProcessExit para terminar
el probe en Windows. Esto no equivale a una señal Linux real ni valida el proxy de
Render. No hubo streams HTTP activos en ese probe; su liberación se probó con mocks.

Recursos conservados: base nueva, reporte `phase7c3a-unit.json`, probe temporal y
artefactos dist. No quedan procesos de prueba activos ni nuevas cuentas de negocio.

## Autodeploy y migraciones

El propietario confirma Render Free, Vercel Free, Supabase Free y autodeploy al push.
UptimeRobot consulta /health cada 12 minutos. El monitor comprueba SELECT 1, no
listener ni backlog, y no constituye garantía de continuidad SSE.

No hay manifiesto Render ni configuración .github en este repositorio. Los scripts
build/start no ejecutan migraciones; migration:run es una operación separada.
El runner local sí llama runMigrations, solo durante prepare de una base nueva.
Runtime mantiene synchronize=false; SSE permanece false por defecto. La configuración
efectiva de build/start/pre-deploy y flags en el dashboard no pudo verificarse.

Hay 28 migraciones locales, aplicadas en esta base nueva; el estado Supabase es
desconocido. Destacan AddDeliveryZones1791244800000 (tabla y snapshot nullable),
FcmGenerations1791414000000 (tabla/columna de generaciones, down rechaza rollback),
OrderEventsOutbox1791500400000 (dos tablas, singleton e índices, down no operativo).
Delivery down elimina datos de zonas/snapshots. El outbox no añade triggers ni
modifica pedidos existentes. migration:run ejecuta todas las pendientes, no solo SSE.

Posteriormente, con autorización, obtener el registro migrations y el catálogo del
esquema mediante consultas de lectura revisadas; compararlos con el release exacto.
Revisar todas las pendientes, extensiones UUID y permisos. No marcar migraciones como
aplicadas sin acreditar equivalencia. Incluso conectar el CLI TypeORM puede intentar
instalar extensiones: no se usó migration:show como inspección productiva inocua.

## Checklist previo al primer push

1. Confirmar en Render el commit realmente desplegado, release estable y comandos
   efectivos; no asumir que HEAD local es el commit productivo.
2. Controlar autodeploy mediante una acción posterior autorizada o una ventana
   aprobada. Un push puede desplegar inmediatamente y ejecutar comandos del dashboard.
3. Confirmar endpoint Supabase, modo/puerto/hostname API y listener, IPv4/IPv6,
   certificados/CA, permisos y límites, sin publicar credenciales.
4. Ensayar verificación TLS contra un endpoint autorizado de preproducción; comprobar
   confianza y rechazo de certificados/hostname inválidos antes de producción.
5. Acreditar backup externo recuperable, fecha/retención, integridad y restauración
   en destino aislado; acordar RPO/RTO y responsable. Supabase Free no debe asumirse
   cubierto por los backups/PITR de planes de pago.
6. Obtener y aprobar el inventario exacto de pendientes y su impacto, incluyendo
   conversiones de fechas, actualizaciones de registros e índices no concurrentes.
7. Preparar primer backend con ORDER_EVENTS_ENABLED=false y frontend sin opt-in;
   comprobar que esta es la configuración efectiva, no solo el default del código.
8. Aprobar CORS del dominio administrativo, capacidad, health check y monitorización
   del listener/backlog para la activación posterior.
9. Ensayar SIGTERM real en Linux con streams, solicitudes lentas, timers y listener;
   confirmar finalización dentro del shutdown delay de Render.
10. Autorizar expresamente push/despliegue y, por separado, cualquier migración.

## Primer despliegue propuesto y rollback — no ejecutado

Tras autorización y cierre del checklist: preservar el commit/artefacto estable y
backup; ejecutar únicamente migraciones aprobadas mediante un solo ejecutor;
desplegar backend con SSE apagado; verificar /health, login, permisos y lecturas de
pedidos. Pruebas de escritura productiva requieren autorización adicional.

Ante regresión: volver al release estable mediante el procedimiento de Render
autorizado, conservar SSE apagado y verificar salud/autenticación/pedidos. Elegir
un release compatible con el esquema que quedó aplicado. Regresar el código no
revierte cambios de base ni variables efectivas del servicio. No usar migration:revert
como rollback automático; conservar outbox y generaciones FCM. No reintroducir una
política TLS insegura para resolver errores de confianza.

Si se requiere restauración: detener/coordinar escrituras, acordar pérdida de datos
posteriores al punto recuperable, restaurar mediante un responsable autorizado y
reconciliar pedidos antes de reabrir. Backup/restore no se ejecutaron en esta fase.

## Riesgos restantes

Render Free puede suspender o reemplazar instancias; los heartbeats no garantizan
que el servicio permanezca activo. UptimeRobot no elimina reinicios, cold starts,
fallos de TLS, pérdida del listener ni límites de recursos. Validar proxy y buffering.
Supabase Free exige confirmar conexiones disponibles, capacidad y backup externo;
un listener consume sesión persistente y debe presupuestarse junto al pool y otros
clientes. No hay evidencia productiva de TLS, migraciones, backup ni restauración.

7C.3A termina aquí. No iniciar 7C.3B ni desplegar automáticamente.
