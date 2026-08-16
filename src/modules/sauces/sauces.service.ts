import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { CreateSauceDto } from './dto/create-sauce.dto';
import { UpdateSauceDto } from './dto/update-sauce.dto';
import { Sauce } from './entities/sauce.entity';

/**
 * Catálogo de salsas/cremas (admin). Sin dependencia de MenuItem: el borrado o
 * renombrado de una salsa nunca toca pedidos ya creados (esos guardan un snapshot
 * de texto en `OrderItem.selectedSauces`, ver skill nestjs-celtas).
 */
@Injectable()
export class SaucesService {
  constructor(
    @InjectRepository(Sauce)
    private readonly saucesRepository: Repository<Sauce>,
  ) {}

  async create(dto: CreateSauceDto): Promise<Sauce> {
    await this.ensureNameAvailable(dto.name);
    const sauce = this.saucesRepository.create(dto);
    return this.runSaveWithUniqueFallback(
      this.saucesRepository.save(sauce),
      'Ya existe una salsa con ese nombre',
    );
  }

  async findAll(): Promise<Sauce[]> {
    return this.saucesRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async update(id: string, dto: UpdateSauceDto): Promise<Sauce> {
    const sauce = await this.saucesRepository.findOne({ where: { id } });
    if (!sauce) {
      throw new NotFoundException('Salsa no encontrada');
    }
    if (dto.name !== undefined && dto.name !== sauce.name) {
      await this.ensureNameAvailable(dto.name, id);
    }
    // merge (no Object.assign): mismo criterio que el resto del proyecto — solo
    // aplica los campos definidos del DTO, sin pisar con undefined los ya cargados.
    this.saucesRepository.merge(sauce, dto);
    return this.runSaveWithUniqueFallback(
      this.saucesRepository.save(sauce),
      'Ya existe una salsa con ese nombre',
    );
  }

  async remove(id: string): Promise<void> {
    const sauce = await this.saucesRepository.findOne({ where: { id } });
    if (!sauce) {
      throw new NotFoundException('Salsa no encontrada');
    }
    // Sin bloqueo por uso: es un catálogo de etiquetas, no una FK con historial —
    // los pedidos ya creados guardan el nombre como snapshot (OrderItem.selectedSauces),
    // así que borrarla solo la quita de la oferta futura de los productos que la tenían.
    //
    // La FK de `menu_item_sauces.sauceId` quedó en ON DELETE NO ACTION (default de
    // TypeORM para el lado inverso de un ManyToMany con @JoinTable — solo el lado
    // dueño, menuItemId, cascadea; ver migración AddSaucesCatalog). Confirmado contra
    // el schema real: sin este borrado explícito, eliminar una salsa todavía asignada
    // a algún producto revienta con un 500 (violación de FK) en vez de simplemente
    // quitarla de la oferta futura. Se limpia la relación primero, en la misma
    // operación lógica.
    await this.saucesRepository.manager.query(
      'DELETE FROM menu_item_sauces WHERE "sauceId" = $1',
      [id],
    );
    await this.saucesRepository.remove(sauce);
  }

  /** Resuelve una lista de UUIDs a entidades Sauce reales; 404 si alguno no existe. */
  async findByIds(ids: string[]): Promise<Sauce[]> {
    if (ids.length === 0) {
      return [];
    }
    const sauces = await this.saucesRepository.findBy({
      id: In(ids),
    });
    if (sauces.length !== new Set(ids).size) {
      throw new NotFoundException('Una o más salsas no existen');
    }
    return sauces;
  }

  private async ensureNameAvailable(
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.saucesRepository.findOne({ where: { name } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('Ya existe una salsa con ese nombre');
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
