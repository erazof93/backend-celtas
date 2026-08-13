import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SortOrder, UsersSortBy } from './dto/query-users.dto';
import { User, UserRole } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repo: { findOne: jest.Mock; save: jest.Mock; findAndCount: jest.Mock };

  const makeUser = () =>
    ({
      id: 'user-1',
      email: 'cliente@example.com',
      password: '$2b$10$hashed',
      fullName: 'Juan Pérez',
      provider: 'local',
      googleId: null,
      phone: null,
      totalSpent: 0,
      role: 'cliente',
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as User;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('getProfile', () => {
    it('devuelve el usuario real desde la BD', async () => {
      const user = makeUser();
      repo.findOne.mockResolvedValue(user);
      const result = await service.getProfile('user-1');
      expect(result).toBe(user);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('lanza 401 si el usuario no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getProfile('no-existe')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('updateProfile', () => {
    it('actualiza fullName y phone y guarda', async () => {
      const updated = {
        ...makeUser(),
        fullName: 'Juan Carlos',
        phone: '+51999999999',
      };
      repo.findOne.mockResolvedValue(makeUser());
      repo.save.mockResolvedValue(updated);

      const result = await service.updateProfile('user-1', {
        fullName: 'Juan Carlos',
        phone: '+51999999999',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Juan Carlos',
          phone: '+51999999999',
        }),
      );
      expect(result).toBe(updated);
    });

    it('no toca fullName ni phone si no vienen en el payload', async () => {
      repo.findOne.mockResolvedValue(makeUser());
      repo.save.mockImplementation((u: User) => u);

      const result = await service.updateProfile('user-1', {});

      expect(result.fullName).toBe('Juan Pérez');
      expect(result.phone).toBe(null);
    });

    it('lanza 401 si el usuario no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.updateProfile('no-existe', { fullName: 'X' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('updateFcmToken', () => {
    it('guarda el token FCM y sobrescribe el anterior', async () => {
      repo.findOne.mockResolvedValue(makeUser());
      repo.save.mockImplementation((u: User) => u);

      const result = await service.updateFcmToken('user-1', 'token-nuevo');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ fcmToken: 'token-nuevo' }),
      );
      expect(result.fcmToken).toBe('token-nuevo');
    });

    it('lanza 401 si el usuario no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.updateFcmToken('no-existe', 'token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('findAll', () => {
    it('devuelve la lista paginada con meta (comportamiento previo intacto sin sortBy/order)', async () => {
      const user = makeUser();
      repo.findAndCount.mockResolvedValue([[user], 1]);
      const result = await service.findAll({ page: 1, limit: 10 });

      expect(repo.findAndCount).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
      expect(result.items).toEqual([user]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it('calcula los totalPages correctamente', async () => {
      repo.findAndCount.mockResolvedValue([[makeUser()], 25]);
      const result = await service.findAll({ page: 2, limit: 10 });
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.page).toBe(2);
    });

    it('ordena por totalSpent descendente cuando se pide sortBy=totalSpent', async () => {
      repo.findAndCount.mockResolvedValue([[makeUser()], 1]);
      await service.findAll({
        sortBy: UsersSortBy.TOTAL_SPENT,
        order: SortOrder.DESC,
      });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { totalSpent: 'DESC' } }),
      );
    });

    it('ordena por totalSpent ascendente cuando se pide order=asc', async () => {
      repo.findAndCount.mockResolvedValue([[makeUser()], 1]);
      await service.findAll({
        sortBy: UsersSortBy.TOTAL_SPENT,
        order: SortOrder.ASC,
      });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { totalSpent: 'ASC' } }),
      );
    });

    it('default de order es desc cuando solo se pide sortBy', async () => {
      repo.findAndCount.mockResolvedValue([[makeUser()], 1]);
      await service.findAll({ sortBy: UsersSortBy.CREATED_AT });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC' } }),
      );
    });
  });

  describe('ensureExists', () => {
    it('no lanza si el usuario existe', async () => {
      repo.findOne.mockResolvedValue(makeUser());
      await expect(service.ensureExists('user-1')).resolves.toBeUndefined();
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('lanza 404 si el usuario no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.ensureExists('no-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateRole', () => {
    it('cambia el rol de otro usuario', async () => {
      repo.findOne.mockResolvedValue(makeUser());
      repo.save.mockImplementation((u: User) => u);
      const result = await service.updateRole(
        'admin-1',
        'user-1',
        UserRole.ADMIN,
      );
      expect(result.role).toBe(UserRole.ADMIN);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
      );
    });

    it('rechaza con 400 que un admin se quite su propio rol', async () => {
      await expect(
        service.updateRole('user-1', 'user-1', UserRole.CLIENTE),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('lanza 404 si el usuario objetivo no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.updateRole('admin-1', 'no-existe', UserRole.ADMIN),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
