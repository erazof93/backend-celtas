# Reglas de negocio implementadas

Referencia por dominio, contrastada con el código el 2026-10-03. Describe esta
revisión del repositorio; no certifica configuración o datos de producción.

## Autenticación y usuarios

- Registro local exige contraseña y la guarda con bcrypt. Usuarios Google tienen password null.
- Google verifica firma, audiencia y expiración del idToken y exige email verificado.
  Busca por googleId; un email local existente produce conflicto, sin fusión automática.
- Login local rechaza cuentas Google. Access y refresh usan secretos y vigencias separados.
- Roles: cliente y admin. JWT transporta el rol; endpoints comprueban guards y propiedad.
- Un token FCM por usuario; logout puede eliminarlo. No hay soporte multi-dispositivo.
- Teléfonos se normalizan mediante `normalizePhone`, formato internacional sin `+`.

## Pedidos y WhatsApp

- El servidor calcula precios y totales y guarda el pedido pendiente antes del enlace WhatsApp.
  No procesa pagos online ni envía automáticamente mensajes WhatsApp.
- Estados: pendiente → confirmado → en_camino → entregado; cancelación permitida
  desde los tres estados previos. Entregado/cancelado son terminales.
- Cancelar en_camino exige motivo. Cancelación reactiva cupón/premio dentro de la transacción.
- Dirección, nombres, precios y selecciones son snapshots; cambios del catálogo no reescriben pedidos.
- Selecciones omitidas, arrays vacíos y arrays con IDs tienen significados distintos.
  Conservar reglas de grupos required/allowWithout y de límites null.
- Bebidas y porciones extras suman precio por unidad; canjes cubren el producto base,
  no sus extras. Un producto exclusivo de premios puede canjearse aunque no esté disponible para venta normal.
- Pedidos manuales pueden tener userId null y contacto propio; no generan gasto,
  cupones, estrellas o push de cliente hasta una vinculación válida.
- Entrega registra deliveredAt y actualiza totalSpent en transacción. Cupones y
  estrellas se procesan después del commit; sus fallos se registran sin revertir la entrega.
- whatsappSentAt registra la primera confirmación humana de envío, no una entrega de WhatsApp comprobada.

## Importes y redondeo

- Checkout calcula subtotales, descuento y total en céntimos enteros. El descuento
  se redondea una sola vez (mitad hacia arriba) y se limita al subtotal; no afecta delivery.
- Total = subtotal - descuento + deliveryFee, a precisión de dos decimales.
  Ejemplo: subtotal 10.01 y cupón 50% producen descuento 5.01 y saldo 5.00, antes del envío.
- WhatsApp inicial e histórico usan snapshots monetarios del pedido, sin recalcular
  porcentajes desde el cupón actual. No se reescriben pedidos anteriores.
- Precios administrables e importes persistidos deben caber en numeric(10,2):
  de 0 a 99999999.99 (catálogo mantiene sus mínimos actuales). Overflow de
  subtotales, total o gasto acumulado se rechaza con 400 y rollback transaccional.

## Delivery y horarios

- delivery_mode selecciona DISTANCE (default compatible) o ZONES; solo acepta esos valores.
- DISTANCE conserva Haversine desde store_location y delivery_fee_tiers, sin bloqueo
  por distancia y con deliveryFee=0 sin coordenadas.
- ZONES usa zonas activas de delivery_zones: GeoJSON Polygon sin huecos, tarifa fija,
  bordes incluidos y solapamientos interiores prohibidos. El cliente sin cobertura
  o sin coordenadas válidas recibe 400 al crear el pedido.
- Admin y cliente en ZONES se rechazan sin cobertura; no hay fallback a DISTANCE.
  Admin mantiene su excepción de horario, no de cobertura.
- Activar ZONES exige una zona activa; no se puede eliminar/desactivar la última
  mientras ese modo esté activo. Cambiar modo conserva ambos catálogos de configuración.
- En ambos modos, con coordenadas válidas, store_location es necesaria (404 si falta)
  para los diagnósticos. La distancia expuesta se redondea a 50 m; isFarOrder sigue
  comparando la distancia exacta con delivery_alert_radius_meters, nunca cobertura.
- Estimaciones añaden isCovered, deliveryMode y zone (id/nombre, sin polígono).
  En ZONES sin cobertura, deliveryFee=0 es marcador sin cotización, no envío gratis.
- Orders conserva deliveryFee e incorpora deliverySnapshot mínimo e independiente
  del catálogo; pedidos anteriores tienen snapshot null. La tarifa se recalcula al crear.
- Contratos, restricciones y transición: [delivery](delivery.md).
- GET /delivery/estimate requiere JWT. Geoapify permite geocodificación; sin API key responde 503.
- Horarios y cierre manual viven en settings, evaluados para Lima, con nextChangeAt.
  Las pruebas de pedidos deben controlar/restaurar esas settings.

## Cupones

- Manuales, campañas y automáticos tienen vencimiento; los manuales sin expiresAt
  usan COUPON_EXPIRATION_DAYS.
- GET/PUT /coupons/auto-config administra cuatro keys protegidas en settings.
  Las variables de entorno siembran valores faltantes; no sustituyen la configuración persistida.
- Cambiar auto-config afecta cupones nuevos, no los emitidos. Los automáticos no tienen mínimo de compra.
- Generación automática bloquea el usuario y evita otro automático activo vigente.
  El gasto se suma de pedidos entregados cuyo **createdAt** sea posterior al último
  cupón emitido al usuario (incluidos los manuales); no se compara directamente totalSpent.
- Entrega dispara generación; el cron diario es respaldo y también expira cupones.
  Su decorador no fija timeZone: no asumir que “1 AM” significa 1 AM Lima.
- Uso/reactivación se integra a las transacciones del pedido; conservar vencimiento e idempotencia.

## Rewards, banners y reportes

- Estrellas por mes de Lima, hitos configurables y premios especiales. Los premios
  vencen al final del mes; su generación es idempotente con lock de usuario.
- El mes se selecciona por deliveredAt; las estrellas usan subtotales de ítems
  (sin delivery) y el multiplicador de promoción de la fecha createdAt.
- GET /rewards/progress recalcula antes de leer. Canje valida el catálogo y bloquea
  el premio dentro de la transacción del pedido.
- Banners públicos activos filtran vigencia, active y días de semana, ordenados por order.
  Imágenes se suben desde backend a Cloudinary.
- Notificaciones push y broadcast usan Firebase; no equivalen a envío WhatsApp.
- Ventas de dashboard/reportes usan deliveredAt; canal proviene de source, fijado por el servidor.
- Reportes atribuyen anónimos por teléfono normalizado; si lo comparten varios
  clientes gana el más antiguo, con desempate por id. No garantiza identidad real.

## Propuestas

La [propuesta de zonas](planning/plan-delivery-zones.md) remite a la primera fase
backend implementada y sus límites. [Marketing](planning/marketing-celtas.md)
continúa siendo una propuesta, no un contrato vigente.

## Integridad de escrituras concurrentes

- Direcciones: create/update/delete toman un lock de fila del usuario antes de leer o modificar sus direcciones, dentro de una transacción READ COMMITTED. El cambio de principal y el guardado son atómicos; como máximo una principal por usuario por escrituras de la API. Borrar o desmarcar la principal puede dejar cero, sin seleccionar otra automáticamente.
- Promociones de estrellas: todas las creaciones y actualizaciones (incluida activación/desactivación) se serializan con advisory transaction lock `(731942, 2)` antes de comprobar el solapamiento; se conserva el error 400 de fechas. Es un lock distinto al catálogo delivery.
- Rewards: checkout bloquea UUIDs canónicos en orden ascendente; la reactivación por cancelación usa el mismo orden. El orden visual y la asociación item/premio no cambian.
- FCM: UNREGISTERED limpia por usuario **y token enviado**, en un UPDATE condicional. Si cambió el token, cero filas afectadas es normal. Envío y cleanup siguen siendo best effort; los logs omiten tokens y mensajes crudos del proveedor.
- Orden de locks relevante: direcciones Usuario → Dirección; promociones lock catálogo → filas de promoción; checkout Cupón (si aplica) → Rewards por UUID; cancelación Pedido → Cupón → Rewards; entrega Pedido → Usuario. Los catálogos no toman locks de usuario/rewards. SQL directo que omita esta coordinación no queda protegido por la invariancia de aplicación.
