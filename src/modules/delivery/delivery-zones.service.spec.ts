import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { DeliveryZonesService } from './delivery-zones.service';
import { DeliveryZone } from './entities/delivery-zone.entity';

describe('DeliveryZonesService', () => {
  const polygon: DeliveryZone['polygon'] = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  };
  const zone = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Centro',
    polygon,
    fee: 5,
    active: true,
  } as DeliveryZone;
  let service: DeliveryZonesService;
  let repo: { find: jest.Mock; findOneBy: jest.Mock };
  let manager: {
    query: jest.Mock;
    find: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    countBy: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([zone]),
      findOneBy: jest.fn().mockResolvedValue(zone),
    };
    manager = {
      query: jest.fn().mockResolvedValue([]),
      countBy: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue({ ...zone }),
      create: jest.fn((_type: unknown, dto: Partial<DeliveryZone>) => dto),
      merge: jest.fn(
        (_type: unknown, entity: DeliveryZone, dto: Partial<DeliveryZone>) => {
          for (const [key, value] of Object.entries(dto))
            if (value !== undefined) Object.assign(entity, { [key]: value });
          return entity;
        },
      ),
      save: jest.fn((_type: unknown, entity: DeliveryZone) =>
        Promise.resolve(entity),
      ),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const source = {
      transaction: (
        _isolation: string,
        cb: (m: EntityManager) => Promise<unknown>,
      ) => cb(manager as unknown as EntityManager),
    };
    service = new DeliveryZonesService(
      repo as unknown as Repository<DeliveryZone>,
      source as DataSource,
    );
  });

  it('lists and gets zones', async () => {
    expect(await service.findAll()).toEqual([zone]);
    expect(await service.findOne(zone.id)).toEqual(zone);
  });
  it('creates with active default and serializes catalog writes', async () => {
    expect(
      await service.create({ name: 'Nueva', polygon, fee: 4 }),
    ).toMatchObject({ name: 'Nueva', active: true, fee: 4 });
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(731942, 1)',
    );
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
      manager.find.mock.invocationCallOrder[0],
    );
  });
  it('patches without erasing omitted fields and can deactivate', async () => {
    expect(
      await service.update(zone.id, { active: false, fee: undefined }),
    ).toMatchObject({ ...zone, active: false });
  });
  it('removes a zone', async () => {
    await service.remove(zone.id);
    expect(manager.remove).toHaveBeenCalledWith(DeliveryZone, zone);
  });
  it.each(['deactivate', 'delete'])(
    'protects the last active zone in ZONES: %s',
    async (action) => {
      manager.findOneBy.mockImplementation((type: unknown) =>
        Promise.resolve(
          type === DeliveryZone ? { ...zone } : { value: 'ZONES' },
        ),
      );
      manager.countBy.mockResolvedValue(0);
      const result =
        action === 'delete'
          ? service.remove(zone.id)
          : service.update(zone.id, { active: false });
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.remove).not.toHaveBeenCalled();
    },
  );
  it('allows removing the last active zone in DISTANCE', async () => {
    manager.findOneBy.mockImplementation((type: unknown) =>
      Promise.resolve(
        type === DeliveryZone ? { ...zone } : { value: 'DISTANCE' },
      ),
    );
    manager.countBy.mockResolvedValue(0);
    await service.remove(zone.id);
    expect(manager.remove).toHaveBeenCalled();
  });
  it('returns 404 for missing get/update/delete', async () => {
    repo.findOneBy.mockResolvedValue(null);
    manager.findOneBy.mockResolvedValue(null);
    await expect(service.findOne(zone.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.update(zone.id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(zone.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('rejects invalid geometry even when called without HTTP validation', async () => {
    await expect(
      service.create({
        name: 'Nueva',
        polygon: { type: 'Polygon', coordinates: [] },
        fee: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('rejects overlaps on create and edit, including inactive catalog entries', async () => {
    manager.find.mockResolvedValue([{ ...zone, active: false }]);
    await expect(
      service.create({ name: 'Nueva', polygon, fee: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
    manager.findOneBy.mockResolvedValue({ ...zone, id: 'other' });
    await expect(service.update('other', { polygon })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('permits shared borders and editing the same zone', async () => {
    manager.find.mockResolvedValue([zone]);
    await expect(
      service.update(zone.id, { name: 'Renombrada' }),
    ).resolves.toMatchObject({ name: 'Renombrada' });
    const adjacent: DeliveryZone['polygon'] = {
      type: 'Polygon',
      coordinates: [
        [
          [2, 0],
          [4, 0],
          [4, 2],
          [2, 2],
          [2, 0],
        ],
      ],
    };
    await expect(
      service.create({ name: 'Vecina', polygon: adjacent, fee: 4 }),
    ).resolves.toMatchObject({ name: 'Vecina' });
  });
  it('resolves active zones with stable UUID ordering on boundaries', async () => {
    repo.find.mockResolvedValue([
      zone,
      { ...zone, id: '00000000-0000-4000-8000-000000000002' },
    ]);
    expect(await service.resolve(1, 0)).toEqual(zone);
    expect(repo.find).toHaveBeenCalledWith({
      where: { active: true },
      order: { id: 'ASC' },
    });
  });
  it('returns no coverage outside or with no active zones', async () => {
    expect(await service.resolve(3, 3)).toBeNull();
    repo.find.mockResolvedValue([]);
    expect(await service.resolve(1, 1)).toBeNull();
  });
  it.each([
    [91, 0],
    [0, 181],
    [NaN, 0],
    [0, Infinity],
  ])('rejects invalid coordinates', async (lat, lng) => {
    await expect(service.resolve(lat, lng)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.find).not.toHaveBeenCalled();
  });
});
