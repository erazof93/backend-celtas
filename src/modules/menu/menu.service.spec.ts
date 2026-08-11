import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { Category } from './entities/category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { MenuService } from './menu.service';

/** Mock de repositorio: devuelve el mismo objeto que recibe (identity tipado). */
const passthrough = <T>(value: T): T => value;

/** Construye un QueryFailedError de Postgres con SQLSTATE 23505 (unique_violation). */
const uniqueViolationError = (): QueryFailedError => {
  const driverError = new Error(
    'duplicate key value violates unique constraint "UQ_categories_name"',
  );
  (driverError as { code?: string }).code = '23505';
  return new QueryFailedError('INSERT INTO categories ...', [], driverError);
};

/** Replica Repository.merge de TypeORM: solo copia las propiedades definidas. */
const mergeImplementation = <T extends object>(target: T, dto: object) => {
  for (const key of Object.keys(dto)) {
    const value = (dto as Record<string, unknown>)[key];
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
};

describe('MenuService', () => {
  let service: MenuService;
  let categoriesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let itemsRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };

  const catId = '11111111-1111-1111-1111-111111111111';
  const otherCatId = '22222222-2222-2222-2222-222222222222';

  const seedCategory = (overrides: Partial<Category> = {}) =>
    ({
      id: catId,
      name: 'Burgers',
      description: 'Hamburguesas',
      image: null,
      active: true,
      sortOrder: 1,
      items: [],
      ...overrides,
    }) as Category;

  const seedItem = (overrides: Partial<MenuItem> = {}) =>
    ({
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Clásica',
      description: null,
      price: 24.9,
      image: null,
      available: true,
      categoryId: catId,
      category: null,
      ...overrides,
    }) as MenuItem;

  beforeEach(async () => {
    categoriesRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      merge: jest.fn(mergeImplementation),
      save: jest.fn(),
      remove: jest.fn(),
    };
    itemsRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      merge: jest.fn(mergeImplementation),
      save: jest.fn(),
      remove: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuService,
        { provide: getRepositoryToken(Category), useValue: categoriesRepo },
        { provide: getRepositoryToken(MenuItem), useValue: itemsRepo },
      ],
    }).compile();

    service = module.get(MenuService);
  });

  describe('findPublicMenu', () => {
    it('consulta solo categorías activas y filtra productos no disponibles', async () => {
      const available = seedItem({ id: 'i-1', name: 'Clásica' });
      const unavailable = seedItem({
        id: 'i-2',
        name: 'Dejar de ofrecer',
        available: false,
      });

      // El repo aplica el filtro active: true (vía where); el servicio recibe solo
      // categorías activas y se encarga de ocultar productos no disponibles.
      categoriesRepo.find.mockResolvedValue([
        seedCategory({ items: [available, unavailable] }),
      ]);

      const result = await service.findPublicMenu();

      expect(categoriesRepo.find).toHaveBeenCalledWith({
        where: { active: true },
        relations: { items: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(catId);
      expect(result[0].items).toHaveLength(1);
      expect(result[0].items[0].id).toBe('i-1');
      // La app no recibe el flag available: se omiten los productos no disponibles.
      expect(result[0].items[0].available).toBeUndefined();
    });

    it('omite categorías activas sin productos disponibles', async () => {
      categoriesRepo.find.mockResolvedValue([
        seedCategory({ items: [seedItem({ available: false })] }),
      ]);
      const result = await service.findPublicMenu();
      expect(result).toEqual([]);
    });
  });

  describe('createCategory', () => {
    it('crea y guarda la categoría con el dto', async () => {
      const dto = { name: 'Chicken', description: 'Pollo', sortOrder: 2 };
      categoriesRepo.create.mockImplementation(passthrough);
      categoriesRepo.save.mockImplementation(passthrough);
      const result = await service.createCategory(dto);
      expect(categoriesRepo.save).toHaveBeenCalledWith(dto);
      expect(result).toEqual(dto);
    });

    it('lanza 409 si ya existe una categoría con ese nombre', async () => {
      categoriesRepo.findOne.mockResolvedValue(
        seedCategory({ id: otherCatId, name: 'Chicken' }),
      );
      await expect(
        service.createCategory({ name: 'Chicken' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(categoriesRepo.save).not.toHaveBeenCalled();
    });

    it('convierte una violación UNIQUE de la BD (23505) en 409 (fallback de concurrencia)', async () => {
      categoriesRepo.findOne.mockResolvedValue(null); // el chequeo previo no detecta nada
      categoriesRepo.create.mockImplementation(passthrough);
      categoriesRepo.save.mockRejectedValue(uniqueViolationError());

      await expect(
        service.createCategory({ name: 'Chicken' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-lanza errores de BD que NO son violación de unicidad', async () => {
      categoriesRepo.findOne.mockResolvedValue(null);
      categoriesRepo.create.mockImplementation(passthrough);
      const dbError = new QueryFailedError(
        'SELECT ...',
        [],
        Object.assign(new Error('connection refused'), {
          code: 'ECONNREFUSED',
        }),
      );
      categoriesRepo.save.mockRejectedValue(dbError);

      await expect(service.createCategory({ name: 'Chicken' })).rejects.toBe(
        dbError,
      );
    });
  });

  describe('findAllCategories', () => {
    it('devuelve todas las categorías con items', async () => {
      categoriesRepo.find.mockResolvedValue([seedCategory()]);
      const result = await service.findAllCategories();
      expect(result).toHaveLength(1);
      expect(categoriesRepo.find).toHaveBeenCalledWith({
        relations: { items: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('updateCategory', () => {
    it('actualiza los campos recibidos', async () => {
      const existing = seedCategory();
      categoriesRepo.findOne.mockResolvedValue(existing);
      categoriesRepo.save.mockImplementation(passthrough);

      const result = await service.updateCategory(catId, { name: 'Burguer' });
      expect(result.name).toBe('Burguer');
      expect(categoriesRepo.save).toHaveBeenCalledWith(existing);
    });

    it('lanza 404 si la categoría no existe', async () => {
      categoriesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateCategory(catId, { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(categoriesRepo.save).not.toHaveBeenCalled();
    });

    it('lanza 409 si se renombra a un nombre ya usado por otra categoría', async () => {
      categoriesRepo.findOne.mockResolvedValueOnce(seedCategory()); // la propia
      categoriesRepo.findOne.mockResolvedValueOnce(
        seedCategory({ id: otherCatId, name: 'Chicken' }),
      );
      await expect(
        service.updateCategory(catId, { name: 'Chicken' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(categoriesRepo.save).not.toHaveBeenCalled();
    });

    it('permite conservar el mismo nombre (no se considera duplicado)', async () => {
      const existing = seedCategory({ name: 'Burgers' });
      categoriesRepo.findOne.mockResolvedValue(existing);
      categoriesRepo.save.mockImplementation(passthrough);

      const result = await service.updateCategory(catId, { name: 'Burgers' });
      expect(result.name).toBe('Burgers');
      expect(categoriesRepo.save).toHaveBeenCalled();
    });

    it('convierte una violación UNIQUE de la BD (23505) en 409 al renombrar (fallback)', async () => {
      const existing = seedCategory({ name: 'Burgers' });
      categoriesRepo.findOne.mockResolvedValueOnce(existing); // encuentra la propia
      categoriesRepo.findOne.mockResolvedValueOnce(null); // el chequeo previo no ve conflicto
      categoriesRepo.save.mockRejectedValue(uniqueViolationError());

      await expect(
        service.updateCategory(catId, { name: 'Chicken' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('removeCategory', () => {
    it('lanza 404 si la categoría no existe', async () => {
      categoriesRepo.findOne.mockResolvedValue(null);
      await expect(service.removeCategory(catId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(categoriesRepo.remove).not.toHaveBeenCalled();
    });

    it('lanza 409 si la categoría tiene productos', async () => {
      categoriesRepo.findOne.mockResolvedValue(
        seedCategory({ items: [seedItem()] }),
      );
      await expect(service.removeCategory(catId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(categoriesRepo.remove).not.toHaveBeenCalled();
    });

    it('elimina la categoría si no tiene productos', async () => {
      const empty = seedCategory({ items: [] });
      categoriesRepo.findOne.mockResolvedValue(empty);
      categoriesRepo.remove.mockResolvedValue(empty);

      await service.removeCategory(catId);
      expect(categoriesRepo.remove).toHaveBeenCalledWith(empty);
    });
  });

  describe('createItem', () => {
    it('lanza 404 si la categoría no existe', async () => {
      categoriesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createItem({ name: 'X', price: 10, categoryId: catId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(itemsRepo.save).not.toHaveBeenCalled();
    });

    it('crea el producto ligado a la categoría', async () => {
      categoriesRepo.findOne.mockResolvedValue(seedCategory());
      const dto = { name: 'Celta', price: 15, categoryId: catId };
      itemsRepo.create.mockImplementation(passthrough);
      itemsRepo.save.mockImplementation(passthrough);

      const result = await service.createItem(dto);
      expect(categoriesRepo.findOne).toHaveBeenCalled();
      expect(itemsRepo.save).toHaveBeenCalledWith(dto);
      expect(result).toEqual(dto);
    });

    it('convierte una violación UNIQUE de la BD (23505) en 409 (fallback)', async () => {
      categoriesRepo.findOne.mockResolvedValue(seedCategory());
      itemsRepo.create.mockImplementation(passthrough);
      itemsRepo.save.mockRejectedValue(uniqueViolationError());

      await expect(
        service.createItem({ name: 'Celta', price: 15, categoryId: catId }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAllItems', () => {
    it('devuelve productos con su categoría', async () => {
      itemsRepo.find.mockResolvedValue([seedItem()]);
      const result = await service.findAllItems();
      expect(result).toHaveLength(1);
      expect(itemsRepo.find).toHaveBeenCalledWith({
        relations: { category: true },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('updateItem', () => {
    it('lanza 404 si el producto no existe', async () => {
      itemsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateItem('item-1', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(itemsRepo.save).not.toHaveBeenCalled();
    });

    it('actualiza el producto sin tocar la categoría si no llega categoryId', async () => {
      const existing = seedItem({ name: 'Viejo' });
      itemsRepo.findOne.mockResolvedValue(existing);
      itemsRepo.save.mockImplementation(passthrough);

      const result = await service.updateItem('item-1', { price: 30 });
      expect(result.price).toBe(30);
      expect(categoriesRepo.findOne).not.toHaveBeenCalled();
    });

    it('valida la nueva categoría si llega categoryId', async () => {
      const existing = seedItem();
      itemsRepo.findOne.mockResolvedValue(existing);
      categoriesRepo.findOne.mockResolvedValue(seedCategory());
      itemsRepo.save.mockImplementation(passthrough);

      await service.updateItem('item-1', { categoryId: otherCatId });
      expect(categoriesRepo.findOne).toHaveBeenCalledWith({
        where: { id: otherCatId },
      });
    });

    it('lanza 404 si la nueva categoría no existe', async () => {
      itemsRepo.findOne.mockResolvedValue(seedItem());
      categoriesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateItem('item-1', { categoryId: otherCatId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(itemsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('lanza 404 si el producto no existe', async () => {
      itemsRepo.findOne.mockResolvedValue(null);
      await expect(service.removeItem('item-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(itemsRepo.remove).not.toHaveBeenCalled();
    });

    it('elimina el producto', async () => {
      const existing = seedItem();
      itemsRepo.findOne.mockResolvedValue(existing);
      itemsRepo.remove.mockResolvedValue(existing);
      await service.removeItem('item-1');
      expect(itemsRepo.remove).toHaveBeenCalledWith(existing);
    });
  });

  describe('updateItemImage', () => {
    it('guarda la URL de Cloudinary en el producto', async () => {
      const existing = seedItem({ image: null });
      itemsRepo.findOne.mockResolvedValue(existing);
      itemsRepo.save.mockImplementation(passthrough);

      const result = await service.updateItemImage(
        'item-1',
        'https://res.cloudinary.com/x.jpg',
      );
      expect(result.image).toBe('https://res.cloudinary.com/x.jpg');
      expect(itemsRepo.save).toHaveBeenCalledWith(existing);
    });

    it('lanza 404 si el producto no existe', async () => {
      itemsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateItemImage('item-1', 'https://x/y.jpg'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(itemsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateCategoryImage', () => {
    it('guarda la imagen de Cloudinary en la categoría', async () => {
      const existing = seedCategory({ image: null });
      categoriesRepo.findOne.mockResolvedValue(existing);
      categoriesRepo.save.mockImplementation(passthrough);

      const result = await service.updateCategoryImage(
        catId,
        'https://res.cloudinary.com/cat.jpg',
      );
      expect(result.image).toBe('https://res.cloudinary.com/cat.jpg');
      expect(categoriesRepo.save).toHaveBeenCalledWith(existing);
    });

    it('lanza 404 si la categoría no existe', async () => {
      categoriesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateCategoryImage(catId, 'https://x/y.jpg'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(categoriesRepo.save).not.toHaveBeenCalled();
    });
  });
});
