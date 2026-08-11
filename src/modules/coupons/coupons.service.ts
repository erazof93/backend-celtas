import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserRole } from '../users/entities/user.entity';
import { GenerateCouponDto } from './dto/generate-coupon.dto';
import { QueryCouponsDto } from './dto/query-coupons.dto';
import {
  Coupon,
  CouponDiscountType,
  CouponOrigin,
  CouponStatus,
} from './entities/coupon.entity';

/** Recompensa del cupón automático (10% de descuento). No es configurable por ahora. */
const AUTO_COUPON_DISCOUNT_TYPE = CouponDiscountType.PERCENTAGE;
const AUTO_COUPON_DISCOUNT_VALUE = 10;

export interface PaginatedCoupons {
  items: Coupon[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ValidatedCoupon {
  valid: boolean;
  id: string;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minPurchaseAmount: number | null;
  description: string;
  expiresAt: Date;
}

/** Parámetros para canjear un cupón dentro de la transacción de creación del pedido. */
export interface ApplyCouponParams {
  code: string;
  userId: string;
  subtotal: number;
}

/** Resultado de validar/canjear un cupón: el total descontado y el cupón (aún sin marcar). */
export interface AppliedCoupon {
  discountedTotal: number;
  coupon: Coupon;
}

/**
 * Módulo Coupons.
 *
 * Generación automática: se dispara justo después de que un pedido pasa a
 * `entregado` (llamada directa desde OrdersService) y, como respaldo, un cron
 * diario a la 1 AM que recorre a todos los clientes.
 *
 * Cómo se evita generar un cupón nuevo cada vez que se supera el umbral una sola
 * vez: el gasto se mide DESDE el último cupón generado, no desde el total histórico.
 * Concretamente se suman los `total` de los pedidos `entregado` cuyo `createdAt`
 * es posterior a la fecha del último cupón del usuario. Si el usuario no tiene
 * cupones aún, se suma todo el gasto histórico. Además, si el usuario ya tiene un
 * cupón automático `active` sin usar, no se genera otro (no se duplica el ciclo).
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    @InjectRepository(Coupon)
    private readonly couponsRepository: Repository<Coupon>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Generación manual (admin) ───────────────────────────────────────────────

  /** Genera un cupón manual para una campaña puntual (no depende del umbral). */
  async generateManual(dto: GenerateCouponDto): Promise<Coupon> {
    const user = await this.usersRepository.findOne({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (
      dto.discountType === CouponDiscountType.PERCENTAGE &&
      dto.discountValue > 100
    ) {
      throw new BadRequestException(
        'El porcentaje de descuento no puede superar el 100%',
      );
    }

    const coupon = this.couponsRepository.create({
      userId: dto.userId,
      code: this.generateCode(),
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      minPurchaseAmount: dto.minPurchaseAmount ?? null,
      status: CouponStatus.ACTIVE,
      origin: CouponOrigin.MANUAL,
      expiresAt: this.addDays(new Date(), this.expirationDays()),
    });
    const saved = await this.couponsRepository.save(coupon);

    // Notifica al usuario dueño. sendPushNotification nunca lanza (ver contrato en
    // NotificationsService): no hace falta try/catch aquí.
    await this.notificationsService.sendPushNotification(dto.userId, {
      title: '¡Tienes un cupón de descuento! 🎉',
      body: `Tu cupón ${saved.code} (${this.describeDiscount(saved)}) ya está disponible.`,
      data: { couponCode: saved.code },
    });

    return saved;
  }

  // ── Validación (cliente) ────────────────────────────────────────────────────

  /**
   * Valida un cupón sin marcarlo como usado (lo usa el frontend antes de
   * confirmar el pedido). El cupón debe pertenecer al usuario autenticado.
   * Si se pasa `subtotal` y el cupón tiene un monto mínimo de compra, se
   * rechaza cuando el subtotal es menor.
   */
  async validateCoupon(
    code: string,
    userId: string,
    subtotal?: number,
  ): Promise<ValidatedCoupon> {
    const coupon = await this.couponsRepository.findOne({ where: { code } });
    if (!coupon) {
      throw new BadRequestException('El cupón no existe');
    }
    this.assertUsable(coupon, userId);
    this.assertMinPurchase(coupon, subtotal);
    return {
      valid: true,
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minPurchaseAmount: coupon.minPurchaseAmount,
      description: this.describeDiscount(coupon),
      expiresAt: coupon.expiresAt,
    };
  }

  // ── Canje dentro de la transacción del pedido ───────────────────────────────

  /**
   * Valida y bloquea el cupón DENTRO de la transacción de creación del pedido.
   * Devuelve el total descontado y el cupón (aún sin marcar). NO guarda el cupón:
   * OrdersService guarda primero el pedido y luego llama a `markUsed`, para que la
   * FK `usedInOrderId` apunte a un pedido que ya existe. Si el cupón no es válido
   * lanza una excepción y la transacción se revierte (el pedido no se crea).
   */
  async applyToOrder(
    manager: EntityManager,
    params: ApplyCouponParams,
  ): Promise<AppliedCoupon> {
    const coupon = await manager.findOne(Coupon, {
      where: { code: params.code },
      lock: { mode: 'pessimistic_write' },
    });
    if (!coupon) {
      throw new BadRequestException('El cupón no existe');
    }
    this.assertUsable(coupon, params.userId);
    this.assertMinPurchase(coupon, params.subtotal);

    const discountedTotal = this.applyDiscount(params.subtotal, coupon);
    return { discountedTotal, coupon };
  }

  /** Marca el cupón como usado, referenciando el pedido ya persistido. */
  async markUsed(
    manager: EntityManager,
    coupon: Coupon,
    orderId: string,
  ): Promise<void> {
    coupon.status = CouponStatus.USED;
    coupon.usedAt = new Date();
    coupon.usedInOrderId = orderId;
    await manager.save(Coupon, coupon);
  }

  /**
   * Reactiva el cupón que canjeó un pedido cuando ese pedido se cancela: el
   * cliente nunca recibió el descuento, así que el cupón vuelve a estar
   * disponible (status `active`, sin `usedInOrderId` ni `usedAt`). Se ejecuta
   * DENTRO de la transacción del cambio de estado del pedido (misma garantía
   * que el incremento de `totalSpent` al entregar). Si el pedido no canjeó
   * ningún cupón, no hace nada.
   *
   * No toca `expiresAt`: si el cupón ya venció naturalmente para cuando se
   * cancela el pedido, seguirá rechazándose como expirado a la hora de usarse.
   */
  async reactivateForCancelledOrder(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    const coupon = await manager.findOne(Coupon, {
      where: { usedInOrderId: orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!coupon) {
      return; // Pedido sin cupón asociado: nada que reactivar.
    }
    coupon.status = CouponStatus.ACTIVE;
    coupon.usedInOrderId = null;
    coupon.usedAt = null;
    await manager.save(Coupon, coupon);
  }

  // ── Generación automática ───────────────────────────────────────────────────

  /**
   * Revisa si el usuario superó el umbral de gasto desde el último cupón y, si
   * corresponde, genera UN cupón automático. No genera si ya hay uno activo sin
   * usar. Se ejecuta dentro de una transacción con lock pesimista sobre el
   * usuario para evitar duplicados ante llamadas concurrentes.
   */
  async checkAndGenerateForUser(userId: string): Promise<Coupon | null> {
    const threshold = this.thresholdAmount();

    const coupon = await this.dataSource.transaction(async (manager) => {
      // Lock del usuario serializa la generación por usuario (evita duplicados).
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        return null;
      }

      // No duplicar: si ya hay un cupón automático activo sin usar, no generar otro.
      const hasActive = await manager.findOne(Coupon, {
        where: {
          userId,
          status: CouponStatus.ACTIVE,
          origin: CouponOrigin.AUTO,
        },
      });
      if (hasActive) {
        return null;
      }

      // Gasto desde el último cupón (corte = fecha del último cupón generado).
      const lastCoupon = await manager.findOne(Coupon, {
        where: { userId },
        order: { createdAt: 'DESC' },
      });
      const since = lastCoupon ? lastCoupon.createdAt : new Date(0);

      const raw = await manager
        .createQueryBuilder(Order, 'order')
        .select('COALESCE(SUM(order.total), 0)', 'total')
        .where('order.userId = :userId', { userId })
        .andWhere('order.status = :status', { status: OrderStatus.ENTREGADO })
        .andWhere('order.createdAt > :since', { since })
        .getRawOne<{ total: string }>();
      const spent = parseFloat(raw?.total ?? '0');

      if (spent < threshold) {
        return null;
      }

      const coupon = manager.create(Coupon, {
        userId,
        code: this.generateCode(),
        discountType: AUTO_COUPON_DISCOUNT_TYPE,
        discountValue: AUTO_COUPON_DISCOUNT_VALUE,
        minPurchaseAmount: null, // los automáticos nunca llevan mínimo de compra
        status: CouponStatus.ACTIVE,
        origin: CouponOrigin.AUTO,
        expiresAt: this.addDays(new Date(), this.expirationDays()),
      });
      return manager.save(Coupon, coupon);
    });

    // Notifica al usuario dueño tras el commit. sendPushNotification nunca lanza
    // (ver contrato en NotificationsService): no hace falta try/catch aquí.
    if (coupon) {
      await this.notificationsService.sendPushNotification(userId, {
        title: '¡Ganaste un cupón por tu fidelidad! 🎉',
        body: `Tu cupón ${coupon.code} (${this.describeDiscount(coupon)}) ya está disponible.`,
        data: { couponCode: coupon.code },
      });
    }

    return coupon;
  }

  // ── Cron de respaldo (diario a la 1 AM) ─────────────────────────────────────

  /**
   * Respaldo del disparo directo: expira cupones vencidos y recorre a todos los
   * clientes por si algún disparo directo falló. No es el mecanismo principal.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDailyMaintenance(): Promise<void> {
    // 1) Marcar como expirados los cupones activos vencidos.
    await this.couponsRepository
      .createQueryBuilder()
      .update(Coupon)
      .set({ status: CouponStatus.EXPIRED })
      .where('status = :active', { active: CouponStatus.ACTIVE })
      .andWhere('expiresAt < :now', { now: new Date() })
      .execute();

    // 2) Generar cupones automáticos para clientes que superaron el umbral.
    const users = await this.usersRepository.find({
      where: { role: UserRole.CLIENTE },
    });
    for (const user of users) {
      try {
        await this.checkAndGenerateForUser(user.id);
      } catch (err) {
        this.logger.error(
          `No se pudo generar el cupón automático para el usuario ${user.id}`,
          err as Error,
        );
      }
    }
  }

  // ── Listados ────────────────────────────────────────────────────────────────

  /** Cupones del usuario autenticado (más recientes primero). */
  async findMyCoupons(userId: string): Promise<Coupon[]> {
    return this.couponsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Listado paginado para el panel admin, con filtro opcional por estado y por usuario. */
  async findAll(query: QueryCouponsDto): Promise<PaginatedCoupons> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: FindOptionsWhere<Coupon> = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    const [items, total] = await this.couponsRepository.findAndCount({
      where,
      take: limit,
      skip: (page - 1) * limit,
      order: { createdAt: 'DESC' },
    });

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── Helpers privados ────────────────────────────────────────────────────────

  /** Valida que el cupón sea usable por el usuario (pertenencia, estado y vigencia). */
  private assertUsable(coupon: Coupon, userId: string): void {
    if (coupon.userId !== userId) {
      throw new BadRequestException('Este cupón no pertenece a tu cuenta');
    }
    if (coupon.status === CouponStatus.USED) {
      throw new BadRequestException('Este cupón ya fue utilizado');
    }
    if (
      coupon.status === CouponStatus.EXPIRED ||
      coupon.expiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Este cupón ha expirado');
    }
  }

  /**
   * Valida el monto mínimo de compra del cupón. Si el cupón tiene
   * `minPurchaseAmount` y el subtotal del pedido es menor, rechaza con un
   * mensaje claro (no un error genérico). Si el cupón no tiene mínimo o no se
   * conoce el subtotal (validación sin subtotal), no hace nada.
   */
  private assertMinPurchase(coupon: Coupon, subtotal?: number): void {
    if (coupon.minPurchaseAmount == null) {
      return; // Sin mínimo: cualquier pedido puede usarlo.
    }
    if (subtotal == null) {
      return; // No se informó el subtotal: no se puede validar el mínimo.
    }
    if (subtotal < coupon.minPurchaseAmount) {
      throw new BadRequestException(
        `Este cupón requiere un pedido mínimo de S/${coupon.minPurchaseAmount.toFixed(2)}`,
      );
    }
  }

  /** Aplica el descuento al subtotal según el tipo del cupón. Nunca baja de 0. */
  private applyDiscount(subtotal: number, coupon: Coupon): number {
    if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
      // Clampeado a 0 por si un cupón porcentual supera el 100%.
      return Math.max(0, subtotal * (1 - coupon.discountValue / 100));
    }
    // fixed_amount: nunca baja de 0.
    return Math.max(0, subtotal - coupon.discountValue);
  }

  /** Descripción legible del descuento para mostrar al cliente. */
  private describeDiscount(coupon: Coupon): string {
    if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
      return `${coupon.discountValue}% de descuento`;
    }
    return `S/${coupon.discountValue.toFixed(2)} de descuento`;
  }

  /** Código único de cupón (8 caracteres hex en mayúsculas), sin dependencias. */
  private generateCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private thresholdAmount(): number {
    return this.configService.get<number>('coupons.thresholdAmount') ?? 50;
  }

  private expirationDays(): number {
    return this.configService.get<number>('coupons.expirationDays') ?? 15;
  }

  private round2(value: number): number {
    return Number(value.toFixed(2));
  }
}
