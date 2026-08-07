import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Setting } from './entities/setting.entity';
import { SettingsService, WHATSAPP_NUMBER_KEY } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let settingsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let configService: { get: jest.Mock };

  const seedSetting = (overrides: Partial<Setting> = {}) =>
    ({
      id: 'setting-1',
      key: WHATSAPP_NUMBER_KEY,
      value: '51999999999',
      description: 'Número de WhatsApp',
      ...overrides,
    }) as Setting;

  beforeEach(async () => {
    settingsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((v: Setting) => Promise.resolve(v)),
      create: jest.fn((v: Partial<Setting>) => v as Setting),
    };
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(Setting), useValue: settingsRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  describe('onModuleInit (seed)', () => {
    it('no siembra si la key ya existe', async () => {
      settingsRepo.findOne.mockResolvedValue(seedSetting());
      await service.onModuleInit();
      expect(settingsRepo.save).not.toHaveBeenCalled();
    });

    it('siembra whatsapp_business_number desde .env si la tabla está vacía', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      configService.get.mockReturnValue('51988888888');
      await service.onModuleInit();
      expect(settingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          key: WHATSAPP_NUMBER_KEY,
          value: '51988888888',
        }),
      );
    });

    it('siembra con un default si no hay .env', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      configService.get.mockReturnValue(undefined);
      await service.onModuleInit();
      expect(settingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          key: WHATSAPP_NUMBER_KEY,
          value: '51999999999',
        }),
      );
    });
  });

  describe('findPublic', () => {
    it('expone solo las keys de la whitelist, nunca todo el key-value', async () => {
      settingsRepo.find.mockResolvedValue([
        seedSetting(),
        {
          id: 's2',
          key: 'secret_internal',
          value: 'no-debe-salir',
          description: null,
        },
      ]);
      const result = await service.findPublic();
      expect(result).toEqual({ [WHATSAPP_NUMBER_KEY]: '51999999999' });
      expect(result['secret_internal']).toBeUndefined();
    });
  });

  describe('upsert', () => {
    it('actualiza una setting existente', async () => {
      settingsRepo.findOne.mockResolvedValue(seedSetting());
      const result = await service.upsert(WHATSAPP_NUMBER_KEY, '51977777777');
      expect(result.value).toBe('51977777777');
      expect(settingsRepo.save).toHaveBeenCalled();
    });

    it('crea una setting nueva si no existe', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      await service.upsert('nueva_key', 'valor');
      expect(settingsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'nueva_key', value: 'valor' }),
      );
    });
  });

  describe('getWhatsappNumber', () => {
    it('usa el valor de la tabla si existe', async () => {
      settingsRepo.findOne.mockResolvedValue(
        seedSetting({ value: '51966666666' }),
      );
      const result = await service.getWhatsappNumber();
      expect(result).toBe('51966666666');
      expect(configService.get).not.toHaveBeenCalled();
    });

    it('cae al .env como fallback si la tabla está vacía', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      configService.get.mockReturnValue('51955555555');
      const result = await service.getWhatsappNumber();
      expect(result).toBe('51955555555');
    });

    it('lanza si no hay tabla ni .env', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      configService.get.mockReturnValue(undefined);
      await expect(service.getWhatsappNumber()).rejects.toThrow();
    });
  });
});
