import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, QueryFailedError, Repository } from 'typeorm';
import { CreateFriesTypeDto } from './dto/create-fries-type.dto';
import { UpdateFriesTypeDto } from './dto/update-fries-type.dto';
import { FriesType } from './entities/fries-type.entity';

/** Catálogo inicial, sembrado solo si la tabla está vacía (ver `onModuleInit`). */
const DEFAULT_FRIES_TYPES: Pick<FriesType, 'name' | 'isDefault'>[] = [
  { name: 'Papas fritas', isDefault: true },
  { name: 'Papas al hilo', isDefault: false },
];

/**
 * Catálogo de tipos de papas (admin). Mismo patrón que `SaucesService`: sin
 * dependencia de MenuItem y el borrado nunca toca pedidos ya creados (guardan un
 * snapshot de texto en `OrderItem.selectedFriesTypes`).
 */
@Injectable()
export class FriesTypesService implements OnModuleInit {
  private readonly logger = new Logger(FriesTypesService.name);

  constructor(
    @InjectRepository(FriesType)
    private readonly friesTypesRepository: Repository<FriesType>,
  ) {}

  /**
   * Siembra el catálogo inicial SOLO si la tabla está vacía — no por nombre: si el
   * admin borra o renombra un tipo, un deploy posterior no debe resucitarlo.
   */
  async onModuleInit(): Promise<void> {
    if ((await this.friesTypesRepository.count()) > 0) {
      return;
    }
    await this.friesTypesRepository.save(
      DEFAULT_FRIES_TYPES.map((type) => this.friesTypesRepository.create(type)),
    );
    this.logger.log(
      `Catálogo de tipos de papas sembrado: ${DEFAULT_FRIES_TYPES.map((t) => t.name).join(', ')}`,
    );
  }

  async create(dto: CreateFriesTypeDto): Promise<FriesType> {
    await this.ensureNameAvailable(dto.name);
    const friesType = this.friesTypesRepository.create(dto);
    const saved = await this.runSaveWithUniqueFallback(
      this.friesTypesRepository.save(friesType),
    );
    if (saved.isDefault) {
      await this.clearOtherDefaults(saved.id);
    }
    return saved;
  }

  async findAll(): Promise<FriesType[]> {
    return this.friesTypesRepository.find({
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  async update(id: string, dto: UpdateFriesTypeDto): Promise<FriesType> {
    const friesType = await this.friesTypesRepository.findOne({
      where: { id },
    });
    if (!friesType) {
      throw new NotFoundException('Tipo de papas no encontrado');
    }
    if (dto.name !== undefined && dto.name !== friesType.name) {
      await this.ensureNameAvailable(dto.name, id);
    }
    // merge (no Object.assign): solo aplica los campos definidos del DTO.
    this.friesTypesRepository.merge(friesType, dto);
    const saved = await this.runSaveWithUniqueFallback(
      this.friesTypesRepository.save(friesType),
    );
    if (dto.isDefault === true) {
      await this.clearOtherDefaults(id);
    }
    return saved;
  }

  async remove(id: string): Promise<void> {
    const friesType = await this.friesTypesRepository.findOne({
      where: { id },
    });
    if (!friesType) {
      throw new NotFoundException('Tipo de papas no encontrado');
    }
    // Misma FK ON DELETE NO ACTION que `menu_item_sauces` (lado inverso del
    // @JoinTable, ver SaucesService.remove): sin limpiar la relación primero,
    // borrar un tipo asignado a algún producto revienta con 500.
    await this.friesTypesRepository.manager.query(
      'DELETE FROM menu_item_fries_types WHERE "friesTypeId" = $1',
      [id],
    );
    await this.friesTypesRepository.remove(friesType);
  }

  /** Resuelve una lista de UUIDs a entidades reales; 404 si alguno no existe. */
  async findByIds(ids: string[]): Promise<FriesType[]> {
    if (ids.length === 0) {
      return [];
    }
    const friesTypes = await this.friesTypesRepository.findBy({ id: In(ids) });
    if (friesTypes.length !== new Set(ids).size) {
      throw new NotFoundException('Uno o más tipos de papas no existen');
    }
    return friesTypes;
  }

  /** A lo sumo un default en todo el catálogo. */
  private async clearOtherDefaults(keepId: string): Promise<void> {
    await this.friesTypesRepository.update(
      { id: Not(keepId), isDefault: true },
      { isDefault: false },
    );
  }

  private async ensureNameAvailable(
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.friesTypesRepository.findOne({
      where: { name },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('Ya existe un tipo de papas con ese nombre');
    }
  }

  private async runSaveWithUniqueFallback<T>(
    savePromise: Promise<T>,
  ): Promise<T> {
    try {
      return await savePromise;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      ) {
        throw new ConflictException(
          'Ya existe un tipo de papas con ese nombre',
        );
      }
      throw error;
    }
  }
}
