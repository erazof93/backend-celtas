import {
  BadRequestException,
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
  let usersRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let configService: { get: jest.Mock };
  let couponsService: {
    applyToOrder: jest.Mock;
    markUsed: jest.Mock;
    checkAndGenerateForUser: jest.Mock;
    reactivateForCancelledOrder: jest.Mock;
  };
  let notificationsService: { sendPushNotification: jest.Mock };
  let settingsService: { getWhatsappNumber: jest.Mock };

  const userId = 'user-1';
  const otherUserId = 'user-2';
  const addressId = '11111111-1111-4111-8111-111111111111';
  const menuItemId = '22222222-2222-4222-8222-222222222222';

  const menuMenuItem = (overrides: Partial<MenuItem> = {}) =>
    ({
      id: menuItemId,
      name: 'Celtas Clásica',
      price: 24.9,
      available: true,
      ...overrides,
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
    usersRepo = { findOne: jest.fn() };
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
      expect(result.whatsappUrl).toMatch(/^https:\/\/wa\.me\/51999999999\?text=/);
      const message = decodeURIComponent(
        result.whatsappUrl!.replace('https://wa.me/51999999999?text=', ''),
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
