import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  EntityManager,
  IsNull,
  LessThan,
  MoreThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  limaWallClockDate,
  limaWallClockToUtc,
} from '../../common/utils/lima-time.util';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/entities/user.entity';
import { RewardRedemption } from './entities/reward-redemption.entity';
import { StarPromotion } from './entities/star-promotion.entity';

/** Vigencia de un premio recién ganado: 15 días desde `earnedAt`. */
const REWARD_EXPIRATION_DAYS = 15;

export interface RewardsProgress {
  estrellasParaProximoPremio: number;
  estrellasPorPremio: number;
  premiosDisponibles: { id: string; expiresAt: Date }[];
  promocionActiva: {
    label: string;
    multiplier: number;
    endDate: string;
  } | null;
}

export interface RewardCatalogItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image: string | null;
}

/**
 * Módulo Rewards (programa de "Estrellas").
 * - Por cada S/`soles_por_estrella` de subtotal (sin envío) en pedidos `entregado`
 *   del mes calendario actual (hora de Lima), el cliente gana 1 estrella; al
 *   juntar `estrellas_por_premio` gana un `RewardRedemption` con 15 días de
 *   vigencia. El conteo se reinicia cada mes; los premios ya ganados no se
 *   pierden (no hay cron: el filtro por mes calendario ya logra el efecto).
 * - El subtotal de cada pedido se deriva sumando `OrderItem.subtotal` (snapshot,
 *   ya excluye envío y no se ve afectado por el descuento de un cupón, que se
 *   aplica al total del pedido, no a los ítems) — más preciso que reconstruirlo
 *   desde `order.total`, que sí mezcla envío y descuento.
 * - El multiplicador de una `StarPromotion` activa pesa el subtotal según el día
 *   en que se hizo el pedido (`order.createdAt`), no el día de entrega.
 */
@Injectable()
export class RewardsService {
  constructor(
    @InjectRepository(RewardRedemption)
    private readonly rewardRedemptionsRepository: Repository<RewardRedemption>,
    @InjectRepository(MenuItem)
    private readonly menuItemsRepository: Repository<MenuItem>,
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  // ── Cliente ──────────────────────────────────────────────────────────────────

  /** Progreso hacia el próximo premio + premios disponibles + promoción vigente hoy. */
  async getProgress(userId: string): Promise<RewardsProgress> {
    const [solesPorEstrella, estrellasPorPremio] = await Promise.all([
      this.settingsService.getSolesPorEstrella(),
      this.settingsService.getEstrellasPorPremio(),
    ]);

    const { start, end } = this.currentMonthRangeInLima();
    const { estrellasDelMes, promotions } = await this.monthlyStats(
      this.dataSource.manager,
      userId,
      start,
      end,
      solesPorEstrella,
      estrellasPorPremio,
    );

    const now = new Date();
    const disponibles = await this.rewardRedemptionsRepository.find({
      where: { userId, usedAt: IsNull(), expiresAt: MoreThan(now) },
      order: { expiresAt: 'ASC' },
    });

    const todayStr = this.formatLimaDate(now);
    const activePromo =
      promotions.find(
        (promo) => promo.startDate <= todayStr && todayStr <= promo.endDate,
      ) ?? null;

    return {
      estrellasParaProximoPremio: estrellasDelMes % estrellasPorPremio,
      estrellasPorPremio,
      premiosDisponibles: disponibles.map((r) => ({
        id: r.id,
        expiresAt: r.expiresAt,
      })),
      promocionActiva: activePromo
        ? {
            label: activePromo.label,
            multiplier: activePromo.multiplier,
            endDate: activePromo.endDate,
          }
        : null,
    };
  }

  /** Catálogo de canje: productos activos y marcados como canjeables con estrellas. */
  async getCatalog(): Promise<RewardCatalogItem[]> {
    const items = await this.menuItemsRepository.find({
      where: { redeemableWithStars: true, available: true },
      order: { name: 'ASC' },
    });
    return items.map(({ id, name, description, price, image }) => ({
      id,
      name,
      description,
      price,
      image,
    }));
  }

  // ── Generación automática (disparada tras cada entrega) ─────────────────────

  /**
   * Recalcula las estrellas del mes calendario actual (hora de Lima) y genera
   * los `RewardRedemption` que falten. Lock pesimista sobre el usuario (mismo
   * patrón que `CouponsService.checkAndGenerateForUser`) para serializar
   * llamadas concurrentes y evitar generar premios duplicados.
   */
  async recalculateForUser(userId: string): Promise<void> {
    const [solesPorEstrella, estrellasPorPremio] = await Promise.all([
      this.settingsService.getSolesPorEstrella(),
      this.settingsService.getEstrellasPorPremio(),
    ]);

    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) return;

      const { start, end } = this.currentMonthRangeInLima();
      const { premiosQueDeberiaTener } = await this.monthlyStats(
        manager,
        userId,
        start,
        end,
        solesPorEstrella,
        estrellasPorPremio,
      );

      const alreadyGenerated = await manager.count(RewardRedemption, {
        where: {
          userId,
          earnedAt: And(MoreThanOrEqual(start), LessThan(end)),
        },
      });

      const toCreate = premiosQueDeberiaTener - alreadyGenerated;
      if (toCreate <= 0) return;

      const now = new Date();
      const expiresAt = this.addDays(now, REWARD_EXPIRATION_DAYS);
      const rewards = Array.from({ length: toCreate }, () =>
        manager.create(RewardRedemption, {
          userId,
          earnedAt: now,
          expiresAt,
          usedAt: null,
          usedInOrderId: null,
          menuItemId: null,
        }),
      );
      await manager.save(RewardRedemption, rewards);
    });
  }

  // ── Canje dentro de la transacción del pedido ───────────────────────────────

  /**
   * Valida y bloquea el premio DENTRO de la transacción de creación del pedido
   * (mismo patrón que `CouponsService.applyToOrder`). No lo marca usado todavía:
   * `OrdersService` guarda primero el pedido y luego llama a `markUsed`, para
   * que `usedInOrderId` apunte a un pedido que ya existe.
   */
  async validateForOrder(
    manager: EntityManager,
    params: { rewardRedemptionId: string; userId: string; menuItemId: string },
  ): Promise<RewardRedemption> {
    const redemption = await manager.findOne(RewardRedemption, {
      where: { id: params.rewardRedemptionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!redemption) {
      throw new BadRequestException('El premio no existe');
    }
    if (redemption.userId !== params.userId) {
      throw new BadRequestException('Este premio no pertenece a tu cuenta');
    }
    if (redemption.usedAt !== null) {
      throw new BadRequestException('Este premio ya fue canjeado');
    }
    if (redemption.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Este premio ha expirado');
    }
    const menuItem = await manager.findOne(MenuItem, {
      where: { id: params.menuItemId },
    });
    if (!menuItem || !menuItem.redeemableWithStars) {
      throw new BadRequestException(
        'El producto seleccionado no es canjeable con estrellas',
      );
    }
    return redemption;
  }

  /** Marca el premio como usado, referenciando el pedido y el producto canjeado. */
  async markUsed(
    manager: EntityManager,
    redemption: RewardRedemption,
    orderId: string,
    menuItemId: string,
  ): Promise<void> {
    redemption.usedAt = new Date();
    redemption.usedInOrderId = orderId;
    redemption.menuItemId = menuItemId;
    await manager.save(RewardRedemption, redemption);
  }

  /**
   * Reactiva TODOS los premios que un pedido canceló al canjearse (puede haber
   * más de uno: cada ítem del pedido puede traer su propio `rewardRedemptionId`).
   * Mismo criterio que `CouponsService.reactivateForCancelledOrder`: el cliente
   * nunca recibió el premio, así que vuelve a estar disponible.
   */
  async reactivateForCancelledOrder(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    const redemptions = await manager.find(RewardRedemption, {
      where: { usedInOrderId: orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (redemptions.length === 0) return;

    for (const redemption of redemptions) {
      redemption.usedAt = null;
      redemption.usedInOrderId = null;
      redemption.menuItemId = null;
    }
    await manager.save(RewardRedemption, redemptions);
  }

  // ── Helpers privados ─────────────────────────────────────────────────────────

  /**
   * Estrellas/premios del mes calendario actual para un usuario: suma el
   * subtotal (sin envío) de los pedidos `entregado` con `deliveredAt` dentro
   * del rango, pesado por el multiplicador de la `StarPromotion` activa el día
   * de CADA pedido (`order.createdAt`, no `deliveredAt`).
   */
  private async monthlyStats(
    manager: EntityManager,
    userId: string,
    start: Date,
    end: Date,
    solesPorEstrella: number,
    estrellasPorPremio: number,
  ): Promise<{
    estrellasDelMes: number;
    premiosQueDeberiaTener: number;
    promotions: StarPromotion[];
  }> {
    const [orders, promotions] = await Promise.all([
      manager.find(Order, {
        where: {
          userId,
          status: OrderStatus.ENTREGADO,
          deliveredAt: And(MoreThanOrEqual(start), LessThan(end)),
        },
        relations: { items: true },
      }),
      manager.find(StarPromotion, { where: { active: true } }),
    ]);

    let weightedSubtotal = 0;
    for (const order of orders) {
      const subtotal = order.items.reduce(
        (sum, item) => sum + item.subtotal,
        0,
      );
      weightedSubtotal +=
        subtotal * this.multiplierForDate(order.createdAt, promotions);
    }

    const estrellasDelMes = Math.floor(
      this.round2(weightedSubtotal) / solesPorEstrella,
    );
    const premiosQueDeberiaTener = Math.floor(
      estrellasDelMes / estrellasPorPremio,
    );

    return { estrellasDelMes, premiosQueDeberiaTener, promotions };
  }

  /** Multiplicador vigente en la fecha (Lima) dada; 1 si ninguna promoción activa la cubre. */
  private multiplierForDate(date: Date, promotions: StarPromotion[]): number {
    const dateStr = this.formatLimaDate(date);
    const promo = promotions.find(
      (p) => p.startDate <= dateStr && dateStr <= p.endDate,
    );
    return promo ? promo.multiplier : 1;
  }

  /** 'YYYY-MM-DD' de una fecha en hora de Lima. */
  private formatLimaDate(date: Date): string {
    const { year, month, day } = limaWallClockDate(date);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /** Rango [inicio, fin) del mes calendario actual en Lima, como instantes UTC. */
  private currentMonthRangeInLima(reference: Date = new Date()): {
    start: Date;
    end: Date;
  } {
    const { year, month } = limaWallClockDate(reference);
    const start = limaWallClockToUtc(year, month, 1, 0, 0);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = limaWallClockToUtc(nextYear, nextMonth, 1, 0, 0);
    return { start, end };
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private round2(value: number): number {
    return Number(value.toFixed(2));
  }
}
