import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { Sauce } from './entities/sauce.entity';
import { SaucesService } from './sauces.service';

/** Mock de repositorio: devuelve el mismo objeto que recibe (identity tipado). */
const passthrough = <T>(value: T): T => value;

/** Construye un QueryFailedError de Postgres con SQLSTATE 23505 (unique_violation). */
const uniqueViolationError = (): QueryFailedError => {
  const driverError = new Error(
    'duplicate key value violates unique constraint "UQ_sauces_name"',
  );
  (driverError as { code?: string }).code = '23505';
  return new QueryFailedError('INSERT INTO sauces ...', [], driverError);
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

describe('SaucesService', () => {
  let service: SaucesService;
  let saucesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findBy: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    manager: { query: jest.Mock };
  };

  const sauceId = '11111111-1111-1111-1111-111111111111';
  const otherId = '22222222-2222-2222-2222-222222222222';

  const seedSauce = (overrides: Partial<Sauce> = {}) =>
    ({
      id: sauceId,
      name: 'Mayonesa',
      active: true,
      sortOrder: 0,
      ...overrides,
    }) as Sauce;

  beforeEach(async () => {
    saucesRepo = {
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
        SaucesService,
        { provide: getRepositoryToken(Sauce), useValue: saucesRepo },
      ],
    }).compile();

    service = module.get(SaucesService);
  });

  describe('create', () => {
    it('crea y guarda la salsa con el dto', async () => {
      const dto = { name: 'Mostaza' };
      saucesRepo.create.mockImplementation(passthrough);
      saucesRepo.save.mockImplementation(passthrough);
      const result = await service.create(dto);
      expect(saucesRepo.save).toHaveBeenCalledWith(dto);
      expect(result).toEqual(dto);
    });

    it('lanza 409 si ya existe una salsa con ese nombre', async () => {
      saucesRepo.findOne.mockResolvedValue(seedSauce({ name: 'Mostaza' }));
      await expect(service.create({ name: 'Mostaza' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(saucesRepo.save).not.toHaveBeenCalled();
    });

    it('convierte una violación UNIQUE de la BD (23505) en 409 (fallback de concurrencia)', async () => {
      saucesRepo.findOne.mockResolvedValue(null);
      saucesRepo.create.mockImplementation(passthrough);
      saucesRepo.save.mockRejectedValue(uniqueViolationError());

      await expect(service.create({ name: 'Mostaza' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('devuelve todas las salsas ordenadas por sortOrder', async () => {
      saucesRepo.find.mockResolvedValue([seedSauce()]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(saucesRepo.find).toHaveBeenCalledWith({
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('update', () => {
    it('actualiza los campos recibidos', async () => {
      const existing = seedSauce();
      saucesRepo.findOne.mockResolvedValue(existing);
      saucesRepo.save.mockImplementation(passthrough);

      const result = await service.update(sauceId, { active: false });
      expect(result.active).toBe(false);
      expect(saucesRepo.save).toHaveBeenCalledWith(existing);
    });

    it('lanza 404 si la salsa no existe', async () => {
      saucesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update(sauceId, { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(saucesRepo.save).not.toHaveBeenCalled();
    });

    it('lanza 409 si se renombra a un nombre ya usado por otra salsa', async () => {
      saucesRepo.findOne.mockResolvedValueOnce(seedSauce());
      saucesRepo.findOne.mockResolvedValueOnce(
        seedSauce({ id: otherId, name: 'Ketchup' }),
      );
      await expect(
        service.update(sauceId, { name: 'Ketchup' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(saucesRepo.save).not.toHaveBeenCalled();
    });

    it('permite conservar el mismo nombre (no se considera duplicado)', async () => {
      const existing = seedSauce({ name: 'Mayonesa' });
      saucesRepo.findOne.mockResolvedValue(existing);
      saucesRepo.save.mockImplementation(passthrough);

      const result = await service.update(sauceId, { name: 'Mayonesa' });
      expect(result.name).toBe('Mayonesa');
      expect(saucesRepo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza 404 si la salsa no existe', async () => {
      saucesRepo.findOne.mockResolvedValue(null);
      await expect(service.remove(sauceId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(saucesRepo.remove).not.toHaveBeenCalled();
    });

    it('elimina la salsa sin bloquear por uso (catálogo de etiquetas, no FK de historial)', async () => {
      const existing = seedSauce();
      saucesRepo.findOne.mockResolvedValue(existing);
      saucesRepo.remove.mockResolvedValue(existing);

      await service.remove(sauceId);
      expect(saucesRepo.remove).toHaveBeenCalledWith(existing);
    });

    it('limpia primero la relación en menu_item_sauces (la FK de sauceId no cascadea sola)', async () => {
      const existing = seedSauce();
      saucesRepo.findOne.mockResolvedValue(existing);
      saucesRepo.remove.mockResolvedValue(existing);

      await service.remove(sauceId);
      expect(saucesRepo.manager.query).toHaveBeenCalledWith(
        'DELETE FROM menu_item_sauces WHERE "sauceId" = $1',
        [sauceId],
      );
    });
  });

  describe('findByIds', () => {
    it('devuelve array vacío sin consultar la BD si no se pasan ids', async () => {
      const result = await service.findByIds([]);
      expect(result).toEqual([]);
      expect(saucesRepo.findBy).not.toHaveBeenCalled();
    });

    it('lanza 404 si algún id no existe', async () => {
      saucesRepo.findBy.mockResolvedValue([seedSauce()]);
      await expect(
        service.findByIds([sauceId, otherId]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('devuelve las entidades si todos los ids existen', async () => {
      saucesRepo.findBy.mockResolvedValue([seedSauce()]);
      const result = await service.findByIds([sauceId]);
      expect(result).toEqual([seedSauce()]);
    });
  });
});
