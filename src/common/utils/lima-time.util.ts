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
