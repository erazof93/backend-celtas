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
- [x] `GET /coupons?userId=X` (admin) filtra solo los cupones de ese usuario; userId inexistente → lista vacía (200); userId malformado → 400; sin el param el comportamiento previo (paginación + status) queda intacto

## Banners

- [ ] `GET /banners/active` respeta `startDate`/`endDate` y el flag `activo`
- [ ] Orden de banners respeta el campo `order`
- [ ] Subida de imagen falla de forma controlada si el archivo no es una imagen válida

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
