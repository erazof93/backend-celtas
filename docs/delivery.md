# Delivery: distancia y zonas

Contrato del código backend de esta fase; no certifica despliegue ni migraciones
aplicadas en producción. La implementación requiere la migración
`1791244800000-AddDeliveryZones` además de las migraciones previas.

## Configuración y transición

`PATCH /settings` (JWT y rol ADMIN):

```json
{ "key": "delivery_mode", "value": "DISTANCE" }
```

Solo acepta `DISTANCE` o `ZONES`, sensibles a mayúsculas. El seed inicial es
DISTANCE; si la key no existe, también usa DISTANCE. Un valor persistido inválido
produce 400 explícito. No se publica esta key en `/settings/public`.
Activar ZONES exige al menos una zona activa (409 si no existe). Cambiar de modo
conserva tiers, zonas, tarifas y geometrías; no realiza conversiones.

DISTANCE conserva el comportamiento anterior: Haversine desde `store_location`,
primer tramo de `delivery_fee_tiers` con distancia <= maxMeters (null sin techo),
aviso cuando distancia > `delivery_alert_radius_meters`, sin rechazo por distancia.
Las zonas no participan en pricing ni coverage.
Sin coordenadas mantiene tarifa 0 y distancia null. Defaults: <=100 m S/2,
<=400 m S/4, <=1000 m S/6, resto S/8; radio de aviso 2500 m.

ZONES obtiene la tarifa de una zona activa que contenga la coordenada. La
distancia y el aviso siguen siendo Haversine: **store_location debe estar configurada
también en ZONES** para puntos válidos; si falta, responde 404. Los tramos no deciden
la tarifa: nunca se usan como fallback en ZONES. No hay rutas por calles ni geocodificación automática.

Crear catálogo → verificar BD de prueba/migración → preparar Admin/Mobile →
activar ZONES explícitamente. Volver a DISTANCE revierte la selección sin borrar
zonas ni recalcular pedidos históricos. No activar ZONES en clientes antiguos
que todavía no interpreten cobertura: esta fase solo garantiza transición
compatible mientras DISTANCE está activo.

## Catálogo administrativo

Todos requieren JWT y ADMIN; no existen endpoints públicos de polígonos.

| Ruta | Request | Éxito |
|---|---|---|
| GET /delivery/zones | — | 200, data array de zonas ordenado por UUID |
| GET /delivery/zones/:id | UUID | 200, data zona |
| POST /delivery/zones | name, polygon, fee; active opcional | 201, data zona |
| PATCH /delivery/zones/:id | campos anteriores opcionales | 200, data zona |
| DELETE /delivery/zones/:id | UUID | 200, success true; data omitido |

Zona: id UUID, name (texto recortado, 1–100 caracteres), polygon JSONB,
fee numeric(10,2) expuesto como number (0–99999999.99, máximo dos decimales),
active boolean (default true), createdAt/updatedAt timestamptz expuestos como ISO.
PATCH permite `active:false` para desactivar y rechaza null en los cuatro campos.
Nombres no son únicos; la identidad es el UUID. DELETE es físico y no afecta snapshots.

Errores: 400 payload/UUID/geometría inválida, 401 JWT, 403 rol, 404 zona inexistente,
409 solapamiento. Envelope estándar `{success:true,data}`; errores
`{success:false,message,statusCode}` en español. Swagger incluye DTOs de entrada
y respuestas con envelope.

## GeoJSON y geometría

```json
{
  "name": "Centro",
  "polygon": {
    "type": "Polygon",
    "coordinates": [[[-77, -12], [-76.99, -12], [-76.99, -11.99], [-77, -11.99], [-77, -12]]]
  },
  "fee": 5,
  "active": true
}
```

Posiciones exclusivamente **[longitude, latitude]**, dos números finitos; rangos
[-180,180] y [-90,90]. Se acepta exactamente un anillo exterior, 4–500 posiciones
incluyendo cierre idéntico. Sin huecos, MultiPolygon, dimensión Z ni propiedades
adicionales dentro de la geometría. Se permiten polígonos cóncavos y ambos sentidos.

Validación propia de segmentos: rechaza longitud prácticamente cero, retrocesos,
vértices repetidos no adyacentes, autointersecciones, área cero y geometría local
con extensión longitudinal >=180° (sin soporte de antimeridiano). No sustituye
un motor GIS general; predicados planares con tolerancia angular de 1e-10 grados.
El límite de posiciones acota el costo de validación cuadrática.

No se permiten solapamientos interiores en todo el catálogo, **incluidas zonas
inactivas**. Se detectan cruces, contención y bordes coincidentes con interiores
del mismo lado. Se permiten bordes/vértices compartidos. Altas, ediciones y bajas
adquieren el mismo advisory lock transaccional PostgreSQL para evitar carreras
entre escrituras por esta API, incluso con catálogo inicialmente vacío.
Los cambios de delivery_mode comparten ese lock, en transacciones READ COMMITTED.
Con ZONES activo, eliminar/desactivar la última zona activa produce 409; en
DISTANCE se permite un catálogo sin zonas activas. Esto serializa activación de
ZONES frente a bajas/desactivaciones y bajas simultáneas de las últimas zonas.
Checkout no toma ese lock: una edición posterior a su lectura no invalida el
cálculo ya obtenido; no hay congelamiento de cotizaciones.
Escrituras directas a BD no tienen estas garantías geométricas.

El borde cuenta como dentro. Si varias zonas activas coinciden por borde/vértice,
gana el **UUID menor en orden ascendente de PostgreSQL**. Decisión de esta fase:
criterio estable independiente de tarifa, nombre, orden de consulta o fecha de edición;
no implica prioridad comercial. Crear de nuevo una zona puede cambiar el desempate.

## Estimación

GET `/delivery/estimate?latitude=...&longitude=...` conserva JWT, coordenadas
obligatorias, validación de número finito/rango y rechazo de extras/vacíos. HTTP 200:

```json
{
  "success": true,
  "data": {
    "deliveryFee": 5,
    "isFarOrder": false,
    "distanceMeters": 100,
    "isCovered": true,
    "deliveryMode": "ZONES",
    "zone": { "id": "00000000-0000-4000-8000-000000000001", "name": "Centro" }
  }
}
```

Los tres campos anteriores conservan tipos. Solo se expone distancia redondeada
al múltiplo más cercano de 50 m; aviso y tarifa DISTANCE usan la exacta.
`zone` es null en DISTANCE o sin zona; jamás incluye geometría. `isCovered=true`
en DISTANCE significa que el modo permite continuar, incluso sin coordenadas;
no certifica pertenencia a un polígono.

ZONES sin coincidencia devuelve 200 con `isCovered:false`, `zone:null` y
`deliveryFee:0` como **marcador de ausencia de cotización**, no una tarifa gratis.
Con coordenadas válidas mantiene distancia/aviso; sin coordenadas válidas,
distancia null y aviso false, sin consultar zonas/local. GET rechaza coordenadas
inválidas con 400 en el DTO; el caso sin coordenadas aplica al endpoint de dirección
guardada POST `/orders/estimate-delivery-fee` (addressId UUID-v4 propio, HTTP 201).
Ambas cotizaciones usan la misma resolución que checkout y no reservan el precio.

## Pedidos y trazabilidad

POST `/orders`: ZONES sin cobertura o sin coordenadas válidas produce 400 antes
de crear pedido/canjear cupón/premio. Incluye snapshots manuales de texto, JSON
incompleto, números fuera de rango o strings numéricos: no permiten eludir cobertura.
La coordenada guardada o enviada sigue siendo un dato del cliente, no prueba física
de ubicación; no se implementa verificación de domicilio en esta fase.

POST `/orders/admin`: respeta exclusivamente delivery_mode, igual que el cliente.
En ZONES sin cobertura o sin coordenadas válidas rechaza con 400 antes de canjes.
No existe fallback entre motores. En DISTANCE conserva el comportamiento legacy,
incluyendo tarifa 0 sin coordenadas. El admin sigue sin bloqueo horario;
propiedad/cupones/premios no cambian.

El backend recalcula, nunca acepta tarifas del cliente. Se mantiene:
subtotal → descuento cupón → delivery → total redondeado a dos decimales.
Persistencia/canjes siguen en la transacción existente; push posterior al commit.

`orders.deliveryFee` y total conservan tipos/snapshot. Nueva columna nullable
JSONB `deliverySnapshot`:

```json
{ "deliveryMode": "ZONES", "zone": { "id": "...", "name": "Centro" } }
```

DISTANCE: `{deliveryMode:"DISTANCE",zone:null}`. Nuevos pedidos no generan
`fallbackFromZones`; snapshots antiguos que contienen esa marca se conservan.
La tarifa histórica está en deliveryFee. Sin FK ni
polígono ni distancia exacta en el pedido. Cambios/borrados de zona no reescriben
el snapshot. Pedidos anteriores tienen null: no se inventa su configuración pasada.
No se conserva revisión de geometría: explica modo/zona/tarifa, no reproduce
la pertenencia histórica exacta.

## Verificación

Unitarios de geometría, catálogo, settings, orders y HTTP aislado con guards
JWT/ADMIN reales. E2E de orders incorpora cobertura, persistencia y restauración
de modo/catalogo; requiere BD de prueba con migración aplicada. Consultar
[testing](testing-checklist.md) y [migraciones](database-migrations.md).

## Validación de Settings al escribir

PATCH /settings rechaza con 400, antes de persistir, configuraciones críticas
inválidas. delivery_fee_tiers conserva [{maxMeters, fee}]: array no vacío,
umbrales finitos no negativos estrictamente ascendentes y último maxMeters=null.
Las tarifas admiten 0 y hasta 99999999.99, con máximo dos decimales.
store_location exige latitude/longitude numéricas finitas en [-90,90]/[-180,180];
el seed vacío sigue representando local sin configurar, no coordenadas inventadas.
delivery_alert_radius_meters debe ser finito y positivo. business_hours_schedule
requiere días 0–6 con closed boolean y open/close HH:mm válidos; conserva
horarios que cruzan medianoche. business_manual_closed acepta true/false como texto.
Keys desconocidas conservan el comportamiento previo. delivery_mode y sus
invariantes transaccionales no cambian; tampoco los contratos DISTANCE/ZONES.
