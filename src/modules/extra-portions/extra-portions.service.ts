import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { CreateExtraPortionDto } from './dto/create-extra-portion.dto';
import { UpdateExtraPortionDto } from './dto/update-extra-portion.dto';
import { ExtraPortion } from './entities/extra-portion.entity';

/**
 * Catálogo de porciones extras (admin). Sin dependencia de MenuItem: el borrado,
 * renombrado o cambio de precio de una porción extra nunca toca pedidos ya creados
 * (esos guardan un snapshot de `{ name, price }` en `OrderItem.selectedExtraPortions`,
 * ver skill nestjs-celtas). Mismo patrón que `SaucesService`/`BeveragesService`.
 */
@Injectable()
export class ExtraPortionsService {
  constructor(
    @InjectRepository(ExtraPortion)
    private readonly extraPortionsRepository: Repository<ExtraPortion>,
  ) {}

  async create(dto: CreateExtraPortionDto): Promise<ExtraPortion> {
    await this.ensureNameAvailable(dto.name);
    const extraPortion = this.extraPortionsRepository.create(dto);
    return this.runSaveWithUniqueFallback(
      this.extraPortionsRepository.save(extraPortion),
      'Ya existe una porción extra con ese nombre',
    );
  }

  async findAll(): Promise<ExtraPortion[]> {
    return this.extraPortionsRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async update(id: string, dto: UpdateExtraPortionDto): Promise<ExtraPortion> {
    const extraPortion = await this.extraPortionsRepository.findOne({
      where: { id },
    });
    if (!extraPortion) {
      throw new NotFoundException('Porción extra no encontrada');
    }
    if (dto.name !== undefined && dto.name !== extraPortion.name) {
      await this.ensureNameAvailable(dto.name, id);
    }
    // merge (no Object.assign): mismo criterio que el resto del proyecto — solo
    // aplica los campos definidos del DTO, sin pisar con undefined los ya cargados.
    this.extraPortionsRepository.merge(extraPortion, dto);
    return this.runSaveWithUniqueFallback(
      this.extraPortionsRepository.save(extraPortion),
      'Ya existe una porción extra con ese nombre',
    );
  }

  async remove(id: string): Promise<void> {
    const extraPortion = await this.extraPortionsRepository.findOne({
      where: { id },
    });
    if (!extraPortion) {
      throw new NotFoundException('Porción extra no encontrada');
    }
    // Sin bloqueo por uso: es un catálogo de etiquetas, no una FK con historial —
    // los pedidos ya creados guardan `{ name, price }` como snapshot
    // (OrderItem.selectedExtraPortions), así que borrarla solo la quita de la
    // oferta futura de los productos que la tenían.
    //
    // La FK de `menu_item_extra_portions.extraPortionId` queda en ON DELETE NO
    // ACTION (default de TypeORM para el lado inverso de un ManyToMany con
    // @JoinTable — solo el lado dueño, menuItemId, cascadea; mismo caso ya
    // confirmado con `menu_item_sauces`, ver SaucesService.remove). Sin este
    // borrado explícito, eliminar una porción extra todavía asignada a algún
    // producto revienta con un 500 (violación de FK) en vez de simplemente
    // quitarla de la oferta futura.
    await this.extraPortionsRepository.manager.query(
      'DELETE FROM menu_item_extra_portions WHERE "extraPortionId" = $1',
      [id],
    );
    await this.extraPortionsRepository.remove(extraPortion);
  }

  /** Resuelve una lista de UUIDs a entidades ExtraPortion reales; 404 si alguno no existe. */
  async findByIds(ids: string[]): Promise<ExtraPortion[]> {
    if (ids.length === 0) {
      return [];
    }
    const extraPortions = await this.extraPortionsRepository.findBy({
      id: In(ids),
    });
    if (extraPortions.length !== new Set(ids).size) {
      throw new NotFoundException('Una o más porciones extras no existen');
    }
    return extraPortions;
  }

  private async ensureNameAvailable(
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.extraPortionsRepository.findOne({
      where: { name },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('Ya existe una porción extra con ese nombre');
    }
  }

  private async runSaveWithUniqueFallback<T>(
    savePromise: Promise<T>,
    message: string,
  ): Promise<T> {
    try {
      return await savePromise;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(message);
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === '23505'
    );
  }
}
