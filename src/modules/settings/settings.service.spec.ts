import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { Setting } from './entities/setting.entity';
import {
  BUSINESS_HOURS_SCHEDULE_KEY,
  BUSINESS_MANUAL_CLOSED_KEY,
  BUSINESS_MANUAL_CLOSED_REASON_KEY,
  BusinessHoursSchedule,
  SettingsService,
  WHATSAPP_NUMBER_KEY,
} from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let settingsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let configService: { get: jest.Mock };
  let notificationsService: { broadcastPushNotification: jest.Mock };

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
    notificationsService = {
      broadcastPushNotification: jest
        .fn()
        .mockResolvedValue({ sent: 0, total: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(Setting), useValue: settingsRepo },
        { provide: ConfigService, useValue: configService },
        { provide: NotificationsService, useValue: notificationsService },
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

    describe('notificación push al cambiar business_manual_closed', () => {
      it('"false" → "true" dispara la notificación de cierre con el motivo leído fresco de la base', async () => {
        settingsRepo.findOne.mockResolvedValue(
          seedSetting({ key: BUSINESS_MANUAL_CLOSED_KEY, value: 'false' }),
        );
        // El motivo se lee fresco vía getManualClosedState() (find), no del
        // valor guardado en este mismo upsert.
        settingsRepo.find.mockResolvedValue([
          { key: BUSINESS_MANUAL_CLOSED_KEY, value: 'true' },
          {
            key: BUSINESS_MANUAL_CLOSED_REASON_KEY,
            value: 'Cerrado por feriado',
          },
        ]);

        await service.upsert(BUSINESS_MANUAL_CLOSED_KEY, 'true');

        expect(
          notificationsService.broadcastPushNotification,
        ).toHaveBeenCalledTimes(1);
        expect(
          notificationsService.broadcastPushNotification,
        ).toHaveBeenCalledWith({
          title: 'Celtas está cerrado temporalmente',
          body: 'Cerrado por feriado',
          data: { businessHoursChanged: 'true' },
        });
      });

      it('"true" → "false" dispara la notificación de reapertura', async () => {
        settingsRepo.findOne.mockResolvedValue(
          seedSetting({ key: BUSINESS_MANUAL_CLOSED_KEY, value: 'true' }),
        );

        await service.upsert(BUSINESS_MANUAL_CLOSED_KEY, 'false');

        expect(
          notificationsService.broadcastPushNotification,
        ).toHaveBeenCalledTimes(1);
        expect(
          notificationsService.broadcastPushNotification,
        ).toHaveBeenCalledWith({
          title: '¡Ya volvimos a abrir!',
          body: 'Ya podés hacer tu pedido normalmente',
          data: { businessHoursChanged: 'true' },
        });
      });

      it('guardar el MISMO valor (form completo sin tocar el toggle) NO dispara ninguna notificación', async () => {
        settingsRepo.findOne.mockResolvedValue(
          seedSetting({ key: BUSINESS_MANUAL_CLOSED_KEY, value: 'false' }),
        );

        await service.upsert(BUSINESS_MANUAL_CLOSED_KEY, 'false');

        expect(
          notificationsService.broadcastPushNotification,
        ).not.toHaveBeenCalled();
      });

      it('cambiar otra key (ej. el número de WhatsApp) nunca dispara esta notificación', async () => {
        settingsRepo.findOne.mockResolvedValue(seedSetting());
        await service.upsert(WHATSAPP_NUMBER_KEY, '51988888888');
        expect(
          notificationsService.broadcastPushNotification,
        ).not.toHaveBeenCalled();
      });
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

  describe('isOpenNow', () => {
    const DEFAULT_SCHEDULE: BusinessHoursSchedule = {
      '0': { closed: false, open: '11:00', close: '22:00' },
      '1': { closed: false, open: '11:00', close: '23:00' },
      '2': { closed: false, open: '11:00', close: '23:00' },
      '3': { closed: false, open: '11:00', close: '23:00' },
      '4': { closed: false, open: '11:00', close: '23:00' },
      '5': { closed: false, open: '11:00', close: '01:00' },
      '6': { closed: false, open: '11:00', close: '01:00' },
    };

    /** No hay override manual activo (comportamiento por defecto en estos tests). */
    const mockNoManualOverride = () => {
      settingsRepo.find.mockResolvedValue([
        { key: BUSINESS_MANUAL_CLOSED_KEY, value: 'false' },
      ]);
    };

    const mockSchedule = (schedule: BusinessHoursSchedule) => {
      settingsRepo.findOne.mockResolvedValue(
        seedSetting({
          key: BUSINESS_HOURS_SCHEDULE_KEY,
          value: JSON.stringify(schedule),
        }),
      );
    };

    it('dentro de horario normal (mismo día, sin cruce) → abierto', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      // Miércoles 15:00 Lima (horario 11:00-23:00).
      const result = await service.isOpenNow(
        new Date('2026-08-19T20:00:00.000Z'),
      );
      expect(result).toEqual({ open: true, message: null });
    });

    it('antes de abrir → cerrado con mensaje del horario de hoy', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      // Miércoles 09:00 Lima (abre a las 11:00).
      const result = await service.isOpenNow(
        new Date('2026-08-19T14:00:00.000Z'),
      );
      expect(result.open).toBe(false);
      expect(result.message).toBe(
        'El local está cerrado en este momento. Hoy atendemos de 11:00 a 23:00',
      );
    });

    it('después de cerrar → cerrado con mensaje del horario de hoy', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      // Miércoles 23:30 Lima (cierra a las 23:00).
      const result = await service.isOpenNow(
        new Date('2026-08-20T04:30:00.000Z'),
      );
      expect(result.open).toBe(false);
      expect(result.message).toBe(
        'El local está cerrado en este momento. Hoy atendemos de 11:00 a 23:00',
      );
    });

    it('día marcado closed:true → "Hoy no atendemos" sin importar la hora', async () => {
      mockNoManualOverride();
      mockSchedule({
        ...DEFAULT_SCHEDULE,
        '3': { closed: true, open: '11:00', close: '23:00' },
      });
      // Miércoles 15:00 Lima, dentro del rango open/close, pero closed:true.
      const result = await service.isOpenNow(
        new Date('2026-08-19T20:00:00.000Z'),
      );
      expect(result).toEqual({ open: false, message: 'Hoy no atendemos' });
    });

    it('horario que cruza medianoche: antes de medianoche (viernes 23:30) → abierto', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      const result = await service.isOpenNow(
        new Date('2026-08-22T04:30:00.000Z'),
      );
      expect(result).toEqual({ open: true, message: null });
    });

    it('horario que cruza medianoche: arrastre de madrugada (sábado 00:30) → abierto', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      const result = await service.isOpenNow(
        new Date('2026-08-22T05:30:00.000Z'),
      );
      expect(result).toEqual({ open: true, message: null });
    });

    it('ya cerró la madrugada pero todavía no abre hoy (sábado 02:00) → cerrado', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      const result = await service.isOpenNow(
        new Date('2026-08-22T07:00:00.000Z'),
      );
      expect(result.open).toBe(false);
      expect(result.message).toBe(
        'El local está cerrado en este momento. Hoy atendemos de 11:00 a 01:00',
      );
    });

    it('override manual con motivo gana incluso en horario normal', async () => {
      settingsRepo.find.mockResolvedValue([
        { key: BUSINESS_MANUAL_CLOSED_KEY, value: 'true' },
        {
          key: BUSINESS_MANUAL_CLOSED_REASON_KEY,
          value: 'Cerrado por mantenimiento',
        },
      ]);
      mockSchedule(DEFAULT_SCHEDULE);
      // Miércoles 15:00 Lima: el horario diría "abierto", pero el override gana.
      const result = await service.isOpenNow(
        new Date('2026-08-19T20:00:00.000Z'),
      );
      expect(result).toEqual({
        open: false,
        message:
          'El local está cerrado temporalmente: Cerrado por mantenimiento',
      });
      // No debería ni consultar el horario si el override ya decidió.
      expect(settingsRepo.findOne).not.toHaveBeenCalled();
    });

    it('override manual sin motivo → mensaje genérico sin ":"', async () => {
      settingsRepo.find.mockResolvedValue([
        { key: BUSINESS_MANUAL_CLOSED_KEY, value: 'true' },
      ]);
      const result = await service.isOpenNow(
        new Date('2026-08-19T20:00:00.000Z'),
      );
      expect(result).toEqual({
        open: false,
        message: 'El local está cerrado temporalmente',
      });
    });
  });

  describe('getNextChangeAt', () => {
    const DEFAULT_SCHEDULE: BusinessHoursSchedule = {
      '0': { closed: false, open: '11:00', close: '22:00' },
      '1': { closed: false, open: '11:00', close: '23:00' },
      '2': { closed: false, open: '11:00', close: '23:00' },
      '3': { closed: false, open: '11:00', close: '23:00' },
      '4': { closed: false, open: '11:00', close: '23:00' },
      '5': { closed: false, open: '11:00', close: '01:00' },
      '6': { closed: false, open: '11:00', close: '01:00' },
    };

    const mockNoManualOverride = () => {
      settingsRepo.find.mockResolvedValue([
        { key: BUSINESS_MANUAL_CLOSED_KEY, value: 'false' },
      ]);
    };

    const mockSchedule = (schedule: BusinessHoursSchedule) => {
      settingsRepo.findOne.mockResolvedValue(
        seedSetting({
          key: BUSINESS_HOURS_SCHEDULE_KEY,
          value: JSON.stringify(schedule),
        }),
      );
    };

    it('abierto ahora (sin cruce) → la hora de cierre de HOY', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      // Miércoles 15:00 Lima (horario 11:00-23:00) → cierra hoy a las 23:00.
      const result = await service.getNextChangeAt(
        new Date('2026-08-19T20:00:00.000Z'),
      );
      expect(result?.toISOString()).toBe('2026-08-20T04:00:00.000Z');
    });

    it('abierto ahora en horario que cruza medianoche → la hora de cierre corresponde a MAÑANA', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      // Viernes 23:30 Lima (horario 11:00-01:00) → cierra el sábado a la 01:00,
      // NO el viernes (la fecha calendario debe avanzar un día).
      const result = await service.getNextChangeAt(
        new Date('2026-08-22T04:30:00.000Z'),
      );
      expect(result?.toISOString()).toBe('2026-08-22T06:00:00.000Z');
    });

    it('abierto ahora por arrastre de ayer (sábado 00:30) → misma hora de cierre que calculada desde "hoy viernes"', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      const result = await service.getNextChangeAt(
        new Date('2026-08-22T05:30:00.000Z'),
      );
      // Debe ser el mismo instante absoluto que el cierre calculado desde el
      // viernes (sábado 01:00 Lima) — el cruce de medianoche es un solo evento.
      expect(result?.toISOString()).toBe('2026-08-22T06:00:00.000Z');
    });

    it('cerrado ahora, todavía no abrió hoy → hora de apertura de HOY', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      // Miércoles 09:00 Lima (abre a las 11:00).
      const result = await service.getNextChangeAt(
        new Date('2026-08-19T14:00:00.000Z'),
      );
      expect(result?.toISOString()).toBe('2026-08-19T16:00:00.000Z');
    });

    it('cerrado ahora, ya cerró por hoy → hora de apertura de MAÑANA', async () => {
      mockNoManualOverride();
      mockSchedule(DEFAULT_SCHEDULE);
      // Miércoles 23:30 Lima (ya cerró) → abre el jueves a las 11:00.
      const result = await service.getNextChangeAt(
        new Date('2026-08-20T04:30:00.000Z'),
      );
      expect(result?.toISOString()).toBe('2026-08-20T16:00:00.000Z');
    });

    it('cerrado ahora, mañana también closed:true → salta al primer día siguiente que sí abre', async () => {
      mockNoManualOverride();
      mockSchedule({
        ...DEFAULT_SCHEDULE,
        '4': { closed: true, open: '11:00', close: '23:00' }, // jueves cerrado
      });
      // Miércoles 23:30 Lima: jueves está closed:true → debe saltar al viernes.
      const result = await service.getNextChangeAt(
        new Date('2026-08-20T04:30:00.000Z'),
      );
      expect(result?.toISOString()).toBe('2026-08-21T16:00:00.000Z');
    });

    it('los 7 días marcados closed:true → null (nunca abre, no lanza excepción)', async () => {
      mockNoManualOverride();
      const allClosed: BusinessHoursSchedule = Object.fromEntries(
        Object.entries(DEFAULT_SCHEDULE).map(([day, entry]) => [
          day,
          { ...entry, closed: true },
        ]),
      );
      mockSchedule(allClosed);
      const result = await service.getNextChangeAt(
        new Date('2026-08-19T20:00:00.000Z'),
      );
      expect(result).toBeNull();
    });

    it('cierre manual activo → null sin importar el horario programado', async () => {
      settingsRepo.find.mockResolvedValue([
        { key: BUSINESS_MANUAL_CLOSED_KEY, value: 'true' },
      ]);
      mockSchedule(DEFAULT_SCHEDULE);
      const result = await service.getNextChangeAt(
        new Date('2026-08-19T20:00:00.000Z'),
      );
      expect(result).toBeNull();
    });
  });

  describe('getBusinessHoursSchedule', () => {
    it('cae al horario default si la key no existe o el JSON es inválido', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await service.getBusinessHoursSchedule();
      expect(result['0'].open).toBe('11:00');
      expect(result['5'].close).toBe('01:00');
    });
  });

  describe('isManuallyClosed', () => {
    it('devuelve true solo cuando el value es exactamente "true"', async () => {
      settingsRepo.find.mockResolvedValue([
        { key: BUSINESS_MANUAL_CLOSED_KEY, value: 'true' },
      ]);
      expect(await service.isManuallyClosed()).toBe(true);
    });

    it('devuelve false si el value es "false" o la key no existe', async () => {
      settingsRepo.find.mockResolvedValue([]);
      expect(await service.isManuallyClosed()).toBe(false);
    });
  });
});
