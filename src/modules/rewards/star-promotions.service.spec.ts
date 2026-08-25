import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StarPromotion } from './entities/star-promotion.entity';
import { StarPromotionsService } from './star-promotions.service';

describe('StarPromotionsService', () => {
  let service: StarPromotionsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    merge: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const seedPromotion = (overrides: Partial<StarPromotion> = {}) =>
    ({
      id: 'promo-1',
      label: 'Navidad 2026',
      multiplier: 2,
      startDate: '2026-12-20',
      endDate: '2026-12-31',
      active: true,
      ...overrides,
    }) as StarPromotion;

  const mockQueryBuilder = (overlapping: StarPromotion | null) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(overlapping),
  });

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      merge: jest.fn((entity: StarPromotion, dto: Partial<StarPromotion>) =>
        Object.assign(entity, dto),
      ),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StarPromotionsService,
        { provide: getRepositoryToken(StarPromotion), useValue: repo },
      ],
    }).compile();

    service = module.get(StarPromotionsService);
  });

  describe('create', () => {
    it('lanza 400 si startDate es posterior a endDate', async () => {
      repo.createQueryBuilder.mockReturnValue(mockQueryBuilder(null));
      await expect(
        service.create({
          label: 'x',
          multiplier: 2,
          startDate: '2026-12-31',
          endDate: '2026-12-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza 400 si se solapa con otra promoción activa', async () => {
      repo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder(seedPromotion()),
      );
      await expect(
        service.create({
          label: 'Año Nuevo',
          multiplier: 1.5,
          startDate: '2026-12-25',
          endDate: '2027-01-05',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('no valida solapamiento si la promoción se crea inactiva', async () => {
      repo.create.mockImplementation((v: unknown) => v);
      repo.save.mockImplementation((v: unknown) => Promise.resolve(v));

      await service.create({
        label: 'Inactiva',
        multiplier: 1.5,
        startDate: '2026-12-25',
        endDate: '2027-01-05',
        active: false,
      });

      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('crea la promoción cuando no hay solapamiento', async () => {
      repo.createQueryBuilder.mockReturnValue(mockQueryBuilder(null));
      repo.create.mockImplementation((v: unknown) => v);
      repo.save.mockImplementation((v: unknown) => Promise.resolve(v));

      const result = await service.create({
        label: 'Navidad 2026',
        multiplier: 2,
        startDate: '2026-12-20',
        endDate: '2026-12-31',
      });

      expect(result).toMatchObject({ label: 'Navidad 2026', active: true });
    });
  });

  describe('findOne', () => {
    it('lanza 404 si no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('excluye la propia promoción al chequear solapamiento', async () => {
      const promo = seedPromotion();
      repo.findOne.mockResolvedValue(promo);
      const qb = mockQueryBuilder(null);
      repo.createQueryBuilder.mockReturnValue(qb);
      repo.save.mockImplementation((v: unknown) => Promise.resolve(v));

      await service.update('promo-1', { endDate: '2027-01-02' });

      expect(qb.andWhere).toHaveBeenCalledWith('promo.id != :excludeId', {
        excludeId: 'promo-1',
      });
    });

    it('no valida solapamiento al desactivar una promoción', async () => {
      const promo = seedPromotion();
      repo.findOne.mockResolvedValue(promo);
      repo.save.mockImplementation((v: unknown) => Promise.resolve(v));

      await service.update('promo-1', { active: false });

      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('lanza 400 si el rango resultante después del merge es inválido', async () => {
      const promo = seedPromotion();
      repo.findOne.mockResolvedValue(promo);

      await expect(
        service.update('promo-1', { startDate: '2027-01-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
