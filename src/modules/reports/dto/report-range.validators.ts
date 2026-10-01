import {
  isISO8601,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Máximo de días (inclusive) que puede abarcar un rango de reporte. */
export const MAX_REPORT_RANGE_DAYS = 366;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_PATTERN = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;

/** YYYY-MM-DD y fecha real de calendario (rechaza 2026-02-30). */
export const isCalendarDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  DATE_PATTERN.test(value) &&
  isISO8601(value, { strict: true });

/** Fecha YYYY-MM-DD que exista en el calendario. */
@ValidatorConstraint({ name: 'isCalendarDateField', async: false })
export class IsCalendarDateField implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isCalendarDate(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} debe ser una fecha válida con formato YYYY-MM-DD`;
  }
}

/** Días que abarca [from, to], ambos incluidos. */
const spanInDays = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  ) + 1;

/**
 * Motivo por el que el rango [from, to] no es válido, o null si lo es. Asume que
 * ambas fechas ya son fechas de calendario válidas.
 */
const rangeProblem = (from: string, to: string): string | null => {
  if (from > to) return 'la fecha de inicio no puede ser posterior a la de fin';
  if (spanInDays(from, to) > MAX_REPORT_RANGE_DAYS) {
    return `el rango no puede superar ${MAX_REPORT_RANGE_DAYS} días`;
  }
  return null;
};

/**
 * `startDate` <= `endDate` y como máximo MAX_REPORT_RANGE_DAYS días. Va sobre
 * `endDate`; si alguna fecha no es válida lo reportan sus propios validadores.
 */
@ValidatorConstraint({ name: 'isReportRangeValid', async: false })
export class IsReportRangeValid implements ValidatorConstraintInterface {
  validate(endDate: unknown, args: ValidationArguments): boolean {
    const { startDate } = args.object as { startDate?: unknown };
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return true;
    return rangeProblem(startDate, endDate) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const { startDate } = args.object as { startDate: string };
    return `Rango inválido: ${rangeProblem(startDate, args.value as string)}`;
  }
}

/** Período como "YYYY-MM-DD:YYYY-MM-DD" con fechas reales, inicio <= fin y tope de días. */
@ValidatorConstraint({ name: 'isPeriodRange', async: false })
export class IsPeriodRange implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    const period = parsePeriod(value);
    return period !== null && rangeProblem(period.from, period.to) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const period = parsePeriod(args.value);
    const problem = period
      ? rangeProblem(period.from, period.to)
      : 'formato esperado YYYY-MM-DD:YYYY-MM-DD con fechas válidas';
    return `${args.property} inválido: ${problem}`;
  }
}

/** Separa "YYYY-MM-DD:YYYY-MM-DD"; null si el formato o alguna fecha no es válida. */
export const parsePeriod = (
  value: unknown,
): { from: string; to: string } | null => {
  if (typeof value !== 'string') return null;
  const match = PERIOD_PATTERN.exec(value);
  if (!match || !isCalendarDate(match[1]) || !isCalendarDate(match[2])) {
    return null;
  }
  return { from: match[1], to: match[2] };
};
