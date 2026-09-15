import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { CreateBeverageDto } from './dto/create-beverage.dto';
import { UpdateBeverageDto } from './dto/update-beverage.dto';
import { Beverage } from './entities/beverage.entity';

/**
 * Catálogo de bebidas (admin). Sin dependencia de MenuItem: el borrado, renombrado
 * o cambio de precio de una bebida nunca toca pedidos ya creados (esos guardan un
 * snapshot de `{ name, price }` en `OrderItem.selectedBeverages`, ver skill
 * nestjs-celtas). Mismo patrón que `SaucesService`.
 */
@Injectable()
export class BeveragesService {
  constructor(
    @InjectRepository(Beverage)
    private readonly beveragesRepository: Repository<Beverage>,
  ) {}

  async create(dto: CreateBeverageDto): Promise<Beverage> {
    await this.ensureNameAvailable(dto.name);
    const beverage = this.beveragesRepository.create(dto);
    return this.runSaveWithUniqueFallback(
      this.beveragesRepository.save(beverage),
      'Ya existe una bebida con ese nombre',
    );
  }

  async findAll(): Promise<Beverage[]> {
    return this.beveragesRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async update(id: string, dto: UpdateBeverageDto): Promise<Beverage> {
    const beverage = await this.beveragesRepository.findOne({
      where: { id },
    });
    if (!beverage) {
      throw new NotFoundException('Bebida no encontrada');
    }
    if (dto.name !== undefined && dto.name !== beverage.name) {
      await this.ensureNameAvailable(dto.name, id);
    }
    // merge (no Object.assign): mismo criterio que el resto del proyecto — solo
    // aplica los campos definidos del DTO, sin pisar con undefined los ya cargados.
    this.beveragesRepository.merge(beverage, dto);
    return this.runSaveWithUniqueFallback(
      this.beveragesRepository.save(beverage),
      'Ya existe una bebida con ese nombre',
    );
  }

  async remove(id: string): Promise<void> {
    const beverage = await this.beveragesRepository.findOne({
      where: { id },
    });
    if (!beverage) {
      throw new NotFoundException('Bebida no encontrada');
    }
    // Sin bloqueo por uso: es un catálogo de etiquetas, no una FK con historial —
    // los pedidos ya creados guardan `{ name, price }` como snapshot
    // (OrderItem.selectedBeverages), así que borrarla solo la quita de la oferta
    // futura de los productos que la tenían.
    //
    // La FK de `menu_item_beverages.beverageId` queda en ON DELETE NO ACTION
    // (default de TypeORM para el lado inverso de un ManyToMany con @JoinTable —
    // solo el lado dueño, menuItemId, cascadea; mismo caso ya confirmado con
    // `menu_item_sauces`, ver SaucesService.remove). Sin este borrado explícito,
    // eliminar una bebida todavía asignada a algún producto revienta con un 500
    // (violación de FK) en vez de simplemente quitarla de la oferta futura.
    await this.beveragesRepository.manager.query(
      'DELETE FROM menu_item_beverages WHERE "beverageId" = $1',
      [id],
    );
    await this.beveragesRepository.remove(beverage);
  }

  /** Resuelve una lista de UUIDs a entidades Beverage reales; 404 si alguno no existe. */
  async findByIds(ids: string[]): Promise<Beverage[]> {
    if (ids.length === 0) {
      return [];
    }
    const beverages = await this.beveragesRepository.findBy({
      id: In(ids),
    });
    if (beverages.length !== new Set(ids).size) {
      throw new NotFoundException('Una o más bebidas no existen');
    }
    return beverages;
  }

  private async ensureNameAvailable(
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.beveragesRepository.findOne({
      where: { name },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('Ya existe una bebida con ese nombre');
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
