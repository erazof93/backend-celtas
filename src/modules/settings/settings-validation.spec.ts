import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Setting } from './entities/setting.entity';
import { NotificationsService } from '../notifications/notifications.service';

describe('Critical settings writes', () => {
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((v: Partial<Setting>) => v),
    save: jest.fn((v: Partial<Setting>) => Promise.resolve(v)),
  };
  let service: SettingsService;
  beforeEach(async () => {
    jest.clearAllMocks();
    repo.findOne.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(Setting), useValue: repo },
        { provide: ConfigService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();
    service = module.get(SettingsService);
  });
  it.each([
    'null',
    '{}',
    '[]',
    '{',
    [{ maxMeters: null, fee: -1 }],
    [{ maxMeters: null, fee: Infinity }],
    [
      { maxMeters: -1, fee: 2 },
      { maxMeters: null, fee: 4 },
    ],
    [{ maxMeters: 100, fee: 2 }],
    [
      { maxMeters: 200, fee: 2 },
      { maxMeters: 100, fee: 4 },
      { maxMeters: null, fee: 5 },
    ],
    [
      { maxMeters: 100, fee: 2 },
      { maxMeters: 100, fee: 4 },
      { maxMeters: null, fee: 5 },
    ],
    [
      { maxMeters: null, fee: 2 },
      { maxMeters: null, fee: 4 },
    ],
    [{ maxMeters: null, fee: 100000000 }],
    '[{"maxMeters":null,"fee":1e309}]',
    '[{"maxMeters":1e309,"fee":2},{"maxMeters":null,"fee":3}]',
    [{ maxMeters: null, fee: 1.001 }],
  ])('rejects tiers %j before persistence', async (value) => {
    await expect(
      service.upsert(
        'delivery_fee_tiers',
        typeof value === 'string' ? value : JSON.stringify(value),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });
  it.each([
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [null, 0],
    ['0', 0],
  ])('rejects coordinates %j %j', async (latitude, longitude) => {
    await expect(
      service.upsert('store_location', JSON.stringify({ latitude, longitude })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });
  it.each(['NaN', 'Infinity', '-1', '0', ''])(
    'rejects radius %s',
    async (value) => {
      await expect(
        service.upsert('delivery_alert_radius_meters', value),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    },
  );
  it.each([
    'null',
    '{}',
    '[]',
    '{"0":{"closed":false,"open":"25:00","close":"22:00"}}',
  ])('rejects incomplete/invalid schedule %s', async (value) => {
    await expect(
      service.upsert('business_hours_schedule', value),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });
  it.each([
    ['store_location', JSON.stringify({ latitude: -90, longitude: 180 })],
    [
      'delivery_fee_tiers',
      JSON.stringify([
        { maxMeters: 100, fee: 0 },
        { maxMeters: null, fee: 8 },
      ]),
    ],
    ['delivery_alert_radius_meters', '2500'],
    ['historic_key', 'anything'],
    [
      'delivery_fee_tiers',
      JSON.stringify([
        { maxMeters: 0, fee: 0 },
        { maxMeters: null, fee: 99999999.99 },
      ]),
    ],
    ['business_manual_closed', 'false'],
    [
      'business_hours_schedule',
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 7 }, (_, day) => [
            String(day),
            { closed: false, open: '11:00', close: '01:00' },
          ]),
        ),
      ),
    ],
  ])('accepts valid %s', async (key, value) => {
    await service.upsert(key, value);
    expect(repo.save).toHaveBeenCalled();
  });
});
