import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BannersService } from './banners.service';
import { Banner, BannerActionType } from './entities/banner.entity';

/** Mock de repositorio: devuelve el mismo objeto que recibe (identity tipado). */
const passthrough = <T>(value: T): T => value;

describe('BannersService', () => {
  let service: BannersService;
  let bannersRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  const seedBanner = (overrides: Partial<Banner> = {}) => ({
    id: 'banner-1',
    title: '2x1 en burgers',
    imageUrl: null,
    actionType: BannerActionType.NONE,
    actionValue: null,
    startDate: null,
    endDate: null,
    active: true,
    daysOfWeek: null,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    bannersRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(passthrough),
      merge: jest.fn(),
      save: jest.fn(passthrough),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    // Replica el comportamiento real de TypeORM Repository.merge: solo copia las
    // propiedades definidas (no undefined) del DTO sobre la entidad cargada.
    bannersRepo.merge.mockImplementation(
      (target: Banner, dto: Record<string, unknown>) => {
        for (const key of Object.keys(dto)) {
          if (dto[key] !== undefined) {
            (target as Record<string, unknown>)[key] = dto[key];
          }
        }
        return target;
      },
    );
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BannersService,
        { provide: getRepositoryToken(Banner), useValue: bannersRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<BannersService>(BannersService);
  });

  describe('findActive', () => {
    it('filtra por active=true, rango de fechas y daysOfWeek, ordenado por order ASC', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([seedBanner()]),
      };
      bannersRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findActive();

      expect(bannersRepo.createQueryBuilder).toHaveBeenCalledWith('banner');
      expect(qb.where).toHaveBeenCalledWith('banner.active = :active', {
        active: true,
      });
      expect(qb.andWhere).toHaveBeenCalledTimes(3);
      expect(qb.orderBy).toHaveBeenCalledWith('banner.order', 'ASC');
      expect(result).toHaveLength(1);
    });

    it('agrega la condición de daysOfWeek con el día actual (0-6) en Lima', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      bannersRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findActive();

      const calls = qb.andWhere.mock.calls as [
        string,
        Record<string, unknown>,
      ][];
      const [condition, params] = calls[2];
      expect(condition).toContain('banner.daysOfWeek IS NULL');
      expect(condition).toContain('array_length(banner.daysOfWeek, 1) IS NULL');
      expect(condition).toContain(':dayOfWeek = ANY(banner.daysOfWeek)');
      expect(params.dayOfWeek).toEqual(expect.any(Number));
      expect(params.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(params.dayOfWeek).toBeLessThanOrEqual(6);
    });
  });

  describe('create', () => {
    it('crea un banner con valores por defecto', async () => {
      const result = await service.create({ title: 'Promo' });

      expect(bannersRepo.create).toHaveBeenCalledWith({
        title: 'Promo',
        actionType: BannerActionType.NONE,
        active: true,
        order: 0,
      });
      expect(result).toBeDefined();
    });

    it('rechaza con 400 si startDate >= endDate', async () => {
      await expect(
        service.create({
          title: 'Promo',
          startDate: new Date('2026-08-31'),
          endDate: new Date('2026-08-01'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza con 400 si actionType != none y falta actionValue', async () => {
      await expect(
        service.create({
          title: 'Promo',
          actionType: BannerActionType.CATEGORY,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('acepta actionType != none con actionValue presente', async () => {
      const result = await service.create({
        title: 'Promo',
        actionType: BannerActionType.CATEGORY,
        actionValue: 'burgers',
      });
      expect(result.actionValue).toBe('burgers');
    });
  });

  describe('findOne', () => {
    it('lanza 404 si el banner no existe', async () => {
      bannersRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });

    it('devuelve el banner si existe', async () => {
      bannersRepo.findOne.mockResolvedValue(seedBanner());
      const result = await service.findOne('banner-1');
      expect(result.id).toBe('banner-1');
    });
  });

  describe('update', () => {
    it('actualiza y valida las fechas tras el merge', async () => {
      bannersRepo.findOne.mockResolvedValue(
        seedBanner({ startDate: new Date('2026-08-01') }),
      );
      await expect(
        service.update('banner-1', { endDate: new Date('2026-07-01') }),
      ).rejects.toThrow(BadRequestException);
    });

    it('actualiza correctamente un banner válido', async () => {
      bannersRepo.findOne.mockResolvedValue(seedBanner());
      const result = await service.update('banner-1', { title: 'Nuevo' });
      expect(result.title).toBe('Nuevo');
    });
  });

  describe('remove', () => {
    it('lanza 404 si no existe', async () => {
      bannersRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });

    it('elimina el banner existente', async () => {
      bannersRepo.findOne.mockResolvedValue(seedBanner());
      await service.remove('banner-1');
      expect(bannersRepo.remove).toHaveBeenCalled();
    });
  });

  describe('updateImage', () => {
    it('guarda la URL de imagen', async () => {
      bannersRepo.findOne.mockResolvedValue(seedBanner());
      const result = await service.updateImage('banner-1', 'https://img');
      expect(result.imageUrl).toBe('https://img');
    });
  });

  describe('reorder', () => {
    it('actualiza el orden de todos los banners en una transacción', async () => {
      const manager = {
        findOne: jest.fn().mockResolvedValue(seedBanner()),
        save: jest.fn(passthrough),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      );

      const result = await service.reorder({
        items: [
          { id: 'banner-1', order: 2 },
          { id: 'banner-2', order: 1 },
        ],
      });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('lanza 404 si algún banner no existe', async () => {
      const manager = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      );

      await expect(
        service.reorder({ items: [{ id: 'missing', order: 0 }] }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
