/** GeoJSON positions use longitude first. Only one exterior ring is supported. */
export type Position = [number, number];
export interface DeliveryPolygon {
  type: 'Polygon';
  coordinates: Position[][];
}

// Angular tolerance for planar predicates. Reject near-degenerate geometry.
const EPSILON = 1e-10;
export const MAX_RING_POSITIONS = 500;

export function validDeliveryCoordinates(
  latitude: number,
  longitude: number,
): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function cross(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function side(a: Position, b: Position, p: Position): number {
  const value = cross(a, b, p);
  const tolerance = EPSILON * Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.abs(value) <= tolerance ? 0 : Math.sign(value);
}

function onSegment(p: Position, a: Position, b: Position): boolean {
  return (
    side(a, b, p) === 0 &&
    p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

function segmentsIntersect(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): boolean {
  const abC = side(a, b, c),
    abD = side(a, b, d);
  const cdA = side(c, d, a),
    cdB = side(c, d, b);
  return (
    (abC * abD < 0 && cdA * cdB < 0) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  );
}

function signedArea(ring: Position[]): number {
  // Translate to the first vertex to avoid cancellation for small local zones.
  let area = 0;
  for (let i = 1; i < ring.length - 1; i++)
    area += cross(ring[0], ring[i], ring[i + 1]);
  return area / 2;
}

/** Returns a Spanish validation error, or null for a simple local polygon. */
export function deliveryPolygonError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'polygon debe ser un objeto GeoJSON Polygon';
  const polygon = value as Record<string, unknown>;
  if (
    Object.keys(polygon).some(
      (key) => key !== 'type' && key !== 'coordinates',
    ) ||
    polygon.type !== 'Polygon'
  ) {
    return 'polygon debe contener solo type="Polygon" y coordinates';
  }
  if (!Array.isArray(polygon.coordinates) || polygon.coordinates.length !== 1) {
    return 'polygon debe tener un único anillo exterior, sin huecos';
  }
  const rawRing: unknown = polygon.coordinates[0];
  if (
    !Array.isArray(rawRing) ||
    rawRing.length < 4 ||
    rawRing.length > MAX_RING_POSITIONS
  ) {
    return `El anillo debe tener entre 4 y ${MAX_RING_POSITIONS} posiciones incluyendo el cierre`;
  }
  for (const point of rawRing as unknown[]) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !validDeliveryCoordinates(point[1], point[0])
    ) {
      return 'Cada posición debe ser [longitude, latitude] con números finitos y dentro de rango';
    }
  }
  const ring = rawRing as Position[];
  const first = ring[0],
    last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1])
    return 'El anillo exterior debe estar cerrado';
  if (
    Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0])) >=
    180
  ) {
    return 'El polígono debe ser local y no cruzar el antimeridiano';
  }
  const count = ring.length - 1;
  for (let i = 0; i < count; i++) {
    const a = ring[i],
      b = ring[i + 1],
      c = ring[(i + 2) % count];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= EPSILON)
      return 'El polígono tiene segmentos degenerados';
    // Adjacent edges may be collinear, but cannot fold back onto themselves.
    if (
      side(a, b, c) === 0 &&
      (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0
    ) {
      return 'El polígono tiene segmentos superpuestos';
    }
    for (let j = i + 1; j < count; j++) {
      if (j === i + 1 || (i === 0 && j === count - 1)) continue;
      if (segmentsIntersect(a, b, ring[j], ring[j + 1]))
        return 'El polígono tiene autointersecciones o vértices repetidos';
    }
  }
  if (Math.abs(signedArea(ring)) <= EPSILON * EPSILON)
    return 'El polígono no puede tener área cero';
  return null;
}

/** Boundary-inclusive ray casting; callers validate the polygon before storage. */
export function pointInDeliveryPolygon(
  point: Position,
  polygon: DeliveryPolygon,
  includeBoundary = true,
): boolean {
  if (!validDeliveryCoordinates(point[1], point[0])) return false;
  const ring = polygon.coordinates[0];
  let inside = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i],
      b = ring[i + 1];
    if (onSegment(point, a, b)) return includeBoundary;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

function parameter(point: Position, a: Position, b: Position): number {
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])
    ? (point[0] - a[0]) / (b[0] - a[0])
    : (point[1] - a[1]) / (b[1] - a[1]);
}

/** Detect interior intersections, containment and coincident boundaries. Shared borders are allowed. */
export function deliveryPolygonsOverlap(
  first: DeliveryPolygon,
  second: DeliveryPolygon,
): boolean {
  const aRing = first.coordinates[0],
    bRing = second.coordinates[0];
  const interiorSideA = Math.sign(signedArea(aRing)),
    interiorSideB = Math.sign(signedArea(bRing));
  for (let i = 0; i < aRing.length - 1; i++) {
    const a = aRing[i],
      b = aRing[i + 1];
    if (pointInDeliveryPolygon(a, second, false)) return true;
    const cuts = [0, 1];
    for (let j = 0; j < bRing.length - 1; j++) {
      const c = bRing[j],
        d = bRing[j + 1];
      if (!segmentsIntersect(a, b, c, d)) continue;
      const denominator =
        (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      if (side(a, b, c) === 0 && side(a, b, d) === 0) {
        const tc = parameter(c, a, b),
          td = parameter(d, a, b);
        const lo = Math.max(0, Math.min(tc, td)),
          hi = Math.min(1, Math.max(tc, td));
        const dot =
          (b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1]);
        // Coincident edge with interiors on the same side implies interior overlap.
        if (hi > lo && interiorSideA * interiorSideB * Math.sign(dot) > 0)
          return true;
        cuts.push(lo, hi);
      } else if (denominator !== 0) {
        const t =
          ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) /
          denominator;
        cuts.push(Math.max(0, Math.min(1, t)));
      }
    }
    cuts.sort((x, y) => x - y);
    for (let k = 0; k < cuts.length - 1; k++) {
      const t = (cuts[k] + cuts[k + 1]) / 2;
      if (
        pointInDeliveryPolygon(
          [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
          second,
          false,
        )
      )
        return true;
    }
  }
  return bRing
    .slice(0, -1)
    .some((p) => pointInDeliveryPolygon(p, first, false));
}
