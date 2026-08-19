import { In, Repository } from 'typeorm';
import { Setting } from './../../src/modules/settings/entities/setting.entity';
import {
  BUSINESS_HOURS_SCHEDULE_KEY,
  BUSINESS_MANUAL_CLOSED_KEY,
  BUSINESS_MANUAL_CLOSED_REASON_KEY,
} from './../../src/modules/settings/settings.service';

/**
 * Horario que nunca cierra: `open === close` hace que `evaluateSchedule` tome
 * la rama "cruza medianoche" (`open >= close`), que solo exige
 * `nowMinutes >= open` (siempre `0 >= 0`) — abierto a cualquier hora, cualquier
 * día. Evita que las suites e2e que crean pedidos (`POST /orders`) dependan de
 * la hora real de Lima en la que corre el test (bloqueadas con 409 fuera del
 * horario configurado, ver `OrdersService.create`).
 */
const ALWAYS_OPEN_DAY = { closed: false, open: '00:00', close: '00:00' };
const ALWAYS_OPEN_SCHEDULE = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((day) => [String(day), ALWAYS_OPEN_DAY]),
);

export interface BusinessHoursSnapshot {
  schedule: string | undefined;
  manualClosed: string | undefined;
  reason: string | undefined;
}

/**
 * Fuerza el local a estar "abierto siempre" y devuelve el valor previo de las
 * 3 keys de horario, para restaurarlo con `restoreBusinessHours` en el
 * `afterAll` de la suite (mismo criterio que ya usa `settings.e2e-spec.ts`
 * para no dejar estado compartido entre suites sobre la misma BD).
 */
export async function forceBusinessAlwaysOpen(
  settingsRepo: Repository<Setting>,
): Promise<BusinessHoursSnapshot> {
  const keys = [
    BUSINESS_HOURS_SCHEDULE_KEY,
    BUSINESS_MANUAL_CLOSED_KEY,
    BUSINESS_MANUAL_CLOSED_REASON_KEY,
  ];
  const existing = await settingsRepo.find({ where: { key: In(keys) } });
  const byKey = new Map(existing.map((row) => [row.key, row.value]));
  const snapshot: BusinessHoursSnapshot = {
    schedule: byKey.get(BUSINESS_HOURS_SCHEDULE_KEY),
    manualClosed: byKey.get(BUSINESS_MANUAL_CLOSED_KEY),
    reason: byKey.get(BUSINESS_MANUAL_CLOSED_REASON_KEY),
  };

  await upsert(
    settingsRepo,
    BUSINESS_HOURS_SCHEDULE_KEY,
    JSON.stringify(ALWAYS_OPEN_SCHEDULE),
  );
  await upsert(settingsRepo, BUSINESS_MANUAL_CLOSED_KEY, 'false');

  return snapshot;
}

/**
 * Restaura las 3 keys de horario a los valores capturados por
 * `forceBusinessAlwaysOpen`. Si una key no existía antes (`undefined` en el
 * snapshot), la borra en vez de dejar pegado el override "siempre abierto"
 * — no depende de que `SettingsService.onModuleInit()` la vuelva a sembrar.
 */
export async function restoreBusinessHours(
  settingsRepo: Repository<Setting>,
  snapshot: BusinessHoursSnapshot,
): Promise<void> {
  await restoreKey(
    settingsRepo,
    BUSINESS_HOURS_SCHEDULE_KEY,
    snapshot.schedule,
  );
  await restoreKey(
    settingsRepo,
    BUSINESS_MANUAL_CLOSED_KEY,
    snapshot.manualClosed,
  );
  await restoreKey(
    settingsRepo,
    BUSINESS_MANUAL_CLOSED_REASON_KEY,
    snapshot.reason,
  );
}

async function restoreKey(
  repo: Repository<Setting>,
  key: string,
  value: string | undefined,
): Promise<void> {
  if (value === undefined) {
    await repo.delete({ key });
    return;
  }
  await upsert(repo, key, value);
}

async function upsert(
  repo: Repository<Setting>,
  key: string,
  value: string,
): Promise<void> {
  const existing = await repo.findOne({ where: { key } });
  if (existing) {
    existing.value = value;
    await repo.save(existing);
    return;
  }
  await repo.save(repo.create({ key, value }));
}
