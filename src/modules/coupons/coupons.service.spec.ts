import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserRole } from '../users/entities/user.entity';
import { CouponsService } from './coupons.service';
import {
  Coupon,
  CouponDiscountType,
  CouponOrigin,
  CouponStatus,
} from './entities/coupon.entity';

/** Mock de repositorio: devuelve el mismo objeto que recibe (identity tipado). */
const passthrough = <T>(value: T): T => value;

describe('CouponsService', () => {
  let service: CouponsService;
  let couponsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    findAndCount: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let usersRepo: { findOne: jest.Mock; find: jest.Mock };
  let ordersRepo: { createQueryBuilder: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let configService: { get: jest.Mock };
  let notificationsService: { sendPushNotification: jest.Mock };

  const userId = 'user-1';
  const otherUserId = 'user-2';

  const seedCoupon = (overrides: Partial<Coupon> = {}) =>
    ({
      id: 'coupon-1',
      userId,
      code: 'A1B2C3D4',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 10,
      minPurchaseAmount: null,
      status: CouponStatus.ACTIVE,
      origin: CouponOrigin.MANUAL,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 15),
      usedAt: null,
      usedInOrderId: null,
      createdAt: new Date(),
      ...overrides,
    }) as Coupon;

  /** Manager mock para dataSource.transaction (checkAndGenerateForUser). */
  const setupTransaction = (options: {
    user?: User | null;
    hasActive?: Coupon | null;
    lastCoupon?: Coupon | null;
    spent?: string;
  }) => {
    const manager = {
      findOne: jest.fn((entity: unknown, query?: { order?: unknown }) => {
        if (entity === User) return Promise.resolve(options.user ?? null);
        if (entity === Coupon) {
          // La consulta de "último cupón" lleva `order`; la de "hay activo" no.
          if (query?.order) {
            return Promise.resolve(options.lastCoupon ?? null);
          }
          return Promise.resolve(options.hasActive ?? null);
        }
        return Promise.resolve(null);
      }),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      save: jest.fn((_entity: unknown, value: unknown) =>
        Promise.resolve(value),
      ),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: options.spent ?? '0' }),
      })),
    };
    dataSource.transaction.mockImplementation(
      (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
    );
    return manager;
  };

  beforeEach(async () => {
    couponsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    usersRepo = { findOne: jest.fn(), find: jest.fn() };
    ordersRepo = { createQueryBuilder: jest.fn() };
    dataSource = { transaction: jest.fn() };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'coupons.thresholdAmount') return 50;
        if (key === 'coupons.expirationDays') return 15;
        return undefined;
      }),
    };
    notificationsService = {
      sendPushNotification: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: getRepositoryToken(Coupon), useValue: couponsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: configService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(CouponsService);
  });

  describe('generateManual', () => {
    it('crea un cupón manual con expiración según config', async () => {
      usersRepo.findOne.mockResolvedValue({ id: userId });
      couponsRepo.create.mockImplementation(passthrough);
      couponsRepo.save.mockImplementation(passthrough);

      const result = await service.generateManual({
        userId,
        discountType: CouponDiscountType.FIXED_AMOUNT,
        discountValue: 15,
      });

      expect(result.userId).toBe(userId);
      expect(result.discountType).toBe(CouponDiscountType.FIXED_AMOUNT);
      expect(result.discountValue).toBe(15);
      expect(result.status).toBe(CouponStatus.ACTIVE);
      expect(result.origin).toBe(CouponOrigin.MANUAL);
      expect(result.code).toMatch(/^[0-9A-F]{8}$/);
      // expiresAt ≈ now + 15 días
      const expected = Date.now() + 15 * 24 * 60 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeGreaterThan(expected - 5000);
      expect(result.expiresAt.getTime()).toBeLessThan(expected + 5000);
    });

    it('crea un cupón manual con mínimo de compra cuando se indica', async () => {
      usersRepo.findOne.mockResolvedValue({ id: userId });
      couponsRepo.create.mockImplementation(passthrough);
      couponsRepo.save.mockImplementation(passthrough);

      const result = await service.generateManual({
        userId,
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 10,
        minPurchaseAmount: 50,
      });

      expect(result.minPurchaseAmount).toBe(50);
      expect(result.origin).toBe(CouponOrigin.MANUAL);
    });

    it('crea un cupón manual sin mínimo cuando no se indica (null)', async () => {
      usersRepo.findOne.mockResolvedValue({ id: userId });
      couponsRepo.create.mockImplementation(passthrough);
      couponsRepo.save.mockImplementation(passthrough);

      const result = await service.generateManual({
        userId,
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 10,
      });

      expect(result.minPurchaseAmount).toBeNull();
    });

    it('lanza 404 si el usuario no existe', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.generateManual({
          userId,
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 10,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza 400 si el porcentaje supera el 100%', async () => {
      usersRepo.findOne.mockResolvedValue({ id: userId });
      await expect(
        service.generateManual({
          userId,
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 150,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('validateCoupon', () => {
    it('devuelve el descuento si el cupón es válido', async () => {
      couponsRepo.findOne.mockResolvedValue(seedCoupon());
      const result = await service.validateCoupon('A1B2C3D4', userId);
      expect(result.valid).toBe(true);
      expect(result.discountType).toBe(CouponDiscountType.PERCENTAGE);
      expect(result.discountValue).toBe(10);
      expect(result.minPurchaseAmount).toBeNull();
      expect(result.description).toBe('10% de descuento');
    });

    it('devuelve el mínimo de compra en la respuesta cuando el cupón lo tiene', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ minPurchaseAmount: 50 }),
      );
      const result = await service.validateCoupon('A1B2C3D4', userId);
      expect(result.valid).toBe(true);
      expect(result.minPurchaseAmount).toBe(50);
    });

    it('rechaza con mensaje claro si el subtotal es menor al mínimo de compra', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ minPurchaseAmount: 50 }),
      );
      await expect(
        service.validateCoupon('A1B2C3D4', userId, 30),
      ).rejects.toThrow('Este cupón requiere un pedido mínimo de S/50.00');
    });

    it('acepta si el subtotal es igual al mínimo de compra', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ minPurchaseAmount: 50 }),
      );
      const result = await service.validateCoupon('A1B2C3D4', userId, 50);
      expect(result.valid).toBe(true);
    });

    it('acepta si el subtotal supera el mínimo de compra', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ minPurchaseAmount: 50 }),
      );
      const result = await service.validateCoupon('A1B2C3D4', userId, 80);
      expect(result.valid).toBe(true);
    });

    it('sin subtotal no valida el mínimo (comportamiento previo intacto)', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ minPurchaseAmount: 50 }),
      );
      const result = await service.validateCoupon('A1B2C3D4', userId);
      expect(result.valid).toBe(true);
    });

    it('minPurchaseAmount = 0 se comporta como sin mínimo (acepta subtotal 0)', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ minPurchaseAmount: 0 }),
      );
      const result = await service.validateCoupon('A1B2C3D4', userId, 0);
      expect(result.valid).toBe(true);
    });

    it('lanza 400 si el cupón no existe', async () => {
      couponsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.validateCoupon('XXXX', userId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza 400 si el cupón es de otro usuario', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ userId: otherUserId }),
      );
      await expect(
        service.validateCoupon('A1B2C3D4', userId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza 400 si el cupón ya fue usado', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ status: CouponStatus.USED }),
      );
      await expect(
        service.validateCoupon('A1B2C3D4', userId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza 400 si el cupón está expirado (fecha pasada)', async () => {
      couponsRepo.findOne.mockResolvedValue(
        seedCoupon({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(
        service.validateCoupon('A1B2C3D4', userId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('applyToOrder / markUsed', () => {
    let manager: { findOne: jest.Mock; save: jest.Mock };

    beforeEach(() => {
      manager = {
        findOne: jest.fn(),
        save: jest.fn((_e: unknown, v: unknown) => Promise.resolve(v)),
      };
    });

    it('aplica descuento porcentual y devuelve el cupón sin marcarlo', async () => {
      const coupon = seedCoupon();
      manager.findOne.mockResolvedValue(coupon);

      const applied = await service.applyToOrder(manager as never, {
        code: 'A1B2C3D4',
        userId,
        subtotal: 100,
      });

      expect(applied.discountedTotal).toBe(90); // 100 - 10%
      expect(applied.coupon).toBe(coupon);
      expect(coupon.status).toBe(CouponStatus.ACTIVE); // aún no usado
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rechaza con mensaje claro si el subtotal es menor al mínimo de compra', async () => {
      manager.findOne.mockResolvedValue(seedCoupon({ minPurchaseAmount: 50 }));
      await expect(
        service.applyToOrder(manager as never, {
          code: 'A1B2C3D4',
          userId,
          subtotal: 30,
        }),
      ).rejects.toThrow('Este cupón requiere un pedido mínimo de S/50.00');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('aplica el descuento si el subtotal supera el mínimo de compra', async () => {
      manager.findOne.mockResolvedValue(seedCoupon({ minPurchaseAmount: 50 }));
      const applied = await service.applyToOrder(manager as never, {
        code: 'A1B2C3D4',
        userId,
        subtotal: 100,
      });
      expect(applied.discountedTotal).toBe(90); // 100 - 10%
    });

    it('aplica el descuento si el subtotal es igual al mínimo de compra', async () => {
      manager.findOne.mockResolvedValue(seedCoupon({ minPurchaseAmount: 50 }));
      const applied = await service.applyToOrder(manager as never, {
        code: 'A1B2C3D4',
        userId,
        subtotal: 50,
      });
      expect(applied.discountedTotal).toBe(45); // 50 - 10%
    });

    it('sin mínimo de compra aplica igual (comportamiento previo intacto)', async () => {
      manager.findOne.mockResolvedValue(seedCoupon());
      const applied = await service.applyToOrder(manager as never, {
        code: 'A1B2C3D4',
        userId,
        subtotal: 10,
      });
      expect(applied.discountedTotal).toBe(9); // 10 - 10%
    });

    it('minPurchaseAmount = 0 aplica igual con subtotal 0', async () => {
      manager.findOne.mockResolvedValue(seedCoupon({ minPurchaseAmount: 0 }));
      const applied = await service.applyToOrder(manager as never, {
        code: 'A1B2C3D4',
        userId,
        subtotal: 0,
      });
      expect(applied.discountedTotal).toBe(0); // 0 - 10% = 0
    });

    it('markUsed marca el cupón como usado con usedInOrderId', async () => {
      const coupon = seedCoupon();
      await service.markUsed(manager as never, coupon, 'order-1');

      expect(coupon.status).toBe(CouponStatus.USED);
      expect(coupon.usedAt).toBeInstanceOf(Date);
      expect(coupon.usedInOrderId).toBe('order-1');
      expect(manager.save).toHaveBeenCalledWith(Coupon, coupon);
    });

    it('aplica descuento de monto fijo', async () => {
      manager.findOne.mockResolvedValue(
        seedCoupon({
          discountType: CouponDiscountType.FIXED_AMOUNT,
          discountValue: 15,
        }),
      );

      const applied = await service.applyToOrder(manager as never, {
        code: 'A1B2C3D4',
        userId,
        subtotal: 100,
      });

      expect(applied.discountedTotal).toBe(85);
    });

    it('el descuento fijo nunca baja de 0', async () => {
      manager.findOne.mockResolvedValue(
        seedCoupon({
          discountType: CouponDiscountType.FIXED_AMOUNT,
          discountValue: 50,
        }),
      );
      const applied = await service.applyToOrder(manager as never, {
        code: 'A1B2C3D4',
        userId,
        subtotal: 10,
      });
      expect(applied.discountedTotal).toBe(0);
    });

    it('el descuento porcentual >100% nunca baja de 0', async () => {
      manager.findOne.mockResolvedValue(
        seedCoupon({
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 150,
        }),
      );
      const applied = await service.applyToOrder(manager as never, {
        code: 'A1B2C3D4',
        userId,
        subtotal: 49.8,
      });
      expect(applied.discountedTotal).toBe(0);
    });

    it('lanza 400 si el cupón está usado', async () => {
      manager.findOne.mockResolvedValue(
        seedCoupon({ status: CouponStatus.USED }),
      );

      await expect(
        service.applyToOrder(manager as never, {
          code: 'A1B2C3D4',
          userId,
          subtotal: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('reactivateForCancelledOrder', () => {
    let manager: { findOne: jest.Mock; save: jest.Mock };

    beforeEach(() => {
      manager = {
        findOne: jest.fn(),
        save: jest.fn((_e: unknown, v: unknown) => Promise.resolve(v)),
      };
    });

    it('reactiva el cupón que canjeó el pedido (active, sin usedInOrderId ni usedAt)', async () => {
      const coupon = seedCoupon({
        status: CouponStatus.USED,
        usedAt: new Date(),
        usedInOrderId: 'order-1',
      });
      manager.findOne.mockResolvedValue(coupon);

      await service.reactivateForCancelledOrder(manager as never, 'order-1');

      expect(manager.findOne).toHaveBeenCalledWith(Coupon, {
        where: { usedInOrderId: 'order-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(coupon.status).toBe(CouponStatus.ACTIVE);
      expect(coupon.usedInOrderId).toBeNull();
      expect(coupon.usedAt).toBeNull();
      expect(manager.save).toHaveBeenCalledWith(Coupon, coupon);
    });

    it('no hace nada si el pedido no canjeó ningún cupón', async () => {
      manager.findOne.mockResolvedValue(null);

      await service.reactivateForCancelledOrder(manager as never, 'order-1');

      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('checkAndGenerateForUser', () => {
    it('no genera si ya hay un cupón automático activo (no duplica)', async () => {
      setupTransaction({
        user: { id: userId } as User,
        hasActive: seedCoupon({ origin: CouponOrigin.AUTO }),
        spent: '200',
      });

      const result = await service.checkAndGenerateForUser(userId);
      expect(result).toBeNull();
    });

    it('no genera si el gasto desde el último cupón no supera el umbral', async () => {
      setupTransaction({ user: { id: userId } as User, spent: '30' });
      const result = await service.checkAndGenerateForUser(userId);
      expect(result).toBeNull();
    });

    it('genera un cupón automático si el gasto supera el umbral', async () => {
      const manager = setupTransaction({
        user: { id: userId } as User,
        spent: '60',
      });

      const result = await service.checkAndGenerateForUser(userId);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(userId);
      expect(result!.origin).toBe(CouponOrigin.AUTO);
      expect(result!.status).toBe(CouponStatus.ACTIVE);
      expect(result!.discountType).toBe(CouponDiscountType.PERCENTAGE);
      expect(result!.minPurchaseAmount).toBeNull(); // los automáticos no llevan mínimo
      expect(result!.code).toMatch(/^[0-9A-F]{8}$/);
      expect(manager.save).toHaveBeenCalled();
    });

    it('suma solo pedidos entregados DESDE el último cupón (corte por fecha)', async () => {
      const lastCoupon = seedCoupon({
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      const manager = setupTransaction({
        user: { id: userId } as User,
        lastCoupon,
        spent: '40',
      });

      await service.checkAndGenerateForUser(userId);

      // El query debe filtrar por createdAt > fecha del último cupón.
      const qb = manager.createQueryBuilder.mock.results[0].value as {
        andWhere: jest.Mock;
      };
      expect(qb.andWhere).toHaveBeenCalledWith('order.createdAt > :since', {
        since: lastCoupon.createdAt,
      });
    });

    it('usa el umbral y los días de expiración desde config', async () => {
      const manager = setupTransaction({
        user: { id: userId } as User,
        spent: '60',
      });
      const result = await service.checkAndGenerateForUser(userId);

      const expected = Date.now() + 15 * 24 * 60 * 60 * 1000;
      expect(result!.expiresAt.getTime()).toBeGreaterThan(expected - 5000);
      expect(result!.expiresAt.getTime()).toBeLessThan(expected + 5000);
      expect(configService.get).toHaveBeenCalledWith('coupons.thresholdAmount');
      expect(configService.get).toHaveBeenCalledWith('coupons.expirationDays');
      void manager;
    });
  });

  describe('findMyCoupons / findAll', () => {
    it('lista los cupones del usuario', async () => {
      couponsRepo.find.mockResolvedValue([seedCoupon()]);
      const result = await service.findMyCoupons(userId);
      expect(couponsRepo.find).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });

    it('lista paginado con filtro por estado', async () => {
      couponsRepo.findAndCount.mockResolvedValue([[seedCoupon()], 1]);
      const result = await service.findAll({ status: CouponStatus.ACTIVE });
      expect(couponsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: CouponStatus.ACTIVE },
          take: 10,
          skip: 0,
        }),
      );
      expect(result.meta.total).toBe(1);
    });

    it('filtra por userId cuando se pasa el query param', async () => {
      couponsRepo.findAndCount.mockResolvedValue([[seedCoupon()], 1]);
      const result = await service.findAll({ userId });
      expect(couponsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          take: 10,
          skip: 0,
        }),
      );
      expect(result.meta.total).toBe(1);
    });

    it('combina el filtro por userId con el de status', async () => {
      couponsRepo.findAndCount.mockResolvedValue([[seedCoupon()], 1]);
      await service.findAll({
        userId,
        status: CouponStatus.ACTIVE,
      });
      expect(couponsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, status: CouponStatus.ACTIVE },
        }),
      );
    });

    it('sin userId no agrega el filtro (comportamiento previo intacto)', async () => {
      couponsRepo.findAndCount.mockResolvedValue([[seedCoupon()], 1]);
      await service.findAll({});
      expect(couponsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          take: 10,
          skip: 0,
        }),
      );
    });
  });

  describe('handleDailyMaintenance (cron)', () => {
    it('expira cupones vencidos y recorre a los clientes', async () => {
      const updateBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      couponsRepo.createQueryBuilder.mockReturnValue(updateBuilder);
      usersRepo.find.mockResolvedValue([
        { id: userId, role: UserRole.CLIENTE } as User,
      ]);
      setupTransaction({ user: { id: userId } as User, spent: '0' });

      await service.handleDailyMaintenance();

      expect(updateBuilder.execute).toHaveBeenCalled();
      expect(usersRepo.find).toHaveBeenCalledWith({
        where: { role: UserRole.CLIENTE },
      });
    });
  });
});
