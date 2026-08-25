import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/entities/user.entity';
import { RewardRedemption } from './entities/reward-redemption.entity';
import { StarPromotion } from './entities/star-promotion.entity';
import { RewardsService } from './rewards.service';

describe('RewardsService', () => {
  let service: RewardsService;
  let rewardRedemptionsRepo: { find: jest.Mock };
  let menuItemsRepo: { find: jest.Mock };
  let dataSource: {
    manager: { find: jest.Mock };
    transaction: jest.Mock;
  };
  let settingsService: {
    getSolesPorEstrella: jest.Mock;
    getEstrellasPorPremio: jest.Mock;
  };

  const userId = 'user-1';

  const seedOrder = (overrides: Partial<Order> = {}) =>
    ({
      id: 'order-1',
      userId,
      status: OrderStatus.ENTREGADO,
      deliveredAt: new Date('2026-08-10T15:00:00.000Z'),
      createdAt: new Date('2026-08-09T15:00:00.000Z'),
      items: [{ subtotal: 30 }, { subtotal: 20 }],
      ...overrides,
    }) as unknown as Order;

  const seedPromotion = (overrides: Partial<StarPromotion> = {}) =>
    ({
      id: 'promo-1',
      label: 'Doble estrella',
      multiplier: 2,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      active: true,
      ...overrides,
    }) as StarPromotion;

  /** Manager mock para dataSource.transaction (recalculateForUser). */
  const setupTransaction = (options: {
    user?: User | null;
    orders?: Order[];
    promotions?: StarPromotion[];
    alreadyGenerated?: number;
  }) => {
    const manager = {
      findOne: jest.fn((entity: unknown) => {
        if (entity === User) return Promise.resolve(options.user ?? null);
        return Promise.resolve(null);
      }),
      find: jest.fn((entity: unknown) => {
        if (entity === Order) return Promise.resolve(options.orders ?? []);
        if (entity === StarPromotion)
          return Promise.resolve(options.promotions ?? []);
        return Promise.resolve([]);
      }),
      count: jest.fn().mockResolvedValue(options.alreadyGenerated ?? 0),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      save: jest.fn((_entity: unknown, value: unknown) =>
        Promise.resolve(value),
      ),
    };
    dataSource.transaction.mockImplementation(
      (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
    );
    return manager;
  };

  beforeEach(async () => {
    rewardRedemptionsRepo = { find: jest.fn() };
    menuItemsRepo = { find: jest.fn() };
    dataSource = {
      manager: { find: jest.fn() },
      transaction: jest.fn(),
    };
    settingsService = {
      getSolesPorEstrella: jest.fn().mockResolvedValue(10),
      getEstrellasPorPremio: jest.fn().mockResolvedValue(10),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RewardsService,
        {
          provide: getRepositoryToken(RewardRedemption),
          useValue: rewardRedemptionsRepo,
        },
        { provide: getRepositoryToken(MenuItem), useValue: menuItemsRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get(RewardsService);
  });

  describe('getCatalog', () => {
    it('filtra por redeemableWithStars y available', async () => {
      menuItemsRepo.find.mockResolvedValue([
        {
          id: 'a',
          name: 'Papas',
          description: null,
          price: 5,
          image: null,
        },
      ]);

      const result = await service.getCatalog();

      expect(menuItemsRepo.find).toHaveBeenCalledWith({
        where: { redeemableWithStars: true, available: true },
        order: { name: 'ASC' },
      });
      expect(result).toEqual([
        { id: 'a', name: 'Papas', description: null, price: 5, image: null },
      ]);
    });
  });

  describe('getProgress', () => {
    it('calcula las estrellas del mes sin promoción activa (multiplicador 1)', async () => {
      // S/50 gastados este mes / 10 soles-por-estrella = 5 estrellas.
      dataSource.manager.find.mockImplementation((entity: unknown) => {
        if (entity === Order) return Promise.resolve([seedOrder()]);
        if (entity === StarPromotion) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      rewardRedemptionsRepo.find.mockResolvedValue([]);

      const result = await service.getProgress(userId);

      expect(result.estrellasParaProximoPremio).toBe(5);
      expect(result.estrellasPorPremio).toBe(10);
      expect(result.promocionActiva).toBeNull();
    });

    it('pesa el subtotal con el multiplicador de la promoción activa el día del pedido', async () => {
      // 50 * 2 (promo) = 100 soles pesados / 10 = 10 estrellas → 10 % 10 = 0
      dataSource.manager.find.mockImplementation((entity: unknown) => {
        if (entity === Order) return Promise.resolve([seedOrder()]);
        if (entity === StarPromotion) return Promise.resolve([seedPromotion()]);
        return Promise.resolve([]);
      });
      rewardRedemptionsRepo.find.mockResolvedValue([]);

      const result = await service.getProgress(userId);

      expect(result.estrellasParaProximoPremio).toBe(0);
    });

    it('no aplica el multiplicador si el pedido fue hecho fuera del rango de la promoción', async () => {
      dataSource.manager.find.mockImplementation((entity: unknown) => {
        if (entity === Order)
          return Promise.resolve([
            seedOrder({ createdAt: new Date('2026-07-15T15:00:00.000Z') }),
          ]);
        if (entity === StarPromotion) return Promise.resolve([seedPromotion()]); // vigente en agosto, no en julio
        return Promise.resolve([]);
      });
      rewardRedemptionsRepo.find.mockResolvedValue([]);

      const result = await service.getProgress(userId);

      expect(result.estrellasParaProximoPremio).toBe(5); // sin pesar (multiplicador 1)
    });

    it('devuelve promocionActiva solo si la fecha de hoy cae dentro de su rango', async () => {
      const today = new Date();
      const iso = today.toISOString().slice(0, 10);
      dataSource.manager.find.mockImplementation((entity: unknown) => {
        if (entity === Order) return Promise.resolve([]);
        if (entity === StarPromotion)
          return Promise.resolve([
            seedPromotion({ startDate: iso, endDate: iso }),
          ]);
        return Promise.resolve([]);
      });
      rewardRedemptionsRepo.find.mockResolvedValue([]);

      const result = await service.getProgress(userId);

      expect(result.promocionActiva).toEqual({
        label: 'Doble estrella',
        multiplier: 2,
        endDate: iso,
      });
    });

    it('lista solo los premios sin usar y sin vencer, ordenados por expiresAt', async () => {
      dataSource.manager.find.mockResolvedValue([]);
      rewardRedemptionsRepo.find.mockResolvedValue([
        { id: 'r1', expiresAt: new Date('2026-09-01T00:00:00.000Z') },
      ]);

      const result = await service.getProgress(userId);

      expect(rewardRedemptionsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { expiresAt: 'ASC' } }),
      );
      expect(result.premiosDisponibles).toEqual([
        { id: 'r1', expiresAt: new Date('2026-09-01T00:00:00.000Z') },
      ]);
    });
  });

  describe('recalculateForUser', () => {
    it('no hace nada si el usuario no existe', async () => {
      const manager = setupTransaction({ user: null });
      await service.recalculateForUser(userId);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('genera un premio al llegar a las estrellas necesarias', async () => {
      // S/100 gastados / 10 = 10 estrellas / 10 por premio = 1 premio.
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [
          seedOrder({ items: [{ subtotal: 60 }, { subtotal: 40 }] as never }),
        ],
        alreadyGenerated: 0,
      });

      await service.recalculateForUser(userId);

      expect(manager.save).toHaveBeenCalledWith(
        RewardRedemption,
        expect.arrayContaining([
          expect.objectContaining({ userId, usedAt: null, menuItemId: null }),
        ]),
      );
      const savedRewards = manager.save.mock.calls[0][1] as unknown[];
      expect(savedRewards).toHaveLength(1);
    });

    it('genera más de un premio de una sola vez si el pedido es grande', async () => {
      // S/300 / 10 = 30 estrellas / 10 = 3 premios en una sola pasada.
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [seedOrder({ items: [{ subtotal: 300 }] as never })],
        alreadyGenerated: 0,
      });

      await service.recalculateForUser(userId);

      const savedRewards = manager.save.mock.calls[0][1] as unknown[];
      expect(savedRewards).toHaveLength(3);
    });

    it('no regenera premios ya contados este mes', async () => {
      // 1 premio calculado, pero ya se generó 1 este mes → no crea otro.
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [seedOrder({ items: [{ subtotal: 100 }] as never })],
        alreadyGenerated: 1,
      });

      await service.recalculateForUser(userId);

      expect(manager.save).not.toHaveBeenCalledWith(
        RewardRedemption,
        expect.anything(),
      );
    });

    it('no genera nada si no se alcanzó el umbral de estrellas', async () => {
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [seedOrder({ items: [{ subtotal: 5 }] as never })],
        alreadyGenerated: 0,
      });

      await service.recalculateForUser(userId);

      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('validateForOrder', () => {
    const menuItemId = 'menu-item-1';
    const rewardRedemptionId = 'reward-1';

    const setupManager = (options: {
      redemption?: Partial<RewardRedemption> | null;
      menuItem?: Partial<MenuItem> | null;
    }) => ({
      findOne: jest.fn((entity: unknown) => {
        if (entity === RewardRedemption) {
          return Promise.resolve(
            options.redemption === undefined
              ? {
                  id: rewardRedemptionId,
                  userId,
                  usedAt: null,
                  expiresAt: new Date(Date.now() + 1000 * 60 * 60),
                }
              : options.redemption,
          );
        }
        if (entity === MenuItem) {
          return Promise.resolve(
            options.menuItem === undefined
              ? { id: menuItemId, redeemableWithStars: true }
              : options.menuItem,
          );
        }
        return Promise.resolve(null);
      }),
    });

    it('rechaza si el premio no existe', async () => {
      const manager = setupManager({ redemption: null });
      await expect(
        service.validateForOrder(manager as never, {
          rewardRedemptionId,
          userId,
          menuItemId,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si el premio es de otro usuario', async () => {
      const manager = setupManager({
        redemption: {
          id: rewardRedemptionId,
          userId: 'other-user',
          usedAt: null,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      });
      await expect(
        service.validateForOrder(manager as never, {
          rewardRedemptionId,
          userId,
          menuItemId,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si el premio ya fue usado', async () => {
      const manager = setupManager({
        redemption: {
          id: rewardRedemptionId,
          userId,
          usedAt: new Date(),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      });
      await expect(
        service.validateForOrder(manager as never, {
          rewardRedemptionId,
          userId,
          menuItemId,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si el premio ya expiró', async () => {
      const manager = setupManager({
        redemption: {
          id: rewardRedemptionId,
          userId,
          usedAt: null,
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await expect(
        service.validateForOrder(manager as never, {
          rewardRedemptionId,
          userId,
          menuItemId,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si el producto no es canjeable con estrellas', async () => {
      const manager = setupManager({
        menuItem: { id: menuItemId, redeemableWithStars: false },
      });
      await expect(
        service.validateForOrder(manager as never, {
          rewardRedemptionId,
          userId,
          menuItemId,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('acepta un premio válido y lo devuelve sin marcarlo usado', async () => {
      const manager = setupManager({});
      const result = await service.validateForOrder(manager as never, {
        rewardRedemptionId,
        userId,
        menuItemId,
      });
      expect(result.id).toBe(rewardRedemptionId);
      expect(result.usedAt).toBeNull();
    });
  });

  describe('markUsed / reactivateForCancelledOrder', () => {
    it('markUsed marca usedAt, usedInOrderId y menuItemId', async () => {
      const manager = { save: jest.fn().mockResolvedValue(undefined) };
      const redemption = {
        id: 'r1',
        usedAt: null,
        usedInOrderId: null,
        menuItemId: null,
      } as unknown as RewardRedemption;

      await service.markUsed(manager as never, redemption, 'order-1', 'item-1');

      expect(redemption.usedAt).not.toBeNull();
      expect(redemption.usedInOrderId).toBe('order-1');
      expect(redemption.menuItemId).toBe('item-1');
      expect(manager.save).toHaveBeenCalledWith(RewardRedemption, redemption);
    });

    it('reactivateForCancelledOrder revierte TODOS los premios usados por ese pedido', async () => {
      const redemptions = [
        {
          id: 'r1',
          usedAt: new Date(),
          usedInOrderId: 'order-1',
          menuItemId: 'a',
        },
        {
          id: 'r2',
          usedAt: new Date(),
          usedInOrderId: 'order-1',
          menuItemId: 'b',
        },
      ] as unknown as RewardRedemption[];
      const manager = {
        find: jest.fn().mockResolvedValue(redemptions),
        save: jest.fn().mockResolvedValue(undefined),
      };

      await service.reactivateForCancelledOrder(manager as never, 'order-1');

      for (const redemption of redemptions) {
        expect(redemption.usedAt).toBeNull();
        expect(redemption.usedInOrderId).toBeNull();
        expect(redemption.menuItemId).toBeNull();
      }
      expect(manager.save).toHaveBeenCalledWith(RewardRedemption, redemptions);
    });

    it('reactivateForCancelledOrder no hace nada si el pedido no canjeó ningún premio', async () => {
      const manager = {
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn(),
      };

      await service.reactivateForCancelledOrder(manager as never, 'order-1');

      expect(manager.save).not.toHaveBeenCalled();
    });
  });
});
