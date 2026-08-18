import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  currentMinutesInLima,
  todayDayOfWeekInLima,
} from '../../common/utils/lima-time.util';
import { Setting } from './entities/setting.entity';

/** Clave del número de WhatsApp del negocio (usada por OrdersService). */
export const WHATSAPP_NUMBER_KEY = 'whatsapp_business_number';

/** Clave del horario de atención por día de la semana (JSON, ver `BusinessHoursSchedule`). */
export const BUSINESS_HOURS_SCHEDULE_KEY = 'business_hours_schedule';

/** Clave del interruptor manual "cerrado temporalmente" ("true"/"false"). */
export const BUSINESS_MANUAL_CLOSED_KEY = 'business_manual_closed';

/** Clave del motivo opcional mostrado al cliente cuando el cierre manual está activo. */
export const BUSINESS_MANUAL_CLOSED_REASON_KEY =
  'business_manual_closed_reason';

/**
 * Whitelist de keys que el endpoint público GET /settings/public puede exponer.
 * NUNCA exponer todo el key-value sin filtrar: solo lo que la app cliente necesita.
 */
const PUBLIC_KEYS_WHITELIST: ReadonlySet<string> = new Set([
  WHATSAPP_NUMBER_KEY,
  BUSINESS_HOURS_SCHEDULE_KEY,
  BUSINESS_MANUAL_CLOSED_KEY,
  BUSINESS_MANUAL_CLOSED_REASON_KEY,
]);

/** Horario de un día: `open`/`close` en formato `HH:mm`, hora local de Lima. */
export interface DaySchedule {
  closed: boolean;
  open: string;
  close: string;
}

/** Claves numéricas como string ('0'=domingo...'6'=sábado, igual que `Date.getDay()`). */
export type BusinessHoursSchedule = Record<string, DaySchedule>;

/** Horario por defecto sembrado en `onModuleInit` si la key todavía no existe. */
const DEFAULT_BUSINESS_HOURS_SCHEDULE: BusinessHoursSchedule = {
  '0': { closed: false, open: '11:00', close: '22:00' },
  '1': { closed: false, open: '11:00', close: '23:00' },
  '2': { closed: false, open: '11:00', close: '23:00' },
  '3': { closed: false, open: '11:00', close: '23:00' },
  '4': { closed: false, open: '11:00', close: '23:00' },
  '5': { closed: false, open: '11:00', close: '01:00' },
  '6': { closed: false, open: '11:00', close: '01:00' },
};

/** Convierte "HH:mm" a minutos desde medianoche. */
function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Módulo Settings: configuración clave-valor gestionada desde el panel admin.
 * - El seed (no migración) inserta `whatsapp_business_number` al arrancar si no existe.
 * - GET /settings/public solo expone las keys de la whitelist.
 * - GET/PATCH /settings (admin) gestionan todas las keys.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(Setting)
    private readonly settingsRepository: Repository<Setting>,
    private readonly configService: ConfigService,
  ) {}

  /** Seed: inserta las filas iniciales si no existen todavía (no es una migración). */
  async onModuleInit(): Promise<void> {
    // Valor inicial del WhatsApp: el del .env si existe (no romper despliegues previos).
    const envValue = this.configService.get<string>('whatsapp.businessNumber');
    await this.seedIfMissing(
      WHATSAPP_NUMBER_KEY,
      envValue ?? '51999999999',
      'Número de WhatsApp del negocio (formato internacional sin +)',
      envValue ? ' (desde .env)' : ' (default)',
    );

    await this.seedIfMissing(
      BUSINESS_HOURS_SCHEDULE_KEY,
      JSON.stringify(DEFAULT_BUSINESS_HOURS_SCHEDULE),
      'Horario de atención por día de la semana (JSON), 0=domingo...6=sábado, hora local de Lima',
    );
    await this.seedIfMissing(
      BUSINESS_MANUAL_CLOSED_KEY,
      'false',
      'Interruptor manual: "true" cierra el local ahora mismo sin importar el horario programado',
    );
    await this.seedIfMissing(
      BUSINESS_MANUAL_CLOSED_REASON_KEY,
      '',
      'Motivo opcional mostrado al cliente cuando business_manual_closed es "true"',
    );
  }

  /** Inserta `key` con `value`/`description` solo si todavía no existe. */
  private async seedIfMissing(
    key: string,
    value: string,
    description: string,
    logSuffix = '',
  ): Promise<void> {
    const existing = await this.settingsRepository.findOne({ where: { key } });
    if (existing) return;
    await this.settingsRepository.save(
      this.settingsRepository.create({ key, value, description }),
    );
    this.logger.log(`Setting sembrada: ${key}${logSuffix}`);
  }

  /** Todas las settings (solo admin). */
  async findAll(): Promise<Setting[]> {
    return this.settingsRepository.find({ order: { key: 'ASC' } });
  }

  /** Solo las keys de la whitelist, para el endpoint público. */
  async findPublic(): Promise<Record<string, string>> {
    const all = await this.settingsRepository.find();
    const result: Record<string, string> = {};
    for (const setting of all) {
      if (PUBLIC_KEYS_WHITELIST.has(setting.key)) {
        result[setting.key] = setting.value;
      }
    }
    return result;
  }

  /** Upsert de una setting (admin). */
  async upsert(
    key: string,
    value: string,
    description?: string,
  ): Promise<Setting> {
    const existing = await this.settingsRepository.findOne({ where: { key } });
    if (existing) {
      existing.value = value;
      if (description !== undefined) {
        existing.description = description;
      }
      return this.settingsRepository.save(existing);
    }
    return this.settingsRepository.save(
      this.settingsRepository.create({
        key,
        value,
        description: description ?? null,
      }),
    );
  }

  /**
   * Número de WhatsApp del negocio. Lee de la tabla settings; si la tabla está
   * vacía (despliegue sin sembrar), cae al valor de .env y loguea un warning.
   */
  async getWhatsappNumber(): Promise<string> {
    const setting = await this.settingsRepository.findOne({
      where: { key: WHATSAPP_NUMBER_KEY },
    });
    if (setting && setting.value) {
      return setting.value;
    }
    const fallback = this.configService.get<string>('whatsapp.businessNumber');
    if (fallback) {
      this.logger.warn(
        `Usando WHATSAPP_BUSINESS_NUMBER de .env como fallback (tabla settings vacía)`,
      );
      return fallback;
    }
    throw new NotFoundException(
      'No hay número de WhatsApp configurado (settings vacía y sin .env)',
    );
  }

  /** Horario de atención configurado; si la key falta o el JSON es inválido, cae al default. */
  async getBusinessHoursSchedule(): Promise<BusinessHoursSchedule> {
    const setting = await this.settingsRepository.findOne({
      where: { key: BUSINESS_HOURS_SCHEDULE_KEY },
    });
    return this.parseSchedule(setting?.value);
  }

  /** `true` si el interruptor manual "cerrado temporalmente" está activo. */
  async isManuallyClosed(): Promise<boolean> {
    const { closed } = await this.getManualClosedState();
    return closed;
  }

  /**
   * Fuente única de verdad de si el local está abierto AHORA MISMO. El
   * override manual (`business_manual_closed`) siempre gana sobre el horario
   * programado. `reference` es el instante real a evaluar (por defecto ahora);
   * se puede fijar en los tests para controlar la hora sin mockear `Date`.
   */
  async isOpenNow(
    reference: Date = new Date(),
  ): Promise<{ open: boolean; message: string | null }> {
    const manual = await this.getManualClosedState();
    if (manual.closed) {
      return {
        open: false,
        message: `El local está cerrado temporalmente${manual.reason ? `: ${manual.reason}` : ''}`,
      };
    }

    const schedule = await this.getBusinessHoursSchedule();
    return this.evaluateSchedule(schedule, reference);
  }

  // ── Helpers privados: horario de atención ───────────────────────────────────

  private async getManualClosedState(): Promise<{
    closed: boolean;
    reason: string | null;
  }> {
    const rows = await this.settingsRepository.find({
      where: {
        key: In([
          BUSINESS_MANUAL_CLOSED_KEY,
          BUSINESS_MANUAL_CLOSED_REASON_KEY,
        ]),
      },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const reason = byKey.get(BUSINESS_MANUAL_CLOSED_REASON_KEY)?.trim();
    return {
      closed: byKey.get(BUSINESS_MANUAL_CLOSED_KEY) === 'true',
      reason: reason ? reason : null,
    };
  }

  private parseSchedule(raw: string | undefined): BusinessHoursSchedule {
    if (!raw) return DEFAULT_BUSINESS_HOURS_SCHEDULE;
    try {
      return JSON.parse(raw) as BusinessHoursSchedule;
    } catch {
      this.logger.warn(
        `No se pudo parsear ${BUSINESS_HOURS_SCHEDULE_KEY}, usando horario default`,
      );
      return DEFAULT_BUSINESS_HOURS_SCHEDULE;
    }
  }

  /**
   * Evalúa el horario programado contra el día y la hora actual en Lima. Un
   * horario que cruza medianoche (open >= close, ej. 11:00–01:00) requiere
   * revisar DOS entradas: la de hoy (tramo nocturno antes de medianoche) y la
   * de ayer (tramo de madrugada que se "arrastra" de la noche anterior).
   */
  private evaluateSchedule(
    schedule: BusinessHoursSchedule,
    reference: Date,
  ): { open: boolean; message: string | null } {
    const todayDow = todayDayOfWeekInLima(reference);
    const yesterdayDow = (todayDow + 6) % 7;
    const nowMinutes = currentMinutesInLima(reference);

    const today = schedule[String(todayDow)];
    const yesterday = schedule[String(yesterdayDow)];

    if (
      this.isOpenToday(today, nowMinutes) ||
      this.isCarriedOverFromYesterday(yesterday, nowMinutes)
    ) {
      return { open: true, message: null };
    }

    if (today?.closed) {
      return { open: false, message: 'Hoy no atendemos' };
    }
    if (today) {
      return {
        open: false,
        message: `El local está cerrado en este momento. Hoy atendemos de ${today.open} a ${today.close}`,
      };
    }
    return { open: false, message: 'El local está cerrado en este momento' };
  }

  /** Porción de HOY: rango normal (open<close) o tramo nocturno antes de medianoche si cruza. */
  private isOpenToday(
    entry: DaySchedule | undefined,
    nowMinutes: number,
  ): boolean {
    if (!entry || entry.closed) return false;
    const open = toMinutes(entry.open);
    const close = toMinutes(entry.close);
    if (open < close) {
      return nowMinutes >= open && nowMinutes < close;
    }
    // Cruza medianoche: la porción de hoy va desde `open` hasta medianoche.
    return nowMinutes >= open;
  }

  /** Tramo de madrugada de HOY que se arrastra del horario de AYER si ese cruzó medianoche. */
  private isCarriedOverFromYesterday(
    entry: DaySchedule | undefined,
    nowMinutes: number,
  ): boolean {
    if (!entry || entry.closed) return false;
    const open = toMinutes(entry.open);
    const close = toMinutes(entry.close);
    if (open < close) return false; // no cruza medianoche: no hay arrastre
    return nowMinutes < close;
  }
}
