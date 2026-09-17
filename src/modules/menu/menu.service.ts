import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { BeveragesService } from '../beverages/beverages.service';
import { ExtraPortionsService } from '../extra-portions/extra-portions.service';
import { SaucesService } from '../sauces/sauces.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { Category } from './entities/category.entity';
import { MenuItem } from './entities/menu-item.entity';

/** Forma de una categoría en el menú público (solo campos que le interesan a la app). */
export interface PublicMenuCategory {
  id: string;
  name: string;
  description: string | null;
  items: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    image: string | null;
    sauces: { id: string; name: string }[];
    beverages: { id: string; name: string; price: number }[];
    beverageGroupRequired: boolean;
    beverageGroupMaxSelectable: number;
    extraPortions: { id: string; name: string; price: number }[];
    extraPortionsGroupRequired: boolean;
    extraPortionsGroupMaxSelectable: number;
  }[];
}

/**
 * Módulo Menu: categorías + productos.
 * - El endpoint público `GET /menu` lo consume la app (solo categorías activas con
 *   productos disponibles).
 * - El resto del CRUD es exclusivo del panel admin.
 */
@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(MenuItem)
    private readonly itemsRepository: Repository<MenuItem>,
    private readonly saucesService: SaucesService,
    private readonly beveragesService: BeveragesService,
    private readonly extraPortionsService: ExtraPortionsService,
  ) {}

  /**
   * Menú optimizado para la app: categorías activas, ordenadas por sortOrder, que
   * contienen al menos un producto disponible. Los productos no disponibles se omiten.
   * Cada producto incluye sus salsas/bebidas/porciones extras activas (id+name, y
   * precio para bebidas/porciones extras); vacío = sin selector de esa categoría en
   * la app. `beverageGroupRequired`/`Max` y `extraPortionsGroupRequired`/`Max`
   * viajan siempre (aunque el array esté vacío) para que la app no tenga que
   * adivinar el default si el admin no configuró nada.
   */
  async findPublicMenu(): Promise<PublicMenuCategory[]> {
    const categories = await this.categoriesRepository.find({
      where: { active: true },
      relations: {
        items: { sauces: true, beverages: true, extraPortions: true },
      },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    return categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        items: category.items
          .filter((item) => item.available)
          .map(
            ({
              id,
              name,
              description,
              price,
              image,
              sauces,
              beverages,
              beverageGroupRequired,
              beverageGroupMaxSelectable,
              extraPortions,
              extraPortionsGroupRequired,
              extraPortionsGroupMaxSelectable,
            }) => ({
              id,
              name,
              description,
              price,
              image,
              // Solo activos: uno desactivado sigue asignado al producto (el admin
              // no pierde la relación) pero deja de ofrecerse en la app. Mismo
              // criterio para sauces/beverages/extraPortions.
              sauces: (sauces ?? [])
                .filter((sauce) => sauce.active)
                .sort(
                  (a, b) =>
                    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
                )
                .map(({ id: sauceId, name: sauceName }) => ({
                  id: sauceId,
                  name: sauceName,
                })),
              beverages: (beverages ?? [])
                .filter((beverage) => beverage.active)
                .sort(
                  (a, b) =>
                    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
                )
                .map(
                  ({
                    id: beverageId,
                    name: beverageName,
                    price: beveragePrice,
                    includeFreeTo,
                  }) => ({
                    id: beverageId,
                    name: beverageName,
                    // 0 si este producto es un combo con esta bebida incluida
                    // gratis (`includeFreeTo`), mismo criterio de precio que
                    // `OrdersService.resolveBeveragePrices` — lo que la app
                    // muestra en el menú y lo que se cobra en `POST /orders`
                    // siempre deben coincidir.
                    price: includeFreeTo?.includes(id) ? 0 : beveragePrice,
                  }),
                ),
              beverageGroupRequired,
              beverageGroupMaxSelectable,
              extraPortions: (extraPortions ?? [])
                .filter((extraPortion) => extraPortion.active)
                .sort(
                  (a, b) =>
                    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
                )
                .map(
                  ({
                    id: extraPortionId,
                    name: extraPortionName,
                    price: extraPortionPrice,
                  }) => ({
                    id: extraPortionId,
                    name: extraPortionName,
                    price: extraPortionPrice,
                  }),
                ),
              extraPortionsGroupRequired,
              extraPortionsGroupMaxSelectable,
            }),
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((category) => category.items.length > 0);
  }

  // ── Categorías (admin) ──────────────────────────────────────────────────────

  async createCategory(dto: CreateCategoryDto): Promise<Category> {
    await this.ensureCategoryNameAvailable(dto.name);
    const category = this.categoriesRepository.create(dto);
    return this.runSaveWithUniqueFallback(
      this.categoriesRepository.save(category),
      'Ya existe una categoría con ese nombre',
    );
  }

  async findAllCategories(): Promise<Category[]> {
    return this.categoriesRepository.find({
      relations: { items: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.categoriesRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
    // Si se renombra, el nuevo nombre no debe chocar con otra categoría.
    if (dto.name !== undefined && dto.name !== category.name) {
      await this.ensureCategoryNameAvailable(dto.name, id);
    }
    // merge (no Object.assign): solo aplica los campos definidos del DTO. Con
    // Object.assign, los campos ausentes del PATCH (undefined) pisaban los valores
    // ya cargados de la entidad y la respuesta salía incompleta.
    this.categoriesRepository.merge(category, dto);
    return this.runSaveWithUniqueFallback(
      this.categoriesRepository.save(category),
      'Ya existe una categoría con ese nombre',
    );
  }

  async removeCategory(id: string): Promise<void> {
    const category = await this.categoriesRepository.findOne({
      where: { id },
      relations: { items: true },
    });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
    if (category.items.length > 0) {
      throw new ConflictException(
        'No se puede eliminar una categoría que tiene productos',
      );
    }
    await this.categoriesRepository.remove(category);
  }

  // ── Productos (admin) ───────────────────────────────────────────────────────

  async createItem(dto: CreateMenuItemDto): Promise<MenuItem> {
    await this.ensureCategory(dto.categoryId);
    // sauceIds/beverageIds/extraPortionIds no son columnas propias de MenuItem
    // (son las relaciones ManyToMany): se separan del resto del DTO antes de
    // `create` y se resuelven aparte.
    const { sauceIds, beverageIds, extraPortionIds, ...rest } = dto;
    const item = this.itemsRepository.create(rest);
    if (sauceIds !== undefined) {
      item.sauces = await this.saucesService.findByIds(sauceIds);
    }
    if (beverageIds !== undefined) {
      item.beverages = await this.beveragesService.findByIds(beverageIds);
    }
    if (extraPortionIds !== undefined) {
      item.extraPortions =
        await this.extraPortionsService.findByIds(extraPortionIds);
    }
    return this.runSaveWithUniqueFallback(
      this.itemsRepository.save(item),
      'Ya existe un producto con ese nombre',
    );
  }

  async findAllItems(): Promise<MenuItem[]> {
    return this.itemsRepository.find({
      relations: {
        category: true,
        sauces: true,
        beverages: true,
        extraPortions: true,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async updateItem(id: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    const item = await this.itemsRepository.findOne({
      where: { id },
      relations: {
        category: true,
        sauces: true,
        beverages: true,
        extraPortions: true,
      },
    });
    if (!item) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (dto.categoryId !== undefined) {
      await this.ensureCategory(dto.categoryId);
    }
    const { sauceIds, beverageIds, extraPortionIds, ...rest } = dto;
    // merge (no Object.assign): solo aplica los campos definidos del DTO. Con
    // Object.assign, los campos ausentes del PATCH (undefined) pisaban los valores
    // ya cargados de la entidad y la respuesta salía incompleta.
    this.itemsRepository.merge(item, rest);
    // Las relaciones ManyToMany no las toca `merge` (no son columnas): se
    // actualizan aparte, y SOLO si el PATCH las incluyó explícitamente — omitirlas
    // deja lo ya asignado intacto (mismo criterio "guard explícito" que el resto
    // del proyecto para campos que `merge` no puede cubrir).
    if (sauceIds !== undefined) {
      item.sauces = await this.saucesService.findByIds(sauceIds);
    }
    if (beverageIds !== undefined) {
      item.beverages = await this.beveragesService.findByIds(beverageIds);
    }
    if (extraPortionIds !== undefined) {
      item.extraPortions =
        await this.extraPortionsService.findByIds(extraPortionIds);
    }
    return this.runSaveWithUniqueFallback(
      this.itemsRepository.save(item),
      'Ya existe un producto con ese nombre',
    );
  }

  async removeItem(id: string): Promise<void> {
    const item = await this.itemsRepository.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException('Producto no encontrado');
    }
    await this.itemsRepository.remove(item);
  }

  // ── Imágenes (admin, vía Cloudinary) ────────────────────────────────────────

  /** Guarda la URL devuelta por Cloudinary en el producto. */
  async updateItemImage(id: string, imageUrl: string): Promise<MenuItem> {
    const item = await this.itemsRepository.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException('Producto no encontrado');
    }
    item.image = imageUrl;
    return this.itemsRepository.save(item);
  }

  /** Guarda la URL devuelta por Cloudinary en la categoría. */
  async updateCategoryImage(id: string, imageUrl: string): Promise<Category> {
    const category = await this.categoriesRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
    category.image = imageUrl;
    return this.categoriesRepository.save(category);
  }

  /** Valida que exista una categoría; 404 si no. */
  private async ensureCategory(categoryId: string): Promise<void> {
    const category = await this.categoriesRepository.findOne({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
  }

  /**
   * Valida que el nombre de categoría no esté en uso por otra categoría; 409 si lo está.
   * `exceptId` permite ignorar la propia categoría al renombrarla.
   */
  private async ensureCategoryNameAvailable(
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.categoriesRepository.findOne({
      where: { name },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('Ya existe una categoría con ese nombre');
    }
  }

  /**
   * Fallback de concurrencia: el chequeo previo (`ensureCategoryNameAvailable` /
   * `ensureCategory`) previene el 99% de los casos, pero dos peticiones simultáneas
   * pueden colarse y chocar con una constraint UNIQUE en la BD. Este helper convierte
   * esa violación (SQLSTATE 23505) en un 409 limpio en vez de un 500.
   */
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

  /** True si el error es una violación de constraint UNIQUE de Postgres (SQLSTATE 23505). */
  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === '23505'
    );
  }
}
