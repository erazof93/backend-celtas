import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateStarPromotionDto } from './dto/create-star-promotion.dto';
import { UpdateStarPromotionDto } from './dto/update-star-promotion.dto';
import { StarPromotion } from './entities/star-promotion.entity';

/**
 * CRUD admin de promociones de estrellas. Sin `DELETE`: desactivar es
 * `active: false`, nunca se borra el historial (mismo criterio que Coupons/Banners).
 */
@Injectable()
export class StarPromotionsService {
  constructor(
    @InjectRepository(StarPromotion)
    private readonly starPromotionsRepository: Repository<StarPromotion>,
  ) {}

  async create(dto: CreateStarPromotionDto): Promise<StarPromotion> {
    return this.write(async (repo) => {
      this.assertValidDates(dto.startDate, dto.endDate);
      if (dto.active ?? true)
        await this.assertNoOverlap(repo, dto.startDate, dto.endDate);
      return repo.save(repo.create({ ...dto, active: dto.active ?? true }));
    });
  }

  async findAll(): Promise<StarPromotion[]> {
    return this.starPromotionsRepository.find({
      order: { startDate: 'DESC' },
    });
  }

  async findOne(id: string): Promise<StarPromotion> {
    const promotion = await this.starPromotionsRepository.findOne({
      where: { id },
    });
    if (!promotion) {
      throw new NotFoundException('Promoción no encontrada');
    }
    return promotion;
  }

  async update(
    id: string,
    dto: UpdateStarPromotionDto,
  ): Promise<StarPromotion> {
    return this.write(async (repo) => {
      const promotion = await repo.findOne({ where: { id } });
      if (!promotion)
        throw new NotFoundException('Promoci\u00f3n no encontrada');
      repo.merge(promotion, dto);
      this.assertValidDates(promotion.startDate, promotion.endDate);
      if (promotion.active)
        await this.assertNoOverlap(
          repo,
          promotion.startDate,
          promotion.endDate,
          promotion.id,
        );
      return repo.save(promotion);
    });
  }

  /** Catalog lock is distinct from delivery and acquired before any read/write. */
  private write<T>(
    work: (repo: Repository<StarPromotion>) => Promise<T>,
  ): Promise<T> {
    return this.starPromotionsRepository.manager.transaction(
      'READ COMMITTED',
      async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(731942, 2)');
        return work(manager.getRepository(StarPromotion));
      },
    );
  }

  // ── Validaciones de negocio ─────────────────────────────────────────────────

  /** startDate <= endDate. Defensa en profundidad (el DTO ya lo valida al crear). */
  private assertValidDates(startDate: string, endDate: string): void {
    if (startDate > endDate) {
      throw new BadRequestException(
        'startDate debe ser anterior o igual a endDate',
      );
    }
  }

  /**
   * Rechaza el guardado si otra promoción ACTIVA se solapa con el rango de
   * fechas dado. `excludeId` permite ignorar la propia promoción al editarla.
   * El mensaje menciona "fechas" a propósito: el panel admin mapea un 400 con
   * esa palabra al campo endDate (mismo contrato que otras validaciones de
   * rango del proyecto, ej. banners).
   */
  private async assertNoOverlap(
    repo: Repository<StarPromotion>,
    startDate: string,
    endDate: string,
    excludeId?: string,
  ): Promise<void> {
    const qb = repo
      .createQueryBuilder('promo')
      .where('promo.active = true')
      .andWhere('promo.startDate <= :endDate', { endDate })
      .andWhere('promo.endDate >= :startDate', { startDate });
    if (excludeId) {
      qb.andWhere('promo.id != :excludeId', { excludeId });
    }
    const overlapping = await qb.getOne();
    if (overlapping) {
      throw new BadRequestException(
        'Ya existe una promoción activa en ese rango de fechas',
      );
    }
  }
}
