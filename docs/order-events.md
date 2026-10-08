# Eventos de pedidos: SSE + outbox, Fase 1B / Etapa 1

## Estado de verificación de esta entrega

Los mocks y el guard descartable están corregidos. La base local autorizada
`celtas_e2e_test_sse_20261008_01`, en PostgreSQL 17.11 mediante 127.0.0.1:5432,
tiene las 28 migraciones aplicadas. La suite de outbox pasó dos veces (7/7 casos
por corrida). La suite HTTP SSE pasó dos veces (8/8 casos por corrida), mediante
el runner y con PostgreSQL, JWT, guards y transporte HTTP reales. No se reportaron
handles abiertos. TypeScript, build y lint de los archivos nuevos también pasaron.

La suite HTTP usa un módulo Nest enfocado en el endpoint, no todo AppModule;
no valida el bootstrap completo, CORS ni el proxy de producción. Comprueba replay
de 12 eventos en orden numérico, payload permitido, autenticación, reset,
reconexión, expiración y revocación periódica. Solo los timers periódicos se
avanzan virtualmente; JWT, timeouts, sockets y PostgreSQL siguen siendo reales.
Ambas suites restauran el singleton y eliminan sus fixtures. El guard confirmó
`head=0`, `floor=0` y tablas de negocio vacías; la base se conserva. Estos resultados
no declaran SSE listo para producción ni validan todos los contratos REST.

## Activación y compatibilidad

La infraestructura está desactivada por defecto (`ORDER_EVENTS_ENABLED=false`).
No requiere cambios en Admin o Flutter. No cambia REST, payloads FCM ni polling.
Desactivada, no captura eventos ni abre conexiones LISTEN. El endpoint responde 503
después de autenticar y autorizar. No hay ejecución automática de migraciones.

Antes de activarla, aplicar mediante el procedimiento autorizado la migración
`OrderEventsOutbox1791500400000` exclusivamente en una base identificada como segura.
La migración agrega `order_events`, `order_event_state` e índices; no cambia tablas
de negocio, no hace backfill y es compatible con el backend anterior.

Declarar `ORDER_EVENTS_ENABLED=true` y `ORDER_EVENTS_LISTENER_MODE=direct` o `session`.
El modo declarado es una responsabilidad operativa: no usar pooling transaccional.
Por defecto LISTEN usa host/puerto/usuario/SSL de TypeORM y la misma base. Si el pool
principal es transaccional, configurar `ORDER_EVENTS_LISTENER_HOST`, `_PORT`,
`_USERNAME`, `_PASSWORD` para una conexión directa o de sesión. Base y SSL siguen
siendo los del DataSource. El listener verifica nombre de base, estado LISTEN y
UUID de identidad del outbox; nunca registrar credenciales.

## Persistencia y publicación

OrdersService inserta el evento con el EntityManager de la transacción del pedido:
creación, transición de estado, primera confirmación WhatsApp y vinculación.
WhatsApp adquiere ahora un lock de fila y conserva la primera fecha bajo concurrencia.
Pedidos anónimos también generan eventos; el retorno temprano de acciones de cliente
ocurre después de disparar publicación. FCM conserva su flujo post-commit existente.

La fila contiene UUID de evento, clave única de operación, tipo, UUID de pedido,
estado e instante. No almacena cliente, teléfono, dirección, importe o JWT.
No tiene FK al pedido: eliminar un pedido no destruye el historial de entrega.

El publicador usa una transacción distinta y un advisory lock transaccional común
entre instancias. Incrementa el cursor BIGINT bajo ese lock, desde el estado durable;
no usa una secuencia de las transacciones comerciales. Cursor y publicación se
confirman juntos. El orden representa publicación, no un orden cronológico absoluto
de las ventas. El cliente debe consultar REST para obtener el estado actual.

NOTIFY contiene solo el head del cursor y se emite dentro de la transacción del
publicador. Su entrega ocurre al confirmar esa transacción. Un error SQL de publicación
revierte cursores/publicación, conserva el evento pendiente y no revierte el pedido.
Hay un intento inmediato después del commit y un respaldo indexado cada 30 segundos,
compartido por instancia. Cada lote procesa hasta 100 eventos. Una caída entre commit
y disparo se recupera al iniciar otro publicador. Publicado no significa recibido por
todos los navegadores; replay/REST proporcionan recuperación.

Cada instancia abre un único pg.Client para LISTEN, fuera de transacciones largas;
los clientes SSE no consumen conexiones PostgreSQL adicionales permanentes.
Las instancias recuperan señales desde el historial, incluso si se pierde un NOTIFY.
Si el listener cae, los streams se cierran; la instancia reintenta cada cinco segundos.
El historial conserva aproximadamente 48 horas desde publicación, en limpieza por
lotes y prefijos de cursor. Nunca se elimina un evento aún no publicado.

## Contrato HTTP/SSE v1

`GET /admin/orders/events`, únicamente Bearer válido con expiración y rol actual admin.
No acepta parámetros de consulta. `Last-Event-ID` es opcional y contiene un entero
decimal no negativo, sin ceros iniciales y dentro del rango BIGINT.

```text
id: 1842
event: order.created
data: {"v":1,"eventId":"<uuid>","orderId":"<uuid>","status":"pendiente","occurredAt":"<ISO-8601>"}

```

Tipos comerciales: `order.created`, `order.status_changed`, `order.updated`.
El cursor es string en el wire; eventId identifica la alerta para deduplicación.
No es un snapshot. Todos los administradores autorizados comparten el ámbito global
de pedidos actual; clientes con rol cliente nunca acceden al stream.

Controles sin id: `stream.ready` (headCursor, floorCursor, recovery=rest),
`stream.reset` (cursor vencido/futuro, replay >100, transporte interrumpido),
`auth.expiring` (expiración o lease de 10 minutos), `access.revoked` (cambio de rol).
El heartbeat es `: heartbeat`; el inicio incluye `retry: 5000`.
Un reset cierra la conexión y requiere snapshot REST y nueva conexión sin cursor
obsoleto. Con cursor válido, se reproduce como máximo 100 eventos en orden.
Sin cursor no se alertan todos los pedidos históricos: obtener el snapshot REST.

Al conectar, registrar el stream, consultar REST y procesar las invalidaciones que
lleguen durante la consulta; repetir REST si quedó sucio. Guardar el head inicial
después de reconciliar y luego el último id procesado. Al reconectar siempre conciliar
REST. Deduplicar por eventId; un cliente FCM no debe avanzar el cursor SSE.
La etapa actual no implementa el consumidor frontend ni un nuevo snapshot REST.

## Recursos y seguridad

Límites por instancia: 40 streams; por administrador/instancia: 4 simultáneos y
12 aperturas/minuto. Rechazo 429 con Retry-After=30. No son cuotas globales entre
instancias; un límite global futuro necesitaría coordinación adicional.

Heartbeat cada 20 segundos sin SQL. Cola de escritura hasta 64 KiB; cliente bloqueado
10 segundos se destruye. Replay y buffer de inicialización limitados a 100 eventos.
Se respetan backpressure y drain, y se liberan timers/suscripciones al desconectar.
Las transacciones técnicas usan statement_timeout de cinco segundos.

La estrategia JWT existente comprueba firma/expiración y rol actual en la apertura.
Adjunta el exp verificado internamente; no cambia la respuesta REST. Comprobación de
roles agrupada cada minuto por instancia con deadline de cinco segundos; falla cerrado.
La democión no tiene efecto instantáneo en un stream ya abierto. La integración HTTP
comprobó que una solicitud nueva recibe 403 tras cambiar el rol en PostgreSQL, mientras
el stream existente todavía puede recibir eventos antes del siguiente control periódico.
Este cierra con `access.revoked`; la ventana depende del intervalo de 60 segundos,
el tiempo de consulta y la disponibilidad del event loop. Expiración tiene timer
propio y verificación antes de entregar eventos. Lease máximo de diez minutos obliga
a reconectar, reutilizando en el cliente el refresh actual. Logout debe abortar fetch;
no existe revocación general de access JWT en Backend. Una generación FCM no es una
sesión JWT. El stream no interpreta la revocación FCM como revocación de autenticación.

TransformInterceptor omite únicamente handlers marcados RawResponse; REST conserva
su envelope. Cabeceras: text/event-stream, no-cache/no-transform, X-Accel-Buffering=no.
CORS conserva la whitelist y reflexión de cabeceras existentes, compatible con
Authorization y Last-Event-ID. Verificar buffering y desconexión en el proxy real.

## Prueba local

No usar celtas_db ni una base con fixtures ajenos. Ambas suites SSE están restringidas
a la base local ya preparada `celtas_e2e_test_sse_20261008_01`. El runner exige
loopback, SSL desactivado y marca descartable. No mostrar credenciales ni cambiar
.env. Consultar docs/testing-checklist.md. En un proceso local aislado:

```powershell
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '5432'
$env:DB_DATABASE = 'celtas_e2e_test_sse_20261008_01'
$env:NODE_ENV = 'test'
$env:DB_SSL = 'false'
$env:ORDER_EVENTS_ENABLED = 'false'
pnpm run test:e2e:local run --runTestsByPath test/order-events.e2e-spec.ts --cacheDirectory '<carpeta_temporal_nueva_en_workspace>'
```

La suite activa dos servicios con DataSources/listeners independientes; comprueba
commit/rollback, caída previa a publicar, deduplicación, publicación concurrente,
orden de cursor con una transacción abierta anterior, fallo SQL inyectado, replay,
retención y fanout. Limpia solo sus fixtures y conserva la base. El runner utiliza
credenciales de proveedores inertes; no envía FCM real. Restaurar variables del proceso.
El guard exige exactamente el singleton inicial (`head=0`, `floor=0`) y
`order_events` vacía antes y después del run. Las suites SSE están restringidas
a `celtas_e2e_test_sse_20261008_01`; no ejecutar prepare nuevamente sobre esa base.
Para repetir la integración HTTP con la base ya preparada:

```powershell
pnpm run test:e2e:local run --runTestsByPath test/order-events-http.e2e-spec.ts --cacheDirectory '<carpeta_temporal_nueva_en_workspace>'
```

Para inspección manual, arrancar Backend solo contra esa base local migrada con flag
activo y modo direct. Usar una cuenta admin ficticia y access token obtenido localmente:

```powershell
curl.exe -N -H "Authorization: Bearer $env:SSE_TEST_ACCESS_TOKEN" http://127.0.0.1:3000/admin/orders/events
# Reconexión:
curl.exe -N -H "Authorization: Bearer $env:SSE_TEST_ACCESS_TOKEN" -H "Last-Event-ID: 1" http://127.0.0.1:3000/admin/orders/events
```

No persistir ni imprimir tokens. Probar pedidos ficticios con FCM simulado/inactivo.
Consultar order_events y order_event_state en la base seleccionada después de cada
escenario. JWT inexistente/expirado: 401; cliente: 403; query/cursor inválido: 400.

## Rollback y límites de la etapa

Desactivar ORDER_EVENTS_ENABLED y reiniciar por un procedimiento autorizado; volver
al código estable b6053655db2d3a78e7d0149c64642c2a5bc02aa0 usando el proceso habitual
de release. No resetear un checkout con cambios ni ejecutar migration:revert.
Conservar ambas tablas y la fila migrations: el código anterior las ignora. down()
rechaza explícitamente una eliminación destructiva. Mientras el flag está apagado
o corre código anterior, no se capturan eventos nuevos; restaurar mediante REST.

No retirar polling todavía. La eliminación de usuarios puede borrar pedidos por
cascada sin un evento de esta etapa. Quedan por validar proxy/Render Free, suspensión,
arranque frío, carga real, límites PostgreSQL/pooler y pruebas de navegador de la etapa 2.
Heartbeat no garantiza mantener despierto Render Free. La tabla durable permite
recuperación pero no disponibilidad continua ni entrega exactamente una vez.
