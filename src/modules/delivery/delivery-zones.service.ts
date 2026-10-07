import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { Setting } from '../settings/entities/setting.entity';
import { DeliveryMode } from './delivery-mode';
import { lockDeliveryCatalog } from './delivery-catalog-lock';
import {
  CreateDeliveryZoneDto,
  UpdateDeliveryZoneDto,
} from './dto/create-delivery-zone.dto';
import { DeliveryZone } from './entities/delivery-zone.entity';
import {
  deliveryPolygonError,
  deliveryPolygonsOverlap,
  pointInDeliveryPolygon,
  validDeliveryCoordinates,
} from './polygon.util';

@Injectable()
export class DeliveryZonesService {
  constructor(
    @InjectRepository(DeliveryZone)
    private readonly zonesRepository: Repository<DeliveryZone>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(): Promise<DeliveryZone[]> {
    return this.zonesRepository.find({ order: { id: 'ASC' } });
  }

  async findOne(id: string): Promise<DeliveryZone> {
    const zone = await this.zonesRepository.findOneBy({ id });
    if (!zone) throw new NotFoundException('Zona de delivery no encontrada');
    return zone;
  }

  async create(dto: CreateDeliveryZoneDto): Promise<DeliveryZone> {
    return this.write(async (manager) => {
      const zone = manager.create(DeliveryZone, {
        ...dto,
        active: dto.active ?? true,
      });
      await this.ensureGeometry(manager, zone);
      return manager.save(DeliveryZone, zone);
    });
  }

  async update(id: string, dto: UpdateDeliveryZoneDto): Promise<DeliveryZone> {
    return this.write(async (manager) => {
      const zone = await manager.findOneBy(DeliveryZone, { id });
      if (!zone) throw new NotFoundException('Zona de delivery no encontrada');
      if (zone.active && dto.active === false)
        await this.ensureActiveZoneRemains(manager, id);
      manager.merge(DeliveryZone, zone, dto);
      await this.ensureGeometry(manager, zone);
      return manager.save(DeliveryZone, zone);
    });
  }

  async remove(id: string): Promise<void> {
    await this.write(async (manager) => {
      const zone = await manager.findOneBy(DeliveryZone, { id });
      if (!zone) throw new NotFoundException('Zona de delivery no encontrada');
      if (zone.active) await this.ensureActiveZoneRemains(manager, id);
      await manager.remove(DeliveryZone, zone);
    });
  }

  async resolve(
    latitude: number,
    longitude: number,
  ): Promise<DeliveryZone | null> {
    if (!validDeliveryCoordinates(latitude, longitude))
      throw new BadRequestException('Coordenadas de delivery inválidas');
    // Stable UUID ascending tie-break on shared boundaries, independent of price/name.
    const zones = await this.zonesRepository.find({
      where: { active: true },
      order: { id: 'ASC' },
    });
    return (
      zones.find((zone) =>
        pointInDeliveryPolygon([longitude, latitude], zone.polygon),
      ) ?? null
    );
  }

  private async write<T>(
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      // Serialize catalog writes, including empty catalogs: row locks alone miss concurrent inserts.
      await lockDeliveryCatalog(manager);
      return action(manager);
    });
  }

  private async ensureActiveZoneRemains(
    manager: EntityManager,
    id: string,
  ): Promise<void> {
    const mode = await manager.findOneBy(Setting, { key: 'delivery_mode' });
    if (
      mode?.value === DeliveryMode.ZONES &&
      (await manager.countBy(DeliveryZone, { active: true, id: Not(id) })) === 0
    ) {
      throw new ConflictException(
        'No se puede eliminar o desactivar la última zona activa mientras delivery_mode es ZONES',
      );
    }
  }

  private async ensureGeometry(
    manager: EntityManager,
    zone: DeliveryZone,
  ): Promise<void> {
    const error = deliveryPolygonError(zone.polygon);
    if (error) throw new BadRequestException(error);
    // Disallow overlaps in the entire catalog, including inactive zones, so activation is safe.
    const others = await manager.find(DeliveryZone);
    if (
      others.some(
        (other) =>
          other.id !== zone.id &&
          deliveryPolygonsOverlap(zone.polygon, other.polygon),
      )
    ) {
      throw new ConflictException(
        'La zona se solapa con el interior de otra zona de delivery',
      );
    }
  }
}
