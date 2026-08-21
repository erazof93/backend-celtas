import { haversineDistanceMeters } from './geo.util';

describe('haversineDistanceMeters', () => {
  it('devuelve 0 para el mismo punto', () => {
    expect(haversineDistanceMeters(-12.1631, -76.97, -12.1631, -76.97)).toBe(0);
  });

  it('1 grado de latitud en el ecuador ≈ 111.19 km (valor de referencia conocido)', () => {
    const meters = haversineDistanceMeters(0, 0, 1, 0);
    expect(meters).toBeCloseTo(111194.93, 1);
  });

  it('calcula la distancia real entre dos coordenadas de San Juan de Miraflores', () => {
    // Local (store_location de prueba) vs. una dirección cercana (~150m).
    const store = { latitude: -12.1631, longitude: -76.97 };
    const nearby = { latitude: -12.164, longitude: -76.971 };
    const meters = haversineDistanceMeters(
      store.latitude,
      store.longitude,
      nearby.latitude,
      nearby.longitude,
    );
    expect(meters).toBeCloseTo(147.75, 1);
  });

  it('es simétrica (A→B == B→A)', () => {
    const a = haversineDistanceMeters(-12.1631, -76.97, -12.17, -76.96);
    const b = haversineDistanceMeters(-12.17, -76.96, -12.1631, -76.97);
    expect(a).toBeCloseTo(b, 6);
  });
});
