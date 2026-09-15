import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { BeveragesService } from './beverages.service';
import { Beverage } from './entities/beverage.entity';

/** Mock de repositorio: devuelve el mismo objeto que recibe (identity tipado). */
const passthrough = <T>(value: T): T => value;

/** Construye un QueryFailedError de Postgres con SQLSTATE 23505 (unique_violation). */
const uniqueViolationError = (): QueryFailedError => {
  const driverError = new Error(
    'duplicate key value violates unique constraint "UQ_beverages_name"',
  );
  (driverError as { code?: string }).code = '23505';
  return new QueryFailedError('INSERT INTO beverages ...', [], driverError);
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

describe('BeveragesService', () => {
  let service: BeveragesService;
  let beveragesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findBy: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    manager: { query: jest.Mock };
  };

  const beverageId = '11111111-1111-1111-1111-111111111111';
  const otherId = '22222222-2222-2222-2222-222222222222';

  const seedBeverage = (overrides: Partial<Beverage> = {}) =>
    ({
      id: beverageId,
      name: 'Coca-Cola 500ml',
      price: 5,
      active: true,
      sortOrder: 0,
      ...overrides,
    }) as Beverage;

  beforeEach(async () => {
    beveragesRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findBy: jest.fn(),
      create: jest.fn(),
      merge: jest.fn(mergeImplementation),
      save: jest.fn(),
      remove: jest.fn(),
      manager: { query: jest.fn().mockResolvedValue(undefined) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BeveragesService,
        { provide: getRepositoryToken(Beverage), useValue: beveragesRepo },
      ],
    }).compile();

    service = module.get(BeveragesService);
  });

  describe('create', () => {
    it('crea y guarda la bebida con el dto', async () => {
      const dto = { name: 'Inca Kola 500ml', price: 5.5 };
      beveragesRepo.create.mockImplementation(passthrough);
      beveragesRepo.save.mockImplementation(passthrough);
      const result = await service.create(dto);
      expect(beveragesRepo.save).toHaveBeenCalledWith(dto);
      expect(result).toEqual(dto);
    });

    it('lanza 409 si ya existe una bebida con ese nombre', async () => {
      beveragesRepo.findOne.mockResolvedValue(
        seedBeverage({ name: 'Inca Kola 500ml' }),
      );
      await expect(
        service.create({ name: 'Inca Kola 500ml', price: 5.5 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(beveragesRepo.save).not.toHaveBeenCalled();
    });

    it('convierte una violación UNIQUE de la BD (23505) en 409 (fallback de concurrencia)', async () => {
      beveragesRepo.findOne.mockResolvedValue(null);
      beveragesRepo.create.mockImplementation(passthrough);
      beveragesRepo.save.mockRejectedValue(uniqueViolationError());

      await expect(
        service.create({ name: 'Inca Kola 500ml', price: 5.5 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('devuelve todas las bebidas ordenadas por sortOrder', async () => {
      beveragesRepo.find.mockResolvedValue([seedBeverage()]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(beveragesRepo.find).toHaveBeenCalledWith({
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('update', () => {
    it('actualiza los campos recibidos', async () => {
      const existing = seedBeverage();
      beveragesRepo.findOne.mockResolvedValue(existing);
      beveragesRepo.save.mockImplementation(passthrough);

      const result = await service.update(beverageId, { price: 6 });
      expect(result.price).toBe(6);
      expect(beveragesRepo.save).toHaveBeenCalledWith(existing);
    });

    it('lanza 404 si la bebida no existe', async () => {
      beveragesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update(beverageId, { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(beveragesRepo.save).not.toHaveBeenCalled();
    });

    it('lanza 409 si se renombra a un nombre ya usado por otra bebida', async () => {
      beveragesRepo.findOne.mockResolvedValueOnce(seedBeverage());
      beveragesRepo.findOne.mockResolvedValueOnce(
        seedBeverage({ id: otherId, name: 'Inca Kola 500ml' }),
      );
      await expect(
        service.update(beverageId, { name: 'Inca Kola 500ml' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(beveragesRepo.save).not.toHaveBeenCalled();
    });

    it('permite conservar el mismo nombre (no se considera duplicado)', async () => {
      const existing = seedBeverage({ name: 'Coca-Cola 500ml' });
      beveragesRepo.findOne.mockResolvedValue(existing);
      beveragesRepo.save.mockImplementation(passthrough);

      const result = await service.update(beverageId, {
        name: 'Coca-Cola 500ml',
      });
      expect(result.name).toBe('Coca-Cola 500ml');
      expect(beveragesRepo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza 404 si la bebida no existe', async () => {
      beveragesRepo.findOne.mockResolvedValue(null);
      await expect(service.remove(beverageId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(beveragesRepo.remove).not.toHaveBeenCalled();
    });

    it('elimina la bebida sin bloquear por uso (catálogo de etiquetas, no FK de historial)', async () => {
      const existing = seedBeverage();
      beveragesRepo.findOne.mockResolvedValue(existing);
      beveragesRepo.remove.mockResolvedValue(existing);

      await service.remove(beverageId);
      expect(beveragesRepo.remove).toHaveBeenCalledWith(existing);
    });

    it('limpia primero la relación en menu_item_beverages (la FK de beverageId no cascadea sola)', async () => {
      const existing = seedBeverage();
      beveragesRepo.findOne.mockResolvedValue(existing);
      beveragesRepo.remove.mockResolvedValue(existing);

      await service.remove(beverageId);
      expect(beveragesRepo.manager.query).toHaveBeenCalledWith(
        'DELETE FROM menu_item_beverages WHERE "beverageId" = $1',
        [beverageId],
      );
    });
  });

  describe('findByIds', () => {
    it('devuelve array vacío sin consultar la BD si no se pasan ids', async () => {
      const result = await service.findByIds([]);
      expect(result).toEqual([]);
      expect(beveragesRepo.findBy).not.toHaveBeenCalled();
    });

    it('lanza 404 si algún id no existe', async () => {
      beveragesRepo.findBy.mockResolvedValue([seedBeverage()]);
      await expect(
        service.findByIds([beverageId, otherId]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('devuelve las entidades si todos los ids existen', async () => {
      beveragesRepo.findBy.mockResolvedValue([seedBeverage()]);
      const result = await service.findByIds([beverageId]);
      expect(result).toEqual([seedBeverage()]);
    });
  });
});
