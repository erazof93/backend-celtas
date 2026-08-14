# ✅ Celtas Backend — Checklist de QA

Referencia usada por el agente `@tester`. Cada módulo del `ROADMAP.md` se considera "completo" solo
cuando pasa lo aplicable de este checklist.

---

## General (aplica a todo módulo)

- [ ] `pnpm run build` compila sin errores ni warnings de TypeScript
- [ ] `pnpm run test` pasa (tests unitarios del módulo)
- [ ] `pnpm run test:e2e` pasa (endpoints principales del módulo)
- [ ] DTOs rechazan payloads inválidos (campo faltante, tipo incorrecto, string vacío)
- [ ] Respuestas siguen el formato estándar `{ success, data, message }` / `{ success: false, message, statusCode }`
- [ ] Endpoints protegidos devuelven `401` sin token y `403` con rol incorrecto
- [ ] El endpoint está documentado en Swagger (`/docs`) con `@ApiOperation` y `@ApiResponse`
- [ ] Ningún endpoint expone campos sensibles (ej. `password`) en la respuesta

---

## Auth

- [ ] Registro tradicional exige `password`, `email` único
- [ ] Login tradicional falla (401) si el usuario tiene `provider: google`
- [ ] Login con Google verifica el `idToken` real contra Google (no confía ciegamente en el payload)
- [ ] Login con Google crea el usuario con `password: null` si no existía
- [ ] `refresh-token` genera un nuevo access token válido y rechaza tokens expirados/inválidos
- [ ] Passwords se guardan hasheadas (bcrypt), nunca en texto plano
- [ ] `POST /auth/google` verifica la audiencia del idToken contra `GOOGLE_CLIENT_ID` y exige `email_verified`
- [ ] `POST /auth/google` crea el usuario con `provider: google` y `password: null` si no existía
- [ ] `POST /auth/google` hace login directo si el `googleId` ya existe (no duplica cuentas)
- [ ] `POST /auth/google` rechaza con 409 si el email ya existe como cuenta local (no fusiona cuentas)
- [ ] Login tradicional rechaza cuentas `provider: google` (401)
- [ ] `POST /auth/google` devuelve 401 con idToken inválido y 400 con idToken vacío/faltante
- [ ] `POST /auth/google` tiene `ThrottlerGuard` (429) y está documentado en Swagger (200/401/409/429)

## Users

- [ ] Un usuario no puede leer/editar el perfil de otro usuario
- [ ] `totalSpent` no es editable directamente vía API pública (solo se actualiza desde `orders`)
- [ ] `PATCH /users/me` solo acepta `fullName` y `phone`; enviar `role`, `totalSpent`, `email` o `password` devuelve 400
- [ ] Un usuario no puede editar/borrar la dirección de otro usuario (403) y obtiene 404 si la dirección no existe
- [ ] `GET /users/me/addresses` devuelve solo las direcciones del usuario autenticado
- [ ] Solo una dirección puede ser `isDefault` a la vez para un usuario
- [ ] `GET /users` devuelve 403 para un usuario con rol `cliente` y la lista paginada sin password para un admin
- [x] `GET /users/:id/addresses` (admin): `401` sin token, `403` cliente, `404` si el usuario no existe, `400` si el id no es UUID, devuelve solo las direcciones de ese usuario (array vacío si no tiene)
- [x] `GET /users?sortBy&order` (admin, ranking por consumo): whitelist estricta vía `@IsEnum(UsersSortBy)` (solo `totalSpent`/`createdAt`) — cualquier otro valor, incluidos intentos de inyección de columna (`sortBy=password`, `sortBy=id); DROP TABLE users;--`), rechaza con 400 (nunca 500, nunca se cuela en el `ORDER BY` porque el valor ya pasó por el enum antes de llegar al `order: { [sortColumn]: direction }`); `order` inválido (no `asc`/`desc`) también 400
- [x] `sortBy=totalSpent` ordena correctamente asc y desc; sin `sortBy`/`order` el comportamiento previo (`createdAt DESC`, paginación) queda 100% intacto (test explícito de no-regresión)
- [ ] Endpoints protegidos devuelven 401 sin token

## Menu

- [ ] `GET /menu` público devuelve solo items `disponible: true` (o el flag correcto)
- [ ] Crear una categoría con nombre duplicado devuelve `409 Conflict` (no 500)
- [ ] Renombrar una categoría a un nombre ya usado devuelve `409`; conservar el mismo nombre no se considera duplicado
- [ ] CRUD de admin rechaza acceso sin rol `admin`
- [ ] Precio se valida como número positivo

## Orders

- [ ] El pedido se crea siempre en estado `pendiente`
- [ ] Transición de estados sigue el flujo válido (no se puede saltar de `pendiente` a `entregado` sin pasar por los intermedios, salvo que se decida lo contrario explícitamente)
- [ ] Al pasar a `entregado`, `totalSpent` del usuario se incrementa correctamente (verificar con un caso de prueba numérico)
- [ ] Un cliente solo puede ver sus propios pedidos; admin puede ver todos
- [x] `GET /orders?userId=X` (admin) filtra solo los pedidos de ese usuario; userId inexistente → lista vacía (200); userId malformado → 400; combinado con `status`; sin el param el comportamiento previo (paginación + status) queda intacto

## Coupons

- [x] El cron no genera cupones duplicados para el mismo ciclo de gasto
- [x] Todo cupón generado tiene `expiresAt` futuro
- [x] Un cupón usado (`usado: true`) no puede reutilizarse
- [x] Generación manual desde admin funciona igual que la automática (mismo servicio, distinto trigger)
- [x] Cancelar un pedido que canjeó un cupón reactiva el cupón (status `active`, `usedInOrderId`/`usedAt` null); el cupón reactivado puede reutilizarse en un pedido nuevo; `expiresAt` no se toca (si venció, se rechaza como expirado al usarse)
- [x] `GET /coupons?userId=X` (admin) filtra solo los cupones de ese usuario; userId inexistente → lista vacía (200); userId malformado → 400; sin el param el comportamiento previo (paginación + status) queda intacto
- [x] Descuento del cupón automático configurable vía `AUTO_COUPON_DISCOUNT_TYPE`/`AUTO_COUPON_DISCOUNT_VALUE` (opcionales, mismo patrón que `COUPON_THRESHOLD_AMOUNT`/`COUPON_EXPIRATION_DAYS`): sin configurar nada, `checkAndGenerateForUser` sigue generando exactamente 10% `percentage` (sin regresión, verificado con Joi aislado y con `coupons.service.spec.ts`); `Joi.when('AUTO_COUPON_DISCOUNT_TYPE', { is: 'percentage', then: max(100) })` bloquea el arranque con `AUTO_COUPON_DISCOUNT_VALUE > 100` y tipo `percentage`, pero permite `fixed_amount` sin tope; los 3 tests de regresión (`coupons.service.spec.ts` y `validation.schema.spec.ts`) fallan si se revierte el código correspondiente (confirmado con `git stash`)
- [ ] `minPurchaseAmount` opcional en generación manual (null = sin mínimo); `POST /coupons/validate` y el canje en `POST /orders` rechazan con 400 y mensaje exacto `Este cupón requiere un pedido mínimo de S/X.XX` si el subtotal es menor; subtotal igual al mínimo se acepta; sin subtotal no se valida el mínimo; `minPurchaseAmount = 0` se comporta como sin mínimo; cupones automáticos siempre con `minPurchaseAmount: null`
- [x] `POST /coupons/generate-bulk` (admin): genera un cupón individual (`code` único random) para CADA usuario `role: cliente`, excluye admins (`manager.find(User, { where: { role: UserRole.CLIENTE } } )` verificado); `campaignName` es solo una etiqueta compartida entre los cupones del lote, no reemplaza `code`
- [x] `POST /coupons/generate-bulk` corre dentro de `dataSource.transaction` y usa batch insert real (`manager.insert()` en chunks de 500), no un loop de `save()` uno por uno — verificado leyendo el código y confirmado con un test de regresión que falla si se revierte a filtrar sin `where: { role }` (ver `coupons.service.spec.ts`)
- [x] `expiresAt` opcional en `POST /coupons/generate` y `POST /coupons/generate-bulk`: si se indica, el cupón expira en la fecha EXACTA indicada (no aproximada); si se omite, se calcula automático (hoy + `COUPON_EXPIRATION_DAYS`)
- [x] Los cupones automáticos (`CouponsService.checkAndGenerateForUser`) no tienen ningún parámetro/ruta para `expiresAt`; su fecha siempre sale de `addDays(new Date(), expirationDays())`, sin tocar por el cambio de `generate`/`generate-bulk`
- [x] `POST /coupons/generate-bulk`: 401 sin token, 403 para rol cliente; `campaignName` requerido (400 si falta); `discountValue` porcentaje > 100 rechazado igual que en `generate`; `expiresAt` no-ISO rechazado con 400
- [x] `POST /coupons/generate-bulk` con 0 clientes en la BD devuelve `{ count: 0 }` sin intentar ningún `insert` (transacción no rompe)

## Banners

- [x] `GET /banners/active` respeta `startDate`/`endDate` y el flag `activo`
- [x] Orden de banners respeta el campo `order`
- [x] Subida de imagen falla de forma controlada si el archivo no es una imagen válida
- [x] Recurrencia por día de la semana (`daysOfWeek`, 0=domingo...6=sábado): `GET /banners/active` incluye banners cuyo array contiene el día actual calculado en `America/Lima` y excluye los que no lo contienen
- [x] `daysOfWeek` null o array vacío = todos los días (sin regresión sobre el comportamiento previo)
- [x] Las 3 condiciones (`active`, rango de fechas y `daysOfWeek`) son independientes y TODAS deben cumplirse: rango ok + día incorrecto → no aparece; día correcto + fuera de rango → no aparece
- [x] DTOs (create/update) validan `daysOfWeek`: array de enteros 0-6 → 400 para `[7]`, `[-1]`, `[1.5]` y para no-array (string)
- [x] PATCH parcial de `daysOfWeek`: edita solo el campo enviado; PATCH sin `daysOfWeek` conserva el valor existente (merge, sin `undefined`)
- [x] Migración `AddDaysOfWeekToBanners`: columna `integer[]` nullable verificada en `information_schema`, registrada en la tabla `migrations`

## Notifications

- [ ] Falla de FCM (token inválido/expirado) no rompe el flujo principal (pedido, cupón, etc.) — se loguea y continúa
- [ ] El token FCM se actualiza correctamente si el usuario cambia de dispositivo

## Admin / Dashboard

- [ ] `GET /admin/dashboard/summary` y `GET /admin/dashboard/top-products` devuelven `401` sin token y `403` con rol `cliente`
- [ ] `ordersCount` y `ordersByStatus` se cuentan por `createdAt` (fecha de creación del pedido)
- [ ] `revenue` y `top-products` se filtran por `deliveredAt` (entrega real), NO por `createdAt`
- [ ] `revenue` excluye pedidos `pendiente`/`cancelado`/`confirmado`/`en_camino` (sin `deliveredAt`)
- [ ] Un pedido creado ayer pero entregado hoy cuenta en las ventas de hoy
- [ ] El rango de fechas respeta la zona horaria de Lima (UTC-5): un pedido entregado a las 23:59 del día anterior NO cuenta en el día actual
- [ ] `top-products` agrupa por `menuItemId`, usa el nombre del snapshot (`MAX(name)`), suma `quantity` y `revenue`, ordena por cantidad descendente y respeta `limit` (1-50)
- [ ] `from` y `to` validan formato `YYYY-MM-DD` (400 si es inválido)
- [ ] `from > to` devuelve `400` con mensaje claro (no un resultado vacío silencioso)
- [ ] `limit` se valida como entero entre 1 y 50 (400 si está fuera de rango)
- [ ] `deliveredAt` se setea en `OrdersService.updateStatus` dentro de la transacción al pasar a `ENTREGADO`

---

## Reporte de auditoría (formato esperado del @tester)

```
## Auditoría: <nombre del módulo>

✅ Pasó:
- ...

❌ Falló:
- [archivo/endpoint] — descripción exacta del problema

⚠️ Riesgos / casos borde no cubiertos:
- ...

Veredicto: LISTO PARA MARCAR COMPLETO / PENDIENTE
```
## Config / Validación de variables de entorno

- [ ] `validation.schema.ts` declara TODAS las variables del `.env` con `.required()` (PORT, NODE_ENV, DB_*, JWT_*)
- [ ] `ConfigModule.forRoot({ validationSchema })` está conectado en `app.module.ts`
- [ ] La app FALLA al arrancar (error claro, no defaults silenciosos) si falta o está vacía una variable requerida
- [ ] `configuration.ts` NO tiene fallbacks `??` hardcodeados para las variables requeridas
- [x] `GOOGLE_CLIENT_ID` está en el schema como `.required()` (submódulo de Google de Auth ya implementado)
- [ ] `PORT`/`DB_PORT` validan como número de puerto; `NODE_ENV` solo `development`/`production`/`test`

## Settings

- [ ] `GET /settings/public` (sin auth) devuelve SOLO las keys de la whitelist (`whatsapp_business_number`); una key interna (ej. `secret_internal`) NO aparece
- [ ] `GET /settings` y `PATCH /settings` devuelven `401` sin token y `403` con rol `cliente`
- [ ] `PATCH /settings` hace upsert por key: crea si no existe, actualiza `value`/`description` si existe
- [ ] `PATCH /settings` valida `key` y `value` no vacíos (400 si faltan)
- [ ] `onModuleInit` siembra `whatsapp_business_number` al arrancar si no existe (desde `.env` o default `51999999999`)
- [ ] `getWhatsappNumber()` usa el valor de la tabla si existe; cae al `.env` con warning si la tabla está vacía; lanza si no hay ni tabla ni env
- [ ] Un pedido nuevo usa el número de la tabla (no el de `.env`) si ambos existen
- [ ] `WHATSAPP_BUSINESS_NUMBER` es opcional en `validation.schema.ts` y la app arranca sin ella (fallback a tabla)
- [ ] `PATCH /users/:id/role` (admin): `401` sin token, `403` cliente, `400` si el admin se quita su propio rol, `400` si el rol no es `cliente`/`admin`, `404` si el usuario no existe
