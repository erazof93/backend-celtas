import { BadRequestException } from '@nestjs/common';
import {
  MAX_MONEY,
  toCents,
  fromCents,
  discountedSubtotal,
} from './money.util';

describe('Money policy', () => {
  it.each([
    [10.01, 50, 5],
    [10.03, 50, 5.01],
    [0.01, 50, 0],
    [0.03, 50, 0.01],
  ])('rounds discount once: %s / %s', (subtotal, percentage, expected) => {
    expect(discountedSubtotal(subtotal, percentage, true)).toBe(expected);
  });
  it.each([
    [10.01, 2, 8.01],
    [10.01, 20, 0],
    [10.01, 0, 10.01],
  ])('caps fixed discount', (subtotal, fixed, expected) => {
    expect(discountedSubtotal(subtotal, fixed, false)).toBe(expected);
  });
  it('keeps exact cent arithmetic with delivery', () => {
    const subtotal = toCents(10.01),
      discounted = toCents(discountedSubtotal(10.01, 50, true));
    expect(fromCents(subtotal - (subtotal - discounted) + toCents(2))).toBe(7);
    expect(fromCents(toCents(MAX_MONEY))).toBe(MAX_MONEY);
  });
  it.each([-1, NaN, Infinity, MAX_MONEY + 0.01])(
    'rejects invalid money %s',
    (value) => expect(() => toCents(value)).toThrow(BadRequestException),
  );
  it('rejects aggregate overflow', () =>
    expect(() => fromCents(toCents(MAX_MONEY) + 1)).toThrow(
      BadRequestException,
    ));
});
