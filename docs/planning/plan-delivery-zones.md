# Propuesta: zonas de delivery por polígonos

Estado al 2026-10-03: **no implementado en el árbol revisado**. El documento anterior
indicaba “en desarrollo” en feature/delivery-zones; la existencia o avance de esa
rama no se verificó. Requiere decisión del desarrollador antes de implementarlo.

## Objetivo

Evaluar tarifas fijas por zona GeoJSON como alternativa al cálculo actual por
Haversine y tramos de distancia. Esta propuesta no cambia el contrato vigente:
GET /delivery/estimate requiere JWT, devuelve tarifa/distancia/aviso y no bloquea
pedidos por distancia. Ver [reglas actuales](../business-rules.md#delivery-y-horarios).

## Alcance candidato

- Backend: catálogo de zonas con nombre, polígono JSONB, costo decimal(10,2),
  estado activo y fechas timestamptz. CRUD admin y resolución de punto en zona.
- Migraciones en src/migrations/; CLI en src/data-source.ts. La ruta anterior
  src/database/ no corresponde al proyecto.
- GeoJSON usa [longitude, latitude], no [latitude, longitude]. Validar cierre,
  rango de coordenadas y geometría; decidir soporte de huecos/multipolígonos.
- Evaluar point-in-polygon (ray casting u otra solución justificada) sin añadir
  dependencias pesadas por defecto. Probar dentro/fuera/borde y zonas solapadas.
- React: editor/listado de zonas, posible Leaflet + herramienta de dibujo.
  Evaluar compatibilidad y dependencias en el repositorio del panel.
- Flutter: consulta de tarifa y mensaje de cobertura al elegir dirección.
  Coordinar contratos sin modificar repositorios hermanos automáticamente.

## Decisiones antes de construir

1. Sustituir o coexistir con tarifas por distancia; migración de settings actuales.
2. Política para solapamientos, bordes, zonas inactivas y direcciones sin coordenadas.
3. Si estar fuera de zona bloquea checkout; hoy estar lejos solo genera aviso.
4. Acceso autenticado/público y privacidad de polígonos/ubicación del negocio.
5. Rutas y respuesta final: /delivery/zones y /delivery/cost eran candidatas,
   no endpoints existentes ni una autorización para romper /delivery/estimate.
6. Prioridad y coordinación entre backend, React y Flutter; no mezclar cupones
   automáticos como alcance nuevo, su configuración ya está implementada.

## Secuencia y aceptación propuestas

Definir contrato → migración/dominio → cálculo y endpoints → unitarios/e2e →
panel y app → integración y revisión de despliegue. Validar roles, CRUD,
geometría, tarifas, snapshots y compatibilidad. Commits, ramas, merge y deploy
requieren solicitudes específicas; este plan no autoriza operaciones Git.

Consultar [migraciones](../database-migrations.md) y
[testing](../testing-checklist.md) solo cuando se apruebe la implementación.
