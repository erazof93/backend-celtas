# Plan: Zonas de Delivery por Polígonos

**Estado:** En desarrollo (rama: `feature/delivery-zones`)  
**Fecha:** Octubre 1, 2026  
**Responsable:** Feli + team

---

## 1. Especificación Técnica

### 1.1 Objetivo
Implementar un sistema de zonas de delivery basadas en polígonos geográficos (GeoJSON) con costos fijos por zona, en lugar de cálculo por distancia recta.

### 1.2 Estructura de Datos

**Tabla: `delivery_zones`**
```sql
CREATE TABLE delivery_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,           -- "Zona Centro", "Zona Sur", etc
  polygon JSONB NOT NULL,               -- GeoJSON polygon
  cost_soles DECIMAL(10, 2) NOT NULL,   -- S/ 3.00, S/ 4.00, etc
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Formato GeoJSON:**
```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [-12.123456, -76.456789],  // punto 1
      [-12.124456, -76.456789],  // punto 2
      [-12.124456, -76.457789],  // punto 3
      [-12.123456, -76.457789],  // punto 4
      [-12.123456, -76.456789]   // cierre (mismo que punto 1)
    ]
  ]
}
```

---

## 2. Backend (NestJS)

### 2.1 Archivos a Crear
- `src/database/migrations/TIMESTAMP-AddDeliveryZones.ts`
- `src/modules/delivery/entities/delivery-zone.entity.ts`
- `src/modules/delivery/dto/create-delivery-zone.dto.ts`
- `src/modules/delivery/dto/update-delivery-zone.dto.ts`
- `src/modules/delivery/dto/index.ts`
- `src/modules/delivery/delivery.service.ts`
- `src/modules/delivery/delivery.controller.ts`
- `src/modules/delivery/delivery.module.ts`
- `test/delivery.e2e-spec.ts`

### 2.2 Archivos a Modificar
- `src/app.module.ts` (importar DeliveryModule)
- `src/database/data-source.ts` (si es necesario)

### 2.3 Endpoints
```
POST   /delivery/zones              → crear zona (admin)
GET    /delivery/zones              → listar zonas (public)
GET    /delivery/cost?lat=X&lng=Y   → obtener costo para ubicación (public)
PATCH  /delivery/zones/:id          → editar zona (admin)
DELETE /delivery/zones/:id          → eliminar zona (admin)
```

### 2.4 Algoritmo Principal
**Point-in-Polygon**: Verifica si un punto [lat, lng] está dentro de un polígono GeoJSON.

```typescript
private isPointInPolygon(
  point: [number, number],
  polygon: GeoJSON
): boolean {
  // Ray casting algorithm
  // Devuelve true si está dentro, false si está fuera
}
```

### 2.5 Validación
- Migración crea tabla en BD local con `npm run migration:run`
- Tests cubren: crear, listar, obtener costo (dentro/fuera), editar, eliminar
- Tests validan Point-in-Polygon algorithm

---

## 3. Admin Panel (React - celtas-admin)

### 3.1 Archivos a Crear
- `src/features/delivery/DeliveryZonesMap.tsx` (componente principal)
- `src/features/delivery/DeliveryZonesList.tsx` (tabla con zonas)
- `src/features/delivery/delivery.service.ts` (llamadas API)

### 3.2 Librerías
```bash
npm install leaflet leaflet-draw
```

### 3.3 Funcionalidad
**Mapa Interactivo (Leaflet):**
1. Mostrar mapa de Lima
2. Control para dibujar nuevos polígonos
3. Cada click = nuevo punto
4. Cierre automático = completar polígono
5. Modal para asignar nombre y costo
6. Guardar en BD (POST /delivery/zones)
7. Mostrar todas las zonas guardadas en el mapa (colores diferentes)

**CRUD:**
- Crear zona (dibujar + modal)
- Editar zona (rediseñar o editar puntos)
- Eliminar zona
- Ver costo de cada zona

### 3.4 Colores por Zona
```
Zona 1 (S/3): Verde
Zona 2 (S/4): Amarillo
Zona 3 (S/6): Rojo
Etc (automático)
```

---

## 4. App Flutter (celtas-app)

### 4.1 Archivos a Crear
- `lib/features/cart/services/delivery_service.dart`
- `lib/features/cart/presentation/widgets/delivery_cost_widget.dart`

### 4.2 Archivos a Modificar
- `lib/features/cart/presentation/cart_screen.dart` (integración)

### 4.3 Flujo
1. Cliente elige ubicación de entrega (dirección con lat/lng)
2. Obtener costo: `GET /delivery/cost?lat=X&lng=Y`
3. Backend devuelve:
   - `{ cost: 3.00, zoneName: "Zona Centro" }` ✅
   - `{ error: "Zona no disponible" }` ❌
4. Mostrar costo en carrito
5. Permitir o bloquear checkout

### 4.4 UI en Carrito
```
Subtotal:        S/ 50.00
Delivery:        S/ 3.00  (Zona Centro)
────────────────────────
Total:           S/ 53.00
```

### 4.5 Validación
- Si fuera de zona: mostrar error
- "Tu dirección está fuera de nuestra zona de entrega"
- Bloquear agregar al pedido

---

## 5. Pasos de Implementación

### Fase 1: Backend ✅ (En progreso)
- [ ] Crear migración
- [ ] Crear Entity + DTOs
- [ ] Crear Service (con Point-in-Polygon)
- [ ] Crear Controller + Endpoints
- [ ] Tests E2E
- [ ] Commit + push rama

### Fase 2: Admin Panel
- [ ] Crear componentes React
- [ ] Instalar Leaflet + leaflet-draw
- [ ] Implementar mapa interactivo
- [ ] CRUD de zonas
- [ ] Tests
- [ ] Commit + push rama

### Fase 3: App Flutter
- [ ] Crear delivery_service
- [ ] Integrar en cart_screen
- [ ] Mostrar costo dinámico
- [ ] Validación de zona
- [ ] Tests
- [ ] Commit + push rama

### Fase 4: Integración + Testing
- [ ] Testing manual en los 3 repos
- [ ] Merge a main
- [ ] Deploy en Render/Supabase

---

## 6. Branching

**Rama principal:** `feature/delivery-zones`

**En los 3 repos:**
```bash
git checkout main
git pull origin main
git checkout -b feature/delivery-zones
```

**Revertir si es necesario:**
```bash
npm run migration:revert  # Backend
git checkout main
git pull origin main
```

---

## 7. Prompts Disponibles

### Backend Prompt
- Migración + Entity + DTOs
- Service con Point-in-Polygon algorithm
- Controller con 5 endpoints
- Tests E2E completos

### Admin Prompt
- Componentes React
- Mapa con Leaflet Draw
- CRUD de zonas
- Integración API

### App Prompt
- Servicio de delivery
- Widget de costo
- Integración en carrito
- Validación de zona

---

## 8. Decisiones Pendientes

- [ ] ¿Incluir cupones automáticos configurables en esta feature?
- [ ] ¿O dejarlo para un PR separado?

---

## 9. Testing

### Backend
- Point-in-Polygon: dentro/fuera/borde
- CRUD: crear, listar, actualizar, eliminar
- Endpoint cost: con y sin zona

### Admin
- Dibujar polígono
- Guardar zona
- Editar zona
- Eliminar zona

### App
- Mostrar costo correcto
- Bloquear si está fuera
- Totales actualizados

---

## 10. Notas Importantes

- **Migraciones:** Se corren automáticamente en Supabase al deploy
- **Revertir:** `npm run migration:revert` + nueva migración
- **GeoJSON:** Formato estándar para polígonos geográficos
- **Leaflet:** Librería ligera para mapas
- **Algoritmo:** Ray casting para Point-in-Polygon (eficiente)

---

**Última actualización:** 2026-10-01 13:00  
**Rama:** `feature/delivery-zones`  
**Estado:** En desarrollo
