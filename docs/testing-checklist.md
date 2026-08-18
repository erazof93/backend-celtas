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

## Salsas/cremas (catálogo `Sauce` + selección por producto)

> Feature nueva (no estaba en el `ROADMAP.md` original): el cliente elige salsas al agregar un
> producto al carrito (mobile), el admin configura qué salsas ofrece cada producto (algunos, como
> arroz chaufa, no ofrecen ninguna), y el mensaje de WhatsApp las incluye por ítem.
>
> **Verificado por mí (esta sesión) contra el código real y una base de datos Postgres local real
> — NO por el subagente `@tester` del flujo habitual del proyecto.** Antes de marcar esto
> "completo" en `ROADMAP.md`, correr el pase real de `@tester` (build/lint/test + e2e +
> checklist), como exige la convención del proyecto.

- [x] `pnpm run build` compila sin errores
- [x] `pnpm run lint` sin errores (`eslint --fix`, sin warnings nuevos)
- [x] `pnpm run test`: 253/253 tests unitarios en verde (18 suites), incluye casos nuevos de
      `SaucesService`, `MenuService` (asignación/reemplazo/limpieza de `sauceIds`) y
      `OrdersService` (snapshot de salsas, validación de `sauceIds` contra las ofrecidas, mensaje
      de WhatsApp con/sin salsas)
- [x] Migración `AddSaucesCatalog` generada con `migration:generate` contra una BD Postgres real
      (no escrita a mano), revisada línea por línea, aplicada con `migration:run` contra un
      Postgres local real, y confirmada limpia (`migration:generate` posterior reporta "No
      changes in database schema were found")
- [x] **Bug real encontrado y corregido antes de aplicar la migración**: `src/data-source.ts` (el
      `DataSource` que usa el CLI de `typeorm migration:*`, fuera de Nest) declara la lista de
      entidades a mano — no tiene `autoLoadEntities` como el `AppModule` en runtime. La entidad
      `Sauce` nueva no estaba en esa lista; `migration:generate` fallaba con
      `Entity metadata for MenuItem#sauces was not found`. Corregido agregando `Sauce` al array
      `entities` de `data-source.ts`. Bug de clase a vigilar: **toda entidad nueva futura debe
      agregarse en los DOS lugares** (`app.module.ts` vía `autoLoadEntities` ya lo resuelve solo,
      pero `data-source.ts` no).
- [x] **Bug real encontrado y corregido con evidencia de la migración generada, antes de
      aplicarla**: la FK de la tabla de unión `menu_item_sauces.sauceId → sauces.id` quedó
      `ON DELETE NO ACTION` (default de TypeORM para el lado inverso de un `@JoinTable`; el lado
      dueño, `menuItemId → menu_items.id`, sí quedó `ON DELETE CASCADE`). Sin corregirlo,
      `DELETE /sauces/:id` habría devuelto `500` (violación de FK) para cualquier salsa todavía
      asignada a un producto, contradiciendo el diseño ("catálogo de etiquetas, sin bloqueo por
      uso"). Corregido en `SaucesService.remove()`: limpia primero las filas de
      `menu_item_sauces` para ese `sauceId` (`DELETE FROM menu_item_sauces WHERE "sauceId" = $1`)
      antes de borrar la salsa — verificado end-to-end contra el servidor real corriendo (ver
      abajo), no solo en el test unitario.
- [x] **Prueba real end-to-end contra el servidor corriendo (`pnpm run start:dev`) y Postgres
      local real**, vía `curl` (no simulado): admin real registrado y promovido, categoría real,
      2 salsas reales (Mayonesa, Mostaza), un producto CON esas 2 salsas asignadas
      (`sauceIds` en `POST /menu/items`) y un producto SIN ninguna (Arroz Chaufa):
      - `GET /menu` (público): el producto con salsas expone `sauces: [{id,name}]` (2 elementos);
        Arroz Chaufa expone `sauces: []` — nunca `undefined`, así el frontend no necesita un
        chequeo de nulidad especial para "sin selector".
      - `POST /orders` con `sauceIds` en un ítem y sin `sauceIds` en el otro: el `OrderItem` del
        primero guarda `selectedSauces: ["Mayonesa","Mostaza"]` (snapshot, no referencia); el
        segundo guarda `selectedSauces: null`.
      - El `whatsappUrl` decodificado real: `"2x Celtas Burguesa Clasica (Salsas: Mayonesa,
        Mostaza)"` en una línea y `"1x Arroz Chaufa"` en la otra, sin el sufijo `(Salsas: ...)`
        cuando el ítem no tiene ninguna.
      - `DELETE /sauces/:id` sobre una salsa todavía asignada a un producto: `200` (no `500`), y
        `GET /menu/items` confirma que el producto quedó con la salsa restante únicamente (la
        relación se limpió, el producto no se tocó de ninguna otra forma).
      - `POST /orders` con un `sauceId` que el producto NO ofrece (probado con la salsa de un
        producto distinto): `400` con mensaje real
        `"El producto \"Arroz Chaufa\" no ofrece la salsa seleccionada"` — nunca guarda una
        salsa inventada en el snapshot.
      - `GET /docs-json`: `/sauces` y `/sauces/{id}` documentados; `CreateOrderItemDto` incluye
        `sauceIds` en el schema.
- [x] `pnpm run test:e2e`: 241/241 en verde (12 suites) — la suite existente no tiene casos
      propios de `sauces` todavía (nada e2e cubre `/sauces` ni `sauceIds` en `POST /orders`), pero
      confirma cero regresiones en los endpoints ya existentes
- [ ] Agregar casos e2e propios de `sauces` (`POST/GET/PATCH/DELETE /sauces`, `sauceIds` en
      `POST /menu/items` y `POST /orders`) — hoy esa cobertura vive solo en unit tests +
      la verificación manual con curl de arriba
- [ ] Pase real de `@tester` (independiente, con mutación de al menos un fix para confirmar que
      los tests nuevos realmente fallan sin él — mismo patrón que el resto del proyecto)

### Refinamiento: tri-state real de `sauceIds` (`undefined` vs `[]` vs con ids)

> Pedido explícito del dueño del negocio: antes, `sauceIds` no enviado y `sauceIds: []` enviado
> explícito colapsaban al mismo `selectedSauces: null` — no se podía distinguir "el producto no
> ofrece salsas / el cliente nunca llegó al selector" de "el cliente vio el selector y eligió
> deliberadamente Sin salsas". Ahora es tri-state real. Base de la que dependen `celtas-admin`
> (mostrar "Sin salsas" en el detalle de pedido) y `celtas-app` (mandar `sauceIds: []` explícito
> desde el carrito), ambos ya en curso con el mismo criterio.
>
> **Auditado por `@tester` (pase independiente, con mutación real) — veredicto "LISTO" para este
> refinamiento puntual.**

- [x] `resolveSelectedSauces`: `undefined` → `null`; `[]` explícito → `[]` (nunca colapsado a
      `null`); con ids → nombres validados contra las salsas que el `MenuItem` ofrece (sin cambios
      en este caso). No hizo falta migración: `OrderItem.selectedSauces` ya era `text[]` nullable,
      un array vacío es un valor válido en esa columna, distinto de `NULL`.
- [x] `buildWhatsappUrl`: agrega `(Salsas: Sin salsas)` cuando `selectedSauces` es `[]` no-null;
      sigue sin sufijo solo cuando es `null`; sin cambios cuando trae nombres.
- [x] DTO (`CreateOrderItemDto.sauceIds`): confirmado que nunca tuvo `@ArrayNotEmpty` — `[]` ya
      pasaba la validación de `class-validator` antes de este cambio, sin tocar decoradores. Se
      actualizó `@ApiPropertyOptional({ description: ... })` para documentar el tri-state real
      (antes decía "omitido o vacío = sin salsas", ya no es exacto).
- [x] `pnpm test`: 255/255 en verde (18 suites), incluye 2 tests nuevos en
      `orders.service.spec.ts` (`sauceIds: []` → `selectedSauces` queda `[]` y `.not.toBeNull()`;
      el `whatsappUrl` decodificado contiene literal `"(Salsas: Sin salsas)"`) + el test
      preexistente de "sin sauceIds, el snapshot queda null" intacto y en verde.
- [x] `pnpm run build` y `pnpm run test:e2e` limpios (241/241, 12 suites) — cero regresiones.
- [x] **Verificación real end-to-end lado a lado** contra el servidor (`start:dev`) y Postgres
      local reales: dos `POST /orders` con el mismo ítem (mismo producto, misma salsa ofrecida),
      uno con `sauceIds: []` y otro sin el campo. El primero devolvió `selectedSauces: []` y el
      `whatsappUrl` decodificado contenía `"1x Burger QA Salsas (Salsas: Sin salsas)"`; el segundo
      devolvió `selectedSauces: null` y el mensaje quedó `"1x Burger QA Salsas"` sin ningún sufijo.
      Datos de prueba limpiados de la BD después.
- [x] **Mutación real ejecutada por `@tester`**: revirtió temporalmente el chequeo
      `if (item.sauceIds.length === 0) return [];` a `return null;` (el bug exacto que corrige
      este refinamiento — volver a colapsar `undefined` y `[]`). Con la mutación, los 2 tests
      nuevos fallaron exactamente como se esperaba (`selectedSauces` no era `[]`; el mensaje no
      contenía `"Sin salsas"`) y ningún otro de los 41 tests de `orders.service.spec.ts` se vio
      afectado — confirma que la cobertura nueva es real, no un test que pasaría igual con el bug
      de vuelta. Mutación revertida, suite completa vuelve a 255/255.
- [ ] Riesgos/casos borde anotados por `@tester`, no cubiertos todavía (bajo riesgo, no bloquean
      el veredicto "LISTO" de este refinamiento puntual): un mismo `POST /orders` con un ítem
      `sauceIds: []` y otro ítem sin el campo en la misma llamada (verificar que cada `OrderItem`
      mantenga su propio estado independiente); `sauceIds: []` en un producto que no ofrece
      ninguna salsa (`menuItem.sauces` vacío/`undefined`).

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

## Horario de atención (business hours)

> Backend como única fuente de verdad de si el local está "abierto". El bloqueo real ocurre SOLO
> en `POST /orders`; el cliente navega el menú libremente a cualquier hora. Reutiliza la tabla
> `settings` (sin migración nueva): `business_hours_schedule` (JSON por día, 0=domingo...6=sábado,
> mismas claves que `Banner.daysOfWeek`), `business_manual_closed` ("true"/"false"),
> `business_manual_closed_reason` (texto libre opcional). Lógica de zona horaria compartida con
> Banners en `src/common/utils/lima-time.util.ts` (`todayDayOfWeekInLima`, `currentMinutesInLima`).

- [x] `onModuleInit` siembra las 3 keys nuevas si no existen (horario default 11:00-23:00 entre
      semana, 11:00-01:00 viernes/sábado; `business_manual_closed` en `"false"`) — cubierto en
      `settings.service.spec.ts` y confirmado real vía e2e (`GET /settings` admin lista la key tras
      `onModuleInit` del `TestingModule`)
- [x] Las 3 keys nuevas aparecen en `GET /settings/public` (no son sensibles, mismo criterio que
      el número de WhatsApp) — test e2e nuevo agregado por `@tester`
      (`test/settings.e2e-spec.ts`, describe `GET /settings/public`)
- [x] `SettingsService.isOpenNow()`: dentro de horario normal (mismo día, sin cruce) → abierto
- [x] `isOpenNow()`: antes de abrir / después de cerrar (mismo día) → cerrado, mensaje con el
      horario de hoy
- [x] `isOpenNow()`: día marcado `closed: true` → cerrado con "Hoy no atendemos", sin importar la hora
- [x] `isOpenNow()` con horario que cruza medianoche (ej. viernes 11:00–01:00), las DOS mitades:
      antes de medianoche (viernes 23:30 → abierto), arrastre de madrugada (sábado 00:30 → abierto),
      y el caso límite "ya cerró la madrugada pero todavía no abre hoy" (sábado 02:00 → cerrado) —
      **verificado con mutación real por `@tester`**: (1) se comentó la rama de arrastre de
      madrugada → solo el test de "arrastre" falló; (2) se forzó `return false` en el tramo nocturno
      antes de medianoche → solo el test de "antes de medianoche" falló; (3) se forzó
      `isCarriedOverFromYesterday` a `return true` siempre → solo el test del caso límite
      "sábado 02:00" falló. En los tres casos, ningún otro test de la suite se vio afectado;
      mutaciones revertidas, suite vuelve a verde
- [x] `business_manual_closed: "true"` gana SIEMPRE sobre el horario programado, incluso en horario
      normal; el mensaje incluye el motivo (`: <motivo>`) solo si `business_manual_closed_reason`
      no está vacío — **verificado con mutación real por `@tester`**: se forzó
      `if (false && manual.closed)` en `isOpenNow()` (override deshabilitado); los 2 tests de
      override manual (con y sin motivo) fallaron como se esperaba, y también la contraparte e2e
      (`GET /settings/business-hours` y `POST /orders` dejaron de reflejar el cierre); mutación
      revertida, ambas suites vuelven a verde
- [x] `GET /settings/business-hours` (público, sin auth) devuelve `{ open, message, schedule,
      manualClosed }` reflejando el estado real — antes solo probado manualmente con `curl` por la
      sesión principal; `@tester` agregó cobertura e2e real y repetible en
      `test/settings.e2e-spec.ts` (describe `GET /settings/business-hours`): estado normal, activar
      cierre manual con motivo vía `PATCH /settings` y confirmar `open:false` + mensaje exacto
- [x] `POST /orders` con el local cerrado (manual o por horario) → `409` con el mensaje real de
      `isOpenNow()`, y el guard corta ANTES de tocar la base (no crea filas en `orders`/`order_items`,
      no valida items/dirección/cupón) — confirmado leyendo `OrdersService.create()`: `isOpenNow()`
      es la primera línea, antes de `resolveAddressSnapshot`/`buildItems` (los que tocan
      `addressesRepository`/`menuItemsRepository`); test unitario existente lo verifica con mocks
      (`addressesRepo.findOne` NO llamado) y `@tester` agregó el equivalente e2e con Postgres real
      (cuenta de filas en `orders` antes/después, sigue igual). **Verificado con mutación real**:
      se forzó `if (false && !businessHours.open)` (guard deshabilitado) → el test unitario y el
      test e2e nuevo fallaron ambos como se esperaba (201 en vez de 409); mutación revertida
- [x] `POST /orders` con el local abierto funciona exactamente igual que antes (no-regresión) —
      274/274 unitarios y 245/245 e2e en verde, incluye el resto de la suite de `orders` intacta
- [x] `banners.service.spec.ts` sigue pasando igual tras migrar `todayDayOfWeekInLima` al util
      compartido (mismo comportamiento, solo cambia de dónde viene la función) — confirmado:
      `banners.service.ts` importa `todayDayOfWeekInLima` desde
      `src/common/utils/lima-time.util.ts`, sin copia local; suite de banners (unit + e2e) en verde
- [ ] **Pendiente, fuera de este backend**: `celtas-admin` necesita el formulario de horario +
      interruptor manual en el panel; `celtas-app` necesita mostrar el 409 (y su mensaje) de forma
      clara en el checkout cuando el local está cerrado
- [ ] **Hallazgo de `@tester` (no bloqueante, pendiente)**: `POST /orders` en
      `orders.controller.ts` no documenta la respuesta `409` en Swagger (`@ApiResponse({ status: 409,
      ... })` ausente) — confirmado contra `GET /docs-json` real: solo aparecen 201/400/401/404.
      Ahora que el endpoint puede devolver 409 por local cerrado (y ya podía por conflictos de
      cupón), Swagger queda desactualizado. Corrección de una línea, no requiere lógica nueva.
- [ ] **Hallazgo de `@tester` (riesgo bajo, anotado, no bloqueante)**: `UpdateSettingDto.value`
      tiene `@IsNotEmpty()`, por lo que un admin NO puede usar `PATCH /settings` para volver
      `business_manual_closed_reason` a `""` real una vez que le puso un motivo — solo puede
      "vaciarlo" enviando un string de solo espacios (que `getManualClosedState()` normaliza a
      `null` vía `.trim()`). Funciona en la práctica pero puede sorprender a quien construya el
      formulario en `celtas-admin`; vale la pena documentarlo explícitamente para ese equipo o
      considerar relajar la validación para esta key específica.
