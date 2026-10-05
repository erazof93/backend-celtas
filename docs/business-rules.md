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

## Delivery y horarios

- Implementación actual: Haversine desde store_location y tarifas delivery_fee_tiers,
  ambos en settings. No hay tabla ni módulo de zonas por polígonos.
- Con coordenadas y ubicación del local sin configurar, el cálculo produce 404.
  Sin coordenadas se conserva el fallback deliveryFee=0.
- La distancia expuesta se redondea a 50 m; la tarifa usa la distancia exacta.
  isFarOrder avisa de distancia; no bloquea automáticamente por estar lejos.
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

[Zonas de delivery](planning/plan-delivery-zones.md) y
[marketing](planning/marketing-celtas.md) son ideas pendientes de decisión, no contratos vigentes.
