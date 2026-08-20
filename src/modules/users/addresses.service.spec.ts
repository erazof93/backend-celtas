import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { Address } from './entities/address.entity';

describe('AddressesService', () => {
  let service: AddressesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    update: jest.Mock;
  };

  const userA = 'user-a';
  const userB = 'user-b';
  const ownAddress = {
    id: 'addr-1',
    alias: 'Casa',
    fullAddress: 'Av. Los Álamos 123',
    reference: null,
    district: 'SJM',
    isDefault: false,
    userId: userA,
  } as Address;
  const otherAddress = {
    id: 'addr-2',
    alias: 'Casa',
    fullAddress: 'Otra',
    reference: null,
    district: 'Surco',
    isDefault: false,
    userId: userB,
  } as Address;

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      merge: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      update: jest.fn(),
    };
    // Replica el comportamiento real de TypeORM Repository.merge: solo copia las
    // propiedades definidas (no undefined) del DTO sobre la entidad cargada.
    repo.merge.mockImplementation(
      (target: Address, dto: Record<string, unknown>) => {
        for (const key of Object.keys(dto)) {
          if (dto[key] !== undefined) {
            (target as Record<string, unknown>)[key] = dto[key];
          }
        }
        return target;
      },
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(Address), useValue: repo },
      ],
    }).compile();

    service = module.get(AddressesService);
  });

  describe('findByUser', () => {
    it('busca por userId ordenando principal primero', async () => {
      repo.find.mockResolvedValue([ownAddress]);
      const result = await service.findByUser(userA);
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: userA },
        order: { isDefault: 'DESC', createdAt: 'ASC' },
      });
      expect(result).toEqual([ownAddress]);
    });
  });

  describe('create', () => {
    it('crea la dirección ligada al usuario', async () => {
      repo.create.mockImplementation((data: CreateAddressDto) => data);
      repo.save.mockImplementation((addr: Address) => addr);

      const result = await service.create(userA, {
        alias: 'Casa',
        fullAddress: 'Av. Los Álamos 123',
        district: 'SJM',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: userA }),
      );
      expect(result.userId).toBe(userA);
    });

    it('si isDefault=true, quita el default a las demás y crea la nueva', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.create.mockImplementation((data: CreateAddressDto) => data);
      repo.save.mockImplementation((addr: Address) => addr);

      await service.create(userA, {
        alias: 'Casa',
        fullAddress: 'Av. Los Álamos 123',
        district: 'SJM',
        isDefault: true,
      });

      expect(repo.update).toHaveBeenCalledWith(
        { userId: userA, isDefault: true },
        { isDefault: false },
      );
    });

    it('persiste latitude/longitude cuando vienen en el DTO', async () => {
      repo.create.mockImplementation((data: CreateAddressDto) => data);
      repo.save.mockImplementation((addr: Address) => addr);

      const result = await service.create(userA, {
        alias: 'Casa',
        fullAddress: 'Av. Los Álamos 123',
        district: 'SJM',
        latitude: -12.164,
        longitude: -76.9721,
      });

      expect(result.latitude).toBe(-12.164);
      expect(result.longitude).toBe(-76.9721);
    });

    it('crea la dirección sin latitude/longitude si no vienen (direcciones sin coordenadas siguen siendo válidas)', async () => {
      repo.create.mockImplementation((data: CreateAddressDto) => data);
      repo.save.mockImplementation((addr: Address) => addr);

      const result = await service.create(userA, {
        alias: 'Casa',
        fullAddress: 'Av. Los Álamos 123',
        district: 'SJM',
      });

      expect(result.latitude).toBeUndefined();
      expect(result.longitude).toBeUndefined();
    });
  });

  describe('update', () => {
    it('actualiza una dirección propia', async () => {
      repo.findOne.mockResolvedValue(ownAddress);
      repo.save.mockImplementation((addr: Address) => addr);

      const result = await service.update(userA, 'addr-1', {
        district: 'Miraflores',
      });

      expect(result.district).toBe('Miraflores');
      expect(result.userId).toBe(userA);
    });

    it('lanza 403 si la dirección es de otro usuario', async () => {
      repo.findOne.mockResolvedValue(otherAddress);
      await expect(
        service.update(userA, 'addr-2', { district: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('lanza 404 si la dirección no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.update(userA, 'no-existe', { district: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('si isDefault=true en la actualización, quita el default a las demás', async () => {
      repo.findOne.mockResolvedValue(ownAddress);
      repo.save.mockImplementation((addr: Address) => addr);

      await service.update(userA, 'addr-1', { isDefault: true });

      expect(repo.update).toHaveBeenCalledWith(
        { userId: userA, isDefault: true },
        { isDefault: false },
      );
    });

    it('actualiza solo latitude/longitude sin pisar el resto de campos (merge, no Object.assign)', async () => {
      repo.findOne.mockResolvedValue({ ...ownAddress });
      repo.save.mockImplementation((addr: Address) => addr);

      const result = await service.update(userA, 'addr-1', {
        latitude: -12.05,
        longitude: -77.03,
      });

      expect(result.latitude).toBe(-12.05);
      expect(result.longitude).toBe(-77.03);
      expect(result.district).toBe(ownAddress.district);
      expect(result.alias).toBe(ownAddress.alias);
    });
  });

  describe('remove', () => {
    it('elimina una dirección propia', async () => {
      repo.findOne.mockResolvedValue(ownAddress);
      repo.remove.mockResolvedValue(ownAddress);

      await service.remove(userA, 'addr-1');

      expect(repo.remove).toHaveBeenCalledWith(ownAddress);
    });

    it('lanza 403 si la dirección es de otro usuario', async () => {
      repo.findOne.mockResolvedValue(otherAddress);
      await expect(service.remove(userA, 'addr-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('lanza 404 si la dirección no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.remove(userA, 'no-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
