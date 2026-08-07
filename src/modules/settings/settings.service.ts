import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities/setting.entity';

/** Clave del número de WhatsApp del negocio (usada por OrdersService). */
export const WHATSAPP_NUMBER_KEY = 'whatsapp_business_number';

/**
 * Whitelist de keys que el endpoint público GET /settings/public puede exponer.
 * NUNCA exponer todo el key-value sin filtrar: solo lo que la app cliente necesita.
 */
const PUBLIC_KEYS_WHITELIST: ReadonlySet<string> = new Set([
  WHATSAPP_NUMBER_KEY,
]);

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

  /** Seed: inserta la fila inicial si la tabla está vacía (no es una migración). */
  async onModuleInit(): Promise<void> {
    const existing = await this.settingsRepository.findOne({
      where: { key: WHATSAPP_NUMBER_KEY },
    });
    if (existing) return;

    // Valor inicial: el del .env si existe (para no romper despliegues previos).
    const envValue = this.configService.get<string>('whatsapp.businessNumber');
    const value = envValue ?? '51999999999';
    await this.settingsRepository.save(
      this.settingsRepository.create({
        key: WHATSAPP_NUMBER_KEY,
        value,
        description:
          'Número de WhatsApp del negocio (formato internacional sin +)',
      }),
    );
    this.logger.log(
      `Setting sembrada: ${WHATSAPP_NUMBER_KEY}${envValue ? ' (desde .env)' : ' (default)'}`,
    );
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
}
