import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Not, QueryFailedError } from 'typeorm';
import { FriesType } from './entities/fries-type.entity';
import { FriesTypesService } from './fries-types.service';

/** Mock de repositorio: devuelve el mismo objeto que recibe (identity tipado). */
const passthrough = <T>(value: T): T => value;

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

describe('FriesTypesService', () => {
  let service: FriesTypesService;
  let repo: {
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    findBy: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    manager: { query: jest.Mock };
  };

  const id = '11111111-1111-1111-1111-111111111111';
  const otherId = '22222222-2222-2222-2222-222222222222';

  const seed = (overrides: Partial<FriesType> = {}) =>
    ({
      id,
      name: 'Papas al hilo',
      isDefault: false,
      ...overrides,
    }) as FriesType;

  beforeEach(async () => {
    repo = {
      count: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findBy: jest.fn(),
      create: jest.fn(passthrough),
      merge: jest.fn(mergeImplementation),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      update: jest.fn(),
      remove: jest.fn(),
      manager: { query: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriesTypesService,
        { provide: getRepositoryToken(FriesType), useValue: repo },
      ],
    }).compile();

    service = module.get(FriesTypesService);
  });

  describe('onModuleInit (seed)', () => {
    it('tabla vacía → siembra "Papas fritas" (default) y "Papas al hilo"', async () => {
      repo.count.mockResolvedValue(0);

      await service.onModuleInit();

      expect(repo.save).toHaveBeenCalledWith([
        { name: 'Papas fritas', isDefault: true },
        { name: 'Papas al hilo', isDefault: false },
      ]);
    });

    it('tabla con datos → no siembra nada (un tipo borrado o renombrado por el admin no resucita)', async () => {
      repo.count.mockResolvedValue(1);

      await service.onModuleInit();

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('crea el tipo; si no es default no toca los demás', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.create({ name: 'Papas al hilo' });

      expect(result.name).toBe('Papas al hilo');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('crear uno con isDefault true desmarca el default anterior', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.save.mockResolvedValue(seed({ isDefault: true }));

      await service.create({ name: 'Papas al hilo', isDefault: true });

      expect(repo.update).toHaveBeenCalledWith(
        { id: Not(id), isDefault: true },
        { isDefault: false },
      );
    });

    it('409 si ya existe uno con ese nombre', async () => {
      repo.findOne.mockResolvedValue(seed({ id: otherId }));

      await expect(
        service.create({ name: 'Papas al hilo' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('violación UNIQUE de la BD (23505, concurrencia) → 409', async () => {
      repo.findOne.mockResolvedValue(null);
      const driverError = Object.assign(new Error('duplicate key'), {
        code: '23505',
      });
      repo.save.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], driverError),
      );

      await expect(
        service.create({ name: 'Papas al hilo' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('404 si no existe', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.update(id, { name: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marcar isDefault true desmarca los demás; PATCH parcial conserva el resto', async () => {
      repo.findOne.mockResolvedValue(seed());

      const result = await service.update(id, { isDefault: true });

      expect(result).toMatchObject({ name: 'Papas al hilo', isDefault: true });
      expect(repo.update).toHaveBeenCalledWith(
        { id: Not(id), isDefault: true },
        { isDefault: false },
      );
    });

    it('isDefault false o ausente no toca los demás', async () => {
      repo.findOne.mockResolvedValue(seed({ isDefault: true }));

      await service.update(id, { isDefault: false });
      await service.update(id, { name: 'Papas al hilo' });

      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('limpia la relación con productos ANTES de borrar (FK ON DELETE NO ACTION)', async () => {
      const friesType = seed();
      repo.findOne.mockResolvedValue(friesType);

      await service.remove(id);

      expect(repo.manager.query).toHaveBeenCalledWith(
        'DELETE FROM menu_item_fries_types WHERE "friesTypeId" = $1',
        [id],
      );
      expect(repo.remove).toHaveBeenCalledWith(friesType);
      expect(repo.manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        repo.remove.mock.invocationCallOrder[0],
      );
    });

    it('404 si no existe', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.manager.query).not.toHaveBeenCalled();
    });
  });

  describe('findByIds', () => {
    it('[] → [] sin consultar la BD', async () => {
      await expect(service.findByIds([])).resolves.toEqual([]);
      expect(repo.findBy).not.toHaveBeenCalled();
    });

    it('404 si alguno no existe', async () => {
      repo.findBy.mockResolvedValue([seed()]);

      await expect(service.findByIds([id, otherId])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
