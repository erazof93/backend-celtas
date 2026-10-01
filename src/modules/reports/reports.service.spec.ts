import { ValidationArguments } from 'class-validator';
import {
  isCalendarDate,
  IsPeriodRange,
  IsReportRangeValid,
  parsePeriod,
} from './dto/report-range.validators';
import { percentChange } from './reports.service';

const rangeArgs = (
  startDate: string,
  endDate: string,
): ValidationArguments => ({
  value: endDate,
  object: { startDate, endDate },
  property: 'endDate',
  targetName: 'ReportRangeQueryDto',
  constraints: [],
});

describe('Reports — percentChange', () => {
  it.each([
    [12500, 11200, '+11.6%'],
    [420, 380, '+10.5%'],
    [97, 100, '-3.0%'],
    [100, 100, '0.0%'],
    // -0.04% redondea a 0: nunca "-0.0%".
    [99.96, 100, '0.0%'],
    [0, 50, '-100.0%'],
  ])('%p vs %p → %p', (current, previous, expected) => {
    expect(percentChange(current, previous)).toBe(expected);
  });

  it('devuelve null si el período anterior es 0 (no hay base)', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe('Reports — validación de fechas', () => {
  it('isCalendarDate exige YYYY-MM-DD y una fecha que exista', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true); // bisiesto
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-9-01')).toBe(false);
    expect(isCalendarDate('2026-09-01T00:00:00Z')).toBe(false);
    expect(isCalendarDate(20260901)).toBe(false);
  });

  it('IsReportRangeValid: inicio <= fin y como máximo 366 días (ambos incluidos)', () => {
    const constraint = new IsReportRangeValid();
    const check = (from: string, to: string) =>
      constraint.validate(to, rangeArgs(from, to));

    expect(check('2026-09-01', '2026-09-01')).toBe(true);
    expect(check('2026-09-02', '2026-09-01')).toBe(false);
    expect(check('2024-01-01', '2024-12-31')).toBe(true); // 366 días (bisiesto)
    expect(check('2025-01-01', '2026-01-01')).toBe(true); // 366 días
    expect(check('2025-01-01', '2026-01-02')).toBe(false); // 367 días
    // Si una fecha es inválida, lo reporta su propio validador, no este.
    expect(check('2026-02-30', '2026-01-01')).toBe(true);
    expect(
      constraint.defaultMessage(rangeArgs('2025-01-01', '2026-01-02')),
    ).toBe('Rango inválido: el rango no puede superar 366 días');
  });

  it('parsePeriod / IsPeriodRange aceptan solo "YYYY-MM-DD:YYYY-MM-DD" válido', () => {
    expect(parsePeriod('2026-09-01:2026-09-30')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(parsePeriod('2026-09-01')).toBeNull();
    expect(parsePeriod('2026-09-01:2026-09-31')).toBeNull();
    expect(parsePeriod('2026-09-01/2026-09-30')).toBeNull();

    const constraint = new IsPeriodRange();
    expect(constraint.validate('2026-09-01:2026-09-30')).toBe(true);
    expect(constraint.validate('2026-09-30:2026-09-01')).toBe(false);
    expect(constraint.validate(undefined)).toBe(false);
  });
});
