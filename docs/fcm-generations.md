# Generaciones FCM persistentes

## Contrato

PATCH `/users/me/fcm-token`: `{ fcmToken, generation? }`.
DELETE `/users/me/fcm-token`: sin body (legacy), `{ fcmToken }` (legacy
condicional), o `{ generation, fcmToken? }` (revocación persistente).
`generation` es UUID v4; el usuario se obtiene exclusivamente del JWT.
El envelope y el perfil serializado se conservan. Una generación revocada
devuelve 409 en PATCH; DELETE es idempotente.

La generación puede crearse en el primer PATCH o como marca revocada en un
DELETE anterior. No existe un endpoint que pueda reactivarla. DELETE con
generación revoca toda esa generación; el token opcional no limita la revocación.
Solo limpia el token asociado a esa generación, nunca el de otra generación.
Si el token pertenece al protocolo legacy (`fcmGeneration IS NULL`), puede
limpiarse únicamente cuando se proporciona y coincide el token exacto. Admin
no reutiliza marcas de registro de pestañas sin la versión 2 del protocolo;
primero debe confirmar PATCH con generación.

## Invariantes y concurrencia

Todas las operaciones con generación bloquean primero la fila del usuario con
`SELECT FOR UPDATE`, dentro de la misma transacción que crea/consulta/revoca la
generación y modifica el token. Si PATCH entra primero, DELETE limpia después;
si DELETE entra primero, PATCH se rechaza. La revocación persiste tras reinicios
y es compartida por todas las instancias. No se eliminan marcas de revocación.

Admin reutiliza su UUID compartido entre pestañas durante refresh y bootstrap;
el login explícito genera otro. DELETE se envía con credenciales salientes sin
esperar Web Locks ni Firebase. La limpieza del SDK sigue coordinada por el lock
y verifica propiedad antes de empezar. El timeout limita la espera del logout,
no cancela operaciones aceptadas por el servidor.

Esta garantía requiere que DELETE llegue y confirme en el servidor. Sin red y
con fallo del SDK no se puede prometer revocación remota. Los clientes legacy
conservan su contrato y no adquieren protección contra PATCH obsoletos sin
generación. El PATCH legacy desvincula la generación al reemplazar el token.
FCM sigue siendo single-device por usuario; no se cambia la autenticación.
Un DELETE solo con generación no puede identificar tokens legacy anteriores
a la migración; su limpieza depende del token exacto o de Firebase. Esa
limitación de transición no equivale a revocar tokens ya asociados a generación.

## Migración y publicación

`1791414000000-FcmGenerations.ts` añade `fcm_generations` (usuario, UUID y fecha
de revocación), con clave compuesta y FK con borrado en cascada al eliminar el
usuario; añade `users.fcmGeneration` nullable. No modifica datos existentes.
Los registros crecen con las sesiones revocadas: no añadir una purga sin un
protocolo que impida reutilizar IDs antiguos. No ejecutar esta migración sin
autorización. `synchronize` permanece false.

Publicar: autorizar y comprobar migración en PostgreSQL aislado; validar contratos
y carreras; aplicar migración autorizada; publicar Backend; verificarlo; publicar
Admin y recargar pestañas antiguas. Admin nuevo no debe usar Backend antiguo.

Reversión preferida: deshabilitar registro push en Admin conservando Backend y
esquema. Revertir a Admin legacy elimina la garantía. Backend antiguo puede
convivir con columnas adicionales, pero ignora revocaciones: no ejecutar clientes
con generaciones contra él. `down` rechaza el borrado automático de las marcas;
cualquier retirada del esquema exige revisión y autorización separadas.

## Pruebas PostgreSQL pendientes

En una base local desechable, tras autorizar explícitamente la migración y las
escrituras, usar dos conexiones/servidores con barreras controladas: PATCH bloqueado
antes del UPDATE, DELETE esperando el lock; invertir el orden; enviar PATCH tras
DELETE confirmado; comprobar revocación antes de la primera creación; comprobar
rollback y reintentos, un nuevo login con igual token, aislamiento entre usuarios
y coexistencia legacy. Verificar el perfil serializado, índices/FK y persistencia
tras reiniciar Backend. No sustituir esto por mocks de repositorio.
Después, usar Firebase de pruebas y navegador real para dos pestañas, navegación
al vencer los cinco segundos, desconexión, refresh y aviso sin Web Locks.

## Expectativa de regresión pendiente por acceso de escritura

El entorno rechazó escribir `src/modules/users/users-integrity.spec.ts` (EPERM).
Su expectativa exacta del PATCH legacy debe incluir `fcmGeneration: null`, porque
el reemplazo legacy desvincula atómicamente el token de su generación anterior.
En la rama `operation === 'token'`, el patch esperado es
`{ fcmToken: 'new-token', fcmGeneration: null }`; para `clearToken` sigue siendo
`{ fcmToken: null }`. No se debe eliminar la desvinculación para satisfacer un
mock antiguo. La suite no puede considerarse aprobada hasta actualizar esa
expectativa y repetirla. El escenario de desvinculación está cubierto además en
`fcm-generations.spec.ts`.
