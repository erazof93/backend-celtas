import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
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
  ) {}

  /**
   * Menú optimizado para la app: categorías activas, ordenadas por sortOrder, que
   * contienen al menos un producto disponible. Los productos no disponibles se omiten.
   */
  async findPublicMenu(): Promise<PublicMenuCategory[]> {
    const categories = await this.categoriesRepository.find({
      where: { active: true },
      relations: { items: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    return categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        items: category.items
          .filter((item) => item.available)
          .map(({ id, name, description, price, image }) => ({
            id,
            name,
            description,
            price,
            image,
          }))
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
    Object.assign(category, dto);
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
    const item = this.itemsRepository.create(dto);
    return this.runSaveWithUniqueFallback(
      this.itemsRepository.save(item),
      'Ya existe un producto con ese nombre',
    );
  }

  async findAllItems(): Promise<MenuItem[]> {
    return this.itemsRepository.find({
      relations: { category: true },
      order: { createdAt: 'DESC' },
    });
  }

  async updateItem(id: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    const item = await this.itemsRepository.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!item) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (dto.categoryId !== undefined) {
      await this.ensureCategory(dto.categoryId);
    }
    Object.assign(item, dto);
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
