import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/entities/user.entity';
import { limaWallClockDate } from '../../common/utils/lima-time.util';
import { RewardMilestone } from './entities/reward-milestone.entity';
import { RewardRedemption } from './entities/reward-redemption.entity';
import { StarPromotion } from './entities/star-promotion.entity';
import { RewardsService } from './rewards.service';

describe('RewardsService', () => {
  let service: RewardsService;
  let rewardRedemptionsRepo: { find: jest.Mock };
  let rewardMilestonesRepo: { find: jest.Mock };
  let menuItemsRepo: { find: jest.Mock };
  let dataSource: {
    manager: { find: jest.Mock };
    transaction: jest.Mock;
  };
  let settingsService: {
    getSolesPorEstrella: jest.Mock;
  };

  const userId = 'user-1';

  const seedMilestone = (overrides: Partial<RewardMilestone> = {}) =>
    ({
      id: 'milestone-1',
      starsRequired: 10,
      isSpecial: false,
      ...overrides,
    }) as RewardMilestone;

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
    alreadyGranted?: RewardRedemption[];
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
        if (entity === RewardRedemption)
          return Promise.resolve(options.alreadyGranted ?? []);
        return Promise.resolve([]);
      }),
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
    rewardMilestonesRepo = { find: jest.fn().mockResolvedValue([]) };
    menuItemsRepo = { find: jest.fn() };
    dataSource = {
      manager: { find: jest.fn() },
      transaction: jest.fn(),
    };
    settingsService = {
      getSolesPorEstrella: jest.fn().mockResolvedValue(10),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RewardsService,
        {
          provide: getRepositoryToken(RewardRedemption),
          useValue: rewardRedemptionsRepo,
        },
        {
          provide: getRepositoryToken(RewardMilestone),
          useValue: rewardMilestonesRepo,
        },
        { provide: getRepositoryToken(MenuItem), useValue: menuItemsRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get(RewardsService);
  });

  describe('getCatalog', () => {
    it('sin especial: filtra solo por redeemableWithStars, sin importar available', async () => {
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
        where: { redeemableWithStars: true },
        order: { name: 'ASC' },
      });
      expect(result).toEqual([
        { id: 'a', name: 'Papas', description: null, price: 5, image: null },
      ]);
    });

    it('con especial=true: filtra solo por specialReward, catálogo EXCLUYENTE, sin importar available', async () => {
      menuItemsRepo.find.mockResolvedValue([
        {
          id: 'b',
          name: 'Combo especial',
          description: null,
          price: 20,
          image: null,
        },
      ]);

      const result = await service.getCatalog(true);

      expect(menuItemsRepo.find).toHaveBeenCalledWith({
        where: { specialReward: true },
        order: { name: 'ASC' },
      });
      expect(result).toEqual([
        {
          id: 'b',
          name: 'Combo especial',
          description: null,
          price: 20,
          image: null,
        },
      ]);
    });

    it('producto EXCLUSIVO del programa (available=false, redeemableWithStars=true) aparece en el catálogo', async () => {
      menuItemsRepo.find.mockResolvedValue([
        {
          id: 'c',
          name: 'Pieza de pollo con papas',
          description: null,
          price: 0,
          image: null,
          available: false,
          redeemableWithStars: true,
        },
      ]);

      const result = await service.getCatalog();

      expect(menuItemsRepo.find).toHaveBeenCalledWith({
        where: { redeemableWithStars: true },
        order: { name: 'ASC' },
      });
      expect(result).toEqual([
        {
          id: 'c',
          name: 'Pieza de pollo con papas',
          description: null,
          price: 0,
          image: null,
        },
      ]);
    });
  });

  describe('getProgress', () => {
    it('devuelve estrellasDelMes y el estado alcanzado/no de cada hito', async () => {
      // S/50 gastados este mes / 10 soles-por-estrella = 5 estrellas.
      rewardMilestonesRepo.find.mockResolvedValue([
        seedMilestone({ starsRequired: 5, isSpecial: false }),
        seedMilestone({ starsRequired: 8, isSpecial: false }),
        seedMilestone({ starsRequired: 15, isSpecial: true }),
      ]);
      dataSource.manager.find.mockImplementation((entity: unknown) => {
        if (entity === Order) return Promise.resolve([seedOrder()]);
        if (entity === StarPromotion) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      rewardRedemptionsRepo.find.mockResolvedValue([]);

      const result = await service.getProgress(userId);

      expect(result.estrellasDelMes).toBe(5);
      expect(result.hitos).toEqual([
        { estrellasRequeridas: 5, alcanzado: true, esEspecial: false },
        { estrellasRequeridas: 8, alcanzado: false, esEspecial: false },
        { estrellasRequeridas: 15, alcanzado: false, esEspecial: true },
      ]);
      expect(result.promocionActiva).toBeNull();
    });

    it('pesa el subtotal con el multiplicador de la promoción activa el día del pedido', async () => {
      // 50 * 2 (promo) = 100 soles pesados / 10 = 10 estrellas.
      rewardMilestonesRepo.find.mockResolvedValue([
        seedMilestone({ starsRequired: 10 }),
      ]);
      dataSource.manager.find.mockImplementation((entity: unknown) => {
        if (entity === Order) return Promise.resolve([seedOrder()]);
        if (entity === StarPromotion) return Promise.resolve([seedPromotion()]);
        return Promise.resolve([]);
      });
      rewardRedemptionsRepo.find.mockResolvedValue([]);

      const result = await service.getProgress(userId);

      expect(result.estrellasDelMes).toBe(10);
      expect(result.hitos[0].alcanzado).toBe(true);
    });

    it('no aplica el multiplicador si el pedido fue hecho fuera del rango de la promoción', async () => {
      rewardMilestonesRepo.find.mockResolvedValue([]);
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

      expect(result.estrellasDelMes).toBe(5); // sin pesar (multiplicador 1)
    });

    it('devuelve promocionActiva solo si la fecha de hoy cae dentro de su rango', async () => {
      // "Hoy" según la hora de pared de Lima (UTC-5), igual que el servicio real
      // (RewardsService usa limaWallClockDate). Con toISOString() esto fallaba de
      // forma determinística entre las 00:00 y las 04:59 UTC (7pm–11:59pm en Lima),
      // cuando la fecha UTC ya avanzó un día y la de Lima todavía no.
      const { year, month, day } = limaWallClockDate();
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      rewardMilestonesRepo.find.mockResolvedValue([]);
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

    it('lista solo los premios sin usar y sin vencer, ordenados por expiresAt, con esEspecial por premio', async () => {
      rewardMilestonesRepo.find.mockResolvedValue([]);
      dataSource.manager.find.mockResolvedValue([]);
      rewardRedemptionsRepo.find.mockResolvedValue([
        {
          id: 'r1',
          expiresAt: new Date('2026-09-01T00:00:00.000Z'),
          isSpecial: true,
        },
      ]);

      const result = await service.getProgress(userId);

      expect(rewardRedemptionsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { expiresAt: 'ASC' } }),
      );
      expect(result.premiosDisponibles).toEqual([
        {
          id: 'r1',
          expiresAt: new Date('2026-09-01T00:00:00.000Z'),
          esEspecial: true,
        },
      ]);
    });
  });

  describe('recalculateForUser', () => {
    it('no hace nada si el usuario no existe', async () => {
      const manager = setupTransaction({ user: null });
      await service.recalculateForUser(userId);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('otorga un premio al alcanzar un único hito', async () => {
      rewardMilestonesRepo.find.mockResolvedValue([
        seedMilestone({ starsRequired: 10, isSpecial: false }),
      ]);
      // S/100 gastados / 10 = 10 estrellas → alcanza el hito de 10.
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [
          seedOrder({ items: [{ subtotal: 60 }, { subtotal: 40 }] as never }),
        ],
      });

      await service.recalculateForUser(userId);

      expect(manager.save).toHaveBeenCalledWith(
        RewardRedemption,
        expect.arrayContaining([
          expect.objectContaining({
            userId,
            usedAt: null,
            menuItemId: null,
            milestoneStars: 10,
            isSpecial: false,
          }),
        ]),
      );
      const savedRewards = manager.save.mock.calls[0][1] as unknown[];
      expect(savedRewards).toHaveLength(1);
    });

    it('otorga TODOS los hitos alcanzados en una sola pasada (hitos irregulares 5/8/15, 20 estrellas de una)', async () => {
      rewardMilestonesRepo.find.mockResolvedValue([
        seedMilestone({ starsRequired: 5, isSpecial: false }),
        seedMilestone({ starsRequired: 8, isSpecial: false }),
        seedMilestone({ starsRequired: 15, isSpecial: true }),
      ]);
      // S/200 / 10 = 20 estrellas → cruza los 3 hitos de una.
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [seedOrder({ items: [{ subtotal: 200 }] as never })],
      });

      await service.recalculateForUser(userId);

      const savedRewards = manager.save.mock.calls[0][1] as {
        milestoneStars: number;
        isSpecial: boolean;
      }[];
      expect(savedRewards).toHaveLength(3);
      expect(
        savedRewards.map((r) => r.milestoneStars).sort((a, b) => a - b),
      ).toEqual([5, 8, 15]);
      expect(savedRewards.find((r) => r.milestoneStars === 15)!.isSpecial).toBe(
        true,
      );
      expect(savedRewards.find((r) => r.milestoneStars === 5)!.isSpecial).toBe(
        false,
      );
    });

    it('el excedente sobre el hito más alto no genera nada extra (tope de un tablero por mes)', async () => {
      rewardMilestonesRepo.find.mockResolvedValue([
        seedMilestone({ starsRequired: 5 }),
        seedMilestone({ starsRequired: 8 }),
        seedMilestone({ starsRequired: 15 }),
      ]);
      // S/1000 / 10 = 100 estrellas, muy por encima del hito más alto (15):
      // sigue otorgando solo los 3 hitos configurados, nunca más.
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [seedOrder({ items: [{ subtotal: 1000 }] as never })],
      });

      await service.recalculateForUser(userId);

      const savedRewards = manager.save.mock.calls[0][1] as unknown[];
      expect(savedRewards).toHaveLength(3);
    });

    it('no regenera un hito ya otorgado este mes (idempotente, llamar 2 veces no duplica)', async () => {
      rewardMilestonesRepo.find.mockResolvedValue([
        seedMilestone({ starsRequired: 10 }),
      ]);
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [seedOrder({ items: [{ subtotal: 100 }] as never })],
        alreadyGranted: [{ milestoneStars: 10 } as RewardRedemption],
      });

      await service.recalculateForUser(userId);

      expect(manager.save).not.toHaveBeenCalledWith(
        RewardRedemption,
        expect.anything(),
      );
    });

    it('otorga solo los hitos NUEVOS cuando algunos ya fueron otorgados este mes', async () => {
      rewardMilestonesRepo.find.mockResolvedValue([
        seedMilestone({ starsRequired: 5 }),
        seedMilestone({ starsRequired: 8 }),
      ]);
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [seedOrder({ items: [{ subtotal: 80 }] as never })], // 8 estrellas
        alreadyGranted: [{ milestoneStars: 5 } as RewardRedemption],
      });

      await service.recalculateForUser(userId);

      const savedRewards = manager.save.mock.calls[0][1] as {
        milestoneStars: number;
      }[];
      expect(savedRewards).toHaveLength(1);
      expect(savedRewards[0].milestoneStars).toBe(8);
    });

    it('no genera nada si no se alcanzó ningún hito', async () => {
      rewardMilestonesRepo.find.mockResolvedValue([
        seedMilestone({ starsRequired: 10 }),
      ]);
      const manager = setupTransaction({
        user: { id: userId } as User,
        orders: [seedOrder({ items: [{ subtotal: 5 }] as never })],
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
                  isSpecial: false,
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

    it('premio normal (isSpecial=false): rechaza si el producto no es redeemableWithStars', async () => {
      const manager = setupManager({
        redemption: {
          id: rewardRedemptionId,
          userId,
          usedAt: null,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          isSpecial: false,
        },
        menuItem: { id: menuItemId, redeemableWithStars: false },
      });
      await expect(
        service.validateForOrder(manager as never, {
          rewardRedemptionId,
          userId,
          menuItemId,
        }),
      ).rejects.toThrow(
        'El producto seleccionado no es canjeable con estrellas',
      );
    });

    it('premio normal (isSpecial=false): acepta un producto specialReward=true pero redeemableWithStars=false NO (catálogos excluyentes)', async () => {
      const manager = setupManager({
        redemption: {
          id: rewardRedemptionId,
          userId,
          usedAt: null,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          isSpecial: false,
        },
        menuItem: {
          id: menuItemId,
          redeemableWithStars: false,
          specialReward: true,
        },
      });
      await expect(
        service.validateForOrder(manager as never, {
          rewardRedemptionId,
          userId,
          menuItemId,
        }),
      ).rejects.toThrow(
        'El producto seleccionado no es canjeable con estrellas',
      );
    });

    it('premio especial (isSpecial=true): rechaza si el producto no es specialReward, aunque sea redeemableWithStars', async () => {
      const manager = setupManager({
        redemption: {
          id: rewardRedemptionId,
          userId,
          usedAt: null,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          isSpecial: true,
        },
        menuItem: {
          id: menuItemId,
          redeemableWithStars: true,
          specialReward: false,
        },
      });
      await expect(
        service.validateForOrder(manager as never, {
          rewardRedemptionId,
          userId,
          menuItemId,
        }),
      ).rejects.toThrow(
        'El producto seleccionado no es parte del catálogo del premio especial',
      );
    });

    it('premio especial (isSpecial=true): acepta un producto specialReward=true', async () => {
      const manager = setupManager({
        redemption: {
          id: rewardRedemptionId,
          userId,
          usedAt: null,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          isSpecial: true,
        },
        menuItem: {
          id: menuItemId,
          redeemableWithStars: false,
          specialReward: true,
        },
      });
      const result = await service.validateForOrder(manager as never, {
        rewardRedemptionId,
        userId,
        menuItemId,
      });
      expect(result.id).toBe(rewardRedemptionId);
    });

    it('acepta un premio normal válido y lo devuelve sin marcarlo usado', async () => {
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
