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

/** Offset fijo de Lima para armar instantes a partir de fechas calendario. */
const LIMA_OFFSET = '-05:00';

/**
 * Instantes de inicio (00:00:00.000) de `from` y fin (23:59:59.999) de `to`, ambos
 * fechas calendario YYYY-MM-DD en Lima. Se comparan directo contra columnas
 * `timestamptz`.
 */
export function limaDayRange(
  from: string,
  to: string,
): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00.000${LIMA_OFFSET}`),
    end: new Date(`${to}T23:59:59.999${LIMA_OFFSET}`),
  };
}

/** Fecha calendario (YYYY-MM-DD) en Lima de un instante. */
export function toLimaDateString(instant: Date = new Date()): string {
  return instant.toLocaleDateString('en-CA', { timeZone: LIMA_TIMEZONE });
}

/** Suma `days` días a una fecha calendario YYYY-MM-DD (aritmética en UTC, sin zona). */
export function shiftCalendarDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de una fecha calendario YYYY-MM-DD. */
export function mondayOfCalendarDate(date: string): string {
  const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay(); // 0=domingo
  return shiftCalendarDate(date, -((dayOfWeek + 6) % 7));
}

/** Fechas calendario de `from` a `to` (ambas incluidas), en orden ascendente. */
export function calendarDatesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftCalendarDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/**
 * Expresión SQL con el día calendario (YYYY-MM-DD) en Lima de una columna
 * `timestamptz`, ej. `limaDaySql('order.deliveredAt')` en un query builder.
 */
export function limaDaySql(column: string): string {
  return `to_char(${column} AT TIME ZONE '${LIMA_TIMEZONE}', 'YYYY-MM-DD')`;
}
