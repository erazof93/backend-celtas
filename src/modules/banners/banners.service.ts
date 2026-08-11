import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateBannerDto } from './dto/create-banner.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { Banner, BannerActionType } from './entities/banner.entity';

/**
 * Módulo Banners.
 * - `GET /banners/active` es público (lo consume la app): banners con `active`
 *   true y dentro de su rango de fechas (si no hay fechas, siempre vigente).
 * - El resto del CRUD es exclusivo del panel admin.
 *
 * NOTA (decisión futura): al crear un banner con `active: true` NO se notifica a
 * los usuarios. El broadcast a todos los usuarios con fcmToken queda PENDIENTE
 * como decisión de diseño aparte (probablemente con FCM topics, no con un envío
 * token a token). El método `NotificationsService.sendPushNotification` ya está
 * listo para cuando se decida cómo hacerlo.
 */
@Injectable()
export class BannersService {
  constructor(
    @InjectRepository(Banner)
    private readonly bannersRepository: Repository<Banner>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Banners vigentes para la app: `active` true Y (sin startDate O startDate <= ahora)
   * Y (sin endDate O endDate >= ahora), ordenados por `order` ascendente.
   */
  async findActive(): Promise<Banner[]> {
    const now = new Date();
    return this.bannersRepository
      .createQueryBuilder('banner')
      .where('banner.active = :active', { active: true })
      .andWhere('(banner.startDate IS NULL OR banner.startDate <= :now)', {
        now,
      })
      .andWhere('(banner.endDate IS NULL OR banner.endDate >= :now)', { now })
      .orderBy('banner.order', 'ASC')
      .getMany();
  }

  // ── CRUD admin ──────────────────────────────────────────────────────────────

  async create(dto: CreateBannerDto): Promise<Banner> {
    this.assertValidDates(dto.startDate, dto.endDate);
    this.assertActionValue(dto.actionType, dto.actionValue);
    const banner = this.bannersRepository.create({
      ...dto,
      actionType: dto.actionType ?? BannerActionType.NONE,
      active: dto.active ?? true,
      order: dto.order ?? 0,
    });
    return this.bannersRepository.save(banner);
  }

  async findAll(): Promise<Banner[]> {
    return this.bannersRepository.find({
      order: { order: 'ASC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Banner> {
    const banner = await this.bannersRepository.findOne({ where: { id } });
    if (!banner) {
      throw new NotFoundException('Banner no encontrado');
    }
    return banner;
  }

  async update(id: string, dto: UpdateBannerDto): Promise<Banner> {
    const banner = await this.findOne(id);
    // merge (no Object.assign): solo aplica los campos definidos del DTO. Con
    // Object.assign, los campos ausentes del PATCH (undefined) pisaban los valores
    // ya cargados y la respuesta salía incompleta. Además, las validaciones se
    // ejecutan sobre el banner ya fusionado, no sobre un objeto temporal con spread.
    this.bannersRepository.merge(banner, dto);
    this.assertValidDates(banner.startDate, banner.endDate);
    this.assertActionValue(banner.actionType, banner.actionValue);
    return this.bannersRepository.save(banner);
  }

  async remove(id: string): Promise<void> {
    const banner = await this.findOne(id);
    await this.bannersRepository.remove(banner);
  }

  /** Guarda la URL devuelta por Cloudinary en el banner. */
  async updateImage(id: string, imageUrl: string): Promise<Banner> {
    const banner = await this.findOne(id);
    banner.imageUrl = imageUrl;
    return this.bannersRepository.save(banner);
  }

  /** Actualiza el orden de varios banners en batch (drag & drop del panel). */
  async reorder(dto: ReorderBannersDto): Promise<Banner[]> {
    return this.dataSource.transaction(async (manager) => {
      const updated: Banner[] = [];
      for (const item of dto.items) {
        const banner = await manager.findOne(Banner, {
          where: { id: item.id },
        });
        if (!banner) {
          throw new NotFoundException(`Banner no encontrado: ${item.id}`);
        }
        banner.order = item.order;
        updated.push(await manager.save(Banner, banner));
      }
      return updated;
    });
  }

  // ── Validaciones de negocio ─────────────────────────────────────────────────

  /** Si vienen ambas fechas, startDate debe ser anterior a endDate. */
  private assertValidDates(
    startDate?: Date | null,
    endDate?: Date | null,
  ): void {
    if (startDate && endDate && startDate.getTime() >= endDate.getTime()) {
      throw new BadRequestException('startDate debe ser anterior a endDate');
    }
  }

  /** Si actionType no es none, actionValue es obligatorio. */
  private assertActionValue(
    actionType?: BannerActionType,
    actionValue?: string | null,
  ): void {
    if (
      actionType &&
      actionType !== BannerActionType.NONE &&
      !actionValue?.trim()
    ) {
      throw new BadRequestException(
        'actionValue es obligatorio cuando actionType no es none',
      );
    }
  }
}
