import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityTarget, In, IsNull, ObjectLiteral } from 'typeorm';
import { CouponsService } from '../coupons/coupons.service';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RewardsService } from '../rewards/rewards.service';
import { SettingsService } from '../settings/settings.service';
import { Address } from '../users/entities/address.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { GeoapifyService } from './geoapify.service';
import { OrdersService } from './orders.service';
import * as geoUtil from '../../common/utils/geo.util';

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
    update: jest.Mock;
  };
  let orderItemsRepo: { create: jest.Mock };
  let menuItemsRepo: { find: jest.Mock };
  let addressesRepo: { findOne: jest.Mock };
  let usersRepo: { findOne: jest.Mock; find: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let configService: { get: jest.Mock };
  let geoapifyService: { geocode: jest.Mock };
  let couponsService: {
    applyToOrder: jest.Mock;
    markUsed: jest.Mock;
    checkAndGenerateForUser: jest.Mock;
    reactivateForCancelledOrder: jest.Mock;
    findCodeUsedInOrder: jest.Mock;
  };
  let rewardsService: {
    validateForOrder: jest.Mock;
    markUsed: jest.Mock;
    reactivateForCancelledOrder: jest.Mock;
    recalculateForUser: jest.Mock;
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

  /** Referencia mínima de una bebida/porción extra ofrecida (id+name+price, con precio). */
  const pricedRef = (id: string, name: string, price: number) =>
    ({ id, name, price }) as MenuItem['beverages'][number];

  const menuMenuItem = (
    overrides: Partial<
      Omit<MenuItem, 'sauces' | 'beverages' | 'extraPortions'>
    > & {
      sauces?: { id: string; name: string }[];
      beverages?: { id: string; name: string; price: number }[];
      extraPortions?: { id: string; name: string; price: number }[];
    } = {},
  ) =>
    ({
      id: menuItemId,
      name: 'Celtas Clásica',
      price: 24.9,
      available: true,
      ...overrides,
      sauces: overrides.sauces?.map((s) => sauceRef(s.id, s.name)),
      beverages: overrides.beverages?.map((b) =>
        pricedRef(b.id, b.name, b.price),
      ),
      extraPortions: overrides.extraPortions?.map((e) =>
        pricedRef(e.id, e.name, e.price),
      ),
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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
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
      findCodeUsedInOrder: jest.fn().mockResolvedValue(null),
    };
    rewardsService = {
      validateForOrder: jest.fn(),
      markUsed: jest.fn().mockResolvedValue(undefined),
      reactivateForCancelledOrder: jest.fn().mockResolvedValue(undefined),
      recalculateForUser: jest.fn().mockResolvedValue(undefined),
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
    // Nunca pegarle a Geoapify real desde un test unitario (rate limit compartido).
    geoapifyService = { geocode: jest.fn() };

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
        { provide: RewardsService, useValue: rewardsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: SettingsService, useValue: settingsService },
        { provide: GeoapifyService, useValue: geoapifyService },
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

  describe('create — bebidas y porciones extras (SÍ tienen precio y afectan el subtotal)', () => {
    beforeEach(() => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
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

    it('suma el precio de la bebida elegida al subtotal, una vez por unidad (quantity > 1)', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          price: 24.9,
          beverages: [{ id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 }],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [
          {
            menuItemId,
            quantity: 2,
            beverageIds: ['bev-coca'],
          },
        ],
      });

      // (24.9 + 5) * 2 = 59.8, NO (24.9 * 2) + 5 = 54.8
      expect(result.items[0].subtotal).toBe(59.8);
      expect(result.total).toBe(59.8);
      expect(result.items[0].selectedBeverages).toEqual([
        { name: 'Coca-Cola 500ml', price: 5 },
      ]);
    });

    it('suma el precio de la porción extra elegida al subtotal, una vez por unidad', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          price: 24.9,
          extraPortions: [
            { id: 'extra-papas', name: 'Porción extra de papas', price: 8 },
          ],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 3, extraPortionIds: ['extra-papas'] }],
      });

      // (24.9 + 8) * 3 = 98.7
      expect(result.items[0].subtotal).toBe(98.7);
      expect(result.items[0].selectedExtraPortions).toEqual([
        { name: 'Porción extra de papas', price: 8 },
      ]);
    });

    it('combina múltiples bebidas Y múltiples porciones extras a la vez en el mismo ítem', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          price: 20,
          beverages: [
            { id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 },
            { id: 'bev-inca', name: 'Inca Kola 500ml', price: 5.5 },
          ],
          extraPortions: [
            { id: 'extra-papas', name: 'Papas extra', price: 8 },
            { id: 'extra-queso', name: 'Queso extra', price: 3.5 },
          ],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [
          {
            menuItemId,
            quantity: 1,
            beverageIds: ['bev-coca', 'bev-inca'],
            extraPortionIds: ['extra-papas', 'extra-queso'],
          },
        ],
      });

      // 20 + 5 + 5.5 + 8 + 3.5 = 42
      expect(result.items[0].subtotal).toBe(42);
      expect(result.items[0].selectedBeverages).toEqual([
        { name: 'Coca-Cola 500ml', price: 5 },
        { name: 'Inca Kola 500ml', price: 5.5 },
      ]);
      expect(result.items[0].selectedExtraPortions).toEqual([
        { name: 'Papas extra', price: 8 },
        { name: 'Queso extra', price: 3.5 },
      ]);
    });

    it('bebida gratis en el combo (includeFreeTo con este menuItemId): precio 0 en el subtotal', async () => {
      menuItemsRepo.find.mockResolvedValue([
        {
          ...menuMenuItem({ price: 24.9 }),
          beverages: [
            {
              id: 'bev-coca',
              name: 'Coca-Cola 1.5L',
              price: 8,
              includeFreeTo: [menuItemId],
            },
          ],
        },
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 2, beverageIds: ['bev-coca'] }],
      });

      // (24.9 + 0) * 2 = 49.8, no (24.9 + 8) * 2 — el combo la incluye gratis.
      expect(result.items[0].subtotal).toBe(49.8);
      expect(result.items[0].selectedBeverages).toEqual([
        { name: 'Coca-Cola 1.5L', price: 0 },
      ]);
    });

    it('la misma bebida SÍ cobra su precio normal en un producto que no está en su includeFreeTo', async () => {
      menuItemsRepo.find.mockResolvedValue([
        {
          ...menuMenuItem({ price: 24.9 }),
          beverages: [
            {
              id: 'bev-coca',
              name: 'Coca-Cola 1.5L',
              price: 8,
              includeFreeTo: ['otro-combo-id'],
            },
          ],
        },
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 1, beverageIds: ['bev-coca'] }],
      });

      expect(result.items[0].subtotal).toBe(32.9);
      expect(result.items[0].selectedBeverages).toEqual([
        { name: 'Coca-Cola 1.5L', price: 8 },
      ]);
    });

    it('sin beverageIds/extraPortionIds, el snapshot queda null y el subtotal no cambia (no-regresión)', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          price: 24.9,
          beverages: [{ id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 }],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 2 }],
      });

      expect(result.items[0].selectedBeverages).toBeNull();
      expect(result.items[0].selectedExtraPortions).toBeNull();
      expect(result.items[0].subtotal).toBe(49.8); // 24.9 * 2, sin bebida
    });

    it('con beverageIds: [] explícito, el snapshot queda [] (no null) y el subtotal no suma nada', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          price: 24.9,
          beverages: [{ id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 }],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 2, beverageIds: [] }],
      });

      expect(result.items[0].selectedBeverages).toEqual([]);
      expect(result.items[0].selectedBeverages).not.toBeNull();
      expect(result.items[0].subtotal).toBe(49.8);
    });

    it('lanza 400 si el beverageId no está entre las bebidas que el producto ofrece', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          beverages: [{ id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 }],
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [
            { menuItemId, quantity: 1, beverageIds: ['bev-inexistente'] },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza 400 si el extraPortionId no está entre las porciones extras que el producto ofrece', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          extraPortions: [{ id: 'extra-papas', name: 'Papas extra', price: 8 }],
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [
            {
              menuItemId,
              quantity: 1,
              extraPortionIds: ['extra-inexistente'],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('el mensaje de WhatsApp lista las bebidas/extras elegidos con su precio', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          price: 24.9,
          beverages: [{ id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 }],
          extraPortions: [{ id: 'extra-papas', name: 'Papas extra', price: 8 }],
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [
          {
            menuItemId,
            quantity: 1,
            beverageIds: ['bev-coca'],
            extraPortionIds: ['extra-papas'],
          },
        ],
      });

      const message = decodeURIComponent(
        result.whatsappUrl.replace('https://wa.me/51999999999?text=', ''),
      );
      expect(message).toContain('Bebidas: Coca-Cola 500ml +S/5.00');
      expect(message).toContain('Extras: Papas extra +S/8.00');
    });
  });

  describe('create — validación de OptionGroup (sauceGroupRequired/Max, beverageGroupRequired/Max, extraPortionsGroupRequired/Max)', () => {
    beforeEach(() => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
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

    // [QA] Fija el texto EXACTO de los mensajes de grupo previos a "tipo de papas":
    // el refactor de validateGroupSelection a label {one, many} no debe cambiarlos.
    it.each([
      [
        'salsa requerida',
        {
          sauces: [{ id: 's1', name: 'Mayo' }],
          sauceGroupRequired: true,
        },
        {},
        'El producto "Celtas Clásica" requiere elegir al menos una salsa',
      ],
      [
        'salsa máximo',
        {
          sauces: [
            { id: 's1', name: 'Mayo' },
            { id: 's2', name: 'Ají' },
          ],
          sauceGroupMaxSelectable: 1,
        },
        { sauceIds: ['s1', 's2'] },
        'El producto "Celtas Clásica" permite elegir como máximo 1 salsa(s)',
      ],
      [
        'bebida requerida',
        {
          beverages: [{ id: 'b1', name: 'Coca', price: 5 }],
          beverageGroupRequired: true,
        },
        {},
        'El producto "Celtas Clásica" requiere elegir al menos una bebida',
      ],
      [
        'bebida máximo',
        {
          beverages: [
            { id: 'b1', name: 'Coca', price: 5 },
            { id: 'b2', name: 'Inca', price: 5 },
          ],
          beverageGroupMaxSelectable: 1,
        },
        { beverageIds: ['b1', 'b2'] },
        'El producto "Celtas Clásica" permite elegir como máximo 1 bebida(s)',
      ],
      [
        'porción extra requerida',
        {
          extraPortions: [{ id: 'e1', name: 'Queso', price: 3 }],
          extraPortionsGroupRequired: true,
        },
        {},
        'El producto "Celtas Clásica" requiere elegir al menos una porción extra',
      ],
      [
        'porción extra máximo',
        {
          extraPortions: [
            { id: 'e1', name: 'Queso', price: 3 },
            { id: 'e2', name: 'Tocino', price: 4 },
          ],
          extraPortionsGroupMaxSelectable: 1,
        },
        { extraPortionIds: ['e1', 'e2'] },
        'El producto "Celtas Clásica" permite elegir como máximo 1 porción extra(s)',
      ],
    ])(
      '[QA] mensaje exacto sin cambios: %s',
      async (_label, overrides, item, expectedMessage) => {
        menuItemsRepo.find.mockResolvedValue([menuMenuItem(overrides)]);

        const error: unknown = await service
          .create(userId, {
            addressId,
            items: [{ menuItemId, quantity: 1, ...item }],
          })
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toBe(expectedMessage);
      },
    );

    it('grupo de bebidas obligatorio (required=true) + beverageIds omitido → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          beverages: [{ id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 }],
          beverageGroupRequired: true,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('grupo de bebidas obligatorio + beverageIds: [] explícito (tampoco cuenta) → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          beverages: [{ id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 }],
          beverageGroupRequired: true,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1, beverageIds: [] }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('grupo de bebidas obligatorio, pero el producto no ofrece ninguna bebida → sin efecto, no lanza', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ beverages: [], beverageGroupRequired: true }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 1 }],
      });

      expect(result.items[0].selectedBeverages).toBeNull();
    });

    it('beverageGroupMaxSelectable=1 + 2 beverageIds elegidos → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          beverages: [
            { id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 },
            { id: 'bev-inca', name: 'Inca Kola 500ml', price: 5.5 },
          ],
          beverageGroupMaxSelectable: 1,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [
            {
              menuItemId,
              quantity: 1,
              beverageIds: ['bev-coca', 'bev-inca'],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('beverageGroupMaxSelectable=2 + 2 beverageIds elegidos (justo en el límite) → no lanza', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          beverages: [
            { id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 },
            { id: 'bev-inca', name: 'Inca Kola 500ml', price: 5.5 },
          ],
          beverageGroupMaxSelectable: 2,
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [
          { menuItemId, quantity: 1, beverageIds: ['bev-coca', 'bev-inca'] },
        ],
      });

      expect(result.items[0].selectedBeverages).toHaveLength(2);
    });

    it('grupo de porciones extras obligatorio + extraPortionIds omitido → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          extraPortions: [{ id: 'extra-papas', name: 'Papas extra', price: 8 }],
          extraPortionsGroupRequired: true,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('extraPortionsGroupMaxSelectable=1 + 2 extraPortionIds elegidos → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          extraPortions: [
            { id: 'extra-papas', name: 'Papas extra', price: 8 },
            { id: 'extra-queso', name: 'Queso extra', price: 3.5 },
          ],
          extraPortionsGroupMaxSelectable: 1,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [
            {
              menuItemId,
              quantity: 1,
              extraPortionIds: ['extra-papas', 'extra-queso'],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('grupo de salsas obligatorio (required=true) + sauceIds omitido → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          sauces: [{ id: 'sauce-mayo', name: 'Mayonesa' }],
          sauceGroupRequired: true,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('grupo de salsas obligatorio + sauceIds: [] explícito (tampoco cuenta) → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          sauces: [{ id: 'sauce-mayo', name: 'Mayonesa' }],
          sauceGroupRequired: true,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1, sauceIds: [] }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('grupo de salsas obligatorio, pero el producto no ofrece ninguna salsa → sin efecto, no lanza', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ sauces: [], sauceGroupRequired: true }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 1 }],
      });

      expect(result.items[0].selectedSauces).toBeNull();
    });

    it('sauceGroupMaxSelectable=1 + 2 sauceIds elegidos → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          sauces: [
            { id: 'sauce-mayo', name: 'Mayonesa' },
            { id: 'sauce-ketchup', name: 'Ketchup' },
          ],
          sauceGroupMaxSelectable: 1,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [
            {
              menuItemId,
              quantity: 1,
              sauceIds: ['sauce-mayo', 'sauce-ketchup'],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sauceGroupMaxSelectable=2 + 2 sauceIds elegidos (justo en el límite) → no lanza', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          sauces: [
            { id: 'sauce-mayo', name: 'Mayonesa' },
            { id: 'sauce-ketchup', name: 'Ketchup' },
          ],
          sauceGroupMaxSelectable: 2,
        }),
      ]);

      const result = await service.create(userId, {
        addressId,
        items: [
          {
            menuItemId,
            quantity: 1,
            sauceIds: ['sauce-mayo', 'sauce-ketchup'],
          },
        ],
      });

      expect(result.items[0].selectedSauces).toEqual(['Mayonesa', 'Ketchup']);
    });

    it.each([5, 10])(
      'sauceGroupMaxSelectable=null (sin límite) + %i sauceIds → no lanza',
      async (count) => {
        const sauces = Array.from({ length: count }, (_, i) => ({
          id: `sauce-${i + 1}`,
          name: `Salsa ${i + 1}`,
        }));
        menuItemsRepo.find.mockResolvedValue([
          menuMenuItem({ sauces, sauceGroupMaxSelectable: null }),
        ]);

        const result = await service.create(userId, {
          addressId,
          items: [
            {
              menuItemId,
              quantity: 1,
              sauceIds: sauces.map((s) => s.id),
            },
          ],
        });

        expect(result.items[0].selectedSauces).toHaveLength(count);
      },
    );

    it('sauceGroupMaxSelectable=null NO desactiva sauceGroupRequired → 400 si no elige ninguna', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          sauces: [{ id: 'sauce-mayo', name: 'Mayonesa' }],
          sauceGroupRequired: true,
          sauceGroupMaxSelectable: null,
        }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1, sauceIds: [] }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create — tipo de papas (friesTypeIds)', () => {
    const FRITAS = {
      id: 'fries-fritas',
      name: 'Papas fritas',
      isDefault: true,
    };
    const HILO = { id: 'fries-hilo', name: 'Papas al hilo', isDefault: false };
    const burgerWithFries = (
      overrides: Partial<
        Pick<MenuItem, 'friesTypeGroupRequired' | 'friesTypeGroupMaxSelectable'>
      > = {},
    ) =>
      menuMenuItem({
        friesTypes: [FRITAS, HILO] as MenuItem['friesTypes'],
        friesTypeGroupRequired: false,
        friesTypeGroupMaxSelectable: 1,
        ...overrides,
      });
    const order = (item: Record<string, unknown>) =>
      service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 1, ...item }],
      });
    const whatsappText = (url: string) =>
      decodeURIComponent(url.replace('https://wa.me/51999999999?text=', ''));

    beforeEach(() => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
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

    it('friesTypeIds válido → snapshot con el nombre y línea "(Papas: …)" en WhatsApp; no cambia el precio', async () => {
      menuItemsRepo.find.mockResolvedValue([burgerWithFries()]);

      const result = await order({ friesTypeIds: [HILO.id] });

      expect(result.items[0].selectedFriesTypes).toEqual(['Papas al hilo']);
      expect(result.items[0].subtotal).toBe(24.9);
      expect(whatsappText(result.whatsappUrl)).toContain(
        '1x Celtas Clásica (Papas: Papas al hilo)',
      );
    });

    it('friesTypeIds omitido (app vieja) + grupo NO obligatorio → 201, snapshot null y sin línea de papas', async () => {
      menuItemsRepo.find.mockResolvedValue([burgerWithFries()]);

      const result = await order({});

      expect(result.items[0].selectedFriesTypes).toBeNull();
      expect(whatsappText(result.whatsappUrl)).not.toContain('Papas:');
    });

    it('friesTypeIds: [] explícito → snapshot [] (no null)', async () => {
      menuItemsRepo.find.mockResolvedValue([burgerWithFries()]);

      const result = await order({ friesTypeIds: [] });

      expect(result.items[0].selectedFriesTypes).toEqual([]);
    });

    it('tipo que el producto no ofrece → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([burgerWithFries()]);

      await expect(order({ friesTypeIds: ['fries-otro'] })).rejects.toThrow(
        'El producto "Celtas Clásica" no ofrece el tipo de papas seleccionado',
      );
    });

    it.each([
      ['omitido', {}],
      ['[] explícito', { friesTypeIds: [] }],
    ])('friesTypeGroupRequired + %s → 400', async (_label, item) => {
      menuItemsRepo.find.mockResolvedValue([
        burgerWithFries({ friesTypeGroupRequired: true }),
      ]);

      await expect(order(item)).rejects.toThrow(
        'El producto "Celtas Clásica" requiere elegir al menos un tipo de papas',
      );
    });

    it('friesTypeGroupMaxSelectable=1 + fritas y al hilo → 400', async () => {
      menuItemsRepo.find.mockResolvedValue([burgerWithFries()]);

      await expect(
        order({ friesTypeIds: [FRITAS.id, HILO.id] }),
      ).rejects.toThrow('permite elegir como máximo 1 tipo(s) de papas');
    });

    it('[QA] friesTypeIds: [] explícito → WhatsApp sin línea de papas (ni "Papas: )" vacío)', async () => {
      menuItemsRepo.find.mockResolvedValue([burgerWithFries()]);

      const result = await order({ friesTypeIds: [] });
      const text = whatsappText(result.whatsappUrl);

      expect(text).not.toContain('Papas:');
      expect(text).not.toContain('null');
      expect(text).toContain('  • 1x Celtas Clásica\n');
    });

    it('[QA] WhatsApp: papas justo después del nombre, antes de salsas y nota; respeta el orden enviado', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          friesTypes: [FRITAS, HILO] as MenuItem['friesTypes'],
          friesTypeGroupRequired: false,
          friesTypeGroupMaxSelectable: 2,
          sauces: [{ id: 'sauce-mayo', name: 'Mayonesa' }],
        }),
      ]);

      const result = await order({
        friesTypeIds: [HILO.id, FRITAS.id],
        sauceIds: ['sauce-mayo'],
        comment: 'Bien cocida',
      });

      expect(result.items[0].selectedFriesTypes).toEqual([
        'Papas al hilo',
        'Papas fritas',
      ]);
      expect(whatsappText(result.whatsappUrl)).toContain(
        '  • 1x Celtas Clásica (Papas: Papas al hilo, Papas fritas) (Salsas: Mayonesa) — Nota: Bien cocida',
      );
    });

    it('producto sin tipos de papas: friesTypeGroupRequired no aplica (no hay nada que elegir)', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          friesTypes: [] as MenuItem['friesTypes'],
          friesTypeGroupRequired: true,
        }),
      ]);

      await expect(order({})).resolves.toBeDefined();
    });
  });

  describe('create — bebidas/extras combinadas con canje de premio (rewardRedemptionId)', () => {
    const rewardRedemptionId = '55555555-5555-4555-8555-555555555555';

    beforeEach(() => {
      addressesRepo.findOne.mockResolvedValue(seedAddress());
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

    it('el precio de la bebida SÍ se cobra aunque el producto base esté canjeado a 0 (el premio no cubre extras)', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({
          price: 24.9,
          redeemableWithStars: true,
          beverages: [{ id: 'bev-coca', name: 'Coca-Cola 500ml', price: 5 }],
        }),
      ]);
      rewardsService.validateForOrder.mockResolvedValue({
        id: rewardRedemptionId,
        usedAt: null,
      });

      const result = await service.create(userId, {
        addressId,
        items: [
          {
            menuItemId,
            quantity: 1,
            rewardRedemptionId,
            beverageIds: ['bev-coca'],
          },
        ],
      });

      expect(result.items[0].unitPrice).toBe(0);
      // unitPrice forzado a 0, pero la bebida SÍ suma: (0 + 5) * 1 = 5, no 0.
      expect(result.items[0].subtotal).toBe(5);
      expect(result.items[0].selectedBeverages).toEqual([
        { name: 'Coca-Cola 500ml', price: 5 },
      ]);
    });
  });

  describe('create — canje de premios (programa de estrellas)', () => {
    const rewardRedemptionId = '44444444-4444-4444-8444-444444444444';

    beforeEach(() => {
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
      addressesRepo.findOne.mockResolvedValue(seedAddress());
    });

    it('fuerza el precio del ítem canjeado a 0, sin importar el price real del producto', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ price: 24.9, redeemableWithStars: true }),
      ]);
      const redemption = { id: rewardRedemptionId, usedAt: null };
      rewardsService.validateForOrder.mockResolvedValue(redemption);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 1, rewardRedemptionId }],
      });

      expect(result.items[0].unitPrice).toBe(0);
      expect(result.items[0].subtotal).toBe(0);
      expect(rewardsService.validateForOrder).toHaveBeenCalledWith(
        expect.anything(),
        { rewardRedemptionId, userId, menuItemId },
      );
      expect(rewardsService.markUsed).toHaveBeenCalledWith(
        expect.anything(),
        redemption,
        result.id,
        menuItemId,
      );
    });

    it('acepta el canje de un producto EXCLUSIVO del programa (available=false, redeemableWithStars=true)', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ available: false, redeemableWithStars: true }),
      ]);
      const redemption = { id: rewardRedemptionId, usedAt: null };
      rewardsService.validateForOrder.mockResolvedValue(redemption);

      const result = await service.create(userId, {
        addressId,
        items: [{ menuItemId, quantity: 1, rewardRedemptionId }],
      });

      expect(result.items[0].unitPrice).toBe(0);
      expect(rewardsService.validateForOrder).toHaveBeenCalledWith(
        expect.anything(),
        { rewardRedemptionId, userId, menuItemId },
      );
    });

    it('lanza 400 si el producto no es canjeable con estrellas (no llega a validar el premio)', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ redeemableWithStars: false }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1, rewardRedemptionId }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rewardsService.validateForOrder).not.toHaveBeenCalled();
    });

    it('lanza 400 si quantity no es 1 en un ítem canjeado', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ redeemableWithStars: true }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 2, rewardRedemptionId }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza 400 si el mismo premio se repite en dos ítems del pedido', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ id: 'a', redeemableWithStars: true }),
        menuMenuItem({ id: 'b', redeemableWithStars: true }),
      ]);

      await expect(
        service.create(userId, {
          addressId,
          items: [
            { menuItemId: 'a', quantity: 1, rewardRedemptionId },
            { menuItemId: 'b', quantity: 1, rewardRedemptionId },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('propaga el error si el premio no es válido (no crea el pedido)', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ redeemableWithStars: true }),
      ]);
      rewardsService.validateForOrder.mockRejectedValue(
        new BadRequestException('Este premio ya fue canjeado'),
      );

      await expect(
        service.create(userId, {
          addressId,
          items: [{ menuItemId, quantity: 1, rewardRedemptionId }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rewardsService.markUsed).not.toHaveBeenCalled();
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

    it('borde de tramo: 120 m exactos cobra S/4 (tramo <=400m), aunque la distancia expuesta se redondee a 100 m', async () => {
      // 120 m al sur del local sobre el meridiano (1° = 2π·6371000/360 m).
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({
          latitude: -12.1631 - 120 / ((2 * Math.PI * 6371000) / 360),
          longitude: -76.97,
        }),
      );
      const result = await service.create(userId, { ...dto, addressId });

      expect(result.deliveryFee).toBe(4);
      expect(result.total).toBe(53.8); // 49.8 + 4
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

  describe('createOrderByAdmin (pedido manual del admin)', () => {
    const customerId = '55555555-5555-4555-8555-555555555555';
    const rewardRedemptionId = '44444444-4444-4444-8444-444444444444';
    const snapshot = JSON.stringify({
      fullAddress: 'Av. Los Héroes 500',
      district: 'San Juan de Miraflores',
      latitude: -12.1631,
      longitude: -76.97,
    });
    const anonDto = {
      customerName: 'Juan Pérez',
      customerPhone: '987 654 321',
      addressSnapshot: snapshot,
      items: [{ menuItemId, quantity: 2 }],
    };
    let manager: { create: jest.Mock; save: jest.Mock };

    /** Mensaje de WhatsApp decodificado + número destino del whatsappUrl. */
    const parseWhatsapp = (url: string) => {
      const parsed = new URL(url);
      return {
        number: parsed.pathname.slice(1),
        text: parsed.searchParams.get('text') ?? '',
      };
    };

    beforeEach(() => {
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);
      orderItemsRepo.create.mockImplementation(passthrough);
      manager = {
        create: jest.fn((_entity: unknown, value: unknown) => value),
        save: jest.fn((_entity: unknown, value: unknown) =>
          Promise.resolve(value),
        ),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      );
    });

    it('anónimo: userId null, contacto guardado (celular normalizado a 51...) y total calculado en el backend', async () => {
      const result = await service.createOrderByAdmin(anonDto);

      expect(result.userId).toBeNull();
      expect(result.customerName).toBe('Juan Pérez');
      expect(result.customerPhone).toBe('51987654321');
      expect(result.status).toBe(OrderStatus.PENDIENTE);
      // 2 × 24.9 = 49.8 + delivery (coords == store_location → primer tramo, S/2).
      expect(result.total).toBe(51.8);
      expect(result.addressSnapshot).toBe(snapshot);
    });

    it('anónimo: whatsappUrl al celular del CLIENTE con encabezado "CONFIRMA TU PEDIDO"', async () => {
      const result = await service.createOrderByAdmin(anonDto);

      const { number, text } = parseWhatsapp(result.whatsappUrl);
      expect(number).toBe('51987654321');
      expect(text).toContain('*CONFIRMA TU PEDIDO #');
      expect(text).not.toContain('NUEVO PEDIDO');
      expect(settingsService.getWhatsappNumber).not.toHaveBeenCalled();
    });

    it.each([
      ['venezolano', '+58 412 999 9999', '584129999999'],
      ['brasileño con 00', '0055 11 99999-9999', '5511999999999'],
    ])(
      'anónimo con celular %s: se guarda con su código de país y el whatsappUrl apunta ahí',
      async (_label, input, expected) => {
        const result = await service.createOrderByAdmin({
          ...anonDto,
          customerPhone: input,
        });

        expect(result.customerPhone).toBe(expected);
        expect(parseWhatsapp(result.whatsappUrl).number).toBe(expected);
      },
    );

    it('NO se bloquea por horario: crea el pedido aunque el local esté cerrado', async () => {
      settingsService.isOpenNow.mockResolvedValue({
        open: false,
        message: 'Cerrado',
      });

      const result = await service.createOrderByAdmin(anonDto);

      expect(result.status).toBe(OrderStatus.PENDIENTE);
      expect(settingsService.isOpenNow).not.toHaveBeenCalled();
    });

    it('con customerId: asocia el pedido al cliente, sin customerName/Phone, y valida su addressId contra ÉL', async () => {
      usersRepo.findOne.mockResolvedValue({
        id: customerId,
        role: UserRole.CLIENTE,
        phone: '+51 912-345-678',
      });
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ userId: customerId }),
      );

      const result = await service.createOrderByAdmin({
        customerId,
        addressId,
        items: [{ menuItemId, quantity: 1 }],
      });

      expect(result.userId).toBe(customerId);
      expect(result.customerName).toBeNull();
      expect(result.customerPhone).toBeNull();
      expect(addressesRepo.findOne).toHaveBeenCalledWith({
        where: { id: addressId, userId: customerId },
      });
      expect(parseWhatsapp(result.whatsappUrl).number).toBe('51912345678');
    });

    it('con customerId sin celular válido: whatsappUrl cae al número del negocio ("NUEVO PEDIDO")', async () => {
      usersRepo.findOne.mockResolvedValue({
        id: customerId,
        role: UserRole.CLIENTE,
        phone: null,
      });

      const result = await service.createOrderByAdmin({
        customerId,
        addressSnapshot: snapshot,
        items: [{ menuItemId, quantity: 1 }],
      });

      const { number, text } = parseWhatsapp(result.whatsappUrl);
      expect(number).toBe('51999999999');
      expect(text).toContain('*NUEVO PEDIDO #');
    });

    it('con customerId: el cupón se valida con el userId del CLIENTE (no del admin)', async () => {
      usersRepo.findOne.mockResolvedValue({
        id: customerId,
        role: UserRole.CLIENTE,
      });
      couponsService.applyToOrder.mockResolvedValue({
        discountedTotal: 44.82,
        coupon: { id: 'c-1', code: 'A1B2C3D4' },
      });

      await service.createOrderByAdmin({
        customerId,
        addressSnapshot: snapshot,
        couponCode: 'A1B2C3D4',
        items: [{ menuItemId, quantity: 2 }],
      });

      expect(couponsService.applyToOrder).toHaveBeenCalledWith(
        expect.anything(),
        { code: 'A1B2C3D4', userId: customerId, subtotal: 49.8 },
      );
    });

    it('customerId de una cuenta admin → 400, sin crear nada', async () => {
      usersRepo.findOne.mockResolvedValue({
        id: customerId,
        role: UserRole.ADMIN,
      });

      await expect(
        service.createOrderByAdmin({
          customerId,
          addressSnapshot: snapshot,
          items: [{ menuItemId, quantity: 1 }],
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'customerId debe ser una cuenta de cliente, no de administrador',
        ),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('customerId inexistente → 404 "Cliente no encontrado", sin crear nada', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createOrderByAdmin({
          customerId,
          addressSnapshot: snapshot,
          items: [{ menuItemId, quantity: 1 }],
        }),
      ).rejects.toThrow(new NotFoundException('Cliente no encontrado'));
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('anónimo con addressId → 400 (sin userId el where no filtraría por dueño)', async () => {
      await expect(
        service.createOrderByAdmin({ ...anonDto, addressId }),
      ).rejects.toThrow(
        new BadRequestException(
          'Un pedido sin cliente no puede usar addressId: envía la dirección en addressSnapshot',
        ),
      );
      expect(addressesRepo.findOne).not.toHaveBeenCalled();
    });

    it('anónimo con couponCode → 400, sin tocar el módulo de cupones', async () => {
      await expect(
        service.createOrderByAdmin({ ...anonDto, couponCode: 'A1B2C3D4' }),
      ).rejects.toThrow(
        new BadRequestException('Un pedido sin cliente no puede usar cupones'),
      );
      expect(couponsService.applyToOrder).not.toHaveBeenCalled();
    });

    it('anónimo con rewardRedemptionId → 400, sin tocar el módulo de premios', async () => {
      menuItemsRepo.find.mockResolvedValue([
        menuMenuItem({ redeemableWithStars: true }),
      ]);

      await expect(
        service.createOrderByAdmin({
          ...anonDto,
          items: [{ menuItemId, quantity: 1, rewardRedemptionId }],
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Un pedido sin cliente no puede canjear premios',
        ),
      );
      expect(rewardsService.validateForOrder).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('sin dirección → 400 (misma regla que POST /orders)', async () => {
      await expect(
        service.createOrderByAdmin({
          ...anonDto,
          addressSnapshot: undefined,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Debes indicar una dirección (addressId o addressSnapshot)',
        ),
      );
    });

    it.each([
      ['nombre solo espacios', { customerName: '   ' }],
      ['celular inválido', { customerPhone: '12345' }],
    ])(
      'anónimo con %s → 400 (defensa en profundidad si el DTO lo dejara pasar)',
      async (_label, override) => {
        await expect(
          service.createOrderByAdmin({ ...anonDto, ...override }),
        ).rejects.toThrow(
          new BadRequestException(
            'Un pedido sin cliente requiere customerName y customerPhone',
          ),
        );
      },
    );

    it('avisa a los admins con push igual que un pedido de la app', async () => {
      usersRepo.find.mockResolvedValue([{ id: 'admin-1' }]);

      const result = await service.createOrderByAdmin(anonDto);

      expect(notificationsService.sendPushNotification).toHaveBeenCalledWith(
        'admin-1',
        expect.objectContaining({
          data: { orderId: result.id, status: OrderStatus.PENDIENTE },
        }),
      );
    });
  });

  describe('getWhatsappLinks / markWhatsappSent (links wa.me, el backend no envía)', () => {
    const orderId = '33333333-3333-4333-8333-333333333333';
    const item = (overrides: Partial<OrderItem> = {}) =>
      ({
        name: 'Celtas Clásica',
        quantity: 2,
        unitPrice: 24.9,
        subtotal: 49.8,
        selectedSauces: null,
        selectedBeverages: null,
        selectedExtraPortions: null,
        selectedFriesTypes: null,
        comment: null,
        ...overrides,
      }) as OrderItem;
    const order = (overrides: Partial<Order> = {}) =>
      seedOrder({
        id: orderId,
        items: [item()],
        total: 49.8,
        deliveryFee: 0,
        whatsappSentAt: null,
        user: { id: userId, phone: '987 654 321' } as User,
        ...overrides,
      });
    const decode = (url: string) => {
      const parsed = new URL(url);
      return {
        number: parsed.pathname.slice(1),
        text: parsed.searchParams.get('text') ?? '',
      };
    };

    it('cliente con celular: link al cliente ("CONFIRMA TU PEDIDO") + link a la tienda ("NUEVO PEDIDO")', async () => {
      ordersRepo.findOne.mockResolvedValue(order());

      const result = await service.getWhatsappLinks(orderId);

      expect(result.customer?.phone).toBe('51987654321');
      const customer = decode(result.customer!.url);
      expect(customer.number).toBe('51987654321');
      expect(customer.text).toContain('*CONFIRMA TU PEDIDO #33333333*');
      expect(customer.text).toContain('2x Celtas Clásica');
      expect(customer.text).toContain('*Total a pagar:* S/ 49.80');

      expect(result.store.phone).toBe('51999999999');
      const store = decode(result.store.url);
      expect(store.number).toBe('51999999999');
      expect(store.text).toContain('*NUEVO PEDIDO #33333333*');
      expect(result.whatsappSentAt).toBeNull();
      expect(ordersRepo.findOne).toHaveBeenCalledWith({
        where: { id: orderId },
        relations: { items: true, user: true },
      });
    });

    it('cliente sin celular válido → customer null, solo queda la tienda', async () => {
      ordersRepo.findOne.mockResolvedValue(
        order({ user: { id: userId, phone: '12345' } as User }),
      );

      const result = await service.getWhatsappLinks(orderId);

      expect(result.customer).toBeNull();
      expect(decode(result.store.url).number).toBe('51999999999');
    });

    it('anónimo: el cliente sale de customerPhone (user null)', async () => {
      ordersRepo.findOne.mockResolvedValue(
        order({
          userId: null,
          user: null,
          customerName: 'Juan Pérez',
          customerPhone: '51912345678',
        }),
      );

      const result = await service.getWhatsappLinks(orderId);

      expect(result.customer?.phone).toBe('51912345678');
      expect(decode(result.customer!.url).number).toBe('51912345678');
    });

    it('rearma el mensaje con el cupón: busca el código y muestra el descuento', async () => {
      // subtotal 49.8, envío 2, total 46.82 → descuento 4.98 (10%).
      ordersRepo.findOne.mockResolvedValue(
        order({ total: 46.82, deliveryFee: 2 }),
      );
      couponsService.findCodeUsedInOrder.mockResolvedValue('A1B2C3D4');

      const result = await service.getWhatsappLinks(orderId);

      const { text } = decode(result.store.url);
      expect(couponsService.findCodeUsedInOrder).toHaveBeenCalledWith(orderId);
      expect(text).toContain('*Cupón (A1B2C3D4):* -S/ 4.98');
      expect(text).toContain('*Envío:* S/ 2.00');
    });

    it('sin descuento no consulta cupones', async () => {
      ordersRepo.findOne.mockResolvedValue(order());

      await service.getWhatsappLinks(orderId);

      expect(couponsService.findCodeUsedInOrder).not.toHaveBeenCalled();
    });

    it('mismo mensaje que al crear el pedido (salvo el encabezado)', async () => {
      menuItemsRepo.find.mockResolvedValue([menuMenuItem()]);
      orderItemsRepo.create.mockImplementation(passthrough);
      dataSource.transaction.mockImplementation(
        (cb: (m: { create: jest.Mock; save: jest.Mock }) => Promise<unknown>) =>
          cb({
            create: jest.fn((_entity: unknown, value: unknown) => value),
            save: jest.fn((_entity: unknown, value: unknown) =>
              Promise.resolve(value),
            ),
          }),
      );
      const created = await service.createOrderByAdmin({
        customerName: 'Juan Pérez',
        customerPhone: '987654321',
        addressSnapshot: JSON.stringify({ fullAddress: 'Av. Los Héroes 500' }),
        items: [{ menuItemId, quantity: 2 }],
      });
      ordersRepo.findOne.mockResolvedValue({
        ...created,
        whatsappSentAt: null,
      });

      const result = await service.getWhatsappLinks(created.id);

      expect(result.customer!.url).toBe(created.whatsappUrl);
    });

    it('pedido inexistente → 404', async () => {
      ordersRepo.findOne.mockResolvedValue(null);

      await expect(service.getWhatsappLinks(orderId)).rejects.toThrow(
        new NotFoundException('Pedido no encontrado'),
      );
      await expect(service.markWhatsappSent(orderId)).rejects.toThrow(
        new NotFoundException('Pedido no encontrado'),
      );
    });

    it('pedido cancelado → 409 en ambos endpoints', async () => {
      ordersRepo.findOne.mockResolvedValue(
        order({ status: OrderStatus.CANCELADO }),
      );

      await expect(service.getWhatsappLinks(orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.markWhatsappSent(orderId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });

    it('markWhatsappSent: guarda whatsappSentAt con update() de la columna sola', async () => {
      ordersRepo.findOne.mockResolvedValue(order());

      const result = await service.markWhatsappSent(orderId);

      expect(result.orderId).toBe(orderId);
      expect(result.whatsappSentAt).toBeInstanceOf(Date);
      expect(ordersRepo.update).toHaveBeenCalledWith(orderId, {
        whatsappSentAt: result.whatsappSentAt,
      });
      expect(ordersRepo.save).not.toHaveBeenCalled();
    });

    it('markWhatsappSent es idempotente: devuelve la PRIMERA fecha sin pisarla', async () => {
      const first = new Date('2026-09-30T20:00:00.000Z');
      ordersRepo.findOne.mockResolvedValue(order({ whatsappSentAt: first }));

      const result = await service.markWhatsappSent(orderId);

      expect(result.whatsappSentAt).toBe(first);
      expect(ordersRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('vincular pedidos anónimos a un cliente (findLinkableAnonymousOrders / linkAnonymousOrders)', () => {
    const customerId = '55555555-5555-4555-8555-555555555555';
    const orderA = '66666666-6666-4666-8666-666666666666';
    const orderB = '77777777-7777-4777-8777-777777777777';
    const customer = (overrides: Partial<User> = {}) =>
      ({
        id: customerId,
        role: UserRole.CLIENTE,
        // Formato libre viejo: normalizePhone lo lleva a 51987654321.
        phone: '+51 987-654-321',
        totalSpent: 100,
        ...overrides,
      }) as User;
    const anon = (id: string, overrides: Partial<Order> = {}) =>
      seedOrder({
        id,
        userId: null,
        customerName: 'Pedro',
        customerPhone: '51987654321',
        status: OrderStatus.ENTREGADO,
        total: 49.8,
        ...overrides,
      });
    let manager: {
      find: jest.Mock;
      update: jest.Mock;
      findOne: jest.Mock;
      save: jest.Mock;
    };
    const setupTx = (orders: Order[], lockedUser: User | null = customer()) => {
      manager = {
        find: jest.fn().mockResolvedValue(orders),
        update: jest.fn().mockResolvedValue({ affected: orders.length }),
        findOne: jest.fn().mockResolvedValue(lockedUser),
        save: jest.fn((_entity: unknown, value: unknown) =>
          Promise.resolve(value),
        ),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      );
    };

    it('preview: busca anónimos por el celular NORMALIZADO del cliente, sin vincular', async () => {
      usersRepo.findOne.mockResolvedValue(customer());
      ordersRepo.find.mockResolvedValue([anon(orderA)]);

      const result = await service.findLinkableAnonymousOrders(customerId);

      expect(result).toEqual({
        userId: customerId,
        phone: '51987654321',
        orders: [anon(orderA)],
      });
      expect(ordersRepo.find).toHaveBeenCalledWith({
        where: { userId: IsNull(), customerPhone: '51987654321' },
        relations: { items: true },
        order: { createdAt: 'DESC' },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('vincula: setea userId, suma SOLO los entregados a totalSpent y recalcula estrellas/cupón', async () => {
      usersRepo.findOne.mockResolvedValue(customer());
      setupTx([
        anon(orderA),
        anon(orderB, { status: OrderStatus.PENDIENTE, total: 30 }),
      ]);

      const result = await service.linkAnonymousOrders(customerId, [
        orderA,
        orderB,
      ]);

      expect(manager.find).toHaveBeenCalledWith(Order, {
        where: { id: In([orderA, orderB]) },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.update).toHaveBeenCalledWith(
        Order,
        { id: In([orderA, orderB]) },
        { userId: customerId },
      );
      expect(manager.save).toHaveBeenCalledWith(
        User,
        expect.objectContaining({ totalSpent: 149.8 }),
      );
      expect(result).toEqual({
        userId: customerId,
        linkedOrderIds: [orderA, orderB],
        deliveredTotalAdded: 49.8,
        totalSpent: 149.8,
      });
      expect(couponsService.checkAndGenerateForUser).toHaveBeenCalledWith(
        customerId,
      );
      expect(rewardsService.recalculateForUser).toHaveBeenCalledWith(
        customerId,
      );
    });

    it('sin entregados: vincula pero no toca totalSpent ni recalcula', async () => {
      usersRepo.findOne.mockResolvedValue(customer());
      setupTx([anon(orderA, { status: OrderStatus.PENDIENTE })]);

      const result = await service.linkAnonymousOrders(customerId, [orderA]);

      expect(result.deliveredTotalAdded).toBe(0);
      expect(result.totalSpent).toBe(100);
      expect(manager.save).not.toHaveBeenCalled();
      expect(rewardsService.recalculateForUser).not.toHaveBeenCalled();
    });

    it.each([
      ['ya tiene cliente', { userId: 'otro-usuario' }],
      ['celular distinto', { customerPhone: '51911111111' }],
    ])(
      'todo o nada: si un pedido %s → 409 y NO se vincula ninguno',
      async (_label, override) => {
        usersRepo.findOne.mockResolvedValue(customer());
        setupTx([anon(orderA), anon(orderB, override)]);

        await expect(
          service.linkAnonymousOrders(customerId, [orderA, orderB]),
        ).rejects.toThrow(ConflictException);
        expect(manager.update).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it('un orderId que no existe → 409 que lo nombra, sin vincular', async () => {
      usersRepo.findOne.mockResolvedValue(customer());
      setupTx([anon(orderA)]);

      await expect(
        service.linkAnonymousOrders(customerId, [orderA, orderB]),
      ).rejects.toThrow(orderB);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it.each([
      [
        'usuario inexistente → 404',
        null,
        new NotFoundException('Usuario no encontrado'),
      ],
      [
        'cuenta admin → 400',
        customer({ role: UserRole.ADMIN }),
        new BadRequestException(
          'Solo se pueden vincular pedidos a una cuenta de cliente',
        ),
      ],
      [
        'cliente sin celular válido → 400',
        customer({ phone: null }),
        new BadRequestException(
          'El cliente no tiene un celular válido: no hay con qué buscar sus pedidos anónimos',
        ),
      ],
    ])('%s (preview y vinculación)', async (_label, user, error) => {
      usersRepo.findOne.mockResolvedValue(user);

      await expect(
        service.findLinkableAnonymousOrders(customerId),
      ).rejects.toThrow(error);
      await expect(
        service.linkAnonymousOrders(customerId, [orderA]),
      ).rejects.toThrow(error);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('geocodeAddress', () => {
    it('dirección válida → [lat, lng] (texto recortado antes de enviarlo)', async () => {
      geoapifyService.geocode.mockResolvedValue([-12.0466994, -77.03041]);

      const result = await service.geocodeAddress('  Jr. Carabaya 250, Lima  ');

      expect(result).toEqual([-12.0466994, -77.03041]);
      expect(result[0]).toBeLessThan(0); // Lima: latitud sur
      expect(geoapifyService.geocode).toHaveBeenCalledWith(
        'Jr. Carabaya 250, Lima',
      );
    });

    it.each(['', '   '])(
      'dirección vacía (%p) → 400 sin llamar a Geoapify',
      async (address) => {
        await expect(service.geocodeAddress(address)).rejects.toThrow(
          new BadRequestException('Dirección es requerida'),
        );
        expect(geoapifyService.geocode).not.toHaveBeenCalled();
      },
    );

    it('dirección sin resultado → 400 "Dirección no encontrada"', async () => {
      geoapifyService.geocode.mockResolvedValue(null);

      await expect(service.geocodeAddress('xyzabc123notreal')).rejects.toThrow(
        new BadRequestException('Dirección no encontrada: "xyzabc123notreal"'),
      );
    });

    it('falla del proveedor (503) se propaga tal cual, no se reescribe a 400', async () => {
      geoapifyService.geocode.mockRejectedValue(
        new ServiceUnavailableException('caído'),
      );

      await expect(
        service.geocodeAddress('Jr. Carabaya 250, Lima'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('estimateDeliveryFee', () => {
    // Mismos store_location/tramos que el describe de create() (mock default de
    // settingsService: { latitude: -12.1631, longitude: -76.97 }).
    const NEAR_COORDS = { latitude: -12.16315, longitude: -76.97005 }; // ~7.77m → tramo 1 (<=100m, S/2)
    const FAR_COORDS = { latitude: -12.19, longitude: -76.95 }; // ~3697.65m → tramo 4, supera el radio de aviso (2500m)

    it('dirección con coordenadas (tramo 1) → deliveryFee, isFarOrder y distanceMeters calculados, sin crear pedido', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));

      const result = await service.estimateDeliveryFee(userId, { addressId });

      expect(result.deliveryFee).toBe(2);
      expect(result.isFarOrder).toBe(false);
      // ~7.77 m exactos; se expone redondeado a múltiplos de 50 m.
      expect(result.distanceMeters).toBe(0);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(addressesRepo.findOne).toHaveBeenCalledWith({
        where: { id: addressId, userId },
      });
    });

    it('dirección lejana → isFarOrder true y deliveryFee del tramo sin techo', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(FAR_COORDS));

      const result = await service.estimateDeliveryFee(userId, { addressId });

      expect(result.deliveryFee).toBe(8);
      expect(result.isFarOrder).toBe(true);
      expect(result.distanceMeters).toBeGreaterThan(2500);
    });

    it('dirección sin coordenadas → deliveryFee 0, isFarOrder false, distanceMeters null (no bloquea)', async () => {
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: null, longitude: null }),
      );

      const result = await service.estimateDeliveryFee(userId, { addressId });

      expect(result).toEqual({
        deliveryFee: 0,
        isFarOrder: false,
        distanceMeters: null,
      });
      expect(settingsService.getStoreLocation).not.toHaveBeenCalled();
    });

    it('dirección inexistente o de otro usuario → NotFoundException (mismo criterio que /users/:id/addresses)', async () => {
      addressesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.estimateDeliveryFee(otherUserId, { addressId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('store_location sin configurar + dirección con coordenadas → NotFoundException', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(NEAR_COORDS));
      settingsService.getStoreLocation.mockRejectedValue(
        new NotFoundException(
          'La ubicación del local todavía no está configurada (setting "store_location")',
        ),
      );

      await expect(
        service.estimateDeliveryFee(userId, { addressId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('computeDelivery — distanceMeters redondeado a 50 m (privacidad del local)', () => {
    // Punto a `meters` metros exactos al sur del local (mock: -12.1631, -76.97).
    // Sobre un meridiano, Haversine da exactamente R·Δφ → 1° = 2π·6371000/360 m.
    const METERS_PER_DEGREE = (2 * Math.PI * 6371000) / 360;
    const pointAt = (meters: number) => ({
      latitude: -12.1631 - meters / METERS_PER_DEGREE,
      longitude: -76.97,
    });

    it.each([
      [0, 0],
      [24, 0],
      [49, 50],
      [51, 50],
      [100, 100],
      [124, 100],
      [380, 400],
    ])(
      '%i m exactos → distanceMeters %i (múltiplo de 50)',
      async (exact, shown) => {
        const result = await service.estimateDeliveryByCoords(pointAt(exact));

        expect(result.distanceMeters).toBe(shown);
        expect(result.distanceMeters! % 50).toBe(0);
      },
    );

    it('la tarifa usa la distancia EXACTA: 120 m se muestra como 100 pero cobra el tramo ≤400 m (S/4), no S/2', async () => {
      const result = await service.estimateDeliveryByCoords(pointAt(120));

      expect(result.distanceMeters).toBe(100);
      expect(result.deliveryFee).toBe(4);
    });

    it('99 m exactos → se muestra 100 y cobra S/2 (sigue dentro del tramo ≤100 m)', async () => {
      const result = await service.estimateDeliveryByCoords(pointAt(99));

      expect(result.distanceMeters).toBe(100);
      expect(result.deliveryFee).toBe(2);
    });

    it('isFarOrder usa la distancia EXACTA: 2510 m se muestra como 2500 pero supera el radio de aviso (2500)', async () => {
      const result = await service.estimateDeliveryByCoords(pointAt(2510));

      expect(result.distanceMeters).toBe(2500);
      expect(result.isFarOrder).toBe(true);
    });

    it('estimateDeliveryFee (mismo computeDelivery que create) cobra con la distancia exacta: 120 m → deliveryFee 4', async () => {
      addressesRepo.findOne.mockResolvedValue(seedAddress(pointAt(120)));
      const result = await service.estimateDeliveryFee(userId, { addressId });

      expect(result.deliveryFee).toBe(4);
    });
  });

  describe('QA — redondeo de distanceMeters no altera lo cobrado (distancia exacta mockeada)', () => {
    // Se mockea haversineDistanceMeters para fijar la distancia EXACTA sin
    // ruido de punto flotante (bordes de tramo 100/400/1000 y radio 2500).
    const dto = { items: [{ menuItemId, quantity: 2 }] };
    let haversineSpy: jest.SpyInstance;

    beforeEach(() => {
      haversineSpy = jest.spyOn(geoUtil, 'haversineDistanceMeters');
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
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: -12.2, longitude: -76.9 }),
      );
    });

    afterEach(() => haversineSpy.mockRestore());

    it.each([
      [0, 2],
      [74.9, 2],
      [75, 2], // se mostraría 100
      [100, 2],
      [100.0001, 4],
      [110, 4], // se mostraría 100 → redondear antes cobraría S/2
      [124.99, 4],
      [375, 4], // se mostraría 400
      [400, 4],
      [400.0001, 6],
      [420, 6], // se mostraría 400 → redondear antes cobraría S/4
      [975, 6],
      [1000, 6],
      [1000.0001, 8],
      [1020, 8], // se mostraría 1000 → redondear antes cobraría S/6
    ])(
      'create(): %d m exactos → deliveryFee %d (cobro con distancia exacta)',
      async (exact, fee) => {
        haversineSpy.mockReturnValue(exact);
        const result = await service.create(userId, { ...dto, addressId });

        expect(result.deliveryFee).toBe(fee);
        expect(result.total).toBe(Math.round((49.8 + fee) * 100) / 100);
      },
    );

    it.each([
      [2475, false],
      [2500, false],
      [2500.0001, true],
      [2520, true], // se mostraría 2500 → redondear antes NO avisaría
    ])(
      'create(): %d m exactos → push de pedido lejano = %s (radio 2500 con distancia exacta)',
      async (exact, far) => {
        haversineSpy.mockReturnValue(exact);
        usersRepo.find.mockResolvedValue([
          { id: 'admin-1', role: UserRole.ADMIN, fcmToken: 'token-admin-1' },
        ]);
        await service.create(userId, { ...dto, addressId });

        const [, payload] = notificationsService.sendPushNotification.mock
          .calls[0] as [string, { title: string }];
        expect(payload.title.includes('fuera de la zona habitual')).toBe(far);
      },
    );

    it.each([
      [0, 0],
      [24.999999, 0],
      [25, 50], // .5 exacto → Math.round sube
      [75, 100],
      [125, 150],
      [2525, 2550],
      [2524.99, 2500],
      [1e-9, 0],
    ])(
      'estimateDeliveryByCoords: %d m exactos → distanceMeters %d',
      async (exact, shown) => {
        haversineSpy.mockReturnValue(exact);
        const result = await service.estimateDeliveryByCoords({
          latitude: -12.2,
          longitude: -76.9,
        });

        expect(result.distanceMeters).toBe(shown);
        expect(Object.is(result.distanceMeters, -0)).toBe(false);
        expect(result.distanceMeters! % 50).toBe(0);
      },
    );

    it('estimateDeliveryFee: mismo fee que create() para 110 m exactos (4) y distanceMeters 100', async () => {
      haversineSpy.mockReturnValue(110);
      const result = await service.estimateDeliveryFee(userId, { addressId });

      expect(result).toEqual({
        deliveryFee: 4,
        isFarOrder: false,
        distanceMeters: 100,
      });
    });

    it('sin coordenadas → distanceMeters null (no 0) y no calcula Haversine', async () => {
      addressesRepo.findOne.mockResolvedValue(
        seedAddress({ latitude: null, longitude: null }),
      );
      const result = await service.estimateDeliveryFee(userId, { addressId });

      expect(result.distanceMeters).toBeNull();
      expect(haversineSpy).not.toHaveBeenCalled();
    });
  });

  describe('estimateDeliveryByCoords', () => {
    it('coordenadas del local → tramo 1 (S/2), distancia 0, sin tocar direcciones ni crear pedido', async () => {
      const result = await service.estimateDeliveryByCoords({
        latitude: -12.1631,
        longitude: -76.97,
      });

      expect(result).toEqual({
        deliveryFee: 2,
        isFarOrder: false,
        distanceMeters: 0,
      });
      expect(addressesRepo.findOne).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('coordenadas lejanas → tramo sin techo (S/8) e isFarOrder true, nunca rechaza', async () => {
      const result = await service.estimateDeliveryByCoords({
        latitude: -12.19,
        longitude: -76.95,
      });

      expect(result.deliveryFee).toBe(8);
      expect(result.isFarOrder).toBe(true);
      expect(result.distanceMeters).toBe(3700); // ~3697.65 m exactos
    });

    it('mismo resultado que estimateDeliveryFee para las mismas coordenadas (cálculo compartido)', async () => {
      const coords = { latitude: -12.1658, longitude: -76.97 }; // ~300 m → S/4
      addressesRepo.findOne.mockResolvedValue(seedAddress(coords));

      const byAddress = await service.estimateDeliveryFee(userId, {
        addressId,
      });
      const byCoords = await service.estimateDeliveryByCoords(coords);

      expect(byCoords).toEqual(byAddress);
      expect(byCoords.deliveryFee).toBe(4);
    });

    it('store_location sin configurar → NotFoundException', async () => {
      settingsService.getStoreLocation.mockRejectedValue(
        new NotFoundException(
          'La ubicación del local todavía no está configurada (setting "store_location")',
        ),
      );

      await expect(
        service.estimateDeliveryByCoords({ latitude: -12.1, longitude: -76.9 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findMyOrders', () => {
    it('busca los pedidos del usuario con sus items, con el límite default (20)', async () => {
      ordersRepo.find.mockResolvedValue([seedOrder()]);
      const result = await service.findMyOrders(userId);
      expect(ordersRepo.find).toHaveBeenCalledWith({
        where: { userId },
        relations: { items: true },
        order: { createdAt: 'DESC' },
        take: 20,
      });
      expect(result).toHaveLength(1);
    });

    it('respeta un límite custom', async () => {
      ordersRepo.find.mockResolvedValue([seedOrder()]);
      await service.findMyOrders(userId, 5);
      expect(ordersRepo.find).toHaveBeenCalledWith({
        where: { userId },
        relations: { items: true },
        order: { createdAt: 'DESC' },
        take: 5,
      });
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

    describe('pedido manual anónimo (userId null)', () => {
      const anonOrder = (status: OrderStatus) =>
        seedOrder({ userId: null, status, customerPhone: '51987654321' });

      it('en_camino → entregado: se entrega (deliveredAt) sin buscar usuario ni tocar totalSpent', async () => {
        const manager = setupTransaction(
          anonOrder(OrderStatus.EN_CAMINO),
          null as unknown as User,
        );

        const result = await service.updateStatus('one-1', {
          status: OrderStatus.ENTREGADO,
        });

        expect(result.status).toBe(OrderStatus.ENTREGADO);
        expect(result.deliveredAt).toBeInstanceOf(Date);
        expect(manager.findOne).not.toHaveBeenCalledWith(
          User,
          expect.anything(),
        );
        expect(manager.save).not.toHaveBeenCalledWith(User, expect.anything());
      });

      it('entregado: no genera cupón, no recalcula estrellas, no manda push al "cliente"', async () => {
        setupTransaction(
          anonOrder(OrderStatus.EN_CAMINO),
          null as unknown as User,
        );

        await service.updateStatus('one-1', { status: OrderStatus.ENTREGADO });

        expect(couponsService.checkAndGenerateForUser).not.toHaveBeenCalled();
        expect(rewardsService.recalculateForUser).not.toHaveBeenCalled();
        expect(
          notificationsService.sendPushNotification,
        ).not.toHaveBeenCalled();
      });

      it('pendiente → confirmado: transiciona sin push', async () => {
        setupTransaction(
          anonOrder(OrderStatus.PENDIENTE),
          null as unknown as User,
        );

        const result = await service.updateStatus('one-1', {
          status: OrderStatus.CONFIRMADO,
        });

        expect(result.status).toBe(OrderStatus.CONFIRMADO);
        expect(
          notificationsService.sendPushNotification,
        ).not.toHaveBeenCalled();
      });
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

    it('dispara recalculateForUser tras entregar (programa de estrellas)', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      const order = seedOrder({ status: OrderStatus.EN_CAMINO, total: 59.7 });
      setupTransaction(order, user);

      await service.updateStatus('one-1', { status: OrderStatus.ENTREGADO });

      expect(rewardsService.recalculateForUser).toHaveBeenCalledWith(userId);
    });

    it('no rompe el PATCH si recalculateForUser falla (best-effort)', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      const order = seedOrder({ status: OrderStatus.EN_CAMINO, total: 59.7 });
      setupTransaction(order, user);
      rewardsService.recalculateForUser.mockRejectedValue(new Error('boom'));

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.ENTREGADO,
      });

      expect(result.status).toBe(OrderStatus.ENTREGADO);
    });

    it('no dispara recalculateForUser si no es entregado', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      await service.updateStatus('one-1', { status: OrderStatus.CONFIRMADO });

      expect(rewardsService.recalculateForUser).not.toHaveBeenCalled();
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

    it('reactiva los premios del programa de estrellas al cancelar (dentro de la transacción)', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      const manager = setupTransaction(order, user);

      await service.updateStatus('one-1', { status: OrderStatus.CANCELADO });

      expect(rewardsService.reactivateForCancelledOrder).toHaveBeenCalledWith(
        manager,
        order.id,
      );
    });

    it('no reactiva premios en transiciones que no son cancelado', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      await service.updateStatus('one-1', { status: OrderStatus.CONFIRMADO });

      expect(rewardsService.reactivateForCancelledOrder).not.toHaveBeenCalled();
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

    it('permite cancelar desde en_camino con motivo (200, motivo guardado, cupón/premio reactivado)', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.EN_CAMINO });
      const manager = setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.CANCELADO,
        cancelReason: 'El cliente ya no se encuentra en la dirección',
      });

      expect(result.status).toBe(OrderStatus.CANCELADO);
      expect(result.cancelReason).toBe(
        'El cliente ya no se encuentra en la dirección',
      );
      expect(couponsService.reactivateForCancelledOrder).toHaveBeenCalledWith(
        manager,
        order.id,
      );
      expect(rewardsService.reactivateForCancelledOrder).toHaveBeenCalledWith(
        manager,
        order.id,
      );
    });

    it('lanza 400 al cancelar desde en_camino sin motivo', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.EN_CAMINO });
      setupTransaction(order, user);

      await expect(
        service.updateStatus('one-1', { status: OrderStatus.CANCELADO }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza 400 al cancelar desde en_camino con motivo vacío/solo espacios', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.EN_CAMINO });
      setupTransaction(order, user);

      await expect(
        service.updateStatus('one-1', {
          status: OrderStatus.CANCELADO,
          cancelReason: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cancelar desde pendiente sin motivo sigue funcionando igual que antes', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.CANCELADO,
      });

      expect(result.status).toBe(OrderStatus.CANCELADO);
      expect(result.cancelReason).toBeUndefined();
    });

    it('cancelar desde confirmado sin motivo sigue funcionando igual que antes', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.CONFIRMADO });
      setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.CANCELADO,
      });

      expect(result.status).toBe(OrderStatus.CANCELADO);
    });

    it('guarda el motivo si viene, aunque la transición sea pendiente→cancelado (no es obligatorio ahí)', async () => {
      const user = { id: userId, totalSpent: 0 } as User;
      const order = seedOrder({ status: OrderStatus.PENDIENTE });
      setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.CANCELADO,
        cancelReason: 'El cliente se arrepintió',
      });

      expect(result.cancelReason).toBe('El cliente se arrepintió');
    });

    it('en_camino→entregado sigue funcionando (la nueva transición a cancelado no la rompe)', async () => {
      const user = { id: userId, totalSpent: 100 } as User;
      const order = seedOrder({ status: OrderStatus.EN_CAMINO, total: 59.7 });
      setupTransaction(order, user);

      const result = await service.updateStatus('one-1', {
        status: OrderStatus.ENTREGADO,
      });

      expect(result.status).toBe(OrderStatus.ENTREGADO);
      expect(user.totalSpent).toBe(159.7);
    });
  });
});
