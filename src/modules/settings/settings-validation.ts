import { isNumber } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { toCents } from '../../common/utils/money.util';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function invalid(key: string): never {
  throw new BadRequestException('Configuración inválida para ' + key);
}
function parse(key: string, value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalid(key);
  }
}

/** Explicit validation for existing critical keys; unknown keys stay compatible. */
export function validateCriticalSetting(key: string, value: string): void {
  if (key === 'delivery_fee_tiers') {
    const tiers = parse(key, value);
    if (!Array.isArray(tiers) || tiers.length === 0) invalid(key);
    let previous = -1;
    for (let i = 0; i < tiers.length; i++) {
      const tier: unknown = tiers[i];
      if (!object(tier) || !isNumber(tier.fee, { maxDecimalPlaces: 2 }))
        invalid(key);
      toCents(tier.fee, 'fee');
      if (tier.maxMeters === null) {
        if (i !== tiers.length - 1) invalid(key);
      } else {
        if (
          typeof tier.maxMeters !== 'number' ||
          !Number.isFinite(tier.maxMeters) ||
          tier.maxMeters < 0 ||
          tier.maxMeters <= previous ||
          i === tiers.length - 1
        )
          invalid(key);
        previous = tier.maxMeters;
      }
    }
  } else if (key === 'store_location') {
    const location = parse(key, value);
    if (
      !object(location) ||
      typeof location.latitude !== 'number' ||
      typeof location.longitude !== 'number' ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude) ||
      Math.abs(location.latitude) > 90 ||
      Math.abs(location.longitude) > 180
    )
      invalid(key);
  } else if (key === 'delivery_alert_radius_meters') {
    if (
      value.trim() === '' ||
      !Number.isFinite(Number(value)) ||
      Number(value) <= 0
    )
      invalid(key);
  } else if (key === 'business_manual_closed') {
    if (value !== 'true' && value !== 'false') invalid(key);
  } else if (key === 'business_hours_schedule') {
    const schedule = parse(key, value);
    if (!object(schedule) || Object.keys(schedule).length !== 7) invalid(key);
    for (let day = 0; day < 7; day++) {
      const entry = schedule[String(day)];
      if (
        !object(entry) ||
        typeof entry.closed !== 'boolean' ||
        typeof entry.open !== 'string' ||
        typeof entry.close !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.open) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.close)
      )
        invalid(key);
    }
  }
}
