import { currentMinutesInLima, todayDayOfWeekInLima } from './lima-time.util';

// Lima es UTC-5 todo el año (sin horario de verano): un instante UTC se
// construye sumando 5 horas a la hora de Lima deseada.
describe('lima-time.util', () => {
  describe('todayDayOfWeekInLima', () => {
    it('devuelve el día de la semana (0=domingo) según la hora de Lima, no UTC', () => {
      // Viernes 2026-08-21 23:30 Lima = sábado 2026-08-22 04:30 UTC.
      const reference = new Date('2026-08-22T04:30:00.000Z');
      expect(todayDayOfWeekInLima(reference)).toBe(5); // viernes en Lima
    });

    it('cruza al día siguiente cuando la hora UTC ya pasó medianoche en Lima', () => {
      // Sábado 2026-08-22 00:30 Lima = sábado 2026-08-22 05:30 UTC.
      const reference = new Date('2026-08-22T05:30:00.000Z');
      expect(todayDayOfWeekInLima(reference)).toBe(6); // sábado en Lima
    });
  });

  describe('currentMinutesInLima', () => {
    it('convierte la hora de Lima a minutos desde medianoche', () => {
      // 2026-08-21 11:00 Lima = 2026-08-21 16:00 UTC → 11*60 = 660.
      const reference = new Date('2026-08-21T16:00:00.000Z');
      expect(currentMinutesInLima(reference)).toBe(660);
    });

    it('calcula correctamente minutos después de medianoche', () => {
      // 2026-08-22 00:30 Lima = 2026-08-22 05:30 UTC → 30.
      const reference = new Date('2026-08-22T05:30:00.000Z');
      expect(currentMinutesInLima(reference)).toBe(30);
    });

    it('sin argumento usa la hora real actual (no lanza, devuelve un número válido)', () => {
      const minutes = currentMinutesInLima();
      expect(minutes).toBeGreaterThanOrEqual(0);
      expect(minutes).toBeLessThan(24 * 60);
    });
  });
});
