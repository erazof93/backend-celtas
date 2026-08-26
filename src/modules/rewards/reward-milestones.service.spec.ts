import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { RewardMilestone } from './entities/reward-milestone.entity';
import { RewardMilestonesService } from './reward-milestones.service';

describe('RewardMilestonesService', () => {
  let service: RewardMilestonesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    merge: jest.Mock;
    remove: jest.Mock;
  };

  const uniqueViolation = () =>
    new QueryFailedError('INSERT INTO reward_milestones...', [], {
      code: '23505',
    } as unknown as Error);

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((v: Partial<RewardMilestone>) => v as RewardMilestone),
      save: jest.fn((v: RewardMilestone) => Promise.resolve(v)),
      merge: jest.fn((entity: RewardMilestone, dto: Partial<RewardMilestone>) =>
        Object.assign(entity, dto),
      ),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RewardMilestonesService,
        { provide: getRepositoryToken(RewardMilestone), useValue: repo },
      ],
    }).compile();

    service = module.get(RewardMilestonesService);
  });

  describe('findAll', () => {
    it('ordena ASC por starsRequired', async () => {
      repo.find.mockResolvedValue([]);
      await service.findAll();
      expect(repo.find).toHaveBeenCalledWith({
        order: { starsRequired: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('404 si no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('devuelve el hito si existe', async () => {
      const milestone = { id: 'a', starsRequired: 5 } as RewardMilestone;
      repo.findOne.mockResolvedValue(milestone);
      await expect(service.findOne('a')).resolves.toBe(milestone);
    });
  });

  describe('create', () => {
    it('crea con isSpecial default false si no se envía', async () => {
      await service.create({ starsRequired: 5 });
      expect(repo.create).toHaveBeenCalledWith({
        starsRequired: 5,
        isSpecial: false,
      });
    });

    it('crea con isSpecial=true cuando se envía', async () => {
      await service.create({ starsRequired: 15, isSpecial: true });
      expect(repo.create).toHaveBeenCalledWith({
        starsRequired: 15,
        isSpecial: true,
      });
    });

    it('starsRequired repetido: traduce la violación UNIQUE de la DB a 400, no un 500 crudo', async () => {
      repo.save.mockRejectedValue(uniqueViolation());
      await expect(service.create({ starsRequired: 5 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('otro error de guardado no se traduce, se propaga tal cual', async () => {
      const genericError = new Error('conexión perdida');
      repo.save.mockRejectedValue(genericError);
      await expect(service.create({ starsRequired: 5 })).rejects.toBe(
        genericError,
      );
    });
  });

  describe('update', () => {
    it('aplica merge sobre el hito existente', async () => {
      const milestone = {
        id: 'a',
        starsRequired: 5,
        isSpecial: false,
      } as RewardMilestone;
      repo.findOne.mockResolvedValue(milestone);

      await service.update('a', { starsRequired: 8 });

      expect(repo.merge).toHaveBeenCalledWith(milestone, { starsRequired: 8 });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ starsRequired: 8 }),
      );
    });

    it('starsRequired ya usado por otro hito: 400, no 500', async () => {
      repo.findOne.mockResolvedValue({
        id: 'a',
        starsRequired: 5,
        isSpecial: false,
      });
      repo.save.mockRejectedValue(uniqueViolation());

      await expect(
        service.update('a', { starsRequired: 8 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 si el hito no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { starsRequired: 8 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('DELETE real: borra el hito', async () => {
      const milestone = { id: 'a', starsRequired: 5 } as RewardMilestone;
      repo.findOne.mockResolvedValue(milestone);

      await service.remove('a');

      expect(repo.remove).toHaveBeenCalledWith(milestone);
    });

    it('404 si el hito no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
