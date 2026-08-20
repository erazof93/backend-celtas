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

## Comentario libre por ítem (`OrderItem.comment`)

> Feature nueva: el cliente puede escribir una nota libre opcional por ítem del pedido (ej. "sin
> cebolla", "bien cocida"), se guarda como snapshot en `OrderItem.comment` (`varchar(140)`,
> nullable) y aparece en el mensaje de WhatsApp como `— Nota: <texto>`. A diferencia de
> `sauceIds`/`selectedSauces` (tri-state real `undefined`/`[]`/con valores), este campo es texto
> libre simple: `undefined`, `''` y `'   '` colapsan igual a `null` (sin distinguir "no aplica" de
> "elegido vacío a propósito" — no aplica ese matiz a texto libre).
>
> **Auditado por `@tester` (pase independiente, con mutación real) — veredicto "LISTO".**

- [x] `pnpm run build` compila sin errores
- [x] `pnpm run lint` sin errores (`eslint --fix`, sin warnings nuevos)
- [x] `pnpm run test`: 303/303 tests unitarios en verde (19 suites), incluye `comment` presente
      (persistido y visible como `— Nota: ...` en el whatsappUrl), ausente/vacío/solo-espacios
      (parametrizado con `it.each`, colapsa a `null`, sin "Nota:" en el mensaje) y el trim antes de
      guardar (`orders.service.spec.ts`)
- [x] `pnpm run test:e2e`: 261/261 en verde (12 suites) contra Postgres local real, incluye los
      mismos 3 casos vía `POST /orders` real + 3 casos nuevos agregados en esta auditoría (antes no
      existían): comment de exactamente 140 caracteres (límite inclusive, debe aceptar), comment de
      141 caracteres (400, ya existía), comment con tipo incorrecto (número en vez de string, 400)
      — `test/orders.e2e-spec.ts`
- [x] Migración `AddCommentToOrderItems1787182448563`: `ALTER TABLE "order_items" ADD "comment"
      character varying(140)`, sin `NOT NULL`. Verificada independientemente contra Postgres local
      real (`\d order_items` vía `docker exec`): columna `character varying(140)`, nullable.
      Registrada en la tabla `migrations` (confirmado con `SELECT name FROM migrations ORDER BY id
      DESC`).
- [x] `resolveComment` (el punto más frágil): trimea y colapsa a `null` si el resultado queda
      vacío. **Verificado con mutación real por `@tester`**: se reemplazó
      `const trimmed = item.comment?.trim(); return trimmed ? trimmed : null;` por
      `return item.comment ?? null;` (quita el trim y la normalización de vacío/espacios). Rompió
      exactamente los 3 tests esperados (`comment vacío → null`, `comment solo espacios → null`,
      `el comment se trimea antes de guardarse`) y ningún otro de los 48 tests de
      `orders.service.spec.ts` (45/48 en verde con la mutación). El caso `comment` ausente
      (`undefined`) no se rompió con esta mutación puntual (`undefined ?? null` sigue dando
      `null`), lo cual es coherente: esa mutación específica solo ataca el trim/colapso de string
      vacío, no el caso `undefined`. Mutación revertida, `git diff --stat` confirma el archivo
      idéntico al estado previo a la mutación, suite vuelve a 303/303 (unit) y 261/261 (e2e).
- [x] `buildWhatsappUrl`: agrega ` — Nota: <texto>` al final de la línea del ítem SOLO cuando
      `comment !== null`; sin sufijo cuando es `null` — cubierto en unit y e2e (mensaje decodificado
      real, no solo el string crudo con `%20`/`%C2%A0` sin decodificar)
- [x] `CreateOrderItemDto.comment`: `@IsOptional() @IsString() @MaxLength(140)` — 141 caracteres
      rechaza con 400 (ya existía); **agregado por `@tester`**: exactamente 140 caracteres acepta
      (límite inclusive, antes sin cobertura — riesgo real de un off-by-one no detectado si alguien
      cambia `MaxLength(140)` a `MaxLength(139)` por error) y un tipo incorrecto (número en vez de
      string) rechaza con 400, confirmando que `@IsString` no es redundante con `@MaxLength`
- [x] `POST /orders` expone `comment` en cada item de la respuesta (confirmado leyendo
      `findMyOrders`/`findAll`/`findOne`: los tres usan `relations: { items: true }` sin ningún
      `select` parcial que excluya columnas, así que `comment` viaja igual en los tres endpoints de
      listado/detalle, no solo en la respuesta de creación)
- [x] `@ApiPropertyOptional` en el DTO documenta el campo (`Comentario libre opcional para este
      ítem... Vacío o solo espacios se trata como ausente`) — visible en Swagger
- [x] Seguridad: `comment` no es un campo sensible, no aplica chequeo de exposición de `password`
      aquí (el módulo Orders no expone usuarios completos en la respuesta, solo `userId`)
- ⚠️ Riesgo/caso borde no cubierto (bajo riesgo, no bloqueante): no hay test que verifique el
      comportamiento cuando el mismo `POST /orders` trae varios ítems, cada uno con su propio
      `comment` independiente (uno con nota, otro sin, otro con solo espacios) — la lógica es
      per-ítem (`buildItems` llama `resolveComment(item)` dentro del loop, sin estado compartido
      entre ítems), así que no debería fallar, pero no está ejercitado explícitamente con más de un
      ítem con `comment` en la misma llamada.
- ⚠️ Riesgo/caso borde no cubierto (bajo riesgo, no bloqueante): no hay test de caracteres
      especiales/unicode en `comment` (emojis, saltos de línea, comillas) — relevante porque el
      valor viaja dentro de `encodeURIComponent` en el link de WhatsApp; en teoría
      `encodeURIComponent` maneja cualquier string de forma segura, pero no está verificado con un
      caso real (ej. `comment: 'Sin cebolla 🧅, "bien cocida"'`).

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
- [x] `broadcastPushNotification` envía solo a usuarios con `fcmToken` (no `NULL`); sin ninguno →
      `{ sent: 0, total: 0 }` sin llamar a FCM — `notifications.service.spec.ts`
- [x] `broadcastPushNotification` cuenta `sent`/`total` correctamente cuando algún token individual
      falla (token inválido/expirado) — el fallo de uno no frena el envío a los demás —
      `notifications.service.spec.ts`
- [x] `broadcastPushNotification` divide en lotes de máximo 500 tokens por llamada a
      `sendEachForMulticast` (límite de FCM); si un lote completo falla (ej. error de red), no
      rompe hacia el caller y los lotes siguientes se intentan igual (mismo contrato "nunca lanza"
      que `sendPushNotification`) — `notifications.service.spec.ts`, verificado también en e2e
      real (`FirebaseAppError: Failed to parse private key` logueado, `PATCH /settings` sigue
      devolviendo 200)

### Fix: limpiar `fcmToken` cuando Firebase devuelve `messaging/registration-token-not-registered`

> Commit `eb46fd0` (aplicado vía `git am` desde una sesión externa de Cowork). Cubre el caso de un
> `fcmToken` restaurado por Android Auto Backup que Firebase ya descartó, evitando reintentos
> inútiles. `sendPushNotification` y `broadcastPushNotification` limpian `fcmToken = null` SOLO
> cuando el código de error es exactamente `messaging/registration-token-not-registered`;
> cualquier otro error (red, backend caído) no toca el token. En `broadcastPushNotification` el
> par `(userId, token)` ahora se arma junto desde el inicio en vez de dos arrays paralelos.
>
> **Auditado por `@tester` (pase independiente, con mutación real y prueba de contrato adicional
> propia) — veredicto original "NO LISTO" por el hallazgo ❌ de abajo (contrato "nunca lanza" roto
> en la limpieza de `fcmToken`). Corregido en el commit de seguimiento `995f8ba` ("fix(notifications):
> envolver la limpieza de fcmToken en try/catch propio") y reverificado de forma independiente por
> `@tester` — ver bloque "Reverificación `995f8ba`" al final de esta sección. Veredicto final: LISTO.**

- [x] `pnpm run build` compila sin errores; `npx tsc --noEmit` sin errores nuevos en archivos de
      este módulo (los 14 preexistentes en otros módulos no se tocan)
- [x] `pnpm run lint` limpio (exit 0)
- [x] `pnpm test`: 307/307 en verde (19 suites); `notifications.service.spec.ts` en aislamiento:
      16/16 (12 preexistentes + 4 nuevos)
- [x] `pnpm run test:e2e`: 261/261 en verde (12 suites); `notifications.e2e-spec.ts` en
      aislamiento: 17/17
- [x] Los 4 tests nuevos cubren: `sendPushNotification` limpia en `UNREGISTERED` / no limpia en
      error transitorio; `broadcastPushNotification` limpia SOLO el token que falló con
      `UNREGISTERED` (usuario del medio de 3, `u2`) sin tocar los otros dos / no limpia en error
      transitorio
- [x] **`batch[index]` sigue siendo un índice válido tras el cambio de estructura de datos**:
      `entries` (con `{userId, token}`) reemplaza a los dos arrays paralelos previos, y
      `tokens: batch.map((entry) => entry.token)` preserva el mismo orden que `batch`, así que
      `response.responses[index]` (garantizado por el contrato de `sendEachForMulticast` de estar
      en el mismo orden que el array de `tokens` de entrada) sigue correspondiendo al mismo
      `batch[index]`. **Verificado con mutación real por `@tester`**: se cambió
      `staleUserIds.push(batch[index].userId)` por `staleUserIds.push(batch[0].userId)` (simula
      una desalineación de índice) sobre el caso de 3 usuarios (`u1` éxito, `u2` falla con
      `UNREGISTERED`, `u3` éxito) — rompió exactamente el test que espera que se limpie `u2` (no
      `u1`) y ningún otro (15/16 en verde). Mutación revertida, `git diff --stat` confirma el
      archivo idéntico al estado previo, suite vuelve a 16/16.
- [x] Mutación de regresión sobre `sendPushNotification`: se deshabilitó la limpieza
      (`if (false && err.code === ...)`) — rompió exactamente el test "limpia en UNREGISTERED" y
      ningún otro (15/16). Mutación revertida.
- [x] **(RESUELTO en `995f8ba`) Contrato "NUNCA lanza excepción"**: originalmente roto porque
      `await this.usersRepository.update(...)` (limpieza de token stale) no estaba envuelto en su
      propio `try/catch` en ninguno de los dos métodos — ver detalle histórico del hallazgo y el
      impacto concreto (`SettingsService.notifyBusinessHoursChange()` → `PATCH /settings` habría
      devuelto `500`) en el bloque "Reverificación `995f8ba`" más abajo, donde quedó confirmado
      resuelto de forma independiente.
- [ ] No existe (ni antes ni después de este fix) un test que cubra explícitamente "usuario sin
      `fcmToken`" en el mismo archivo para el flujo de limpieza (sí existe cobertura general de
      "sin token, no llama a FCM" en la suite preexistente, pero no se re-verificó como parte de
      esta auditoría puntual del fix)
- ⚠️ No hay test de "batch con múltiples tokens `UNREGISTERED` a la vez" (solo se cubre 1 de 3) —
      riesgo bajo: la lógica es un `forEach` que empuja independientemente por índice, sin estado
      compartido entre iteraciones, así que no debería fallar, pero no está ejercitado
      explícitamente con más de un token stale en el mismo lote.
- ⚠️ No hay test de "error a nivel de lote completo" combinado con tokens `UNREGISTERED` en el
      mismo `broadcastPushNotification` (dos lotes, uno falla completo por red y otro tiene un
      `UNREGISTERED` individual) — cobertura indirecta por los tests existentes de cada caso por
      separado, pero no combinados.

**Veredicto original (auditoría de `eb46fd0`): NO LISTO.** Bloqueante: el hallazgo de contrato
"nunca lanza" roto arriba (❌) debía corregirse (try/catch propio alrededor de la limpieza de
`fcmToken`) y volver a auditarse antes de marcar este fix como completo en `ROADMAP.md`. Todo lo
demás (build, lint, tsc, unit, e2e, cobertura de los 4 tests nuevos, alineación de índices en el
batch) había pasado de forma independiente.

#### Reverificación `995f8ba` — "fix(notifications): envolver la limpieza de fcmToken en try/catch propio"

> Segundo pase, focalizado en el hallazgo puntual de arriba (no se reaudita el módulo completo).

- [x] Leído `notifications.service.ts` actual: `sendPushNotification` (líneas ~114-121) y
      `broadcastPushNotification` (líneas ~192-199) tienen cada uno su propio `try { await
      this.usersRepository.update(...) } catch (cleanupErr) { this.logger.error(...) }` alrededor
      exclusivamente de la limpieza de `fcmToken`; el `return` normal (`false` / `{ sent, total }`)
      queda fuera de ese catch interno y se sigue ejecutando igual que si la limpieza hubiera
      tenido éxito.
- [x] 2 tests nuevos en `notifications.service.spec.ts` (líneas 174-192 y 358-385), uno por
      método, mockeando `usersRepo.update.mockRejectedValue(new Error('timeout de BD'))` y
      verificando que el resultado sigue siendo `false` / `{ sent, total }` sin que el `await`
      del test rechace. Corridos en aislamiento: `notifications.service.spec.ts` → 18/18 en verde.
- [x] **Mutation testing independiente**: se revirtieron temporalmente ambos try/catch internos
      (dejando el `await this.usersRepository.update(...)` desnudo, como estaba en `eb46fd0`) y se
      corrió la suite — resultado: **2 failed, 16 passed** (exactamente los 2 tests nuevos de este
      fix fallan, ninguno de los 16 restantes se ve afectado), confirmando que ambos tests
      detectan una reversión real del fix y no son falsos positivos. Cambio revertido con `cp`
      desde un backup temporal (no commiteado); `notifications.service.ts` vuelve a quedar
      idéntico al estado de `995f8ba` (confirmado con `git status --short` sin salida) y la suite
      vuelve a 18/18.
- [x] `npm test` (309/309 según la sesión principal — no se re-corrió la suite completa en este
      pase puntual, solo el archivo del módulo, que es donde vive el cambio), `npm run lint`
      (según la sesión principal, exit 0) y `npx tsc --noEmit` (mismos 14 errores preexistentes,
      ninguno nuevo, ninguno en `notifications.*`) — reportados por la sesión principal y
      consistentes con lo observado en este pase acotado al archivo del módulo.
- ⚠️ Caso borde no cubierto (bajo riesgo, no bloqueante): no hay test que verifique que, tras el
      fallo de limpieza en `broadcastPushNotification`, el `sent`/`total` devuelto siga contando
      correctamente los envíos exitosos de *otros* usuarios del mismo lote (el test actual usa un
      solo usuario `u1` con token fantasma, `sent: 0, total: 1`) — la lógica no debería verse
      afectada porque `sent`/`entries.length` se calculan antes e independientemente del bloque de
      limpieza, pero no está ejercitado explícitamente con un lote mixto (algunos éxitos + un
      `UNREGISTERED` cuya limpieza falla).
- ⚠️ Los ⚠️ ya anotados en la auditoría original de `eb46fd0` (batch con múltiples tokens
      `UNREGISTERED` a la vez; combinación de fallo de lote completo + `UNREGISTERED` individual en
      el mismo `broadcastPushNotification`) siguen sin cobertura — no forman parte del alcance de
      este fix puntual, quedan como deuda de test conocida.

**Veredicto reverificación: LISTO.** El hallazgo bloqueante queda confirmado resuelto de forma
independiente (lectura de código + mutation testing). Los dos commits (`eb46fd0` + `995f8ba`)
pueden pushearse juntos. Riesgos pendientes: solo los ⚠️ de cobertura de casos borde listados
arriba, ninguno bloqueante.

### Notificaciones de marketing/fidelización (`POST /notifications/broadcast`, `GET /notifications/broadcast-history`)

- [x] `sendMarketingBroadcast(adminId, payload)` reutiliza `broadcastPushNotification` (no
      reimplementa el batching) y guarda el historial con `title`, `body`, `adminId`, `sentCount`,
      `totalCount` — `notifications.service.spec.ts`
- [x] `sendMarketingBroadcast` guarda el historial también cuando `sent:0, total:0` (nadie con
      token) — `notifications.service.spec.ts`
- [x] `getBroadcastHistory()` pide `order: { createdAt: 'DESC' }` (más reciente primero) —
      `notifications.service.spec.ts`. Verificado también con SQL directo contra Postgres local
      (`ORDER BY "createdAt" DESC` sobre dos filas insertadas manualmente) que el orden es real
      a nivel de motor, no solo del mock.
- [x] `POST /notifications/broadcast` exige rol `admin` (mismo guard que `/notifications/test`):
      403 con rol `cliente`, 401 sin token — `test/notifications.e2e-spec.ts`. Confirmado con test
      de regresión manual (se quitó `@Roles(UserRole.ADMIN)` del controller y el test de 403
      pasó a fallar; luego se restauró) que la protección es real.
- [x] `BroadcastNotificationDto` rechaza `title`/`body` ausentes (400) — `test/notifications.e2e-spec.ts`
- [x] `BroadcastNotificationDto` rechaza `title`/`body` presentes pero vacíos (`''`), no solo
      ausentes — agregado por `@tester` (`test/notifications.e2e-spec.ts`, casos "rechaza title
      vacío…" / "rechaza body vacío…"). Confirmado con test de regresión manual (se quitó
      `@IsNotEmpty` del DTO dejando solo `@IsString` y el test pasó a fallar con 201 en vez de
      400) que `@IsNotEmpty` no es redundante con `@IsString`.
- [x] `GET /notifications/broadcast-history` exige rol `admin` (403 cliente, 401 sin token) —
      `test/notifications.e2e-spec.ts`
- [x] Migración `AddMarketingNotifications` coincide 1:1 con la entidad `MarketingNotification`
      (columnas, tipos, nullable, FK `adminId → users.id ON DELETE SET NULL`) — comparado a mano
      contra `\d marketing_notifications` en Postgres local
- [x] FK `adminId → users.id ON DELETE SET NULL` verificado con SQL real (insert usuario + fila de
      historial, delete del usuario, `adminId` queda `NULL`), transacción revertida sin dejar
      residuo
- [x] `GET /notifications/broadcast-history` no expone datos del admin (`admin` es una relación
      `ManyToOne` no eager y `getBroadcastHistory()` no la carga con `relations`, así que nunca
      viaja un `User`/password en la respuesta)
- ⚠️ Cobertura: a diferencia de Coupons/Banners (que en e2e usan el `NotificationsService` real
      contra Postgres, mockeando solo el servicio externo), en `notifications.e2e-spec.ts` todo
      `NotificationsService` está mockeado (convención ya existente del módulo, por Firebase).
      Esto significa que el guardado real en `marketing_notifications` y el `ORDER BY` real nunca
      se ejercitan a través del endpoint HTTP end-to-end, solo a nivel de unit test (repo
      mockeado) + verificación manual por SQL directo (hecha en esta auditoría). No bloqueante,
      pero si se agrega un e2e con DB real en el futuro, seguir el patrón de `coupons.e2e-spec.ts`.

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
- [x] **Hallazgo de `@tester` corregido**: `POST /orders` en `orders.controller.ts` ahora documenta
      la respuesta `409` en Swagger (`@ApiResponse({ status: 409, ... })`), cubriendo tanto el
      cierre del local como el conflicto de cupón.
- [ ] **Hallazgo de `@tester` (riesgo bajo, anotado, no bloqueante)**: `UpdateSettingDto.value`
      tiene `@IsNotEmpty()`, por lo que un admin NO puede usar `PATCH /settings` para volver
      `business_manual_closed_reason` a `""` real una vez que le puso un motivo — solo puede
      "vaciarlo" enviando un string de solo espacios (que `getManualClosedState()` normaliza a
      `null` vía `.trim()`). Funciona en la práctica pero puede sorprender a quien construya el
      formulario en `celtas-admin`; vale la pena documentarlo explícitamente para ese equipo o
      considerar relajar la validación para esta key específica.

### Ampliación: `nextChangeAt` (próximo cambio de estado, para autoprogramación de `celtas-app`)

> `celtas-app` va a autoprogramarse para el momento exacto del próximo cambio de horario en vez de
> hacer polling a `GET /settings/business-hours` (carga innecesaria en Render free tier). Extiende
> `isOpenNow()`/`evaluateSchedule()` (no los reescribe): reutiliza `isOpenToday`/
> `isCarriedOverFromYesterday` desde un método nuevo, `SettingsService.getNextChangeAt()`. Nuevas
> funciones aditivas en `lima-time.util.ts` (`limaWallClockDate`, `limaWallClockToUtc`) — las
> funciones ya auditadas (`todayDayOfWeekInLima`, `currentMinutesInLima`) no se tocaron.

- [x] `GET /settings/business-hours` agrega `nextChangeAt: string | null` (ISO 8601 UTC) a la
      respuesta existente, sin romper los campos previos — confirmado leyendo
      `settings.controller.ts` (`Promise.all` con `getNextChangeAt()`, campo agregado al objeto de
      respuesta sin tocar `open`/`message`/`schedule`/`manualClosed`) y con el test e2e existente
      que valida los 5 campos en la misma respuesta
- [x] `nextChangeAt` con el local abierto (sin cruce de medianoche) → la hora de cierre de HOY —
      `settings.service.spec.ts`, `getNextChangeAt`, caso "abierto ahora (sin cruce)"
- [x] `nextChangeAt` con el local abierto en un horario que cruza medianoche → la hora de cierre
      corresponde a MAÑANA (fecha calendario avanzada, no la de hoy) — mismo instante absoluto
      calculado tanto desde el tramo de "hoy" (antes de medianoche) como desde el arrastre de
      "ayer" (después de medianoche) — **verificado con mutación real por `@tester`**: (1) se forzó
      `closeDate = todayDate` (nunca `shiftLimaDate`, aunque cruce medianoche) → rompió
      exactamente el test "cruza medianoche → MAÑANA" y ningún otro (28/29 en verde); (2) se
      invirtió la condición `crossesMidnight` (`<` en vez de `>=`) → rompió exactamente los 2
      tests que dependen de esa rama ("sin cruce → hoy" y "cruza medianoche → mañana", 27/29 en
      verde) y ningún otro. Ambas mutaciones revertidas, suite vuelve a 29/29 (`getNextChangeAt`) y
      287/287 (completa)
- [x] `nextChangeAt` con el local cerrado, todavía no abrió hoy → la hora de apertura de HOY —
      caso "cerrado ahora, todavía no abrió hoy"
- [x] `nextChangeAt` con el local cerrado, ya cerró por hoy → la hora de apertura de MAÑANA — caso
      "cerrado ahora, ya cerró por hoy"
- [x] `nextChangeAt` cuando mañana también está `closed: true` → salta al primer día siguiente que
      sí abre (no asume que "mañana" siempre es la respuesta) — caso "mañana también closed:true"
- [x] `nextChangeAt` con los 7 días marcados `closed: true` → `null`, sin lanzar excepción (el local
      nunca abre con la configuración actual, caso válido) — caso "los 7 días closed:true"
- [x] `nextChangeAt` con el cierre manual activo → `null` siempre, sin importar el horario
      programado (un cierre manual puede levantarse en cualquier momento, no es predecible;
      decisión de producto: la app NO programa timer en este caso, se entera al reabrir/reanudar) —
      cubierto en unit (`getNextChangeAt`, caso "cierre manual activo") y en e2e
      (`test/settings.e2e-spec.ts`, `GET /settings/business-hours`, test de cierre manual con
      motivo: `expect(data.nextChangeAt).toBeNull()`)
- [x] Verificado con `curl` real contra el servidor y Postgres local: `nextChangeAt` coincide con
      el cálculo a mano a partir del horario configurado y la hora real; `null` mientras el cierre
      manual está activo, valor real de nuevo al desactivarlo — **hecho por la sesión principal**,
      no reproducido de forma independiente por `@tester` en este pase (confiado según lo indicado
      explícitamente); la cobertura equivalente automatizada y repetible (unit + e2e) sí fue
      verificada de forma independiente por `@tester`, incluyendo el test e2e que confirma
      `nextChangeAt` es un ISO 8601 UTC futuro real contra Postgres de test
- [x] Adicional (no listado originalmente, verificado a pedido explícito): `limaWallClockToUtc` usa
      `month` 1-12 de forma consistente en el único lugar donde se llama (`buildLimaInstant` en
      `settings.service.ts`, alimentado por `limaWallClockDate`, también 1-12) — confirmado leyendo
      el código real, sin mezcla con la convención 0-indexada de `Date` nativo; único call site en
      todo `src/` (grep confirmado)
- [ ] **Pendiente, fuera de este backend**: `celtas-app` es quien consume `nextChangeAt` para el
      cartel del Home (autoprogramar el próximo refresco) — el checkout (`POST /orders` → 409) no
      cambia con este agregado

### Ampliación: push notification automático al activar/desactivar el cierre manual

> Cuando el admin cambia `business_manual_closed` desde el panel, el backend avisa automáticamente
> a todos los clientes con `fcmToken` — infraestructura reutilizada, no construida de cero:
> `NotificationsService.broadcastPushNotification()` (nuevo) sigue el mismo contrato ya auditado de
> `sendPushNotification` (nunca lanza), y `SettingsService.upsert()` detecta el cambio comparando el
> valor anterior (leído antes de guardar) contra el nuevo, disparando la notificación DESPUÉS de
> guardar solo si de verdad cambió — el caso más importante y el más fácil de romper por accidente
> es que reenviar el MISMO valor (el form del admin guarda las 3 keys juntas siempre) no dispare
> nada: spam real a usuarios reales si se rompe.

- [x] `NotificationsService.broadcastPushNotification()` existe y sigue el contrato de
      `sendPushNotification` (nunca lanza) — cubierto arriba en la sección "Notifications"
- [x] `SettingsService.upsert(BUSINESS_MANUAL_CLOSED_KEY, 'true')` cuando el valor anterior era
      `'false'` dispara `broadcastPushNotification` con título "Celtas está cerrado temporalmente" y
      el `body` = el motivo, leído FRESCO de `business_manual_closed_reason` en la base en ese
      momento (no de ningún valor del mismo request) — puede haberse guardado en un PATCH separado
      del mismo formulario del admin. **Verificado con mutación real por `@tester`**: se cambió
      `notifyBusinessHoursChange` para leer el motivo de un parámetro en vez de volver a consultar
      la base (`getManualClosedState`); rompió exactamente el test "false→true...motivo leído
      fresco" (el `body` cayó al mensaje genérico en vez de "Cerrado por feriado") y ningún otro de
      los 33 tests de `settings.service.spec.ts` (32/33). Mutación revertida, suite vuelve a verde.
- [x] Con el motivo vacío/no seteado, el `body` cae a un mensaje genérico (no queda vacío ni
      `undefined`) — confirmado leyendo el código (`reason ?? 'El local no está atendiendo pedidos
      en este momento.'`)
- [x] `SettingsService.upsert(BUSINESS_MANUAL_CLOSED_KEY, 'false')` cuando el valor anterior era
      `'true'` dispara `broadcastPushNotification` con título "¡Ya volvimos a abrir!" y body "Ya
      podés hacer tu pedido normalmente"
- [x] Ambos casos incluyen `data: { businessHoursChanged: 'true' }` en el payload (sin más
      contenido — la app la usa solo como aviso de "algo cambió, volvé a consultar
      `/settings/business-hours`", no confía en el contenido de la notificación como dato real)
- [x] **El caso más importante**: volver a guardar el MISMO valor de `business_manual_closed` (ej.
      el form completo reenviando lo mismo que ya estaba, sin que el admin haya tocado el toggle)
      NO dispara ninguna notificación — **verificado con mutación real por `@tester`**: (1) se
      quitó la comparación `previousValue !== value` (dispara siempre) → rompió exactamente el
      test "guardar el MISMO valor...NO dispara ninguna notificación" y ningún otro (32/33); (2) se
      forzó el `if` completo a `false` (nunca dispara) → rompió exactamente los 2 tests
      "false→true" y "true→false" y ningún otro (31/33). Ambas mutaciones revertidas, suite vuelve
      a 295/295 completa.
- [x] Cambiar cualquier OTRA key de settings (ej. `whatsapp_business_number`, el horario mismo)
      nunca dispara esta notificación, sin importar si el valor cambió — test explícito en
      `settings.service.spec.ts` ("cambiar otra key...nunca dispara esta notificación") y
      confirmado leyendo el `if` (`key === BUSINESS_MANUAL_CLOSED_KEY`, sin excepciones)
- [x] `pnpm run build`/`pnpm test` limpios con `NotificationsModule` importado en `SettingsModule`
      (sin ciclo de dependencias — confirmado leyendo `notifications.module.ts`: solo importa
      `TypeOrmModule.forFeature([User])`, no depende de `SettingsModule` ni de nada que dependa de
      él) — `pnpm run build` limpio, `pnpm test` 295/295 (19 suites), `pnpm run test:e2e` 245/245
      (12 suites)

**Auditado por `@tester` (pase independiente, con mutación real sobre el caso de mayor impacto) —
veredicto "LISTO" para esta ampliación.**

⚠️ Riesgo/caso borde no cubierto (bajo riesgo, no bloqueante): no hay un test e2e dedicado que
verifique end-to-end (Postgres + `PATCH /settings` real) que reenviar el MISMO valor no dispare
`broadcastPushNotification` — la cobertura de ese caso crítico es solo unitaria (con
`NotificationsService` mockeado). Los e2e existentes de `test/settings.e2e-spec.ts` sí ejercitan
`PATCH /settings` con `business_manual_closed: 'true'`/`'false'` de verdad contra Postgres de test
(confirmando que el side-effect de Firebase fallando no rompe la respuesta 200), pero ninguno hace
dos `PATCH` seguidos con el mismo valor para observar el "no-disparo" a ese nivel. Vale la pena
agregarlo si en el futuro se quiere mockear `NotificationsService` también en el contexto e2e para
poder aserir `toHaveBeenCalledTimes(0)`.

### Regresión: suites e2e que crean pedidos dependían de la hora real de Lima

> El horario de atención (`business_hours_schedule`/`business_manual_closed`, bloqueando
> `POST /orders` con 409 fuera de horario) hizo que 5 suites e2e que crean pedidos reales en su
> `beforeAll`/tests (`test/full-customer-journey.e2e-spec.ts`, `test/orders.e2e-spec.ts`,
> `test/coupons.e2e-spec.ts`, `test/admin-dashboard.e2e-spec.ts`, `test/settings.e2e-spec.ts`)
> quedaran acopladas a la hora real de ejecución. Fix: `test/helpers/business-hours.helper.ts`
> (`forceBusinessAlwaysOpen`/`restoreBusinessHours`) fuerza el horario a `open === close === '00:00'`
> (rama "cruza medianoche" de `evaluateSchedule`, `nowMinutes >= 0` siempre verdadero) y
> `business_manual_closed: 'false'` en el `beforeAll` de cada suite (después de `app.init()`),
> restaurando el valor previo en `afterAll`.

- [x] Lógica de `forceBusinessAlwaysOpen` verificada leyendo `SettingsService.evaluateSchedule`/
      `isOpenToday`/`isCarriedOverFromYesterday` directamente (no asumida): con `open==='00:00'` y
      `close==='00:00'`, `open < close` es falso → rama "cruza medianoche" → `isOpenToday` solo
      exige `nowMinutes >= open` (`0 >= 0`, siempre verdadero) para las 7 entradas del schedule
      (una por día de la semana) — abierto sin importar hora ni día.
- [x] En las 5 suites, `forceBusinessAlwaysOpen(settingsRepo)` se llama DESPUÉS de `app.init()` y
      ANTES del primer `POST /orders`/seed de datos, y `restoreBusinessHours` se llama en
      `afterAll` antes de `app.close()` — confirmado leyendo cada diff (`orders.e2e-spec.ts`,
      `full-customer-journey.e2e-spec.ts`, `coupons.e2e-spec.ts`, `admin-dashboard.e2e-spec.ts`,
      `settings.e2e-spec.ts`).
- [x] `pnpm run build` limpio, `pnpm test` 295/295 (19 suites), `pnpm run test:e2e` 245/245
      (12 suites) — corridos a las **08:22 hora Lima** (miércoles, antes de la apertura 11:00),
      es decir dentro de la ventana exacta que reproducía el bug original: evidencia real de que
      el fix es robusto, no solo teórica.
- [x] **Reproducción del bug original confirmada de forma independiente**: con `git stash -u`
      sobre el fix (working tree idéntico a `origin/master`, `git diff origin/master -- test/` sin
      salida), `pnpm run test:e2e` a la misma hora (08:2x Lima) falla con exactamente
      `Test Suites: 5 failed, 7 passed, 12 total` / `Tests: 46 failed, 199 passed, 245 total`, y
      las 5 suites que fallan (`FAIL test/settings.e2e-spec.ts`, `coupons.e2e-spec.ts`,
      `orders.e2e-spec.ts`, `full-customer-journey.e2e-spec.ts`, `admin-dashboard.e2e-spec.ts`) son
      exactamente las 5 que el fix toca — reproducido 2 veces de forma consistente.
- [x] `test/settings.e2e-spec.ts` describe `GET /settings/business-hours` (activa/desactiva el
      cierre manual explícitamente) sigue funcionando igual: el override manual siempre gana sobre
      el schedule (`isOpenNow` chequea `manual.closed` antes de `evaluateSchedule`), así que forzar
      el schedule a "siempre abierto" no interfiere con esos 4 tests — confirmado leyendo el código
      y viendo que pasan dentro de los 245/245 (incluye el test que reabre manualmente y espera
      `POST /orders` → 201, que ahora es robusto a cualquier hora real gracias al mismo fix).
      `settingsRepo` se asigna antes de llamar `forceBusinessAlwaysOpen` (orden correcto).
- [ ] **Hallazgo de `@tester` (riesgo bajo, no bloqueante, no manifestado en la práctica)**:
      `restoreBusinessHours` solo restaura una key si `snapshot.<key> !== undefined` — si
      `forceBusinessAlwaysOpen` corriera en una BD donde esas 3 keys NUNCA existieron, dejaría el
      override "siempre abierto" pegado (no se borra, solo se salta la restauración). En la
      práctica esto no ocurre porque `SettingsService.onModuleInit()` (`seedIfMissing`) siembra las
      3 keys con valores default en CADA `app.init()`, que corre antes de `forceBusinessAlwaysOpen`
      en las 5 suites — confirmado leyendo el orden real en `orders.e2e-spec.ts` (`app.init()` en la
      línea 125, `forceBusinessAlwaysOpen` en la línea 139) y confirmando por psql que las 3 keys
      existen en la BD local con valores de horario reales (no el override) tras correr toda la
      suite. Vale la pena que el helper borre la key (`repo.delete`) en vez de solo saltarse el
      `upsert` cuando el snapshot es `undefined`, para no depender de esa garantía implícita del
      seed si el helper se reutiliza en otro contexto a futuro.

**Auditado por `@tester`: LISTO** — build/unit/e2e en verde, reproducción del bug original
confirmada de forma independiente, lógica del helper verificada línea por línea contra
`SettingsService`, y el describe de horario manual en `settings.e2e-spec.ts` sigue intacto. El
único punto pendiente es el hallazgo de riesgo bajo anotado arriba (no bloqueante).

### Investigación: reporte externo de 7 tests fallando en `test/menu.e2e-spec.ts`

> Un reporte externo afirmó "7 tests fallando en `menu.e2e-spec.ts`, pre-existentes, reproducibles
> incluso sobre `origin/master` limpio". No se pudo reproducir.

- [x] `git diff origin/master -- test/menu.e2e-spec.ts` sin salida (archivo idéntico a
      `origin/master`, no hay cambios locales que pudieran explicarlo).
- [x] Migraciones: las 5 están aplicadas (`npx typeorm-ts-node-commonjs migration:show`), incluida
      `AddSaucesCatalog1786846925971` — descarta la hipótesis de migración faltante en este entorno.
- [x] `menu.e2e-spec.ts` en aislamiento sobre `origin/master` limpio (con `git stash -u`, working
      tree confirmado idéntico a origin): **26/26 verde, 2 corridas seguidas** (no flaky).
- [x] Suite completa sobre `origin/master` limpio (mismo stash), **2 corridas seguidas**:
      `Test Suites: 5 failed, 7 passed, 12 total` — `menu.e2e-spec.ts` está SIEMPRE entre las 7 que
      pasan, nunca entre las 5 que fallan (las 5 que fallan son exactamente las del bug de horario
      de la sección anterior, no `menu.e2e-spec.ts`). Sin dependencia de orden detectada.
- [x] Con el fix del punto anterior aplicado (`git stash pop`), suite completa 2 corridas más:
      245/245, incluye `menu.e2e-spec.ts`.

**Veredicto: NO reproducible en este entorno**, ni en aislamiento ni como parte de la suite
completa, ni sobre el commit limpio de `origin/master`, ni con el fix aplicado, en 6 corridas
distintas en total. No se encontró ninguna causa de código que lo explique. Puede ser un problema
del entorno donde se hizo la verificación externa (dependencias no instaladas/desactualizadas, BD
de test con estado distinto, variables de entorno faltantes) — no se inventa una causa de código
que no se pudo confirmar.
