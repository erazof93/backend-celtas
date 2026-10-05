# Celtas Backend — estado actual

Revisión del código: 2026-10-03. “Implementado” describe funcionalidades presentes;
no certifica tests ejecutados hoy ni despliegue actual. Consultar para planificación.

## Módulos implementados

- Auth/Users: JWT, Google, perfiles, direcciones, teléfonos y token FCM.
- Catálogos: menú/categorías, salsas, bebidas, porciones extras y tipos de papas.
- Orders: checkout WhatsApp, pedidos manuales/anónimos, vinculación, estados,
  snapshots, delivery por distancia y geocodificación.
- Coupons: manuales/campañas, automáticos y configuración editable.
- Rewards: estrellas mensuales, hitos, premios especiales y canjes.
- Banners/Notifications: promociones vigentes, imágenes, push y broadcast.
- Settings: horarios, cierre manual, WhatsApp y parámetros operativos.
- Admin/Reports: dashboard y reportes por canal y día de Lima.
- Infraestructura local: configuración Joi, migraciones y suites unitarias/e2e.
- Instrucciones/documentación de Codex: migración documental completada.

## En progreso

No se puede confirmar una implementación en progreso en esta revisión del código.
El plan de zonas menciona otra rama; no está implementado en el árbol revisado.

## Pendientes confirmados y próximas prioridades

1. Tipar respuestas 200 de reportes en Swagger: descripciones sin schemas de respuesta.
   Coordinar regeneración de tipos con el panel React.
2. Evaluar límites monetarios de price en DTOs de menú/bebidas/porciones extras:
   validación mínima sin tope correspondiente a decimal(10,2).
3. Revisar errores de tipos de specs registrados en el historial antes de asumir
   el mismo baseline; no revalidados en esta migración.

## Requiere decisión del desarrollador

- Prioridad y diseño de [delivery por polígonos](docs/planning/plan-delivery-zones.md).
- Si store_location está cargado y la cadena de migraciones/arranque sigue configurada
  en producción; no verificable por la configuración versionada.
- Si el corte de cupones por último cupón de cualquier origen y createdAt sigue
  siendo la regla de negocio deseada.
- Zona horaria del cron y atribución de clientes con teléfono compartido.
- Broadcast automático al crear banners: no implementado; requiere definición de producto.

Ideas: [marketing](docs/planning/marketing-celtas.md).
Antecedentes: [roadmap histórico](docs/history/roadmap-history.md) y
[auditorías](docs/history/qa-audits.md). Consultarlos solo para investigaciones específicas.
