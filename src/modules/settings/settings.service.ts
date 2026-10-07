import {
  BadRequestException,
  ConflictException,
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
  limaWallClockDate,
  limaWallClockToUtc,
  todayDayOfWeekInLima,
} from '../../common/utils/lima-time.util';
import {
  CouponDiscountType,
  MAX_AUTO_COUPON_EXPIRATION_DAYS,
  MAX_COUPON_AMOUNT,
} from '../coupons/entities/coupon.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Setting } from './entities/setting.entity';
import { validateCriticalSetting } from './settings-validation';
import { DeliveryMode } from '../delivery/delivery-mode';
import { DeliveryZone } from '../delivery/entities/delivery-zone.entity';
import { lockDeliveryCatalog } from '../delivery/delivery-catalog-lock';

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
 * Clave de la ubicación del local (JSON `{ latitude, longitude }`), usada por
 * `OrdersService` para calcular la distancia de delivery. Se siembra SIN
 * CONFIGURAR (value vacío) — no se inventan coordenadas reales; el admin la
 * carga desde el panel (fase siguiente). Mientras tanto, en local se setea a
 * mano vía `PATCH /settings`.
 */
export const STORE_LOCATION_KEY = 'store_location';

/** Clave de los tramos de tarifa de delivery por distancia (JSON, ver `DeliveryFeeTier`). */
export const DELIVERY_FEE_TIERS_KEY = 'delivery_fee_tiers';

/** Clave del radio (metros) a partir del cual un pedido dispara el aviso interno de "lejano". */
export const DELIVERY_ALERT_RADIUS_METERS_KEY = 'delivery_alert_radius_meters';
export const DELIVERY_MODE_KEY = 'delivery_mode';

/**
 * Clave de los soles gastados (subtotal sin envío) necesarios para ganar 1
 * estrella del programa de fidelización. Datos de negocio del admin — no va
 * en la whitelist pública.
 */
export const SOLES_POR_ESTRELLA_KEY = 'soles_por_estrella';

/**
 * Clave de la versión mínima de la app Flutter requerida para operar (formato
 * `X.Y.Z+BB`, donde BB es el build number). Debajo de esa versión, la app
 * debe bloquear el uso y pedir actualizar. Pública: la app la consulta sin auth.
 */
export const MIN_APP_VERSION_KEY = 'min_app_version';

/**
 * Claves de la configuración de cupones automáticos (umbral de gasto). Datos de
 * negocio del admin — no van en la whitelist pública. Solo se editan vía
 * `PUT /coupons/auto-config` (validado en conjunto); `PATCH /settings` las
 * rechaza para que no se pueda guardar, por ejemplo, un `percentage` de 150.
 */
export const AUTO_COUPON_DISCOUNT_TYPE_KEY = 'auto_coupon_discount_type';
export const AUTO_COUPON_DISCOUNT_VALUE_KEY = 'auto_coupon_discount_value';
export const AUTO_COUPON_THRESHOLD_AMOUNT_KEY = 'auto_coupon_threshold_amount';
export const AUTO_COUPON_EXPIRATION_DAYS_KEY = 'auto_coupon_expiration_days';

/** Keys que `upsert` (PATCH /settings genérico) rechaza: tienen su endpoint dedicado. */
const PROTECTED_KEYS: ReadonlySet<string> = new Set([
  AUTO_COUPON_DISCOUNT_TYPE_KEY,
  AUTO_COUPON_DISCOUNT_VALUE_KEY,
  AUTO_COUPON_THRESHOLD_AMOUNT_KEY,
  AUTO_COUPON_EXPIRATION_DAYS_KEY,
]);

/**
 * Whitelist de keys que el endpoint público GET /settings/public puede exponer.
 * NUNCA exponer todo el key-value sin filtrar: solo lo que la app cliente necesita.
 */
const PUBLIC_KEYS_WHITELIST: ReadonlySet<string> = new Set([
  WHATSAPP_NUMBER_KEY,
  BUSINESS_HOURS_SCHEDULE_KEY,
  BUSINESS_MANUAL_CLOSED_KEY,
  BUSINESS_MANUAL_CLOSED_REASON_KEY,
  MIN_APP_VERSION_KEY,
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

/** Type guard: el string guardado en `settings` es un `CouponDiscountType` válido. */
function isCouponDiscountType(
  value: string | undefined,
): value is CouponDiscountType {
  return Object.values(CouponDiscountType).includes(
    value as CouponDiscountType,
  );
}

/** Convierte "HH:mm" a minutos desde medianoche. */
function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Ubicación del local (JSON de `store_location`). */
export interface StoreLocation {
  latitude: number;
  longitude: number;
}

/**
 * Un tramo de la tabla de tarifas de delivery: aplica a pedidos con distancia
 * `<= maxMeters`. `maxMeters: null` = tarifa plana sin techo (debe ser el
 * último tramo del array) — un pedido nunca se rechaza por distancia, así
 * que siempre debe existir un tramo que matchee cualquier distancia.
 */
export interface DeliveryFeeTier {
  maxMeters: number | null;
  fee: number;
}

/** Tabla de tarifas sembrada por defecto en `onModuleInit` si la key no existe. */
const DEFAULT_DELIVERY_FEE_TIERS: DeliveryFeeTier[] = [
  { maxMeters: 100, fee: 2 },
  { maxMeters: 400, fee: 4 },
  { maxMeters: 1000, fee: 6 },
  { maxMeters: null, fee: 8 },
];

/** Radio de aviso interno (metros) sembrado por defecto si la key no existe. */
const DEFAULT_DELIVERY_ALERT_RADIUS_METERS = 2500;

/** Default del programa de estrellas: S/10 gastados → 1 estrella. */
const DEFAULT_SOLES_POR_ESTRELLA = 10;

/** Versión mínima sembrada por defecto: una versión ya publicada, baseline seguro (no bloquea la última). */
const DEFAULT_MIN_APP_VERSION = '1.0.1+16';

/** Configuración de los cupones automáticos (ver `getAutoCouponConfig`). */
export interface AutoCouponConfig {
  discountType: CouponDiscountType;
  discountValue: number;
  thresholdAmount: number;
  expirationDays: number;
}

/** Defaults históricos (los mismos que aplicaba `configuration.ts` sin env vars). */
const DEFAULT_AUTO_COUPON_CONFIG: AutoCouponConfig = {
  discountType: CouponDiscountType.PERCENTAGE,
  discountValue: 10,
  thresholdAmount: 50,
  expirationDays: 15,
};

/** Descripciones de las keys de cupones automáticos (seed y alta en `updateAutoCouponConfig`). */
const AUTO_COUPON_DESCRIPTIONS: Record<string, string> = {
  [AUTO_COUPON_DISCOUNT_TYPE_KEY]:
    'Tipo de descuento del cupón automático (percentage | fixed_amount) — editar vía PUT /coupons/auto-config',
  [AUTO_COUPON_DISCOUNT_VALUE_KEY]:
    'Valor del descuento del cupón automático (% o soles según el tipo) — editar vía PUT /coupons/auto-config',
  [AUTO_COUPON_THRESHOLD_AMOUNT_KEY]:
    'Soles gastados en pedidos entregados (desde el último cupón) para generar un cupón automático — editar vía PUT /coupons/auto-config',
  [AUTO_COUPON_EXPIRATION_DAYS_KEY]:
    'Días de vigencia del cupón automático desde su generación — editar vía PUT /coupons/auto-config',
};

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
    private readonly notificationsService: NotificationsService,
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

    // Sembrada SIN CONFIGURAR a propósito: no se inventan coordenadas reales.
    // getStoreLocation() lanza NotFoundException hasta que el admin la cargue
    // (por ahora, a mano vía PATCH /settings con una coordenada real de prueba).
    await this.seedIfMissing(
      STORE_LOCATION_KEY,
      '',
      'Ubicación del local (JSON {"latitude":number,"longitude":number}) — sin configurar por defecto, necesaria para calcular el delivery por distancia',
    );
    await this.seedIfMissing(
      DELIVERY_MODE_KEY,
      DeliveryMode.DISTANCE,
      'Modo de delivery: DISTANCE (default compatible) o ZONES',
    );
    await this.seedIfMissing(
      DELIVERY_FEE_TIERS_KEY,
      JSON.stringify(DEFAULT_DELIVERY_FEE_TIERS),
      'Tramos de tarifa de delivery por distancia (JSON, array ascendente por maxMeters; el último tramo con maxMeters=null es la tarifa plana sin techo, nunca se rechaza un pedido por distancia)',
    );
    await this.seedIfMissing(
      DELIVERY_ALERT_RADIUS_METERS_KEY,
      String(DEFAULT_DELIVERY_ALERT_RADIUS_METERS),
      'Radio (metros) a partir del cual un pedido dispara el aviso interno de "fuera de la zona habitual" al admin — nunca bloquea el pedido',
    );

    await this.seedIfMissing(
      SOLES_POR_ESTRELLA_KEY,
      String(DEFAULT_SOLES_POR_ESTRELLA),
      'Soles gastados (subtotal sin envío) necesarios para ganar 1 estrella del programa de fidelización',
    );

    await this.seedIfMissing(
      MIN_APP_VERSION_KEY,
      DEFAULT_MIN_APP_VERSION,
      'Versión mínima de la app Flutter requerida para operar (formato X.Y.Z+BB) — debajo de esta versión, la app debe bloquear el uso y pedir actualizar',
    );

    // Cupones automáticos: el valor inicial sale de las env vars (ya validadas
    // por Joi en validation.schema.ts), para que el primer deploy conserve lo
    // que hoy está configurado en Render. Desde ahí en adelante manda la BD.
    const autoSeed: [string, string | number | undefined, string | number][] = [
      [
        AUTO_COUPON_DISCOUNT_TYPE_KEY,
        this.configService.get<string | number>('coupons.autoDiscountType'),
        DEFAULT_AUTO_COUPON_CONFIG.discountType,
      ],
      [
        AUTO_COUPON_DISCOUNT_VALUE_KEY,
        this.configService.get<string | number>('coupons.autoDiscountValue'),
        DEFAULT_AUTO_COUPON_CONFIG.discountValue,
      ],
      [
        AUTO_COUPON_THRESHOLD_AMOUNT_KEY,
        this.configService.get<string | number>('coupons.thresholdAmount'),
        DEFAULT_AUTO_COUPON_CONFIG.thresholdAmount,
      ],
      [
        AUTO_COUPON_EXPIRATION_DAYS_KEY,
        this.configService.get<string | number>('coupons.expirationDays'),
        DEFAULT_AUTO_COUPON_CONFIG.expirationDays,
      ],
    ];
    for (const [key, envValue, fallback] of autoSeed) {
      await this.seedIfMissing(
        key,
        String(envValue ?? fallback),
        AUTO_COUPON_DESCRIPTIONS[key],
        envValue !== undefined ? ' (desde .env)' : ' (default)',
      );
    }
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

  /**
   * Upsert de una setting (admin). Si la key es `business_manual_closed` y el
   * valor de verdad cambió (no si el form reenvió el mismo valor que ya
   * estaba), dispara un push masivo avisando el cambio a todos los clientes.
   */
  async upsert(
    key: string,
    value: string,
    description?: string,
  ): Promise<Setting> {
    validateCriticalSetting(key, value);
    if (
      key === DELIVERY_MODE_KEY &&
      !Object.values(DeliveryMode).includes(value as DeliveryMode)
    ) {
      throw new BadRequestException('delivery_mode debe ser DISTANCE o ZONES');
    }
    if (PROTECTED_KEYS.has(key)) {
      throw new BadRequestException(
        `La setting "${key}" no se puede editar desde aquí. Usa PUT /coupons/auto-config`,
      );
    }

    if (key === DELIVERY_MODE_KEY) {
      return this.settingsRepository.manager.transaction(
        'READ COMMITTED',
        async (manager) => {
          await lockDeliveryCatalog(manager);
          if (
            value === 'ZONES' &&
            (await manager.countBy(DeliveryZone, { active: true })) === 0
          ) {
            throw new ConflictException(
              'No se puede activar ZONES sin al menos una zona de delivery activa',
            );
          }
          const existing = await manager.findOneBy(Setting, { key });
          const setting = existing ?? manager.create(Setting, { key });
          setting.value = value;
          if (description !== undefined) setting.description = description;
          else if (!existing) setting.description = null;
          return manager.save(Setting, setting);
        },
      );
    }

    const existing = await this.settingsRepository.findOne({ where: { key } });
    const previousValue = existing?.value;

    const saved = existing
      ? await this.saveExisting(existing, value, description)
      : await this.settingsRepository.save(
          this.settingsRepository.create({
            key,
            value,
            description: description ?? null,
          }),
        );

    if (key === BUSINESS_MANUAL_CLOSED_KEY && previousValue !== value) {
      // broadcastPushNotification nunca lanza (mismo contrato que
      // sendPushNotification): no hace falta try/catch aquí.
      await this.notifyBusinessHoursChange(value);
    }

    return saved;
  }

  private async saveExisting(
    existing: Setting,
    value: string,
    description?: string,
  ): Promise<Setting> {
    existing.value = value;
    if (description !== undefined) {
      existing.description = description;
    }
    return this.settingsRepository.save(existing);
  }

  /** Avisa a todos los clientes con push cuando el cierre manual cambia de verdad. */
  private async notifyBusinessHoursChange(newValue: string): Promise<void> {
    try {
      if (newValue === 'true') {
        // Motivo leído fresco de la base: puede haberse guardado en un PATCH
        // separado del mismo formulario del admin, no confiar en este request.
        const { reason } = await this.getManualClosedState();
        await this.notificationsService.broadcastPushNotification({
          title: 'Celtas está cerrado temporalmente',
          body:
            reason ?? 'El local no está atendiendo pedidos en este momento.',
          data: { businessHoursChanged: 'true' },
        });
        return;
      }
      await this.notificationsService.broadcastPushNotification({
        title: '¡Ya volvimos a abrir!',
        body: 'Ya podés hacer tu pedido normalmente',
        data: { businessHoursChanged: 'true' },
      });
    } catch {
      // Preparing the push must not fail a setting update that already committed.
      this.logger.error(
        'No se pudo preparar la notificación del horario de atención',
      );
    }
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

  /**
   * Ubicación del local, usada por `OrdersService` para calcular la distancia
   * de delivery. Sin fallback a .env (no hay un valor de config análogo):
   * si todavía no está configurada, lanza `NotFoundException` en español,
   * mismo criterio defensivo que `getWhatsappNumber()`.
   */
  async getStoreLocation(): Promise<StoreLocation> {
    const setting = await this.settingsRepository.findOne({
      where: { key: STORE_LOCATION_KEY },
    });
    if (setting?.value) {
      try {
        const parsed = JSON.parse(setting.value) as Partial<StoreLocation>;
        if (
          typeof parsed.latitude === 'number' &&
          typeof parsed.longitude === 'number'
        ) {
          return { latitude: parsed.latitude, longitude: parsed.longitude };
        }
      } catch {
        // cae al NotFoundException de abajo
      }
    }
    throw new NotFoundException(
      'La ubicación del local todavía no está configurada (setting "store_location")',
    );
  }

  /** Missing mode keeps existing installations on distance; invalid persisted values fail explicitly. */
  async getDeliveryMode(): Promise<DeliveryMode> {
    const setting = await this.settingsRepository.findOne({
      where: { key: DELIVERY_MODE_KEY },
    });
    if (!setting) return DeliveryMode.DISTANCE;
    if (!Object.values(DeliveryMode).includes(setting.value as DeliveryMode)) {
      throw new BadRequestException('delivery_mode debe ser DISTANCE o ZONES');
    }
    return setting.value as DeliveryMode;
  }

  /** Tramos de tarifa de delivery configurados; si la key falta o el JSON es inválido, cae al default. */
  async getDeliveryFeeTiers(): Promise<DeliveryFeeTier[]> {
    const setting = await this.settingsRepository.findOne({
      where: { key: DELIVERY_FEE_TIERS_KEY },
    });
    if (!setting?.value) return DEFAULT_DELIVERY_FEE_TIERS;
    try {
      return JSON.parse(setting.value) as DeliveryFeeTier[];
    } catch {
      this.logger.warn(
        `No se pudo parsear ${DELIVERY_FEE_TIERS_KEY}, usando tarifas default`,
      );
      return DEFAULT_DELIVERY_FEE_TIERS;
    }
  }

  /** Radio de aviso (metros); si la key falta o no es un número válido, cae al default. */
  async getDeliveryAlertRadiusMeters(): Promise<number> {
    const setting = await this.settingsRepository.findOne({
      where: { key: DELIVERY_ALERT_RADIUS_METERS_KEY },
    });
    const parsed = Number(setting?.value);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_DELIVERY_ALERT_RADIUS_METERS;
  }

  /** Soles necesarios para ganar 1 estrella; si la key falta o no es un número válido, cae al default. */
  async getSolesPorEstrella(): Promise<number> {
    const setting = await this.settingsRepository.findOne({
      where: { key: SOLES_POR_ESTRELLA_KEY },
    });
    const parsed = Number(setting?.value);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_SOLES_POR_ESTRELLA;
  }

  /**
   * Configuración de los cupones automáticos (una sola query). Cada campo que
   * falte o no sea válido cae a su default y se loguea. El par tipo/valor se
   * valida junto: un `percentage` > 100 (o un tipo desconocido) cae al par
   * default completo — nunca se genera un cupón que deje un total negativo
   * aunque alguien edite la fila a mano en la BD.
   */
  async getAutoCouponConfig(): Promise<AutoCouponConfig> {
    const rows = await this.settingsRepository.find({
      where: { key: In([...PROTECTED_KEYS]) },
    });
    const raw = new Map(rows.map((row) => [row.key, row.value]));
    const defaults = DEFAULT_AUTO_COUPON_CONFIG;

    const rawType = raw.get(AUTO_COUPON_DISCOUNT_TYPE_KEY);
    const rawValue = Number(raw.get(AUTO_COUPON_DISCOUNT_VALUE_KEY));
    const pairIsValid =
      isCouponDiscountType(rawType) &&
      Number.isFinite(rawValue) &&
      rawValue > 0 &&
      rawValue <= MAX_COUPON_AMOUNT &&
      !(rawType === CouponDiscountType.PERCENTAGE && rawValue > 100);
    if (!pairIsValid) {
      this.logger.warn(
        'Configuración de descuento de cupones automáticos inválida o ausente, usando default',
      );
    }
    const discountType = pairIsValid ? rawType : defaults.discountType;
    const discountValue = pairIsValid ? rawValue : defaults.discountValue;

    const threshold = Number(raw.get(AUTO_COUPON_THRESHOLD_AMOUNT_KEY));
    const thresholdAmount =
      Number.isFinite(threshold) &&
      threshold > 0 &&
      threshold <= MAX_COUPON_AMOUNT
        ? threshold
        : defaults.thresholdAmount;

    const days = Number(raw.get(AUTO_COUPON_EXPIRATION_DAYS_KEY));
    const expirationDays =
      Number.isInteger(days) &&
      days >= 1 &&
      days <= MAX_AUTO_COUPON_EXPIRATION_DAYS
        ? days
        : defaults.expirationDays;

    return {
      discountType,
      discountValue,
      thresholdAmount,
      expirationDays,
    };
  }

  /**
   * Guarda las 4 keys de cupones automáticos en una sola transacción (todo o
   * nada). La validación de negocio (% ≤ 100, enteros, positivos) vive en
   * `UpdateAutoCouponConfigDto`. Si alguna fila no existe (BD sin sembrar) se
   * crea — no se pierde el cambio en silencio. Solo afecta a cupones NUEVOS:
   * los ya emitidos conservan su tipo/valor/vencimiento.
   */
  async updateAutoCouponConfig(
    config: AutoCouponConfig,
  ): Promise<AutoCouponConfig> {
    const values: [string, string][] = [
      [AUTO_COUPON_DISCOUNT_TYPE_KEY, config.discountType],
      [AUTO_COUPON_DISCOUNT_VALUE_KEY, String(config.discountValue)],
      [AUTO_COUPON_THRESHOLD_AMOUNT_KEY, String(config.thresholdAmount)],
      [AUTO_COUPON_EXPIRATION_DAYS_KEY, String(config.expirationDays)],
    ];

    await this.settingsRepository.manager.transaction(async (manager) => {
      for (const [key, value] of values) {
        const existing = await manager.findOne(Setting, { where: { key } });
        if (existing) {
          existing.value = value;
          await manager.save(Setting, existing);
        } else {
          await manager.save(
            Setting,
            manager.create(Setting, {
              key,
              value,
              description: AUTO_COUPON_DESCRIPTIONS[key],
            }),
          );
        }
      }
    });

    return this.getAutoCouponConfig();
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

  /**
   * Próximo instante (UTC) en que cambia el estado abierto/cerrado — para que
   * la app se autoprograme en vez de reconsultar por polling. `null` si el
   * cierre manual está activo (puede levantarse en cualquier momento, no es
   * predecible) o si el horario nunca abre (los 7 días marcados `closed`).
   * Reutiliza la misma lógica de `evaluateSchedule` (`isOpenToday`,
   * `isCarriedOverFromYesterday`), no la reescribe.
   */
  async getNextChangeAt(reference: Date = new Date()): Promise<Date | null> {
    const manual = await this.getManualClosedState();
    if (manual.closed) return null;

    const schedule = await this.getBusinessHoursSchedule();
    const todayDate = limaWallClockDate(reference);
    const todayDow = todayDayOfWeekInLima(reference);
    const yesterdayDow = (todayDow + 6) % 7;
    const nowMinutes = currentMinutesInLima(reference);

    const today = schedule[String(todayDow)];
    const yesterday = schedule[String(yesterdayDow)];

    if (this.isOpenToday(today, nowMinutes)) {
      // Cierra hoy, salvo que el rango cruce medianoche (entonces cierra mañana).
      const crossesMidnight = toMinutes(today.open) >= toMinutes(today.close);
      const closeDate = crossesMidnight
        ? this.shiftLimaDate(todayDate, 1)
        : todayDate;
      return this.buildLimaInstant(closeDate, today.close);
    }

    if (this.isCarriedOverFromYesterday(yesterday, nowMinutes)) {
      // El tramo de ayer que se arrastró cierra hoy en la madrugada.
      return this.buildLimaInstant(todayDate, yesterday.close);
    }

    // Cerrado ahora: buscar la próxima apertura, empezando por hoy mismo.
    if (today && !today.closed && nowMinutes < toMinutes(today.open)) {
      return this.buildLimaInstant(todayDate, today.open);
    }
    for (let offset = 1; offset <= 7; offset++) {
      const dow = (todayDow + offset) % 7;
      const entry = schedule[String(dow)];
      if (entry && !entry.closed) {
        const date = this.shiftLimaDate(todayDate, offset);
        return this.buildLimaInstant(date, entry.open);
      }
    }
    return null; // el local nunca abre con la configuración actual
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

  /** Instante UTC absoluto de una hora "HH:mm" de Lima en una fecha calendario dada. */
  private buildLimaInstant(
    date: { year: number; month: number; day: number },
    hhmm: string,
  ): Date {
    const [hour, minute] = hhmm.split(':').map(Number);
    return limaWallClockToUtc(date.year, date.month, date.day, hour, minute);
  }

  /** Desplaza una fecha calendario (año/mes/día) N días, sin tocar ninguna zona horaria. */
  private shiftLimaDate(
    date: { year: number; month: number; day: number },
    days: number,
  ): { year: number; month: number; day: number } {
    const shifted = new Date(
      Date.UTC(date.year, date.month - 1, date.day + days),
    );
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }
}
