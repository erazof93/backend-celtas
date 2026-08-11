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
    if (dto.isDefault) {
      await this.unsetDefault(userId);
    }
    const address = this.addressesRepository.create({
      ...dto,
      userId,
    });
    return this.addressesRepository.save(address);
  }

  async update(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<Address> {
    const address = await this.getOwned(userId, addressId);
    if (dto.isDefault) {
      await this.unsetDefault(userId);
    }
    // merge (no Object.assign): solo copia los campos definidos del DTO. Con
    // Object.assign, los campos ausentes del PATCH (undefined) pisaban los valores
    // ya cargados de la entidad y la respuesta salía incompleta (bug de producción).
    this.addressesRepository.merge(address, dto);
    return this.addressesRepository.save(address);
  }

  async remove(userId: string, addressId: string): Promise<void> {
    const address = await this.getOwned(userId, addressId);
    await this.addressesRepository.remove(address);
  }

  /** Recupera una dirección verificando que sea del usuario. 404 si no existe, 403 si es de otro. */
  private async getOwned(userId: string, addressId: string): Promise<Address> {
    const address = await this.addressesRepository.findOne({
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
  private async unsetDefault(userId: string): Promise<void> {
    await this.addressesRepository.update(
      { userId, isDefault: true },
      { isDefault: false },
    );
  }
}
