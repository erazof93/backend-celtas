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

### Direcciones: coordenadas GPS (`Address.latitude`/`Address.longitude`)

> Feature nueva: contraparte backend de autocompletado + GPS + mapa (Geoapify) 100% client-side
> en la app Flutter — este backend nunca llama a Geoapify, solo persiste `latitude`/`longitude`
> ya resueltas por la app. Columnas nuevas `double precision` nullable en `Address` (sin
> backfill; direcciones existentes siguen siendo válidas sin coordenadas). Validación vía
> `@IsLatitude()`/`@IsLongitude()` (`class-validator`) en `CreateAddressDto`/`UpdateAddressDto`.
> No se tocó `AddressesService` (ya usaba `create()`/`merge()`, no `Object.assign`) ni el
> contrato de `addressSnapshot` en Orders.
>
> **Auditado por `@tester` (pase independiente, con mutación real) — veredicto "LISTO" con UN
> hallazgo de riesgo bajo no bloqueante, ver ❌ abajo.**

- [x] `pnpm run build` compila sin errores (confirmado de forma independiente)
- [x] `pnpm run lint` limpio, exit 0 (confirmado de forma independiente)
- [x] `pnpm test`: 312/312 en verde (19 suites), incluye los 3 tests nuevos de
      `addresses.service.spec.ts` (crea con lat/lng, crea sin lat/lng → `undefined`, PATCH que
      solo toca lat/lng sin pisar `alias`/`district` — confirma `merge`, no `Object.assign`)
- [x] `pnpm run test:e2e`: 281/281 en verde (12 suites), incluye 20 tests nuevos agregados por
      `@tester` en `test/users.e2e-spec.ts` (antes esta suite no tenía NINGÚN caso de
      lat/lng): creación con/sin coordenadas, out-of-range en ambos extremos (`±90.001`/`±999`
      para latitud, `±180.001`/`±999` para longitud), valores límite inclusive aceptados
      (`-90`/`90`/`0` lat, `-180`/`180`/`0` lng — "Null Island" incluido), tipo incorrecto
      (`latitude: "abc"` → 400), PATCH que solo toca lat/lng sin pisar el resto, PATCH con
      longitud inválida (400), y `GET /users/:id/addresses` (admin) exponiendo lat/lng
- [x] `npx tsc --noEmit`: 14 errores preexistentes, mismos de antes (confirmado, ninguno nuevo)
- [x] Migración `AddCoordinatesToAddresses1787234827634`: verificada de forma independiente con
      `docker exec celtas-db psql` contra Postgres local real — `\d addresses` muestra
      `latitude`/`longitude` como `double precision`, sin `NOT NULL`; `SELECT name FROM
      migrations ORDER BY id DESC` confirma que está registrada
- [x] Valores límite inclusive (`-90`/`90` lat, `-180`/`180` lng, y `0,0`/"Null Island") se
      ACEPTAN correctamente — verificado leyendo el regex real de `validator.isLatLong` (rama
      `90(\.0+)?`/`180(\.0+)?` exacta para el límite, rama `[1-8]?\d(\.\d+)?`/`\d{1,2}(\.\d+)?`
      para el resto) y confirmado con los 6 casos e2e nuevos (todos 201)
- [x] Valores fuera de rango en ambos extremos (`90.001`, `-90.001`, `180.001`, `-180.001`, y
      `999`/`-999` de sobra) se RECHAZAN con 400 — 8 casos e2e nuevos, todos 400
- [x] **Verificado con mutación real por `@tester`**: se quitó `@IsLatitude()` de
      `CreateAddressDto.latitude` (dejando solo `@IsOptional()`) — rompió exactamente los 4 casos
      de latitud fuera de rango + el caso de tipo incorrecto (`"abc"`) = 5/58 tests fallando en
      `users.e2e-spec.ts`, ningún otro test se vio afectado. Efecto secundario revelador: sin el
      guard, `latitude: "abc"` ya no da 400, da **500** (Postgres rechaza el cast a `double
      precision` sin capturar la excepción antes) — confirma que el decorador no es cosmético,
      evita un 500 real. Mutación revertida (`git diff --stat` confirma el archivo idéntico al
      estado previo a la mutación), suite vuelve a 58/58 (aislado) y 281/281 (completa)
- [x] `AddressesService` no se modificó — `create()` usa `repository.create({...dto, userId})` y
      `update()` usa `repository.merge()` (no `Object.assign`), así que lat/lng fluyen solos sin
      riesgo del bug de clase ya conocido en el proyecto (PATCH parcial pisando campos con
      `undefined`)
- [x] `GET /users/me/addresses`, `GET /users/:id/addresses` (admin) y las respuestas de
      `POST`/`PATCH /users/me/addresses` exponen `latitude`/`longitude` correctamente (ninguno usa
      `select` parcial que las excluya; los tres primeros comparten el mismo
      `AddressesService.findByUser()`) — verificado leyendo el código y con e2e real
- [x] ⚠️ **Nota histórica actualizada**: en su momento se confirmó que `OrdersService
      .resolveAddressSnapshot()` armaba el snapshot con una whitelist de solo 4 campos (`alias`,
      `fullAddress`, `reference`, `district`) y que `latitude`/`longitude` NO viajaban al snapshot ni
      al mensaje de WhatsApp (fuera de alcance a propósito en esa vuelta). Eso **ya no es así**: un
      pase posterior agregó `latitude`/`longitude` al snapshot (rama `dto.addressId`) y links de
      Google Maps/Waze al mensaje de WhatsApp. Ver la sección dedicada más abajo, "## Links de Google
      Maps/Waze en el mensaje de WhatsApp (`OrdersService`)", para el detalle de esa auditoría.
- [x] Swagger: confirmado contra `/docs-json` real (servidor levantado) que `CreateAddressDto` y
      `UpdateAddressDto` documentan `latitude`/`longitude` como `type: "number"` con ejemplo y
      descripción
- [x] Seguridad: `Address` no tiene ningún campo sensible tipo `password`; no aplica ese chequeo
      aquí. Los endpoints de admin (`GET /users/:id/addresses`) siguen devolviendo 401/403
      correctamente (cubierto en la sección `Users` de arriba, sin cambios por este feature)

❌➡️✅ **Hallazgo corregido en la sesión principal tras esta auditoría**: `@IsLatitude()`/
`@IsLongitude()` de `class-validator` aceptan **tanto `number` como `string`** (por diseño de la
librería: `isLatitude(value) { return (typeof value === 'number' || typeof value === 'string')
&& isLatLong(...) }`). Con `ValidationPipe({ transform: true })` sin `enableImplicitConversion` y
sin `@Type(() => Number)` en el DTO, un string numérico válido pasaba la validación TAL CUAL
string, sin coerción a `number` — `POST /users/me/addresses` con `{"latitude": "-12.164"}`
(comillas = string) devolvía `201` con `"latitude":"-12.164"` (string) en la respuesta, en vez de
`-12.164` (number), rompiendo en silencio el contrato de tipo con Swagger/la entidad.

**Fix aplicado** (mismo criterio que el resto de campos numéricos de body JSON en el proyecto —
`subtotal`, `discountValue`, `price`, etc. — que tampoco coercionan strings, solo validan):
agregado `@IsNumber({}, { message: '... debe ser un número' })` ANTES de `@IsLatitude()`/
`@IsLongitude()` en `CreateAddressDto`/`UpdateAddressDto`, así el tipo se exige estrictamente (sin
`@Type(() => Number)`, sin coerción silenciosa — un string ahora es 400, no se acepta). Verificado
con `curl` real contra el servidor y Postgres local reales: `latitude: "-12.164"` (string) ahora
devuelve 400 (`"latitude debe ser un número"`); `latitude: -12.164` (number) sigue devolviendo 201
con el valor como `number` real en la respuesta (`typeof data.latitude === 'number'` confirmado).
2 tests e2e nuevos agregados a `test/users.e2e-spec.ts` para cerrar el gap: uno rechaza un string
numérico válido (`"-12.164"`, no solo `"abc"`) con 400, otro confirma `typeof` `number` en la
respuesta cuando se envía como number real. Suite completa re-corrida tras el fix: 312/312 unit,
283/283 e2e (281 previos + 2 nuevos), `pnpm run lint` limpio, `npx tsc --noEmit` con los mismos 14
errores preexistentes de siempre (ninguno nuevo).

⚠️ Riesgos / casos borde no cubiertos (bajo riesgo, no bloqueantes):
- No hay test de `latitude`/`longitude` combinados con `isDefault` en la misma request (debería
  ser ortogonal, la lógica de `unsetDefault` no toca estos campos, pero no está ejercitado
  explícitamente).
- ✅ Resuelto en un pase posterior: se agregó `latitude`/`longitude` al `addressSnapshot` de Orders
  y links de Google Maps/Waze al mensaje de WhatsApp. Re-auditado por `@tester`, ver la sección
  "## Links de Google Maps/Waze en el mensaje de WhatsApp (`OrdersService`)" más abajo (veredicto
  "LISTO CON OBSERVACIONES").

**Veredicto: LISTO.** Todo lo crítico del checklist pasa (compilación, unit, e2e, validación de
contrato en ambos extremos con boundary inclusive correcto, seguridad, Swagger, cero efecto
colateral en Orders, mutación real confirmando que la cobertura nueva es real). El único hallazgo
❌ de la auditoría de `@tester` (aceptación silenciosa de coordenadas como string sin coerción a
number) fue corregido en la sesión principal inmediatamente después (`@IsNumber()` agregado antes
de `@IsLatitude()`/`@IsLongitude()`), con 2 tests e2e nuevos y la suite completa re-verificada en
verde. Sin bloqueantes restantes.

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
- [x] `POST /orders/estimate-delivery-fee` (cliente autenticado) calcula `deliveryFee`/`isFarOrder`/`distanceMeters` de una dirección propia sin crear un pedido; 404 si la dirección no existe o pertenece a otro usuario; ver sección dedicada más abajo

## Links de Google Maps/Waze en el mensaje de WhatsApp (`OrdersService`)

> Pase puntual (no es un ítem formal de `ROADMAP.md`): cuando el snapshot de dirección del pedido
> trae `latitude`/`longitude` (copiadas de `Address` en `resolveAddressSnapshot()`, rama
> `dto.addressId`), el mensaje de WhatsApp agrega un bloque con links de Google Maps y Waze después
> de la dirección legible. Cierra el gap anotado como "vuelta futura" en la sección `Users` de este
> mismo checklist (línea ~142 histórica: "si en el futuro se agrega latitude/longitude al
> addressSnapshot de Orders, habrá que re-auditar ese flujo específico").
>
> **Auditado por `@tester` (pase independiente, con mutación real) — veredicto "LISTO".**

- [x] `pnpm run build` compila sin errores
- [x] `pnpm run test`: 316/316 tests unitarios en verde (19 suites), incluye 4 casos nuevos en
      `orders.service.spec.ts`: snapshot con coordenadas (copia `latitude`/`longitude` tal cual),
      snapshot sin coordenadas (quedan `null`, direcciones viejas), mensaje de WhatsApp con los
      links cuando hay coordenadas, y mensaje sin ninguna línea de mapa (ni "Google Maps", ni
      "Waze", ni "N/A") cuando no las hay
- [x] `pnpm run test:e2e`: 284/284 en verde (12 suites), incluye 1 caso nuevo en
      `test/orders.e2e-spec.ts`: crea una `Address` real con `latitude`/`longitude` vía
      `POST /users/me/addresses`, arma un pedido real y confirma que `addressSnapshot` y el
      `whatsappUrl` decodificado contienen ambas coordenadas exactas
- [x] `mapsLinksBlock()` usa `parsed.latitude == null || parsed.longitude == null` (chequeo de
      nulidad real, no truthy) — confirmado leyendo el código; correcto en principio para no tratar
      un futuro `0` legítimo como ausente, aunque **no hay ningún test (unitario ni e2e) que ejercite
      `latitude`/`longitude = 0`** (ver mutación abajo)
- [x] Orden de coordenadas `lat,lng` (no `lng,lat`) en ambas URLs (Google Maps y Waze) — confirmado
      leyendo el código
- [x] Sin coordenadas (o `addressSnapshot` directo del dto), el mensaje de WhatsApp queda carácter
      por carácter igual que antes: sin `\n\n` colgante, sin "N/A", sin ningún artefacto — confirmado
      con test dedicado que hace `.not.toContain('Google Maps')`, `.not.toContain('Waze')` y
      `.not.toContain('N/A')`
- [x] El diff **no tocó** el cálculo de `total`/`subtotal` — confirmado leyendo el diff completo de
      `orders.service.ts`: los únicos cambios son (1) 2 líneas agregadas al `JSON.stringify` de
      `resolveAddressSnapshot()` y (2) la interpolación de `mapsLinksBlock()` + el método nuevo en
      sí. `round2()`, `buildItems()` (cálculo de `subtotal` por ítem) y el `subtotal`/`total` del
      método `create()` quedan sin ninguna línea tocada
- [x] `resolveAddressSnapshot()` solo cambió en la rama `dto.addressId` — confirmado leyendo el
      código: la rama `dto.addressSnapshot` (snapshot directo del cliente, sin pasar por `Address`)
      sigue siendo `return dto.addressSnapshot;` sin ningún cambio
- [x] `whatsappUrl` sigue siendo una URL válida y bien encodeada incluso con el mensaje más largo:
      el `?` de `.../search/?api=1&query=...` queda dentro del `message` completo, que pasa una sola
      vez por `encodeURIComponent()` al construir `https://wa.me/...?text=...` — no hay doble
      encoding ni caracteres sin escapar. Confirmado leyendo `buildWhatsappUrl()` y con los tests
      (unitarios y e2e) que hacen `decodeURIComponent()` sobre el resultado real y encuentran las
      URLs completas de Maps/Waze intactas
- [x] Sin pérdida de precisión de las coordenadas en el camino `Address` → snapshot →
      `mapsLinksBlock()`: no hay ningún `.toFixed()`, `Math.round()` ni redondeo en esa cadena;
      `${parsed.latitude},${parsed.longitude}` es interpolación directa del `number` parseado del
      JSON. Confirmado leyendo el código y con el test e2e, que usa `-12.169`/`-77.0089` (4 y 4
      decimales) y verifica el string exacto en el `whatsappUrl` decodificado
- [x] **Mutación real por `@tester`**: se revirtió temporalmente la interpolación de
      `mapsLinksBlock()` en el template del mensaje → el test "agrega los links..." falla como se
      espera (`expect(received).toContain(expected)` con el mensaje sin ningún link). Se restauró el
      código inmediatamente después
- [x] **Mutación real por `@tester`**: se intercambió el orden de las coordenadas
      (`${parsed.longitude},${parsed.latitude}`) → el mismo test falla, detecta el swap
      correctamente (`query=-77.0089,-12.169` en vez de `-12.169,-77.0089`). Se restauró el código
      inmediatamente después
- [ ] ⚠️ **Mutación real por `@tester` — hallazgo, no bloqueante**: se cambió
      `parsed.latitude == null || parsed.longitude == null` por `!parsed.latitude ||
      !parsed.longitude` (chequeo truthy) → **la suite completa de `orders.service.spec.ts` sigue en
      verde (52/52)**. Ningún test unitario ni e2e usa `latitude`/`longitude = 0`, así que si algún
      día alguien "simplifica" el chequeo a una condición truthy, nada lo va a detectar hoy (0 es un
      valor de coordenada técnicamente inválido en Lima, así que el riesgo real es bajísimo, pero el
      guardrail de regresión no existe). Se restauró el código inmediatamente después de la mutación.
      **Pendiente**: agregar un caso con `latitude: 0` (o `longitude: 0`) a `orders.service.spec.ts`
      que confirme que el bloque de links SÍ se genera con coordenada `0`, para que este mutante deje
      de sobrevivir
- [x] Seguridad: no aplica ningún chequeo nuevo (no se tocó ningún endpoint de admin ni ningún campo
      sensible; `mapsLinksBlock()` es un helper privado que solo formatea texto ya presente en el
      snapshot)
- [x] Documentación: no aplica cambio de Swagger — no se agregó ni modificó ningún DTO, campo de
      response ni endpoint; el cambio vive enteramente dentro del texto libre de `whatsappUrl`
      (`string`, mismo tipo de siempre)

**Veredicto: LISTO CON OBSERVACIONES.** Todo lo crítico pasa (build, 316/316 unit, 284/284 e2e,
lógica de coordenadas correcta y verificada con mutación real, cero efecto colateral confirmado
sobre el cálculo de `total`/`subtotal`, backward-compat confirmado byte a byte para direcciones sin
coordenadas, URL bien encodeada, sin pérdida de precisión). La única observación (no bloqueante) es
el gap de cobertura en `latitude`/`longitude = 0`: el chequeo de código (`== null`) es correcto hoy,
pero no hay ningún test de regresión que lo proteja de una futura simplificación accidental a un
chequeo truthy.

## Costo de delivery por distancia + aviso de pedidos lejanos (`OrdersService`, backend)

> Primera parte de la feature (solo backend; `celtas-admin` y `celtas-app` quedan para después).
> `src/common/utils/geo.util.ts` (`haversineDistanceMeters`, fórmula pura, sin API externa).
> `SettingsService` gana 3 keys nuevas (mismo patrón que `business_hours_schedule`): `store_location`
> (sembrada SIN CONFIGURAR a propósito, `getStoreLocation()` lanza `NotFoundException` si falta o el
> JSON es inválido), `delivery_fee_tiers` (tramos ascendentes `{maxMeters, fee}`, cae al default si
> falta/inválido) y `delivery_alert_radius_meters` (cae a `2500` si falta/no numérico). Columna nueva
> `Order.deliveryFee` (decimal 10,2, default 0). `OrdersService.create()`: si el snapshot de dirección
> trae coordenadas, calcula distancia y tarifa contra `store_location`/`delivery_fee_tiers` y evalúa
> `isFarOrder` contra `delivery_alert_radius_meters`; sin coordenadas, `deliveryFee = 0` sin bloquear
> nunca el pedido. `total = subtotal (o con cupón aplicado) + deliveryFee`. Tras persistir el pedido,
> push best-effort a los admins con `fcmToken` (título con `⚠️` si `isFarOrder`). `findOne`/`findAll`
> ahora cargan también `relations.user` (expone `phone`/`fullName`, `password` sigue excluido vía
> `@Exclude()` global); `findMyOrders` sin cambios.
>
> **Auditado por `@tester` (pase independiente, con mutación real y prueba end-to-end contra
> servidor + Postgres local reales) — veredicto "LISTO".**

- [x] `pnpm run build` compila sin errores (confirmado de forma independiente)
- [x] `pnpm run lint` limpio, exit 0 (confirmado de forma independiente)
- [x] `pnpm test`: 348/348 en verde (20 suites) — confirmado de forma independiente, no solo
      confiado en el conteo reportado por la sesión principal
- [x] `pnpm run test:e2e`: 289/289 en verde (12 suites) contra Postgres local real — confirmado de
      forma independiente
- [x] `geo.util.spec.ts`: mismo punto (0m), 1° de latitud en el ecuador (~111.19km, valor de
      referencia conocido), distancia real entre dos coordenadas de San Juan de Miraflores,
      simetría A→B == B→A
- [x] **Nunca se rechaza un pedido por distancia**: confirmado leyendo el código completo de
      `resolveDelivery`/`feeForDistance` — ningún radio máximo, ningún `throw` ligado a la
      distancia; el tramo final (`maxMeters: null`) es tarifa plana sin techo, y `feeForDistance`
      tiene además un fallback defensivo (`tiers[tiers.length - 1]?.fee ?? 0`) si la config no
      trajera un tramo final `null`. Cubierto con el caso de tramo lejano (unit + e2e real: pedido
      a ~3.7km del `store_location` se crea igual, `deliveryFee: 8`, `status: pendiente`)
- [x] `deliveryFee` se suma DESPUÉS del descuento del cupón: confirmado leyendo `create()` línea por
      línea (`total = applied.discountedTotal` primero, `total = round2(total + deliveryFee)`
      después) y con el test unitario dedicado (`44.82 + 2 = 46.82`)
- [x] Sin coordenadas en la dirección (dato viejo o `addressSnapshot` de texto libre): `deliveryFee
      = 0`, el pedido se crea igual, y `getStoreLocation()` NUNCA se llama — confirmado leyendo
      `resolveDelivery` (el `if (!coords) return ...` corta antes de la única línea que llama a
      `settingsService.getStoreLocation()`) y con el test unitario que asegura
      `expect(settingsService.getStoreLocation).not.toHaveBeenCalled()`
- [x] `store_location` sin configurar + dirección CON coordenadas → `404` en español
      (`"La ubicación del local todavía no está configurada (setting \"store_location\")"`), y la
      transacción NUNCA se inicia — confirmado leyendo el código (`resolveDelivery()` se llama
      ANTES de `dataSource.transaction(...)` en `create()`) y con el test unitario
      (`expect(dataSource.transaction).not.toHaveBeenCalled()`). **Verificado además end-to-end
      contra el servidor y Postgres local reales**: se desconfiguró `store_location` vía
      `PATCH /settings` (`value: " "`), se contó `SELECT COUNT(*) FROM orders` antes y después de
      un intento de `POST /orders` con dirección con coordenadas — el conteo no cambió (2→2), la
      respuesta fue `404` con el mensaje exacto de arriba, y `store_location` se restauró al
      finalizar
- [x] Push a los admins es best-effort real: `sendPushNotification` nunca lanza (contrato ya
      auditado en `NotificationsService`); test unitario con `sendPushNotification.mockResolvedValue
      (false)` confirma que la creación del pedido no se ve afectada; test con `usersRepo.find`
      devolviendo `[]` confirma que 0 admins con token no rompe nada y tampoco llama a
      `sendPushNotification`; test con 2 admins confirma que se notifica a TODOS, no solo al primero
- [x] El mensaje de alerta (`⚠️ Nuevo pedido fuera de la zona habitual...`) SOLO aparece cuando
      `isFarOrder` es `true` (distancia > `delivery_alert_radius_meters`); el pedido cercano usa el
      título normal (`🍔 Nuevo pedido...`) — cubierto con tests unitarios dedicados para ambos casos
      (`.toContain`/`.not.toContain('⚠️')`)
- [x] `findOne`/`findAll` exponen `user.phone`/`user.fullName` sin `password` — confirmado leyendo
      el código (`relations: { items: true, user: true }` en ambos, sin ningún `select` parcial) y
      con `curl` real contra el servidor y Postgres local: `GET /orders/:id` (admin) devolvió el
      objeto `user` completo con `fullName`/`phone`/etc., **sin la clave `password`** (confirmado
      que la clave ni siquiera existe en el JSON, no solo que es `null`) — el `@Exclude()` global de
      la entidad `User` sigue aplicando. `findMyOrders` no se tocó (`relations: { items: true }`),
      confirmado con el test unitario existente
- [x] Sin ningún endpoint nuevo, no aplica chequeo nuevo de Swagger/401/403 — `POST /orders`
      conserva las mismas respuestas documentadas; el campo `deliveryFee` viaja dentro del mismo
      `Order` que ya se documentaba
- [x] Migración `AddDeliveryFeeToOrders1787285827711`: verificada de forma independiente con
      `docker exec celtas-db psql` contra Postgres local real — `\d orders` muestra `deliveryFee
      numeric(10,2) NOT NULL DEFAULT '0'`, coincide exactamente con el transformer/decorador de la
      entidad; `SELECT name FROM migrations ORDER BY id DESC` la confirma registrada;
      `migration:generate` posterior reporta "No changes in database schema were found" (sin
      drift)
- [x] **Prueba real end-to-end contra el servidor (`pnpm run start:dev`) y Postgres local reales**
      (no simulada): admin y cliente reales, categoría/producto real, dirección real con
      coordenadas ~147.75m del `store_location` de prueba (`-12.1631,-76.97`) → `POST /orders` real
      devolvió `deliveryFee: 4` (tramo 100-400m), `total: 29` (`25 + 4`); una segunda dirección a
      ~3.7km devolvió `deliveryFee: 8` (tarifa plana) con `status: "pendiente"` (nunca rechazado).
      Datos de prueba limpiados de la BD después (usuarios, direcciones, pedidos, categoría/producto
      QA), settings restauradas a sus valores previos
- [x] **Verificado con mutación real por `@tester`**: se invirtió la comparación en
      `feeForDistance` (`distanceMeters <= tier.maxMeters` → `>=`) — rompió exactamente 4/67 tests
      de `orders.service.spec.ts` (los que dependen del cálculo correcto del tramo), ningún otro se
      vio afectado. Mutación revertida, confirmado con `git diff --stat` que el archivo volvió
      exactamente al estado previo (mismo conteo de líneas que antes de la mutación), suite completa
      vuelve a 348/348
- [x] **Verificado con mutación real por `@tester`**: se deshabilitó el guard `if (!coords)` (forzado
      a `if (false && !coords)`) en `resolveDelivery` — rompió 24/67 tests de
      `orders.service.spec.ts`, incluido un `TypeError: Cannot read properties of null (reading
      'latitude')` real (no un fallo silencioso: sin el guard, un pedido sin coordenadas revienta al
      intentar leer `coords.latitude` de `null`), confirmando que el guard no es cosmético — evita un
      500 real, no solo un `deliveryFee` incorrecto. Mutación revertida, `git diff --stat` confirma
      el archivo idéntico al estado previo, suite completa vuelve a 348/348
- [x] `pnpm test` y `pnpm run test:e2e` completos re-corridos tras cada revert de mutación, ambos en
      verde (348/348 y 289/289 respectivamente)

⚠️ Riesgos / casos borde no cubiertos (bajo riesgo, no bloqueantes):
- No hay ningún test (unitario ni e2e) del caso límite exacto `distanceMeters === tier.maxMeters`
  (ej. una dirección a exactamente 100.00m) — la lógica (`<=`) debería incluirlo en el tramo actual
  (no en el siguiente), y `feeForDistance` fue mutado con éxito arriba invirtiendo el operador, pero
  ningún test usa un valor exactamente en el borde de un tramo, solo valores claramente dentro de
  cada uno.
- No hay test de `distanceMeters > alertRadiusMeters` en el límite exacto (`distanceMeters ===
  alertRadiusMeters`, que según el código con `>` estricto NO dispara `isFarOrder` justo en el
  borde) — mismo patrón de gap que el punto anterior, aplicado al radio de aviso.
- No hay test (unitario ni e2e) de `addressSnapshot` directo del cliente (sin `addressId`, rama
  `dto.addressSnapshot`) que SÍ traiga `latitude`/`longitude` en el JSON — el código lo soportaría
  igual (`parseAddressCoords` no distingue el origen del snapshot), pero no está ejercitado
  explícitamente; toda la cobertura nueva usa la rama `addressId` con una `Address` real.
- No hay test de qué pasa si `delivery_fee_tiers` está configurado con un array VACÍO (`[]`): el
  bucle de `feeForDistance` no entra nunca y cae al fallback `tiers[tiers.length - 1]?.fee ?? 0`
  → `0` (delivery gratis, no un error) — comportamiento razonable pero no verificado con un test
  explícito, y no documentado como decisión intencional en ningún comentario.
- `notifyAdminsNewOrder` corre DESPUÉS de la transacción (fuera de ella, best-effort) — confirmado
  leyendo el código y con tests de que un fallo no rompe la creación, pero no hay ningún test que
  verifique el orden temporal real (que el pedido ya esté commiteado en la BD antes de que se
  dispare el push) más allá de la estructura del código (`await this.dataSource.transaction(...)`
  seguido de `await this.notifyAdminsNewOrder(...)`, secuencial, no en paralelo).

**Veredicto: LISTO.** Todo lo crítico del checklist pasa: build/lint limpios (confirmados de forma
independiente), 348/348 unit y 289/289 e2e (confirmados de forma independiente, no solo el conteo
reportado), migración verificada 1:1 contra Postgres local real sin drift, prueba end-to-end real
contra el servidor corriendo con cálculo de distancia/tarifa concreto y verificable a mano, dos
mutaciones reales en los puntos más frágiles (comparación de tramo, guard de "sin coordenadas") que
confirman que la cobertura de tests es real y no cosmética, seguridad confirmada (`password` nunca
viaja en la respuesta de `user`), y ningún hallazgo bloqueante. Los ⚠️ de arriba son gaps de
cobertura de casos borde de bajo riesgo, no bloqueantes — vale la pena cerrarlos en una vuelta
futura, en particular el límite exacto de tramo (`distanceMeters === maxMeters`) dado que ya se
demostró que `feeForDistance` es mutable sin que ningún test de borde lo detecte hoy.

### `POST /orders/estimate-delivery-fee` (endpoint nuevo, cierra la parte backend de la feature)

> Endpoint nuevo, solo backend (`celtas-admin`/`celtas-app` sin cambios). Reusa el cálculo de
> `create()` vía un helper compartido nuevo, `OrdersService.computeDelivery(coords)`, del que ahora
> derivan tanto `resolveDelivery()` (usado por `create()`) como `estimateDeliveryFee()` (usado por
> este endpoint). Protegido con `JwtAuthGuard` (cliente autenticado, sin rol especial). Valida que
> la `Address` pertenezca al usuario autenticado (`where: { id: dto.addressId, userId }`, mismo
> criterio que `resolveAddressSnapshot()` de `create()` y que el resto de `/users/:id/addresses`).
> Nunca crea un pedido.
>
> **Auditado por `@tester` (pase independiente, con mutación real sobre los dos puntos más frágiles
> — el guard de "dirección ajena" y el guard compartido de "sin coordenadas" en `computeDelivery`)
> — veredicto "LISTO".**

- [x] `pnpm run build` compila sin errores (confirmado de forma independiente)
- [x] `pnpm run test`: 353/353 en verde (20 suites) — confirmado de forma independiente, incluye los
      5 tests nuevos de `describe('estimateDeliveryFee')` en `orders.service.spec.ts`: tramo cercano
      (deliveryFee/isFarOrder/distanceMeters calculados, sin llamar a `dataSource.transaction`),
      tramo lejano (`isFarOrder: true`, tarifa del tramo sin techo), sin coordenadas (`deliveryFee:
      0, isFarOrder: false, distanceMeters: null`, `getStoreLocation` nunca llamado), dirección
      inexistente/ajena → `NotFoundException`, `store_location` sin configurar + coordenadas →
      `NotFoundException`
- [x] `pnpm run test:e2e`: 296/296 en verde (12 suites) contra Postgres local real — confirmado de
      forma independiente, incluye los 7 tests nuevos de `describe('POST /orders/estimate-delivery-fee')`
      en `test/orders.e2e-spec.ts`: 401 sin token, sin coordenadas, tramo cercano (con conteo real de
      `orders` antes/después confirmando que no se crea ningún pedido), tramo lejano, 404 dirección
      inexistente, **404 dirección de otro usuario (con dos usuarios reales, `clientAToken`/
      `clientBToken`, y una `Address` real de `clientA`, no un mock)**, 400 `addressId` no-UUID
- [x] **Refactor `resolveDelivery` → `computeDelivery` compartido, sin regresión en `POST /orders`**:
      confirmado leyendo `create()` línea por línea (nada cambió en su flujo: sigue llamando
      `resolveDelivery(addressSnapshot)`, que ahora solo agrega el warning de log y delega en
      `computeDelivery`) y con la suite `describe('create — delivery por distancia...')` completa
      (14 tests, ninguno tocado en este diff) en verde: tramo cercano/intermedio/lejano, deliveryFee
      sumado después del cupón, `store_location` sin configurar → 404 sin iniciar transacción, push a
      admins con/sin `isFarOrder`, best-effort ante fallo de notificación
- [x] **Verificado con mutación real por `@tester`**: se deshabilitó el guard `if (!coords)` de
      `computeDelivery` (forzado a `if (false && !coords)`) — rompió 25/72 tests de
      `orders.service.spec.ts`, con el mismo `TypeError: Cannot read properties of null (reading
      'latitude')` real documentado en la auditoría anterior (no un fallo silencioso), y esta vez
      afectando AMBOS callers: los tests de `create()` sin coordenadas Y los 2 tests nuevos de
      `estimateDeliveryFee` sin coordenadas — confirma que compartir el helper no introdujo un guard
      duplicado ni divergente. Mutación revertida, `git diff --stat` confirma el archivo idéntico al
      estado previo, suite completa vuelve a 353/353
- [x] **Verificado con mutación real por `@tester`**: se quitó el filtro `userId` del `where` de
      `estimateDeliveryFee` (`{ id: dto.addressId, userId }` → `{ id: dto.addressId }`) — rompió
      exactamente el test e2e "404 si la dirección le pertenece a otro usuario" (1/53 de la suite
      completa de `orders.e2e-spec.ts`, contra Postgres local real con dos usuarios reales) y ningún
      otro; sin el filtro, `clientBToken` pudo estimar el delivery de una dirección de `clientA`
      (`201` en vez de `404`). Confirma que el guard de propiedad es real, no solo que el `addressId`
      exista. Mutación revertida, `git diff --stat` confirma el archivo idéntico al estado previo,
      suite completa vuelve a 296/296
- [x] Contrato del DTO verificado con `curl` real contra el servidor y Postgres local reales (token
      real de un usuario registrado en esta sesión): sin `addressId` → 400 `"addressId debe ser un
      UUID válido"`; `addressId` como número (`123`) → mismo 400 (rechaza el tipo, no coacciona);
      `addressId` no-UUID (`"not-a-uuid"`) → mismo 400; `addressId` UUID válido pero inexistente →
      404 `"Dirección no encontrada"`; sin token, cualquier body → 401 (el guard corre antes que el
      `ValidationPipe`, consistente con el resto del proyecto)
- [x] Prueba real end-to-end adicional (no solo la suite automatizada) contra el servidor
      (`pnpm run start:dev`) y Postgres local reales: usuario y dirección reales creados vía API
      (`POST /auth/register` + `POST /users/me/addresses`, dirección a ~70m del `store_location` de
      prueba) → `POST /orders/estimate-delivery-fee` real devolvió `{"deliveryFee":2,"isFarOrder":
      false,"distanceMeters":70.229...}`; `SELECT COUNT(*) FROM orders` antes y después del llamado
      se mantuvo igual (1→1), confirmando que el endpoint nunca persiste un pedido. Usuario y
      dirección de prueba borrados de la BD al finalizar
- [x] Seguridad: `POST /auth/register` (mismo flujo usado para generar el token de prueba) confirma
      que `password` no aparece en el JSON de la respuesta (ni la clave ni el valor); el endpoint en
      sí no expone ningún usuario/entidad completa, solo el objeto plano
      `{deliveryFee, isFarOrder, distanceMeters}`, así que no aplica ningún otro chequeo de campo
      sensible aquí
- [x] Documentación: confirmado contra `/docs-json` real (servidor levantado) que el endpoint está
      documentado con `@ApiOperation`, `security: [{bearer: []}]`, y las 3 respuestas (201/401/404)
      con descripciones correctas; `EstimateDeliveryFeeDto` documenta `addressId` como `string`
      (UUID) requerido, con ejemplo

⚠️ Riesgos / casos borde no cubiertos (bajo riesgo, no bloqueantes, algunos heredados de la feature
base y confirmados que también aplican a este endpoint nuevo):
- Los mismos gaps de límite exacto de tramo (`distanceMeters === tier.maxMeters`) y de radio de
  aviso (`distanceMeters === alertRadiusMeters`) ya documentados arriba para `create()` también
  aplican a `estimateDeliveryFee()`, porque ambos comparten `computeDelivery`/`feeForDistance` — no
  es una regresión nueva de esta sesión, pero tampoco se cerró en esta vuelta.
- No hay test (unitario ni e2e) de `delivery_fee_tiers` configurado como array vacío (`[]`) para
  este endpoint específicamente — mismo gap ya anotado para `create()`.
- No hay test de qué devuelve el endpoint si `addressId` corresponde a una dirección con
  `latitude`/`longitude` igual a `0` (Null Island) — el chequeo en `estimateDeliveryFee` es
  `typeof address.latitude === 'number'`, que sí trataría `0` como coordenada válida (correcto en
  principio, a diferencia del riesgo `== null` vs truthy ya documentado en la sección de links de
  WhatsApp), pero no está ejercitado con un test explícito.

**Veredicto: LISTO.** Build limpio, 353/353 unit y 296/296 e2e (confirmados de forma independiente),
Swagger correcto, contrato del DTO validado con `curl` real, cero password expuesto, y dos mutaciones
reales en los puntos más frágiles (guard de "sin coordenadas" compartido y guard de "dirección
ajena") que confirman que la cobertura nueva es real y que el refactor `resolveDelivery` →
`computeDelivery` no introdujo ninguna regresión en `POST /orders`. Sin bloqueantes. Los ⚠️ de arriba
son gaps de cobertura ya conocidos de la feature base (límite exacto de tramo/radio de aviso), que
ahora también aplican a este endpoint por compartir el mismo cálculo — vale la pena cerrarlos para
ambos endpoints juntos en una vuelta futura.

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

## Rewards (programa de fidelización "Estrellas")

> Módulo nuevo `src/modules/rewards/` (entidades `RewardRedemption`/`StarPromotion`, `RewardsService`
> cliente + generación automática, `StarPromotionsService` CRUD admin sin `DELETE`). Por cada
> `soles_por_estrella` (setting, default 10) de subtotal sin envío en pedidos `entregado` del mes
> calendario actual (hora de Lima), 1 estrella; al juntar `estrellas_por_premio` (setting, default 10)
> se genera un `RewardRedemption` con 15 días de vigencia. El conteo se reinicia cada mes calendario
> (los premios ya ganados no se pierden — no hay cron, el filtro por mes ya logra el efecto).
> `StarPromotion` pondera el subtotal por `order.createdAt` (día de la compra), no `deliveredAt`.
> Canje: `POST /orders`, cada `CreateOrderItemDto` acepta `rewardRedemptionId?` opcional, valida y
> bloquea (lock pesimista) DENTRO de la transacción de creación, fuerza `unitPrice=0`, exige
> `quantity===1` y que el producto sea `redeemableWithStars`. Cancelar un pedido reactiva los premios
> que canjeó (mismo criterio que `CouponsService.reactivateForCancelledOrder`); `entregado→cancelado`
> no es una transición válida, así que un premio legítimamente usado nunca se reactiva por error.
> `MenuItem` gana `redeemableWithStars` (boolean, default false). Migración
> `AddStarsRewardsProgram1787683759116` (`reward_redemptions`, `star_promotions`, columna en
> `menu_items`).
>
> **Auditado por `@tester` (pase independiente, con Docker/Postgres local real levantados por el
> propio `@tester` — el entorno de la sesión principal no tenía Docker activo — y mutación real sobre
> los dos puntos más frágiles) — veredicto "LISTO".**

- [x] `pnpm run build` compila sin errores (confirmado de forma independiente)
- [x] `pnpm run lint` limpio, exit 0 sin salida (confirmado de forma independiente)
- [x] `npx tsc --noEmit`: exactamente los mismos 19 errores preexistentes que en `origin/master`,
      confirmado línea por línea con `diff` entre una corrida sobre `git stash -u` (working tree
      idéntico a master, incluyendo los archivos nuevos sin trackear) y una corrida con el feature
      aplicado — **0 errores nuevos**. (La primera comparación, con `git stash` simple sin `-u`,
      había dado un resultado engañoso — 19 vs 26 — porque `git stash` sin `-u` no oculta los
      archivos nuevos sin trackear de `rewards/`, dejándolos huérfanos de las entidades/settings que
      necesitan; corregido usando `-u` para una comparación real contra master.)
- [x] `pnpm run test`: 391/391 en verde (22 suites) — confirmado de forma independiente, no solo
      confiado en el conteo reportado por la sesión principal. Incluye 28 tests de
      `rewards.service.spec.ts` (catálogo, progreso con/sin promoción, promoción fuera de rango,
      `promocionActiva` solo si hoy cae en su ventana, premios disponibles ordenados por
      `expiresAt`, generación de 1 premio / de 3 premios de una sola pasada, no regeneración si ya
      se generaron este mes, sin generar si no se alcanza el umbral, las 6 ramas de
      `validateForOrder` — no existe/ajeno/usado/vencido/producto no canjeable/válido —,
      `markUsed`, `reactivateForCancelledOrder` con 2 premios y con 0) y 9 de
      `star-promotions.service.spec.ts` (fechas invertidas, solapamiento en `create`, sin validar
      solapamiento si se crea inactiva, `findOne` 404, `update` excluye la propia promoción del
      chequeo de solapamiento, `update` no valida solapamiento al desactivar, rango inválido tras
      merge)
- [x] `pnpm run test:e2e`: 329/329 en verde (13 suites) contra Postgres local real — confirmado de
      forma independiente, incluye los 31 tests de `test/rewards.e2e-spec.ts`: 401 sin token en los
      3 endpoints, catálogo filtra por `redeemableWithStars`+`available`, cálculo sin promoción
      (S/50→5 estrellas), cálculo con promoción de estrellas dobles activa (S/50×2→10 estrellas→1
      premio, con `expiresAt` verificado dentro de ±60s de "ahora + 15 días"), generación de 3
      premios de una sola pasada (S/300), no regeneración de premios ya contados este mes (3 pedidos
      seguidos, verificado paso a paso), expiración (premio vencido no aparece en
      `premiosDisponibles`, canjear un premio vencido → 400 y no crea el pedido), canje de premio
      ajeno → 400 y no crea pedido, flujo completo de canje válido (precio forzado a 0, se marca
      usado, reintento → 400, cancelar el pedido reactiva el premio y vuelve a aparecer en
      `premiosDisponibles`), `quantity≠1` en ítem canjeado → 400, producto no canjeable → 400,
      mismo `rewardRedemptionId` repetido en dos ítems del mismo pedido → 400, distinción real entre
      `createdAt` (pesa el multiplicador de la promo) y `deliveredAt` (decide el mes calendario) con
      3 casos dedicados, `PATCH /menu/items/:id` con `redeemableWithStars` (activar, no pisarlo con
      un PATCH de otro campo — confirma `merge`, no `Object.assign` —, desactivar), y el CRUD
      completo de `StarPromotions` (401/403, crear válida, fechas invertidas → 400, solapamiento →
      400 con el mensaje exacto, no solapa mes siguiente → 201, `PATCH` que genera solapamiento →
      400, `PATCH active:false` NO valida solapamiento aunque las fechas se solapen, 404 inexistente,
      listado)
- [x] Migración `AddStarsRewardsProgram1787683759116` verificada de forma independiente con
      `docker exec celtas-db psql` contra Postgres local real: `\d reward_redemptions` y
      `\d star_promotions` coinciden columna a columna con las entidades (tipos, nullability, FKs
      `ON DELETE CASCADE`/`SET NULL` correctos), `\d menu_items` confirma
      `redeemableWithStars boolean NOT NULL DEFAULT false`; `SELECT name FROM migrations ORDER BY id
      DESC` la confirma registrada; `migration:generate` posterior reporta "No changes in database
      schema were found" (sin drift)
- [x] Cálculo de estrellas CON promoción activa: pesa el subtotal por el multiplicador vigente en la
      fecha de CADA pedido (`order.createdAt`), no en la fecha de hoy ni en `deliveredAt` — 3 tests
      e2e dedicados que fuerzan `createdAt`/`deliveredAt` a valores independientes vía UPDATE directo
      (algo que la API no permite retroceder) y confirman que el peso histórico usa `createdAt` y el
      filtro de "mes calendario actual" usa `deliveredAt`
- [x] Cálculo SIN promoción activa: multiplicador 1 implícito, confirmado con test dedicado y con el
      caso "promoción vigente en otro mes, pedido hecho fuera de su rango" (sin pesar)
- [x] Generación de MÁS DE UN premio de una sola pasada: `recalculateForUser` genera
      `premiosQueDeberiaTener - alreadyGenerated` en un solo `manager.save` con un array, no un loop
      con múltiples llamadas — confirmado leyendo el código y con el test (S/300→3 premios, un solo
      `save` con `toHaveLength(3)`)
- [x] NO regeneración de premios ya contados en el mes: `alreadyGenerated` se cuenta con
      `manager.count(RewardRedemption, { userId, earnedAt: And(MoreThanOrEqual(start),
      LessThan(end)) })` DENTRO de la misma transacción con lock pesimista sobre el usuario — 1 test
      unitario directo + 1 test e2e con 3 pedidos reales seguidos (100→1 premio, +5→sigue en 1,
      +100→2 premios) que confirma el comportamiento a nivel de negocio, no solo de implementación
- [x] Expiración de premios: `premiosDisponibles` filtra `usedAt: IsNull(), expiresAt: MoreThan(now)`
      — un premio vencido no aparece en `GET /rewards/progress` y `validateForOrder` lo rechaza
      explícitamente con `expiresAt.getTime() < Date.now()` (400 "Este premio ha expirado"),
      cubierto en unit y e2e, e2e confirma además que NO se crea el pedido (conteo de `/orders/me`
      antes/después idéntico)
- [x] Canje inválido, las 6 ramas de `validateForOrder` (todas con test directo unitario Y, para las
      relevantes al flujo completo, también e2e con mutación real de datos):
      - [x] Premio de OTRO usuario → 400 "Este premio no pertenece a tu cuenta", no crea el pedido
      - [x] Premio ya usado (reintento tras canje válido) → 400 "Este premio ya fue canjeado"
      - [x] Premio vencido → 400 "Este premio ha expirado"
      - [x] Producto no canjeable (`redeemableWithStars=false`) → 400 con mensaje que menciona "no es
            canjeable con estrellas"
      - [x] `quantity≠1` en el ítem que trae `rewardRedemptionId` → 400 "Un premio canjeado solo
            habilita 1 unidad del producto", no crea el pedido, el premio sigue disponible después
      - [x] Mismo `rewardRedemptionId` repetido en DOS ítems del mismo pedido → 400 "No puedes usar
            el mismo premio más de una vez en el mismo pedido" (guardia `seenRewardIds`, dentro de
            `buildItems`, antes de llegar a la transacción)
- [x] Reactivación de premio al cancelar el pedido: `reactivateForCancelledOrder` revierte
      `usedAt`/`usedInOrderId`/`menuItemId` a `null` para TODOS los premios que ese pedido canjeó
      (puede ser más de uno), dentro de la misma transacción de `updateStatus` — confirmado con test
      unitario (2 premios revertidos de una vez) y con el flujo e2e completo (canjear → cancelar →
      el premio reaparece en `premiosDisponibles` del dueño real). Confirmado leyendo
      `VALID_TRANSITIONS` que `entregado → cancelado` NO es una transición válida (array vacío para
      `ENTREGADO`), así que un premio legítimamente entregado nunca puede reactivarse por error vía
      esta ruta
- [x] Validación de solapamiento de `StarPromotion`, crear Y editar: `assertNoOverlap` solo considera
      promociones `active=true` (`promo.active = true` en el `WHERE`), compara
      `startDate <= :endDate AND endDate >= :startDate` (rango inclusivo), y en `update()` excluye la
      propia promoción (`promo.id != :excludeId`) — confirmado con unit tests dedicados a cada rama y
      con e2e real (crear solapada → 400 con el mensaje exacto; `PATCH` que hace que el rango se
      solape con otra activa → 400; mes siguiente sin solapar → 201)
- [x] `PATCH active:false` NO dispara la validación de solapamiento aunque las fechas se
      solapen con otra promoción activa existente: confirmado leyendo el código
      (`if (promotion.active) { await this.assertNoOverlap(...) }`, evaluado DESPUÉS del `merge`, así
      que si el DTO trae `active: false` la condición es falsa y `assertNoOverlap` ni se llama) y con
      test unitario + e2e dedicados (`expect(repo.createQueryBuilder).not.toHaveBeenCalled()` en
      unit; e2e real: `PATCH` con `{active:false, startDate: <fecha solapada>}` → 200, no 400)
- [x] `GET /rewards/progress` NO expone `soles_por_estrella` (el campo ni siquiera existe en
      `RewardsProgress`) ni el valor crudo de la setting — confirmado leyendo el código
      (`RewardsProgress` interface solo expone `estrellasParaProximoPremio`, `estrellasPorPremio`,
      `premiosDisponibles`, `promocionActiva`) y con `curl` real contra el servidor y Postgres local
      reales (usuario real registrado en esta sesión): la respuesta real fue exactamente
      `{"estrellasParaProximoPremio":0,"estrellasPorPremio":10,"premiosDisponibles":[],"promocionActiva":null}`
      — sin ninguna clave `soles*`/`solesPorEstrella`. `estrellasPorPremio` SÍ se expone a propósito
      (es el denominador necesario para la barra de progreso del cliente, ej. "3/10"), no es un dato
      sensible de negocio — a diferencia de `soles_por_estrella` (el "precio" en soles de una
      estrella), que si se expusiera revelaría al cliente el umbral de gasto exacto que el negocio no
      necesariamente quiere hacer público
- [x] Seguridad: `POST /auth/register` (mismo flujo usado para generar el token de prueba real
      contra el servidor) confirma que `password` no aparece en el JSON de la respuesta (ni la clave
      ni el valor). `GET/POST/PATCH /star-promotions` (admin): 401 sin token, 403 para `cliente`
      real (no solo mockeado) — confirmado con e2e real. `GET /rewards/progress`,
      `GET /rewards/catalog`: 401 sin token — confirmado con e2e real
- [x] Documentación: confirmado contra `/docs-json` real (servidor levantado) que los 6 endpoints
      nuevos (`GET /rewards/progress`, `GET /rewards/catalog`, `GET/POST /star-promotions`,
      `GET/PATCH /star-promotions/:id`) documentan `security: [{bearer:[]}]` y los status codes
      correctos (401/403/404/400 según aplica); `CreateStarPromotionDto`/`UpdateStarPromotionDto`
      documentan sus 5 campos con ejemplos; `CreateMenuItemDto.redeemableWithStars` y
      `CreateOrderItemDto.rewardRedemptionId` están documentados con `@ApiPropertyOptional` y
      descripción real (confirmado el texto exacto contra el JSON de Swagger real, no asumido)
- [x] **Verificado con mutación real por `@tester` (guardia de duplicado en `OrdersService
      .buildItems`)**: se deshabilitó el chequeo `seenRewardIds.has(...)` (forzado a
      `if (false && seenRewardIds.has(...))`) — rompió **exactamente** 1/31 tests de
      `rewards.e2e-spec.ts` (el de "repetir el mismo rewardRedemptionId en dos ítems del mismo
      pedido", que pasó de 400 a 201) y ningún otro (30/31 en verde con la mutación). Mutación
      revertida, `git diff --stat` confirma el archivo idéntico al estado previo a la mutación
      (mismas 94 líneas de diff que al inicio de la auditoría), suite completa vuelve a 391/391
      unit + 329/329 e2e
- [x] **Verificado con mutación real por `@tester` (rango inclusivo de `assertNoOverlap`)**: se
      cambió `startDate <= :endDate` / `endDate >= :startDate` a `<`/`>` (rango exclusivo) — **la
      suite completa de `rewards.e2e-spec.ts` siguió en verde, 31/31**, revelando un hallazgo real de
      cobertura (ver ⚠️ abajo): ningún test ejercita el caso borde de dos promociones cuyo rango se
      TOCA exactamente en un día (ej. una termina `2026-01-31`, otra empieza `2026-01-31`). Mutación
      revertida inmediatamente, confirmado que el archivo volvió al estado previo
- [x] **Bug real de fragilidad encontrado y corregido por `@tester` en el propio archivo e2e (no en
      código de producción)**: al ejecutar `pnpm run test:e2e -- rewards` contra el Postgres local
      real, la suite falló 5/31 con errores como `expected 201, got 400` y
      `"startDate debe ser anterior o igual a endDate"` en vez del mensaje de solapamiento esperado.
      Causa raíz confirmada: la BD local tenía datos huérfanos de una exploración manual anterior
      (una `StarPromotion` llamada "QA solapada" con fechas `2031-01-20`/`2031-02-10`, `active:true`,
      con un usuario `rewards-client-*@test.com` que no sigue el patrón `qa-rewards-*` de este
      archivo — no fue creada por esta suite ni por su `afterAll`). El bloque de tests de
      `StarPromotions` usaba `const year = new Date().getFullYear() + 5` — un valor **fijo**, no
      atado a una corrida específica (a diferencia del resto del archivo, que sí usa
      `suffix = Date.now()` para los emails) — así que cualquier promoción activa que quede en esa
      misma ventana de fechas de una corrida interrumpida, prueba manual, o simplemente una segunda
      corrida en el mismo año calendario, produce falsos negativos reproducibles. Se confirmó la
      causa desactivando (`UPDATE ... SET active=false`, NUNCA `DELETE`, para no destruir datos que
      no eran míos) la promoción huérfana y re-corriendo: 31/31 en verde. **Fix aplicado en
      `test/rewards.e2e-spec.ts`** (único archivo de test, dentro de mi alcance como `@tester`):
      `const year = 2030 + (suffix % 500)` — cada corrida usa su propia ventana de fechas real,
      igual criterio que ya usa el resto del archivo con los emails. Verificado: `pnpm run test:e2e`
      completo re-corrido 2 veces más tras el fix, 329/329 ambas veces
- [x] Prueba real end-to-end adicional (no solo la suite automatizada) contra el servidor
      (`pnpm run start:dev`, levantado por `@tester` con Docker Desktop iniciado manualmente ya que
      el entorno de la sesión principal no lo tenía activo) y Postgres local reales: usuario real
      registrado vía `POST /auth/register` → `password` ausente de la respuesta real (no solo del
      mock) → `GET /rewards/progress` real devolvió
      `{"estrellasParaProximoPremio":0,"estrellasPorPremio":10,"premiosDisponibles":[],"promocionActiva":null}`.
      Usuario de prueba borrado de la BD al finalizar

⚠️ Riesgos / casos borde no cubiertos (bajo riesgo, no bloqueantes):
- **Confirmado con mutación real que sobrevive**: no hay ningún test (unitario ni e2e) del caso
  borde exacto en que dos `StarPromotion` se TOCAN en un solo día (una `endDate` igual a la
  `startDate` de la otra). El código (`<=`/`>=`, rango inclusivo) trata eso como solapamiento —
  decisión de negocio razonable (evita ambigüedad de qué multiplicador aplica ese día), pero ningún
  test lo confirma explícitamente ni protege contra una futura simplificación accidental a un rango
  exclusivo (la mutación de arriba lo demostró: 31/31 en verde con el operador invertido). Vale la
  pena agregar un caso explícito con `endDate` de una promo == `startDate` de otra (debe rechazar
  con 400) y un caso con un día real de separación (`endDate` + 1 día == `startDate` de la otra, debe
  aceptar con 201).
- No hay ninguna prueba de concurrencia real (dos requests simultáneas) para el lock pesimista de
  `validateForOrder`/`recalculateForUser` — el patrón es idéntico al de `CouponsService`, ya
  auditado y confirmado en producción, pero no hay un test dedicado que dispare 2 canjes
  concurrentes del mismo `rewardRedemptionId` y confirme que solo uno gana (mismo gap que ya existía
  para Coupons, no una regresión nueva de este módulo).
- El multiplicador de una `StarPromotion` no tiene límite superior de negocio más allá de
  `@Max(99.99)` en el DTO — no hay test de qué pasa con un multiplicador muy alto combinado con un
  pedido grande (overflow/redondeo), aunque `round2()` y `Math.floor()` deberían comportarse bien
  con cualquier valor razonable; no ejercitado explícitamente.
- Los dos usuarios (`rewards-admin-1787683931@test.com`, `rewards-client-1787683931@test.com`) y la
  `StarPromotion` "Test promo" que quedaron huérfanos de una exploración manual previa a esta
  auditoría (no de esta suite) se dejaron intactos en la BD local (solo se desactivó "Test promo" y
  "QA solapada" con `active=false`, sin borrar nada) — quedan como basura de datos en el entorno
  local, sin efecto sobre ningún test tras el fix aplicado, pero vale la pena limpiarlos a mano en
  algún momento.

**Veredicto: LISTO.** Todo lo crítico del checklist pasa: build/lint limpios (confirmados de forma
independiente), `tsc --noEmit` sin errores nuevos (19 preexistentes, idénticos a `origin/master`,
comparación corregida con `git stash -u`), 391/391 unit (22 suites) y 329/329 e2e (13 suites)
confirmados de forma independiente contra Postgres local real (no solo el conteo reportado por la
sesión principal), migración verificada 1:1 contra la BD real sin drift, Swagger completo y
verificado contra `/docs-json` real, seguridad confirmada (`password` nunca expuesto, 401/403 reales
en los endpoints de admin y de cliente), y los 7 puntos de negocio específicos pedidos para esta
auditoría (cálculo con/sin promoción, más de un premio de una vez, no regeneración mensual,
expiración, las 6 ramas de canje inválido, reactivación al cancelar, solapamiento de promociones en
crear/editar/con `active:false`, y no-exposición de `soles_por_estrella`/`estrellas_por_premio`
crudos) verificados uno por uno, varios con mutación real. Se encontró y corrigió **dentro del
propio archivo de test** (no en código de producción, dentro del alcance de `@tester`) una
fragilidad real de aislamiento de datos en `test/rewards.e2e-spec.ts` que causaba falsos negativos
reproducibles contra una BD con datos residuales. El único hallazgo ⚠️ que sobrevivió una mutación
real (rango inclusivo de fechas solapadas en el límite exacto de un día) no es bloqueante, pero vale
la pena cerrarlo en una vuelta futura dado que ya se demostró que el código es mutable ahí sin que
ningún test lo detecte hoy.
