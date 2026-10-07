import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { Address } from './entities/address.entity';
import { User } from './entities/user.entity';

/**
 * CRUD de direcciones del usuario autenticado.
 * Todas las operaciones sobre una dirección verifican que pertenezca al usuario:
 * si existe pero es de otro usuario → 403; si no existe → 404.
 */
@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(Address)
    private readonly addressesRepository: Repository<Address>,
  ) {}

  findByUser(userId: string): Promise<Address[]> {
    return this.addressesRepository.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async create(userId: string, dto: CreateAddressDto): Promise<Address> {
    return this.write(userId, async (repo) => {
      if (dto.isDefault) await this.unsetDefault(repo, userId);
      return repo.save(repo.create({ ...dto, userId }));
    });
  }

  async update(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<Address> {
    return this.write(userId, async (repo) => {
      const address = await this.getOwned(repo, userId, addressId);
      if (dto.isDefault) await this.unsetDefault(repo, userId);
      repo.merge(address, dto);
      return repo.save(address);
    });
  }

  async remove(userId: string, addressId: string): Promise<void> {
    await this.write(userId, async (repo) => {
      const address = await this.getOwned(repo, userId, addressId);
      await repo.remove(address);
    });
  }

  /** All address writes serialize on the owner before reading address state. */
  private write<T>(
    userId: string,
    work: (repo: Repository<Address>) => Promise<T>,
  ): Promise<T> {
    return this.addressesRepository.manager.transaction(
      'READ COMMITTED',
      async (manager) => {
        const user = await manager.findOne(User, {
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user) throw new NotFoundException('Usuario no encontrado');
        return work(manager.getRepository(Address));
      },
    );
  }

  /** Recupera una dirección verificando que sea del usuario. 404 si no existe, 403 si es de otro. */
  private async getOwned(
    repo: Repository<Address>,
    userId: string,
    addressId: string,
  ): Promise<Address> {
    const address = await repo.findOne({
      where: { id: addressId },
    });
    if (!address) {
      throw new NotFoundException('Dirección no encontrada');
    }
    if (address.userId !== userId) {
      throw new ForbiddenException(
        'No tienes permiso para acceder a esta dirección',
      );
    }
    return address;
  }

  /** Quita el flag isDefault a todas las direcciones del usuario. */
  private async unsetDefault(
    repo: Repository<Address>,
    userId: string,
  ): Promise<void> {
    await repo.update({ userId, isDefault: true }, { isDefault: false });
  }
}
