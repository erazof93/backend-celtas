/** Zona horaria de Lima (UTC-5, sin horario de verano) — usada en todo el proyecto. */
const LIMA_TIMEZONE = 'America/Lima';

/**
 * Reconstruye el reloj de pared de Lima como Date, para leer día/hora sin
 * importar la zona horaria del servidor. `reference` es el instante real
 * (por defecto ahora); se puede fijar en los tests para controlar la hora.
 */
function limaWallClock(reference: Date = new Date()): Date {
  return new Date(
    reference.toLocaleString('en-US', { timeZone: LIMA_TIMEZONE }),
  );
}

/** Día de la semana actual (0=domingo...6=sábado) en la zona horaria de Lima. */
export function todayDayOfWeekInLima(reference: Date = new Date()): number {
  return limaWallClock(reference).getDay();
}

/** Hora actual en Lima expresada en minutos desde medianoche (0-1439). */
export function currentMinutesInLima(reference: Date = new Date()): number {
  const wallClock = limaWallClock(reference);
  return wallClock.getHours() * 60 + wallClock.getMinutes();
}

/** Año, mes (1-12) y día del mes actuales en Lima — para construir fechas absolutas. */
export function limaWallClockDate(reference: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const wallClock = limaWallClock(reference);
  return {
    year: wallClock.getFullYear(),
    month: wallClock.getMonth() + 1,
    day: wallClock.getDate(),
  };
}

/**
 * Instante UTC absoluto correspondiente a una hora de pared de Lima en una
 * fecha dada (`month` 1-12, no 0-indexado). Lima es UTC-5 fijo (Perú no tiene
 * horario de verano): a diferencia de `limaWallClock` (que LEE la hora actual
 * del reloj del sistema vía `toLocaleString`), esto solo construye un
 * timestamp absoluto sumando 5 horas — no hace falta ningún truco de timezone.
 */
export function limaWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + 5, minute));
}
