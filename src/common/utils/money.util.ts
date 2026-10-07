import { BadRequestException } from '@nestjs/common';

/** PostgreSQL numeric(10,2); nonnegative business amounts. */
export const MAX_MONEY = 99_999_999.99;
export const MAX_MONEY_CENTS = 9_999_999_999;

/** Round a nonnegative monetary amount half up to cents. */
export function toCents(value: number, field = 'monto'): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONEY) {
    throw new BadRequestException(field + ' debe estar entre 0 y ' + MAX_MONEY);
  }
  return Math.round((value + Number.EPSILON * value) * 100);
}

export function fromCents(cents: number, field = 'monto'): number {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_MONEY_CENTS) {
    throw new BadRequestException(
      field + ' excede el rango monetario permitido',
    );
  }
  return cents / 100;
}

/** Round the discount once, cap it at subtotal, then subtract integer cents. */
export function discountedSubtotal(
  subtotal: number,
  value: number,
  percentage: boolean,
): number {
  const cents = toCents(subtotal, 'subtotal');
  toCents(value, 'descuento');
  const discount = percentage
    ? Math.round((cents * Math.round(Math.min(value, 100) * 100)) / 10_000)
    : toCents(value, 'descuento');
  return fromCents(cents - Math.min(cents, discount), 'subtotal descontado');
}
