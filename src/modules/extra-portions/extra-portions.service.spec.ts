import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ExtraPortion } from './entities/extra-portion.entity';
import { ExtraPortionsService } from './extra-portions.service';

/** Mock de repositorio: devuelve el mismo objeto que recibe (identity tipado). */
const passthrough = <T>(value: T): T => value;

/** Construye un QueryFailedError de Postgres con SQLSTATE 23505 (unique_violation). */
const uniqueViolationError = (): QueryFailedError => {
  const driverError = new Error(
    'duplicate key value violates unique constraint "UQ_extra_portions_name"',
  );
  (driverError as { code?: string }).code = '23505';
  return new QueryFailedError(
    'INSERT INTO extra_portions ...',
    [],
    driverError,
  );
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

describe('ExtraPortionsService', () => {
  let service: ExtraPortionsService;
  let extraPortionsRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findBy: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    manager: { query: jest.Mock };
  };

  const extraPortionId = '11111111-1111-1111-1111-111111111111';
  const otherId = '22222222-2222-2222-2222-222222222222';

  const seedExtraPortion = (overrides: Partial<ExtraPortion> = {}) =>
    ({
      id: extraPortionId,
      name: 'Papas extra',
      price: 8,
      active: true,
      sortOrder: 0,
      ...overrides,
    }) as ExtraPortion;

  beforeEach(async () => {
    extraPortionsRepo = {
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
        ExtraPortionsService,
        {
          provide: getRepositoryToken(ExtraPortion),
          useValue: extraPortionsRepo,
        },
      ],
    }).compile();

    service = module.get(ExtraPortionsService);
  });

  describe('create', () => {
    it('crea y guarda la porción extra con el dto', async () => {
      const dto = { name: 'Tocino extra', price: 6 };
      extraPortionsRepo.create.mockImplementation(passthrough);
      extraPortionsRepo.save.mockImplementation(passthrough);
      const result = await service.create(dto);
      expect(extraPortionsRepo.save).toHaveBeenCalledWith(dto);
      expect(result).toEqual(dto);
    });

    it('lanza 409 si ya existe una porción extra con ese nombre', async () => {
      extraPortionsRepo.findOne.mockResolvedValue(
        seedExtraPortion({ name: 'Tocino extra' }),
      );
      await expect(
        service.create({ name: 'Tocino extra', price: 6 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(extraPortionsRepo.save).not.toHaveBeenCalled();
    });

    it('convierte una violación UNIQUE de la BD (23505) en 409 (fallback de concurrencia)', async () => {
      extraPortionsRepo.findOne.mockResolvedValue(null);
      extraPortionsRepo.create.mockImplementation(passthrough);
      extraPortionsRepo.save.mockRejectedValue(uniqueViolationError());

      await expect(
        service.create({ name: 'Tocino extra', price: 6 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('devuelve todas las porciones extras ordenadas por sortOrder', async () => {
      extraPortionsRepo.find.mockResolvedValue([seedExtraPortion()]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(extraPortionsRepo.find).toHaveBeenCalledWith({
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('update', () => {
    it('actualiza los campos recibidos', async () => {
      const existing = seedExtraPortion();
      extraPortionsRepo.findOne.mockResolvedValue(existing);
      extraPortionsRepo.save.mockImplementation(passthrough);

      const result = await service.update(extraPortionId, { price: 9 });
      expect(result.price).toBe(9);
      expect(extraPortionsRepo.save).toHaveBeenCalledWith(existing);
    });

    it('lanza 404 si la porción extra no existe', async () => {
      extraPortionsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update(extraPortionId, { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(extraPortionsRepo.save).not.toHaveBeenCalled();
    });

    it('lanza 409 si se renombra a un nombre ya usado por otra porción extra', async () => {
      extraPortionsRepo.findOne.mockResolvedValueOnce(seedExtraPortion());
      extraPortionsRepo.findOne.mockResolvedValueOnce(
        seedExtraPortion({ id: otherId, name: 'Tocino extra' }),
      );
      await expect(
        service.update(extraPortionId, { name: 'Tocino extra' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(extraPortionsRepo.save).not.toHaveBeenCalled();
    });

    it('permite conservar el mismo nombre (no se considera duplicado)', async () => {
      const existing = seedExtraPortion({ name: 'Papas extra' });
      extraPortionsRepo.findOne.mockResolvedValue(existing);
      extraPortionsRepo.save.mockImplementation(passthrough);

      const result = await service.update(extraPortionId, {
        name: 'Papas extra',
      });
      expect(result.name).toBe('Papas extra');
      expect(extraPortionsRepo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza 404 si la porción extra no existe', async () => {
      extraPortionsRepo.findOne.mockResolvedValue(null);
      await expect(service.remove(extraPortionId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(extraPortionsRepo.remove).not.toHaveBeenCalled();
    });

    it('elimina la porción extra sin bloquear por uso (catálogo de etiquetas, no FK de historial)', async () => {
      const existing = seedExtraPortion();
      extraPortionsRepo.findOne.mockResolvedValue(existing);
      extraPortionsRepo.remove.mockResolvedValue(existing);

      await service.remove(extraPortionId);
      expect(extraPortionsRepo.remove).toHaveBeenCalledWith(existing);
    });

    it('limpia primero la relación en menu_item_extra_portions (la FK de extraPortionId no cascadea sola)', async () => {
      const existing = seedExtraPortion();
      extraPortionsRepo.findOne.mockResolvedValue(existing);
      extraPortionsRepo.remove.mockResolvedValue(existing);

      await service.remove(extraPortionId);
      expect(extraPortionsRepo.manager.query).toHaveBeenCalledWith(
        'DELETE FROM menu_item_extra_portions WHERE "extraPortionId" = $1',
        [extraPortionId],
      );
    });
  });

  describe('findByIds', () => {
    it('devuelve array vacío sin consultar la BD si no se pasan ids', async () => {
      const result = await service.findByIds([]);
      expect(result).toEqual([]);
      expect(extraPortionsRepo.findBy).not.toHaveBeenCalled();
    });

    it('lanza 404 si algún id no existe', async () => {
      extraPortionsRepo.findBy.mockResolvedValue([seedExtraPortion()]);
      await expect(
        service.findByIds([extraPortionId, otherId]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('devuelve las entidades si todos los ids existen', async () => {
      extraPortionsRepo.findBy.mockResolvedValue([seedExtraPortion()]);
      const result = await service.findByIds([extraPortionId]);
      expect(result).toEqual([seedExtraPortion()]);
    });
  });
});
