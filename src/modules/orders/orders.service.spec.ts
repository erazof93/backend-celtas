import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { CouponsService } from '../coupons/coupons.service';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { Address } from '../users/entities/address.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';

/** Mock de repositorio: devuelve el mismo objeto que recibe (identity tipado). */
const passthrough = <T>(value: T): T => value;

describe('OrdersService', () => {
  let service: OrdersService;
  let ordersRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let orderItemsRepo: { create: jest.Mock };
  let menuItemsRepo: { find: jest.Mock };
  let addressesRepo: { findOne: jest.Mock };
  let usersRepo: { findOne: jest.Mock; find: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let configService: { get: jest.Mock };
  let couponsService: {
    applyToOrder: jest.Mock;
    markUsed: jest.Mock;
    checkAndGenerateForUser: jest.Mock;
    reactivateForCancelledOrder: jest.Mock;
  };
  let notificationsService: { sendPushNotification: jest.Mock };
  let settingsService: {
    getWhatsappNumber: jest.Mock;
    isOpenNow: jest.Mock;
    getStoreLocation: jest.Mock;
    getDeliveryFeeTiers: jest.Mock;
    getDeliveryAlertRadiusMeters: jest.Mock;
  };

  const userId = 'user-1';
  const otherUserId = 'user-2';
  const addressId = '11111111-1111-4111-8111-111111111111';
  const menuItemId = '22222222-2222-4222-8222-222222222222';

  /** Referencia mínima de una salsa ofrecida por un producto (solo lo que el service lee). */
  const sauceRef = (id: string, name: string) =>
    ({ id, name }) as MenuItem['sauces'][number];

  const menuMenuItem = (
    overrides: Partial<Omit<MenuItem, 'sauces'>> & {
      sauces?: { id: string; name: string }[];
    } = {},
  ) =>
    ({
      id: menuItemId,
      name: 'Celtas Clásica',
      price: 24.9,
      available: true,
      ...overrides,
      sauces: overrides.sauces?.map((s) => sauceRef(s.id, s.name)),
    }) as MenuItem;

  const seedAddress = (overrides: Partial<Address> = {}) =>
    ({
      id: addressId,
      alias: 'Casa',
      fullAddress: 'Av. Los Álamos 123',
      reference: 'Portón verde',
      district: 'San Juan de Miraflores',
      userId,
      ...overrides,
    }) as Address;

  const seedOrder = (overrides: Partial<Order> = {}) =>
    ({
      id: '33333333-3333-4333-8333-333333333333',
      userId,
      status: OrderStatus.PENDIENTE,
      addressSnapshot: JSON.stringify(seedAddress()),
      total: 49.8,
      whatsappUrl: 'https://wa.me/51999999999?text=...',
      items: [],
      ...overrides,
    }) as Order;

  beforeEach(async () => {
    ordersRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    orderItemsRepo = { create: jest.fn() };
    menuItemsRepo = { find: jest.fn() };
    addressesRepo = { findOne: jest.fn() };
    usersRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    dataSource = { transaction: jest.fn() };
    configService = {
      get: jest.fn((key: string) =>
        key === 'whatsapp.businessNumber' ? '51999999999' : undefined,
      ),
    };
    couponsService = {
      applyToOrder: jest.fn(),
      markUsed: jest.fn().mockResolvedValue(undefined),
      checkAndGenerateForUser: jest.fn().mockResolvedValue(null),
      reactivateForCancelledOrder: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      sendPushNotification: jest.fn().mockResolvedValue(true),
    };
    settingsService = {
      getWhatsappNumber: jest.fn().mockResolvedValue('51999999999'),
      // Local abierto por defecto: los tests existentes de create() no deben
      // verse afectados por el guard de horario de atención.
      isOpenNow: jest.fn().mockResolvedValue({ open: true, message: null }),
      // Solo se consulta cuando la dirección tiene coordenadas (ver
      // resolveDelivery). Default lejos de cualquier dirección de prueba
      // para no afectar los tests que no verifican deliveryFee/distancia.
      getStoreLocation: jest
        .fn()
        .mockResolvedValue({ latitude: -12.1631, longitude: -76.97 }),
      getDeliveryFeeTiers: jest.fn().mockResolvedValue([
        { maxMeters: 100, fee: 2 },
        { maxMeters: 400, fee: 4 },
        { maxMeters: 1000, fee: 6 },
        { maxMeters: null, fee: 8 },
      ]),
      getDeliveryAlertRadiusMeters: jest.fn().mockResolvedValue(2500),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemsRepo },
        { provide: getRepositoryToken(MenuItem), useValue: menuItemsRepo },
        { provide: getRepositoryToken(Address), useValue: addressesRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: configService },
        { provide: CouponsService, useValue: couponsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  describe('create', () => {
    const dto = { items: [{ menuItemId, quantity: 2 }] };

    beforeEach(() => {
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);
      orderItemsRepo.create.mockImplementation(passthrough);
      ordersRepo.create.mockImplementation(passthrough);
      ordersRepo.save.mockImplementation(passthrough);
      // create() ahora persiste dentro de dataSource.transaction.
      dataSource.transaction.mockImplementation(
        (cb: (m: { create: jest.Mock; save: jest.Mock }) => Promise<unknown>) =>
          cb({
            create: jest.fn((_entity: unknown, value: unknown) => value),
            save: jest.fn((_entity: unknown, value: unknown) =>
              Promise.resolve(value),
            ),
          }),
      );
    });

    it('lanza 409 con el mensaje de isOpenNow si el local está cerrado, y no crea nada', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      settingsService.isOpenNow.mockResolvedValue({
        open: false,
        message: 'El local está cerrado temporalmente: Cerrado por feriado',
      });

      await expect(
        service.create(userId, { ...dto, addressId }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create(userId, { ...dto, addressId }),
      ).rejects.toThrow(
        'El local está cerrado temporalmente: Cerrado por feriado',
      );

      // El guard corta antes de tocar la base: nada de esto debió llamarse.
      expect(addressesRepo.findOne).not.toHaveBeenCalled();
      expect(menuItemsRepo.find).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(ordersRepo.save).not.toHaveBeenCalled();
    });

    it('un pedido con el local abierto funciona igual que antes (no-regresión)', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      const result = await service.create(userId, { ...dto, addressId });
      expect(result.status).toBe(OrderStatus.PENDIENTE);
      expect(settingsService.isOpenNow).toHaveBeenCalled();
    });

    it('copia la dirección desde addressId al snapshot (no guarda referencia viva)', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      const result = await service.create(userId, { ...dto, addressId });

      expect(addressesRepo.findOne).toHaveBeenCalledWith({
        where: { id: addressId, userId },
      });
      expect(result.addressSnapshot).toBe(
        JSON.stringify({
          alias: 'Casa',
          fullAddress: 'Av. Los Álamos 123',
          reference: 'Portón verde',
          district: 'San Juan de Miraflores',
        }),
      );
    });

    it('copia latitude/longitude al snapshot cuando la dirección las tiene', async () => {
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: -12.169, longitude: -77.0089 }),
      );
      const result = await service.create(userId, { ...dto, addressId });

      const snapshot = JSON.parse(result.addressSnapshot) as {
        latitude: number;
        longitude: number;
      };
      expect(snapshot.latitude).toBe(-12.169);
      expect(snapshot.longitude).toBe(-77.0089);
    });

    it('no fuerza latitude/longitude si la dirección no las tiene (direcciones viejas)', async () => {
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: null, longitude: null }),
      );
      const result = await service.create(userId, { ...dto, addressId });

      const snapshot = JSON.parse(result.addressSnapshot) as {
        latitude: number | null;
        longitude: number | null;
      };
      expect(snapshot.latitude).toBeNull();
      expect(snapshot.longitude).toBeNull();
    });

    it('usa addressSnapshot directo si no hay addressId', async () => {
      const snapshot = '{"fullAddress":"Jr. Los Olivos 456"}';
      const result = await service.create(userId, {
        ...dto,
        addressSnapshot: snapshot,
      });
      expect(result.addressSnapshot).toBe(snapshot);
      expect(addressesRepo.findOne).not.toHaveBeenCalled();
    });

    it('lanza 400 si no se indica ninguna dirección', async () => {
      await expect(service.create(userId, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lanza 404 si la dirección no existe o es de otro usuario', async () => {
      addressesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create(userId, { ...dto, addressId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza 404 si un producto no existe', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([]);
      await expect(
        service.create(userId, { ...dto, addressId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza 400 si un producto no está disponible', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ available: false }),
      ]);
      await expect(
        service.create(userId, { ...dto, addressId }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('calcula subtotales y total en el backend (no confía en el frontend)', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ id: 'a', price: 24.9 }),
        menuMenuItem({ id: 'b', price: 10.5 }),
      ]);
      orderItemsRepo.create.mockImplementation(passthrough);

      const result = await service.create(userId, {
        addressId,
        items: [
          { menuItemId: 'a', quantity: 2 },
          { menuItemId: 'b', quantity: 3 },
        ],
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].subtotal).toBe(49.8); // 24.9 * 2
      expect(result.items[1].subtotal).toBe(31.5); // 10.5 * 3
      expect(result.total).toBe(81.3); // 49.8 + 31.5
      expect(result.status).toBe(OrderStatus.PENDIENTE);
    });

    it('genera el whatsappUrl con el mensaje esperado', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);
      orderItemsRepo.create.mockImplementation(passthrough);
      ordersRepo.create.mockImplementation(passthrough);

      const result = await service.create(userId, { ...dto, addressId });

      // Se verifican las partes clave por separado (no un string exacto completo):
      // un cambio menor de formato del mensaje (agregar un emoji, un salto de
      // línea) no debe romper todo el test, solo la parte que realmente cambió.
      expect(result.whatsappUrl).toMatch(
        /^https:\/\/wa\.me\/51999999999\?text=/,
      );
      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).toContain(
        `NUEVO PEDIDO #${result.id.slice(0, 8).toUpperCase()}`,
      );
      expect(message).toContain('2x Celtas Clásica');
      expect(message).toContain(
        'Av. Los Álamos 123, San Juan de Miraflores (ref: Portón verde)',
      );
      expect(message).toContain('Total a pagar:* S/ 49.80');
    });

    it('agrega los links de Google Maps y Waze si la dirección tiene coordenadas', async () => {
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: -12.169, longitude: -77.0089 }),
      );
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);

      const result = await service.create(userId, { ...dto, addressId });

      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).toContain(
        '🗺️ Google Maps: https://www.google.com/maps/search/?api=1&query=-12.169,-77.0089',
      );
      expect(message).toContain(
        '🚗 Waze: https://waze.com/ul?ll=-12.169,-77.0089&navigate=yes',
      );
    });

    it('trata latitude/longitude = 0 como coordenada válida, no como ausente (chequeo == null, no truthy)', async () => {
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: 0, longitude: 0 }),
      );
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);

      const result = await service.create(userId, { ...dto, addressId });

      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).toContain(
        '🗺️ Google Maps: https://www.google.com/maps/search/?api=1&query=0,0',
      );
      expect(message).toContain(
        '🚗 Waze: https://waze.com/ul?ll=0,0&navigate=yes',
      );
    });

    it('no agrega ninguna línea de mapa si la dirección no tiene coordenadas (mensaje igual que antes)', async () => {
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: null, longitude: null }),
      );
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);

      const result = await service.create(userId, { ...dto, addressId });

      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).not.toContain('Google Maps');
      expect(message).not.toContain('Waze');
      expect(message).not.toContain('N/A');
    });

    it('valida y guarda el snapshot de salsas elegidas (sauceIds)', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          sauces: [
            { id: 'sauce-mayo', name: 'Mayonesa' },
            { id: 'sauce-ketchup', name: 'Ketchup' },
          ],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [
          {
            menuItemId,
            quantity: 2,
            sauceIds: ['sauce-mayo', 'sauce-ketchup'],
          },
        ],
      });

      expect(result.items[0].selectedSauces).toEqual(['Mayonesa', 'Ketchup']);
    });

    it('sin sauceIds, el snapshot queda null (no falla ni inventa salsas)', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);

      const result = await service.create(userId, { ...dto, addressId });
      expect(result.items[0].selectedSauces).toBeNull();
    });

    it('con sauceIds: [] explícito, el snapshot queda [] (no null) — "Sin salsas" elegido a propósito', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          sauces: [{ id: 'sauce-mayo', name: 'Mayonesa' }],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 2, sauceIds: [] }],
      });

      expect(result.items[0].selectedSauces).toEqual([]);
      expect(result.items[0].selectedSauces).not.toBeNull();
    });

    it('el mensaje de WhatsApp muestra "(Salsas: Sin salsas)" cuando sauceIds vino [] explícito', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          sauces: [{ id: 'sauce-mayo', name: 'Mayonesa' }],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 2, sauceIds: [] }],
      });

      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).toContain('(Salsas: Sin salsas)');
    });

    it('lanza 400 si el sauceId no está entre las salsas que el producto ofrece', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ sauces: [{ id: 'sauce-mayo', name: 'Mayonesa' }] }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1, sauceIds: ['sauce-inexistente'] }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('el mensaje de WhatsApp incluye las salsas elegidas por ítem', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ sauces: [{ id: 'sauce-mayo', name: 'Mayonesa' }] }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 1, sauceIds: ['sauce-mayo'] }],
      });

      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).toContain('1x Celtas Clásica (Salsas: Mayonesa)');
    });

    it('el mensaje de WhatsApp no agrega "(Salsas: ...)" si el ítem no tiene ninguna', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);

      const result = await service.create(userId, { ...dto, addressId });
      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).toContain('2x Celtas Clásica');
      expect(message).not.toContain('Salsas:');
    });

    it('guarda el comment y lo muestra como "Nota:" en el mensaje de WhatsApp', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);

      const result = await service.create(userId, {
        addressId,
        items: [
          { menuItemId, quantity: 2, comment: 'Sin cebolla, bien cocida' },
        ],
      });

      expect(result.items[0].comment).toBe('Sin cebolla, bien cocida');
      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).toContain(
        '2x Celtas Clásica — Nota: Sin cebolla, bien cocida',
      );
    });

    it.each([
      ['ausente', undefined],
      ['vacío', ''],
      ['solo espacios', '   '],
    ])(
      'comment %s → se guarda como null y no aparece "Nota:" en el mensaje',
      async (_label, comment) => {
        addressesRepo.findOne.mockResolvedValue(seedAddress());
        menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);

        const result = await service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 2, comment }],
        });

        expect(result.items[0].comment).toBeNull();
        const message = decodeURIComponent(
          result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
        );
        expect(message).not.toContain('Nota:');
      },
    );

    it('el comment se trimea antes de guardarse', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 2, comment: '  Bien cocida  ' }],
      });

      expect(result.items[0].comment).toBe('Bien cocida');
    });

    it('aplica el cupón y guarda el total descontado', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);
      couponsService.applyToOrder.mockResolvedValue({
        discountedTotal: 44.82, // 49.8 - 10%
        coupon: { id: 'coupon-1' },
      });
      couponsService.markUsed = jest.fn().mockResolvedValue(undefined);

      const result = await service.create(userId, {
        ...dto,
        addressId,
        couponCode: 'A1B2C3D4',
      });

      expect(couponsService.applyToOrder).toHaveBeenCalledWith(
        expect.anything(),
        {
          code: 'A1B2C3D4',
          userId,
          subtotal: 49.8,
        },
      );
      expect(couponsService.markUsed).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'coupon-1' },
        result.id,
      );
      expect(result.total).toBe(44.82);
    });

    it('propaga el error si el cupón no es válido (no crea el pedido)', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);
      couponsService.applyToOrder.mockRejectedValue(
        new BadRequestException('Este cupón ya fue utilizado'),
      );

      await expect(
        service.create(userId, {
          ...dto,
          addressId,
          couponCode: 'USADO',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create — delivery por distancia + aviso de pedidos lejanos', () => {
    const dto = { items: [{ menuItemId, quantity: 2 }] };
    // store_location de prueba usado en el mock default de settingsService:
    // { latitude: -12.1631, longitude: -76.97 }.
    const NEAR_COORDS = { latitude: -12.16315, longitude: -76.97005 }; // ~7.77m → tramo 1 (<=100m, S/2)
    const MID_COORDS = { latitude: -12.169, longitude: -76.965 }; // ~851.93m → tramo 3 (<=1000m, S/6)
    const FAR_COORDS = { latitude: -12.19, longitude: -76.95 }; // ~3697.65m → tramo 4 (sin techo, S/8) y supera el radio de aviso (2500m)

    beforeEach(() => {
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);
      orderItemsRepo.create.mockImplementation(passthrough);
      ordersRepo.create.mockImplementation(passthrough);
      ordersRepo.save.mockImplementation(passthrough);
      dataSource.transaction.mockImplementation(
        (cb: (m: { create: jest.Mock; save: jest.Mock }) => Promise<unknown>) =>
          cb({
            create: jest.fn((_entity: unknown, value: unknown) => value),
            save: jest.fn((_entity: unknown, value: unknown) =>
              Promise.resolve(value),
            ),
          }),
      );
    });

    it('sin coordenadas en la dirección: deliveryFee = 0, no consulta store_location (no bloquea el pedido)', async () => {
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: null, longitude: null }),
      );
      const result = await service.create(userId, { ...dto, addressId });

      expect(result.deliveryFee).toBe(0);
      expect(settingsService.getStoreLocation).not.toHaveBeenCalled();
    });

    it('dirección cercana (tramo 1, <=100m) → deliveryFee = 2, sumado al total', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));
      const result = await service.create(userId, { ...dto, addressId });

      expect(result.deliveryFee).toBe(2);
      expect(result.total).toBe(51.8); // subtotal 49.8 + deliveryFee 2
    });

    it('dirección en tramo intermedio (851.93m, tramo 3 <=1000m) → deliveryFee = 6', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(MID_COORDS));
      const result = await service.create(userId, { ...dto, addressId });

      expect(result.deliveryFee).toBe(6);
      expect(result.total).toBe(55.8); // 49.8 + 6
    });

    it('dirección lejana (>1000m, tramo sin techo) → deliveryFee = 8 y el pedido se crea igual (nunca se rechaza por distancia)', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(FAR_COORDS));
      const result = await service.create(userId, { ...dto, addressId });

      expect(result.deliveryFee).toBe(8);
      expect(result.status).toBe(OrderStatus.PENDIENTE);
    });

    it('deliveryFee se suma DESPUÉS del descuento del cupón', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));
      couponsService.applyToOrder.mockResolvedValue({
        discountedTotal: 44.82, // 49.8 - 10%
        coupon: { id: 'coupon-1' },
      });

      const result = await service.create(userId, {
        ...dto,
        addressId,
        couponCode: 'A1B2C3D4',
      });

      expect(result.total).toBe(46.82); // 44.82 + deliveryFee 2
    });

    it('store_location sin configurar + dirección CON coordenadas → NotFoundException, no crea el pedido', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));
      settingsService.getStoreLocation.mockRejectedValue(
        new NotFoundException(
          'La ubicación del local todavía no está configurada (setting "store_location")',
        ),
      );

      await expect(
        service.create(userId, { ...dto, addressId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('dispara push a los admins con token tras crear el pedido (aviso normal si no supera el radio)', async () => {
      usersRepo.find.mockResolvedValue([
        { id: 'admin-1', role: UserRole.ADMIN, fcmToken: 'token-admin-1' },
      ]);
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));

      const result = await service.create(userId, { ...dto, addressId });

      const findCall = (usersRepo.find.mock.calls[0] as unknown[])[0] as {
        where: { role: string };
      };
      expect(findCall.where.role).toBe(UserRole.ADMIN);

      const [calledUserId, payload] = notificationsService.sendPushNotification
        .mock.calls[0] as [
        string,
        { title: string; data: Record<string, string> },
      ];
      expect(calledUserId).toBe('admin-1');
      expect(payload.title).toContain('🍔 Nuevo pedido');
      expect(payload.title).toContain(`S/ ${result.total.toFixed(2)}`);
      expect(payload.data).toEqual({
        orderId: result.id,
        status: OrderStatus.PENDIENTE,
      });
    });

    it('el pedido lejano (supera el radio de aviso) marca el push con el mensaje de advertencia', async () => {
      usersRepo.find.mockResolvedValue([
        { id: 'admin-1', role: UserRole.ADMIN, fcmToken: 'token-admin-1' },
      ]);
      addressesRepo.findOne.mockResolvedValue(seedAddress(FAR_COORDS));

      await service.create(userId, { ...dto, addressId });

      const [, payload] = notificationsService.sendPushNotification.mock
        .calls[0] as [string, { title: string }];
      expect(payload.title).toContain(
        '⚠️ Nuevo pedido fuera de la zona habitual',
      );
    });

    it('el pedido cercano NO dispara el mensaje de advertencia', async () => {
      usersRepo.find.mockResolvedValue([
        { id: 'admin-1', role: UserRole.ADMIN, fcmToken: 'token-admin-1' },
      ]);
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));

      await service.create(userId, { ...dto, addressId });

      const [, payload] = notificationsService.sendPushNotification.mock
        .calls[0] as [string, { title: string }];
      expect(payload.title).not.toContain('⚠️');
    });

    it('sin admins con token, no llama a sendPushNotification (y el pedido igual se crea)', async () => {
      usersRepo.find.mockResolvedValue([]);
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));

      const result = await service.create(userId, { ...dto, addressId });

      expect(notificationsService.sendPushNotification).not.toHaveBeenCalled();
      expect(result.status).toBe(OrderStatus.PENDIENTE);
    });

    it('notifica a TODOS los admins con token (no solo al primero)', async () => {
      usersRepo.find.mockResolvedValue([
        { id: 'admin-1', role: UserRole.ADMIN, fcmToken: 'token-1' },
        { id: 'admin-2', role: UserRole.ADMIN, fcmToken: 'token-2' },
      ]);
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));

      await service.create(userId, { ...dto, addressId });

      expect(notificationsService.sendPushNotification).toHaveBeenCalledTimes(
        2,
      );
      const calledIds =
        notificationsService.sendPushNotification.mock.calls.map(
          (call) => (call as unknown[])[0] as string,
        );
      expect(calledIds).toEqual(['admin-1', 'admin-2']);
    });

    it('si sendPushNotification falla (best-effort), la creación del pedido no se ve afectada', async () => {
      usersRepo.find.mockResolvedValue([
        { id: 'admin-1', role: UserRole.ADMIN, fcmToken: 'token-admin-1' },
      ]);
      notificationsService.sendPushNotification.mockResolvedValue(false);
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));

      const result = await service.create(userId, { ...dto, addressId });
      expect(result.status).toBe(OrderStatus.PENDIENTE);
    });
  });

  describe('findMyOrders', () => {
    it('busca los pedidos del usuario con sus items', async () => {
      ordersRepo.find.mockResolvedValue([seedOrder()]);
      const result = await service.findMyOrders(userId);
      expect(ordersRepo.find).toHaveBeenCalledWith({
        where: { userId },
        relations: { items: true },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findAll', () => {
    it('devuelve pedidos paginados', async () => {
      ordersRepo.findAndCount.mockResolvedValue([[seedOrder()], 1]);
      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(result.items).toHaveLength(1);
    });

    it('carga la relación user (phone/fullName) además de items', async () => {
      ordersRepo.findAndCount.mockResolvedValue([[seedOrder()], 1]);
      await service.findAll({ page: 1, limit: 10 });
      expect(ordersRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ relations: { items: true, user: true } }),
      );
    });

    it('filtra por estado si se indica', async () => {
      ordersRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.findAll({
        page: 1,
        limit: 10,
        status: OrderStatus.CONFIRMADO,
      });
      expect(ordersRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: OrderStatus.CONFIRMADO } }),
      );
    });

    it('filtra por userId cuando se pasa el query param', async () => {
      ordersRepo.findAndCount.mockResolvedValue([[seedOrder()], 1]);
      const result = await service.findAll({ page: 1, limit: 10, userId });
      expect(ordersRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          take: 10,
          skip: 0,
        }),
      );
      expect(result.meta.total).toBe(1);
    });

    it('combina el filtro por userId con el de status', async () => {
      ordersRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.findAll({
        page: 1,
        limit: 10,
        userId,
        status: OrderStatus.PENDIENTE,
      });
      expect(ordersRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, status: OrderStatus.PENDIENTE },
        }),
      );
    });

    it('sin userId no agrega el filtro (comportamiento previo intacto)', async () => {
      ordersRepo.findAndCount.mockResolvedValue([[seedOrder()], 1]);
      await service.findAll({ page: 1, limit: 10 });
      expect(ordersRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          take: 10,
          skip: 0,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('lanza 404 si el pedido no existe', async () => {
      ordersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.findOne('x', { userId, role: UserRole.CLIENTE.valueOf() }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza 403 si un cliente intenta ver un pedido ajeno', async () => {
      ordersRepo.findOne.mockResolvedValue(seedOrder({ userId: otherUserId }));
      await expect(
        service.findOne('one-1', { userId, role: UserRole.CLIENTE.valueOf() }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('el cliente ve su propio pedido', async () => {
      ordersRepo.findOne.mockResolvedValue(seedOrder());
      const result = await service.findOne('one-1', {
        userId,
        role: UserRole.CLIENTE.valueOf(),
      });
      expect(result.id).toBeDefined();
    });

    it('el admin ve cualquier pedido', async () => {
      ordersRepo.findOne.mockResolvedValue(seedOrder({ userId: otherUserId }));
      const result = await service.findOne('one-1', {
        userId,
        role: UserRole.ADMIN.valueOf(),
      });
      expect(result.userId).toBe(otherUserId);
    });

    it('carga la relación user (phone/fullName) además de items', async () => {
      ordersRepo.findOne.mockResolvedValue(seedOrder());
      await service.findOne('one-1', {
        userId,
        role: UserRole.CLIENTE.valueOf(),
      });
      expect(ordersRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'one-1' },
        relations: { items: true, user: true },
      });
    });
  });

  describe('updateStatus', () => {
    const setupTransaction = (order: Order, user: User) => {
      const manager = {
        findOne: jest.fn((entity: EntityTarget<ObjectLiteral>) => {
          if (entity === Order) return Promise.resolve(order);
          if (entity === User) return Promise.resolve(user);
          return Promise.resolve(null);
        }),
        save: jest.fn((_entity: unknown, value: unknown) =>
          Promise.resolve(value),
        ),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      );
      return manager;
    };

    it('lanza 404 si el pedido no existe', async () => {
      const manager = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      );
      await expect(
        service.updateStatus('x', { status: OrderStatus.CONFIRMADO }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza 400 si la transición es inválida (pendiente → entregado)', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      setupTransaction(seedOrder(), user);
      await expect(
        service.updateStatus('one-1', { status: OrderStatus.ENTREGADO }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza 400 si la transición es inválida (entregado → cancelado)', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      setupTransaction(seedOrder({ status: OrderStatus.ENTREGADO }), user);
      await expect(
        service.updateStatus('one-1', { status: OrderStatus.CANCELADO }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('incrementa totalSpent al pasar a entregado (caso numérico real)', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      const order = seedOrder({ status: OrderStatus.EN_CAMINO, total: 59.7 });
      const manager = setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.ENTREGADO,
      });

      expect(result.status).toBe(OrderStatus.ENTREGADO);
      expect(user.totalSpent).toBe(159.7); // 100 + 59.7
      expect(manager.save).toHaveBeenCalledWith(User, user);
    });

    it('dispara checkAndGenerateForUser tras entregar (módulo de cupones)', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      const order = seedOrder({ status: OrderStatus.EN_CAMINO, total: 59.7 });
      setupTransaction(order, user);

      await service.updateStatus('one-1', { status: OrderStatus.ENTREGADO });

      expect(couponsService.checkAndGenerateForUser).toHaveBeenCalledWith(
        userId,
      );
    });

    it('no dispara el check de cupones si no es entregado', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      await service.updateStatus('one-1', { status: OrderStatus.CONFIRMADO });

      expect(couponsService.checkAndGenerateForUser).not.toHaveBeenCalled();
    });

    it('no toca totalSpent en transiciones que no son entregado', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      await service.updateStatus('one-1', { status: OrderStatus.CONFIRMADO });

      expect(user.totalSpent).toBe(100);
    });

    it('reintentar entregado lanza 400 y no vuelve a sumar totalSpent', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      // El pedido ya fue entregado (primera vez ya sumó el total).
      const order = seedOrder({ status: OrderStatus.ENTREGADO, total: 59.7 });
      const manager = setupTransaction(order, user);

      await expect(
        service.updateStatus('one-1', { status: OrderStatus.ENTREGADO }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(user.totalSpent).toBe(100); // no se acumuló de nuevo
      expect(manager.save).not.toHaveBeenCalledWith(User, user);
    });

    it('permite cancelar desde pendiente', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.CANCELADO,
      });
      expect(result.status).toBe(OrderStatus.CANCELADO);
    });

    it('reactiva el cupón del pedido al cancelarlo (dentro de la transacción)', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      const manager = setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.CANCELADO,
      });

      expect(couponsService.reactivateForCancelledOrder).toHaveBeenCalledWith(
        manager,
        order.id,
      );
      expect(result.status).toBe(OrderStatus.CANCELADO);
    });

    it('cancelar un pedido sin cupón no rompe nada', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.CANCELADO,
      });

      expect(result.status).toBe(OrderStatus.CANCELADO);
    });

    it('no reactiva el cupón en transiciones que no son cancelado', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      await service.updateStatus('one-1', {
        status: OrderStatus.CONFIRMADO,
      });

      expect(couponsService.reactivateForCancelledOrder).not.toHaveBeenCalled();
    });

    it('notifica al cliente el nuevo estado tras el cambio', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      await service.updateStatus('one-1', { status: OrderStatus.CONFIRMADO });

      const [calledUserId, payload] = notificationsService.sendPushNotification
        .mock.calls[0] as [
        string,
        { title: string; data: Record<string, string> },
      ];
      expect(calledUserId).toBe(userId);
      expect(payload.title).toContain('confirmado');
      expect(payload.data).toEqual({
        orderId: order.id,
        status: OrderStatus.CONFIRMADO,
      });
    });

    it('no rompe el PATCH si el usuario no tiene token (sendPush devuelve false)', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);
      notificationsService.sendPushNotification.mockResolvedValue(false);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.CONFIRMADO,
      });

      expect(result.status).toBe(OrderStatus.CONFIRMADO);
    });
  });
});
