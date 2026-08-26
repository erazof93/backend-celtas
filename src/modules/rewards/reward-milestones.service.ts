import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CreateRewardMilestoneDto } from './dto/create-reward-milestone.dto';
import { UpdateRewardMilestoneDto } from './dto/update-reward-milestone.dto';
import { RewardMilestone } from './entities/reward-milestone.entity';

/**
 * CRUD admin de los hitos del tablero de estrellas. A diferencia de
 * `StarPromotionsService`, SÍ admite DELETE real (ver comentario en la
 * entidad): un hito borrado no corrompe premios ya ganados, porque
 * `RewardRedemption` guarda su propio snapshot del umbral, no una FK.
 */
@Injectable()
export class RewardMilestonesService {
  constructor(
    @InjectRepository(RewardMilestone)
    private readonly rewardMilestonesRepository: Repository<RewardMilestone>,
  ) {}

  async findAll(): Promise<RewardMilestone[]> {
    return this.rewardMilestonesRepository.find({
      order: { starsRequired: 'ASC' },
    });
  }

  async findOne(id: string): Promise<RewardMilestone> {
    const milestone = await this.rewardMilestonesRepository.findOne({
      where: { id },
    });
    if (!milestone) {
      throw new NotFoundException('El hito no existe');
    }
    return milestone;
  }

  async create(dto: CreateRewardMilestoneDto): Promise<RewardMilestone> {
    const milestone = this.rewardMilestonesRepository.create({
      starsRequired: dto.starsRequired,
      isSpecial: dto.isSpecial ?? false,
    });
    try {
      return await this.rewardMilestonesRepository.save(milestone);
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  async update(
    id: string,
    dto: UpdateRewardMilestoneDto,
  ): Promise<RewardMilestone> {
    const milestone = await this.findOne(id);
    this.rewardMilestonesRepository.merge(milestone, dto);
    try {
      return await this.rewardMilestonesRepository.save(milestone);
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  async remove(id: string): Promise<void> {
    const milestone = await this.findOne(id);
    await this.rewardMilestonesRepository.remove(milestone);
  }

  /** Traduce la violación de UNIQUE de starsRequired a un 400 legible, no un 500 crudo de Postgres. */
  private translateUniqueViolation(error: unknown): Error {
    if (this.isUniqueViolation(error)) {
      return new BadRequestException(
        'Ya existe un premio configurado para esa cantidad de estrellas',
      );
    }
    return error as Error;
  }

  /** True si el error es una violación de constraint UNIQUE de Postgres (SQLSTATE 23505). */
  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === '23505'
    );
  }
}
