import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import {
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { haversineDistanceMeters } from '../../common/utils/geo.util';
import { normalizePhone } from '../../common/utils/phone.util';
import { CouponsService } from '../coupons/coupons.service';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RewardRedemption } from '../rewards/entities/reward-redemption.entity';
import { RewardsService } from '../rewards/rewards.service';
import { DeliveryFeeTier, SettingsService } from '../settings/settings.service';
import { Address } from '../users/entities/address.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { CreateOrderAdminDto } from './dto/create-order-admin.dto';
import { CreateOrderDto, CreateOrderItemDto } from './dto/create-order.dto';
import { EstimateDeliveryByCoordsDto } from './dto/estimate-delivery-by-coords.dto';
import { EstimateDeliveryFeeDto } from './dto/estimate-delivery-fee.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { GeoapifyService } from './geoapify.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderSource, OrderStatus } from './entities/order.entity';

/** Transiciones válidas de estado (no se puede saltar ni retroceder). */
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDIENTE]: [OrderStatus.CONFIRMADO, OrderStatus.CANCELADO],
  [OrderStatus.CONFIRMADO]: [OrderStatus.EN_CAMINO, OrderStatus.CANCELADO],
  [OrderStatus.EN_CAMINO]: [OrderStatus.ENTREGADO, OrderStatus.CANCELADO],
  [OrderStatus.ENTREGADO]: [],
  [OrderStatus.CANCELADO]: [],
};

/** Granularidad (metros) del `distanceMeters` que se expone en las respuestas de delivery. */
const DISTANCE_ROUNDING_METERS = 50;

/** Lo mínimo de un ítem que necesita el mensaje de WhatsApp (OrderItem lo cumple). */
type WhatsappMessageItem = Pick<
  OrderItem,
  | 'name'
  | 'quantity'
  | 'selectedSauces'
  | 'selectedBeverages'
  | 'selectedExtraPortions'
  | 'selectedFriesTypes'
  | 'comment'
>;

/** Un destinatario de WhatsApp: celular (51XXXXXXXXX) + link wa.me con el mensaje. */
export interface WhatsappLink {
  phone: string;
  url: string;
}

export interface WhatsappLinks {
  orderId: string;
  /** Link al cliente ("CONFIRMA TU PEDIDO"); null si no hay un celular válido (ver normalizePhone). */
  customer: WhatsappLink | null;
  /** Link al número del negocio ("NUEVO PEDIDO"), siempre presente. */
  store: WhatsappLink;
  /** Cuándo el admin confirmó que lo mandó (POST .../whatsapp-sent); null = sin confirmar. */
  whatsappSentAt: Date | null;
}

export interface PaginatedOrders {
  items: Order[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Módulo Orders.
 * - El pedido se guarda en `pendiente` ANTES de redirigir a WhatsApp: siempre hay
 *   registro aunque el cliente no complete el envío del mensaje.
 * - El total y los subtotales se calculan SIEMPRE en el backend (nunca se confía en
 *   un total enviado por el frontend).
 * - La dirección se guarda como snapshot (JSON), no como referencia viva.
 * - Al pasar a `entregado` se incrementa `user.totalSpent` dentro de una transacción
 *   (deja listo el terreno para el módulo de cupones).
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(MenuItem)
    private readonly menuItemsRepository: Repository<MenuItem>,
    @InjectRepository(Address)
    private readonly addressesRepository: Repository<Address>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly couponsService: CouponsService,
    private readonly rewardsService: RewardsService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly geoapifyService: GeoapifyService,
  ) {}

  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    // El local cerrado es lo primero que debe frenar el pedido, antes de
    // validar items/dirección/cupón. isOpenNow() es la fuente única de
    // verdad (override manual "cerrado temporalmente" gana sobre el horario).
    const businessHours = await this.settingsService.isOpenNow();
    if (!businessHours.open) {
      throw new ConflictException(
        businessHours.message ?? 'El local está cerrado en este momento',
      );
    }

    return this.placeOrder({
      userId,
      dto,
      source: OrderSource.APP,
      customerName: null,
      customerPhone: null,
      whatsappRecipient: null,
    });
  }

  /**
   * Pedido manual cargado por el admin (POST /orders/admin), ej. uno tomado por
   * teléfono. Mismo cálculo que `create()` (precios snapshot, delivery, cupón,
   * premios, transacción) vía `placeOrder`, con tres diferencias:
   * - NO se bloquea por horario: el admin decide (ej. pedido tomado al cierre).
   * - Con `customerId` se asocia a ese cliente; sin él es anónimo (userId null,
   *   contacto en customerName/customerPhone).
   * - El whatsappUrl apunta al CELULAR DEL CLIENTE (para mandarle el resumen a
   *   confirmar), no al negocio. Si el cliente registrado no tiene un celular
   *   válido, cae al número del negocio como en `create()`.
   */
  async createOrderByAdmin(dto: CreateOrderAdminDto): Promise<Order> {
    if (dto.customerId) {
      const customer = await this.usersRepository.findOne({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException('Cliente no encontrado');
      }
      // Evita sumar totalSpent/estrellas/cupones a una cuenta admin por error
      // al elegir el cliente en el panel.
      if (customer.role !== UserRole.CLIENTE) {
        throw new BadRequestException(
          'customerId debe ser una cuenta de cliente, no de administrador',
        );
      }
      return this.placeOrder({
        userId: customer.id,
        dto,
        source: OrderSource.ADMIN,
        customerName: null,
        customerPhone: null,
        whatsappRecipient: normalizePhone(customer.phone),
      });
    }

    // El DTO ya exige ambos sin customerId; esto cubre "   " (IsNotEmpty lo deja pasar).
    const customerName = dto.customerName?.trim();
    const customerPhone = normalizePhone(dto.customerPhone);
    if (!customerName || !customerPhone) {
      throw new BadRequestException(
        'Un pedido sin cliente requiere customerName y customerPhone',
      );
    }
    return this.placeOrder({
      userId: null,
      dto,
      source: OrderSource.ADMIN,
      customerName,
      customerPhone,
      whatsappRecipient: customerPhone,
    });
  }

  /**
   * Núcleo común de `create()` y `createOrderByAdmin()`: dirección → delivery →
   * items con precios snapshot → transacción (cupón + premios + pedido) → push a
   * los admins. `userId` null = pedido manual anónimo: addressId, cupón y premios
   * pertenecen a una cuenta, así que se rechazan con 400 (validado acá, junto a
   * cada uso, para que ningún caller pueda saltárselo).
   */
  private async placeOrder(params: {
    userId: string | null;
    dto: CreateOrderDto;
    /** Canal de origen: lo fija el endpoint, nunca el cliente. */
    source: OrderSource;
    customerName: string | null;
    customerPhone: string | null;
    /** Celular (51XXXXXXXXX) al que apunta el whatsappUrl; null = número del negocio. */
    whatsappRecipient: string | null;
  }): Promise<Order> {
    const {
      userId,
      dto,
      source,
      customerName,
      customerPhone,
      whatsappRecipient,
    } = params;

    const addressSnapshot = await this.resolveAddressSnapshot(userId, dto);
    const { deliveryFee, isFarOrder } =
      await this.resolveDelivery(addressSnapshot);
    const { items, rewardClaims } = await this.buildItems(dto.items);
    if (!userId && rewardClaims.length > 0) {
      throw new BadRequestException(
        'Un pedido sin cliente no puede canjear premios',
      );
    }
    const subtotal = this.round2(
      items.reduce((sum, item) => sum + item.subtotal, 0),
    );
    // El id se genera acá para poder construir el whatsappUrl y marcar el cupón usado.
    const orderId = randomUUID();

    // Transacción explícita: el pedido y el canje del cupón se crean/revientan juntos.
    const savedOrder = await this.dataSource.transaction(async (manager) => {
      let total = subtotal;
      let coupon:
        Awaited<ReturnType<CouponsService['applyToOrder']>>['coupon'] | null =
        null;
      let discountAmount = 0;
      if (dto.couponCode) {
        if (!userId) {
          throw new BadRequestException(
            'Un pedido sin cliente no puede usar cupones',
          );
        }
        const applied = await this.couponsService.applyToOrder(manager, {
          code: dto.couponCode,
          userId,
          subtotal,
        });
        total = applied.discountedTotal;
        coupon = applied.coupon;
        discountAmount = this.round2(subtotal - applied.discountedTotal);
      }
      total = this.round2(total + deliveryFee);

      // Validar y bloquear los premios canjeados ANTES de persistir el pedido
      // (mismo patrón que el cupón): si alguno no es válido, la transacción se
      // revierte y el pedido no se crea.
      const validatedRewards: {
        redemption: RewardRedemption;
        menuItemId: string;
      }[] = [];
      for (const claim of rewardClaims) {
        // Ya rechazado arriba si no hay userId; el guard estrecha el tipo.
        if (!userId) break;
        const redemption = await this.rewardsService.validateForOrder(manager, {
          rewardRedemptionId: claim.rewardRedemptionId,
          userId,
          menuItemId: claim.menuItemId,
        });
        validatedRewards.push({ redemption, menuItemId: claim.menuItemId });
      }

      const order = manager.create(Order, {
        id: orderId,
        userId,
        customerName,
        customerPhone,
        source,
        status: OrderStatus.PENDIENTE,
        addressSnapshot,
        total,
        deliveryFee,
        items,
      } as Partial<Order>);
      order.whatsappUrl = await this.buildWhatsappUrl(
        orderId,
        items,
        total,
        addressSnapshot,
        subtotal,
        deliveryFee,
        discountAmount,
        coupon?.code ?? null,
        whatsappRecipient,
      );

      const saved = await manager.save(Order, order);

      // Marcar el cupón usado DESPUÉS de persistir el pedido (la FK usedInOrderId
      // debe apuntar a un pedido que ya exista). Si algo falla, todo se revierte.
      if (coupon) {
        await this.couponsService.markUsed(manager, coupon, saved.id);
      }
      for (const { redemption, menuItemId } of validatedRewards) {
        await this.rewardsService.markUsed(
          manager,
          redemption,
          saved.id,
          menuItemId,
        );
      }

      return saved;
    });

    // Fuera de la transacción, tras el commit: aviso a los admins con push,
    // best-effort (sendPushNotification nunca lanza, no hace falta try/catch).
    // Si esto fallara igual, la creación del pedido ya quedó registrada.
    await this.notifyAdminsNewOrder(savedOrder, isFarOrder);

    return savedOrder;
  }

  /** Lista los pedidos del usuario autenticado (más recientes primero, máx. `limit`). */
  async findMyOrders(userId: string, limit: number = 20): Promise<Order[]> {
    return this.ordersRepository.find({
      where: { userId },
      relations: { items: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Listado paginado para el panel admin, con filtro opcional por estado y por usuario. */
  async findAll(query: QueryOrdersDto): Promise<PaginatedOrders> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: FindOptionsWhere<Order> = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    const [items, total] = await this.ordersRepository.findAndCount({
      where,
      relations: { items: true, user: true },
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

  /**
   * Detalle de un pedido. El cliente solo puede ver el suyo (403); el admin cualquiera.
   */
  async findOne(
    id: string,
    requester: { userId: string; role: string },
  ): Promise<Order> {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: { items: true, user: true },
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }
    if (
      requester.role !== UserRole.ADMIN.valueOf() &&
      order.userId !== requester.userId
    ) {
      throw new ForbiddenException('No tienes permiso para ver este pedido');
    }
    return order;
  }

  /**
   * Actualiza el estado de un pedido (admin). Valida la transición (no saltar de
   * pendiente a entregado; cancelado también permitido desde en_camino, con motivo
   * obligatorio en ese caso). Al pasar a `entregado` suma el total al
   * `user.totalSpent` dentro de la misma transacción; al pasar a `cancelado`
   * reactiva el cupón que el pedido hubiera canjeado.
   */
  async updateStatus(id: string, dto: UpdateOrderStatusDto): Promise<Order> {
    return this.dataSource
      .transaction(async (manager) => {
        // Lock pesimista para evitar que dos PATCH concurrentes lean el mismo estado
        // y dupliquen el incremento de totalSpent al llegar a "entregado".
        // Sin relations: FOR UPDATE no puede aplicarse al lado nullable de un LEFT JOIN.
        const order = await manager.findOne(Order, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!order) {
          throw new NotFoundException('Pedido no encontrado');
        }

        const allowed = VALID_TRANSITIONS[order.status];
        if (!allowed.includes(dto.status)) {
          throw new BadRequestException(
            `No se puede pasar el pedido de "${order.status}" a "${dto.status}"`,
          );
        }

        if (
          dto.status === OrderStatus.CANCELADO &&
          order.status === OrderStatus.EN_CAMINO &&
          !dto.cancelReason?.trim()
        ) {
          throw new BadRequestException(
            'Debes indicar un motivo para cancelar un pedido que ya está en camino',
          );
        }

        order.status = dto.status;

        if (dto.status === OrderStatus.CANCELADO) {
          if (dto.cancelReason?.trim()) {
            order.cancelReason = dto.cancelReason.trim();
          }
          // Si el pedido canjeó un cupón y se cancela, el cliente nunca usó el
          // descuento: se reactiva el cupón dentro de la misma transacción
          // (mismo patrón que totalSpent al entregar). No se toca expiresAt.
          await this.couponsService.reactivateForCancelledOrder(
            manager,
            order.id,
          );
          // Mismo criterio para premios del programa de estrellas: un pedido
          // cancelado nunca debe dejar al cliente sin el premio que canjeó.
          await this.rewardsService.reactivateForCancelledOrder(
            manager,
            order.id,
          );
        }

        if (dto.status === OrderStatus.ENTREGADO) {
          // Pedido manual anónimo (userId null): no hay a quién sumarle totalSpent,
          // pero la entrega se registra igual (deliveredAt → ventas del dashboard).
          if (order.userId) {
            const user = await manager.findOne(User, {
              where: { id: order.userId },
            });
            if (!user) {
              throw new NotFoundException('Usuario del pedido no encontrado');
            }
            user.totalSpent = this.round2(user.totalSpent + order.total);
            await manager.save(User, user);
          }
          // Marca la entrega real: las ventas del dashboard se miden con esta fecha.
          order.deliveredAt = new Date();
        }

        return manager.save(Order, order);
      })
      .then(async (saved) => {
        // Pedido manual anónimo: sin cliente no hay cupón, estrellas ni push.
        const userId = saved.userId;
        if (!userId) return saved;

        // Disparo directo del módulo de cupones tras el commit (el cron es el respaldo).
        // Si falla, no debe romper la respuesta del PATCH: la entrega ya quedó registrada.
        if (saved.status === OrderStatus.ENTREGADO) {
          try {
            await this.couponsService.checkAndGenerateForUser(userId);
          } catch (err) {
            this.logger.error(
              `No se pudo generar el cupón automático para el usuario ${saved.userId}`,
              err as Error,
            );
          }
          try {
            await this.rewardsService.recalculateForUser(userId);
          } catch (err) {
            this.logger.error(
              `No se pudo recalcular las estrellas del usuario ${saved.userId}`,
              err as Error,
            );
          }
        }

        // Notifica al cliente el nuevo estado de su pedido. sendPushNotification
        // nunca lanza (ver contrato en NotificationsService): no hace falta
        // try/catch aquí, no rompe la respuesta del PATCH.
        await this.notificationsService.sendPushNotification(userId, {
          title: `Tu pedido está ${this.statusLabel(saved.status)}`,
          body: `El estado de tu pedido #${saved.id} cambió a "${this.statusLabel(saved.status)}".`,
          data: { orderId: saved.id, status: saved.status },
        });

        return saved;
      });
  }

  /**
   * Dirección en texto → `[latitude, longitude]` vía Geoapify. Vacía o sin resultado
   * confiable → 400. Las fallas del proveedor (sin key, 429, caída) salen como 503
   * desde `GeoapifyService` y NO se reescriben a 400: no son culpa de la dirección.
   */
  async geocodeAddress(address: string): Promise<[number, number]> {
    const text = address?.trim();
    if (!text) {
      throw new BadRequestException('Dirección es requerida');
    }

    const coords = await this.geoapifyService.geocode(text);
    if (!coords) {
      throw new BadRequestException(`Dirección no encontrada: "${text}"`);
    }
    return coords;
  }

  /**
   * Links de WhatsApp de un pedido ya creado (admin). El backend NO envía mensajes:
   * arma links wa.me que el admin abre desde el panel. Se regeneran desde el
   * snapshot del pedido (items/precios/dirección tal como se guardaron) con el
   * número del negocio ACTUAL de settings. El cliente sale de `customerPhone`
   * (anónimo) o del `phone` del usuario (normalizado); si no hay un celular
   * peruano válido, `customer` es null y solo queda el link a la tienda.
   */
  async getWhatsappLinks(orderId: string): Promise<WhatsappLinks> {
    const order = await this.findOrderForWhatsapp(orderId, {
      items: true,
      user: true,
    });

    const subtotal = this.round2(
      order.items.reduce((sum, item) => sum + item.subtotal, 0),
    );
    // Mismo despeje que el panel: total = (subtotal - descuento) + deliveryFee.
    const discountAmount = this.round2(
      subtotal + order.deliveryFee - order.total,
    );
    const couponCode =
      discountAmount > 0
        ? await this.couponsService.findCodeUsedInOrder(order.id)
        : null;
    const messageFor = (heading: 'NUEVO PEDIDO' | 'CONFIRMA TU PEDIDO') =>
      this.buildWhatsappMessage({
        heading,
        orderId: order.id,
        items: order.items,
        total: order.total,
        addressSnapshot: order.addressSnapshot,
        subtotal,
        deliveryFee: order.deliveryFee,
        discountAmount,
        couponCode,
      });
    const link = (phone: string, message: string): WhatsappLink => ({
      phone,
      url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    });

    const customerPhone =
      order.userId === null
        ? order.customerPhone
        : normalizePhone(order.user?.phone);
    const storePhone = await this.settingsService.getWhatsappNumber();

    return {
      orderId: order.id,
      customer: customerPhone
        ? link(customerPhone, messageFor('CONFIRMA TU PEDIDO'))
        : null,
      store: link(storePhone, messageFor('NUEVO PEDIDO')),
      whatsappSentAt: order.whatsappSentAt,
    };
  }

  /**
   * El admin confirma en el panel que YA mandó el WhatsApp del pedido. Registra
   * la confirmación humana (no un envío: el backend no envía nada). Idempotente:
   * se guarda la PRIMERA confirmación y las siguientes la devuelven sin pisarla.
   */
  async markWhatsappSent(
    orderId: string,
  ): Promise<{ orderId: string; whatsappSentAt: Date }> {
    const order = await this.findOrderForWhatsapp(orderId);
    if (order.whatsappSentAt) {
      return { orderId: order.id, whatsappSentAt: order.whatsappSentAt };
    }
    const whatsappSentAt = new Date();
    // update() de la columna sola: no re-guarda relaciones ni pisa otros campos.
    await this.ordersRepository.update(order.id, { whatsappSentAt });
    return { orderId: order.id, whatsappSentAt };
  }

  /** Pedido para los endpoints de WhatsApp: 404 si no existe, 409 si está cancelado. */
  private async findOrderForWhatsapp(
    orderId: string,
    relations: { items?: true; user?: true } = {},
  ): Promise<Order> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations,
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }
    // "CONFIRMA TU PEDIDO" de un pedido cancelado confundiría al cliente.
    if (order.status === OrderStatus.CANCELADO) {
      throw new ConflictException(
        'El pedido está cancelado: no corresponde mandarle WhatsApp',
      );
    }
    return order;
  }

  /**
   * Pedidos manuales ANÓNIMOS (userId null) cuyo `customerPhone` coincide con el
   * celular del cliente: el preview que el admin revisa antes de vincular. No
   * vincula nada.
   */
  async findLinkableAnonymousOrders(
    userId: string,
  ): Promise<{ userId: string; phone: string; orders: Order[] }> {
    const { user, phone } = await this.findCustomerForLinking(userId);
    const orders = await this.ordersRepository.find({
      where: { userId: IsNull(), customerPhone: phone },
      relations: { items: true },
      order: { createdAt: 'DESC' },
    });
    return { userId: user.id, phone, orders };
  }

  /**
   * Vincula a un cliente registrado los pedidos anónimos que el ADMIN eligió
   * (después de confirmar con el cliente que son suyos: el teléfono solo no
   * prueba identidad, por eso esto no es automático al registrarse).
   *
   * Todo o nada, en una transacción con lock sobre los pedidos: si alguno no es
   * anónimo, no existe o su customerPhone no es el del cliente → 409 y no se
   * vincula ninguno (dos clicks simultáneos no pueden sumar dos veces). Los
   * entregados suman su total a `totalSpent` como si se hubieran entregado a este
   * cliente; tras el commit se recalculan estrellas y cupón automático (mismo
   * disparo que `updateStatus`). customerName/customerPhone se conservan como
   * registro de cómo se tomó el pedido.
   */
  async linkAnonymousOrders(
    userId: string,
    orderIds: string[],
  ): Promise<{
    userId: string;
    linkedOrderIds: string[];
    deliveredTotalAdded: number;
    totalSpent: number;
  }> {
    const { user, phone } = await this.findCustomerForLinking(userId);

    const { deliveredTotalAdded, totalSpent } =
      await this.dataSource.transaction(async (manager) => {
        const orders = await manager.find(Order, {
          where: { id: In(orderIds) },
          lock: { mode: 'pessimistic_write' },
        });
        const byId = new Map(orders.map((order) => [order.id, order]));
        const notLinkable = orderIds.filter((id) => {
          const order = byId.get(id);
          return (
            !order || order.userId !== null || order.customerPhone !== phone
          );
        });
        if (notLinkable.length > 0) {
          throw new ConflictException(
            `Estos pedidos no existen, ya tienen cliente o su celular no es ${phone}: ${notLinkable.join(', ')}. No se vinculó ninguno.`,
          );
        }

        await manager.update(Order, { id: In(orderIds) }, { userId: user.id });

        const delivered = this.round2(
          orders
            .filter((order) => order.status === OrderStatus.ENTREGADO)
            .reduce((sum, order) => sum + order.total, 0),
        );
        const lockedUser = await manager.findOne(User, {
          where: { id: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedUser) {
          throw new NotFoundException('Usuario no encontrado');
        }
        if (delivered > 0) {
          lockedUser.totalSpent = this.round2(
            lockedUser.totalSpent + delivered,
          );
          await manager.save(User, lockedUser);
        }
        return {
          deliveredTotalAdded: delivered,
          totalSpent: lockedUser.totalSpent,
        };
      });

    // Mismo disparo post-commit que al entregar (best-effort): la vinculación ya
    // quedó registrada aunque esto falle. Las estrellas son mensuales: solo
    // cuentan los entregados del mes en curso (ver RewardsService.monthlyStats).
    if (deliveredTotalAdded > 0) {
      try {
        await this.couponsService.checkAndGenerateForUser(user.id);
      } catch (err) {
        this.logger.error(
          `No se pudo generar el cupón automático para el usuario ${user.id}`,
          err as Error,
        );
      }
      try {
        await this.rewardsService.recalculateForUser(user.id);
      } catch (err) {
        this.logger.error(
          `No se pudo recalcular las estrellas del usuario ${user.id}`,
          err as Error,
        );
      }
    }

    return {
      userId: user.id,
      linkedOrderIds: orderIds,
      deliveredTotalAdded,
      totalSpent,
    };
  }

  /** Cliente (rol cliente) con celular normalizable: base de la vinculación. */
  private async findCustomerForLinking(
    userId: string,
  ): Promise<{ user: User; phone: string }> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (user.role !== UserRole.CLIENTE) {
      throw new BadRequestException(
        'Solo se pueden vincular pedidos a una cuenta de cliente',
      );
    }
    // normalizePhone también normaliza los teléfonos viejos con formato libre.
    const phone = normalizePhone(user.phone);
    if (!phone) {
      throw new BadRequestException(
        'El cliente no tiene un celular válido: no hay con qué buscar sus pedidos anónimos',
      );
    }
    return { user, phone };
  }

  /**
   * Estima el costo de delivery de una dirección ya guardada del usuario, sin crear
   * un pedido. Mismo cálculo que `create()` (Haversine + tramo + radio de aviso),
   * reutilizado vía `computeDelivery` — no lo duplica. Misma dirección ajena → 404
   * que el resto de `/users/:id/addresses`.
   */
  async estimateDeliveryFee(
    userId: string,
    dto: EstimateDeliveryFeeDto,
  ): Promise<{
    deliveryFee: number;
    isFarOrder: boolean;
    distanceMeters: number | null;
  }> {
    const address = await this.addressesRepository.findOne({
      where: { id: dto.addressId, userId },
    });
    if (!address) {
      throw new NotFoundException('Dirección no encontrada');
    }

    const coords =
      typeof address.latitude === 'number' &&
      typeof address.longitude === 'number'
        ? { latitude: address.latitude, longitude: address.longitude }
        : null;

    return this.computeDelivery(coords);
  }

  /**
   * Estima el delivery para coordenadas sueltas (`GET /delivery/estimate`, ej. el
   * pin del mapa antes de guardar la dirección). Mismo `computeDelivery` que
   * `create()`: lo que se cotiza acá es exactamente lo que se cobrará.
   */
  async estimateDeliveryByCoords(dto: EstimateDeliveryByCoordsDto): Promise<{
    deliveryFee: number;
    isFarOrder: boolean;
    distanceMeters: number | null;
  }> {
    return this.computeDelivery({
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
  }

  /** Etiqueta legible de un estado de pedido para las notificaciones. */
  private statusLabel(status: OrderStatus): string {
    const labels: Record<OrderStatus, string> = {
      [OrderStatus.PENDIENTE]: 'pendiente',
      [OrderStatus.CONFIRMADO]: 'confirmado',
      [OrderStatus.EN_CAMINO]: 'en camino',
      [OrderStatus.ENTREGADO]: 'entregado',
      [OrderStatus.CANCELADO]: 'cancelado',
    };
    return labels[status];
  }

  // ── Helpers privados ─────────────────────────────────────────────────────────

  /** Dirección del pedido: siempre termina en un snapshot JSON, nunca en una referencia viva. */
  private async resolveAddressSnapshot(
    userId: string | null,
    dto: CreateOrderDto,
  ): Promise<string> {
    if (dto.addressId) {
      // Sin userId, `where: { userId: undefined }` NO filtraría por dueño y
      // aceptaría la dirección de cualquier cliente: se rechaza explícitamente.
      if (!userId) {
        throw new BadRequestException(
          'Un pedido sin cliente no puede usar addressId: envía la dirección en addressSnapshot',
        );
      }
      const address = await this.addressesRepository.findOne({
        where: { id: dto.addressId, userId },
      });
      if (!address) {
        throw new NotFoundException('Dirección no encontrada');
      }
      return JSON.stringify({
        alias: address.alias,
        fullAddress: address.fullAddress,
        reference: address.reference,
        district: address.district,
        latitude: address.latitude,
        longitude: address.longitude,
      });
    }
    if (dto.addressSnapshot) {
      return dto.addressSnapshot;
    }
    throw new BadRequestException(
      'Debes indicar una dirección (addressId o addressSnapshot)',
    );
  }

  /**
   * Costo de delivery por distancia (Haversine contra `store_location`) y si
   * el pedido supera el radio de aviso interno. Si la dirección no trae
   * coordenadas (dato viejo, o `addressSnapshot` de texto libre sin
   * `addressId`, ya documentado como fuera de alcance), NUNCA bloquea el
   * pedido: `deliveryFee = 0` y solo se loguea un warning.
   */
  private async resolveDelivery(
    addressSnapshot: string,
  ): Promise<{ deliveryFee: number; isFarOrder: boolean }> {
    const coords = this.parseAddressCoords(addressSnapshot);
    if (!coords) {
      this.logger.warn(
        'No se pudo calcular el delivery por distancia: la dirección del pedido no tiene coordenadas. deliveryFee = 0.',
      );
    }
    return this.computeDelivery(coords);
  }

  /**
   * Cálculo compartido de delivery por distancia (Haversine contra `store_location`
   * + tramo de `delivery_fee_tiers` + radio de aviso), usado tanto por `create()`
   * como por `estimateDeliveryFee()`. Sin coordenadas: `deliveryFee = 0`,
   * `isFarOrder = false`, `distanceMeters = null` — nunca bloquea nada.
   */
  private async computeDelivery(
    coords: { latitude: number; longitude: number } | null,
  ): Promise<{
    deliveryFee: number;
    isFarOrder: boolean;
    distanceMeters: number | null;
  }> {
    if (!coords) {
      return { deliveryFee: 0, isFarOrder: false, distanceMeters: null };
    }

    const store = await this.settingsService.getStoreLocation();
    const distanceMeters = haversineDistanceMeters(
      store.latitude,
      store.longitude,
      coords.latitude,
      coords.longitude,
    );
    const [tiers, alertRadiusMeters] = await Promise.all([
      this.settingsService.getDeliveryFeeTiers(),
      this.settingsService.getDeliveryAlertRadiusMeters(),
    ]);

    // Tarifa y aviso con la distancia EXACTA (redondear antes movería los
    // bordes de tramo: 120 m → 100 m cobraría S/2 en vez de S/4). Solo la
    // distancia expuesta se redondea, para no permitir triangular la
    // ubicación del local con distancias al metro desde 3 puntos.
    return {
      deliveryFee: this.feeForDistance(distanceMeters, tiers),
      isFarOrder: distanceMeters > alertRadiusMeters,
      distanceMeters:
        Math.round(distanceMeters / DISTANCE_ROUNDING_METERS) *
        DISTANCE_ROUNDING_METERS,
    };
  }

  /** Extrae `{ latitude, longitude }` del snapshot JSON, o `null` si no están presentes/son válidas. */
  private parseAddressCoords(
    snapshot: string,
  ): { latitude: number; longitude: number } | null {
    try {
      const parsed = JSON.parse(snapshot) as {
        latitude?: number | null;
        longitude?: number | null;
      };
      if (
        typeof parsed.latitude === 'number' &&
        typeof parsed.longitude === 'number'
      ) {
        return { latitude: parsed.latitude, longitude: parsed.longitude };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Tramo de `delivery_fee_tiers` que corresponde a `distanceMeters` (el primero con `<= maxMeters`). */
  private feeForDistance(
    distanceMeters: number,
    tiers: DeliveryFeeTier[],
  ): number {
    for (const tier of tiers) {
      if (tier.maxMeters === null || distanceMeters <= tier.maxMeters) {
        return tier.fee;
      }
    }
    // Defensivo: si la config no trae un tramo final con maxMeters=null, usa
    // el último tramo en vez de dejar el pedido sin tarifa.
    return tiers[tiers.length - 1]?.fee ?? 0;
  }

  /**
   * Push a los admins con token registrado avisando el pedido nuevo.
   * Fire-and-forget best-effort: `sendPushNotification` nunca lanza (ver
   * contrato en NotificationsService), así que no hace falta try/catch acá.
   */
  private async notifyAdminsNewOrder(
    order: Order,
    isFarOrder: boolean,
  ): Promise<void> {
    const admins = await this.usersRepository.find({
      where: { role: UserRole.ADMIN, fcmToken: Not(IsNull()) },
    });
    if (admins.length === 0) return;

    const shortId = order.id.slice(0, 8).toUpperCase();
    const title = isFarOrder
      ? `⚠️ Nuevo pedido fuera de la zona habitual #${shortId} — S/ ${order.total.toFixed(2)}`
      : `🍔 Nuevo pedido #${shortId} — S/ ${order.total.toFixed(2)}`;
    const body = this.readableAddress(order.addressSnapshot);

    await Promise.all(
      admins.map((admin) =>
        this.notificationsService.sendPushNotification(admin.id, {
          title,
          body,
          data: { orderId: order.id, status: order.status },
        }),
      ),
    );
  }

  /**
   * Valida los productos y construye los OrderItem con precio/nombre SNAPSHOT y
   * subtotales. Si un ítem trae `rewardRedemptionId` (premio del programa de
   * estrellas), fuerza su precio a 0 y lo devuelve aparte en `rewardClaims` —
   * la validación real (pertenencia, uso, vigencia) requiere lock y ocurre
   * DENTRO de la transacción de `create()` (ver `RewardsService.validateForOrder`),
   * no acá: acá solo se resuelve lo que no necesita lock (que el producto
   * elegido sea canjeable, que no se repita el mismo premio en el pedido).
   */
  private async buildItems(items: CreateOrderItemDto[]): Promise<{
    items: OrderItem[];
    rewardClaims: { rewardRedemptionId: string; menuItemId: string }[];
  }> {
    const ids = items.map((item) => item.menuItemId);
    const menuItems = await this.menuItemsRepository.find({
      where: { id: In(ids) },
      relations: {
        sauces: true,
        beverages: true,
        extraPortions: true,
        friesTypes: true,
      },
    });
    const byId = new Map(menuItems.map((menuItem) => [menuItem.id, menuItem]));

    const result: OrderItem[] = [];
    const rewardClaims: { rewardRedemptionId: string; menuItemId: string }[] =
      [];
    const seenRewardIds = new Set<string>();

    for (const item of items) {
      const menuItem = byId.get(item.menuItemId);
      if (!menuItem) {
        throw new NotFoundException(
          `Producto no encontrado: ${item.menuItemId}`,
        );
      }
      if (!item.rewardRedemptionId && !menuItem.available) {
        throw new BadRequestException(
          `El producto "${menuItem.name}" no está disponible`,
        );
      }

      let unitPrice = menuItem.price;
      if (item.rewardRedemptionId) {
        // Chequeo previo, sin lock: solo descarta productos que no participan
        // de NINGÚN catálogo de canje. Cuál de los dos (normal o especial)
        // aplica depende del hito de origen del premio (`redemption.isSpecial`),
        // que recién se conoce y se valida con lock DENTRO de la transacción
        // (ver `RewardsService.validateForOrder`) — nunca acá.
        if (!menuItem.redeemableWithStars && !menuItem.specialReward) {
          throw new BadRequestException(
            `El producto "${menuItem.name}" no es canjeable con estrellas`,
          );
        }
        if (item.quantity !== 1) {
          throw new BadRequestException(
            'Un premio canjeado solo habilita 1 unidad del producto',
          );
        }
        if (seenRewardIds.has(item.rewardRedemptionId)) {
          throw new BadRequestException(
            'No puedes usar el mismo premio más de una vez en el mismo pedido',
          );
        }
        seenRewardIds.add(item.rewardRedemptionId);
        unitPrice = 0;
        rewardClaims.push({
          rewardRedemptionId: item.rewardRedemptionId,
          menuItemId: menuItem.id,
        });
      }

      const selectedSauces = this.resolveSelectedSauces(menuItem, item);
      this.validateGroupSelection(
        menuItem.name,
        menuItem.sauces,
        selectedSauces === null
          ? null
          : selectedSauces.map((name) => ({ name })),
        menuItem.sauceGroupRequired,
        menuItem.sauceGroupMaxSelectable,
        { one: 'una salsa', many: 'salsa(s)' },
      );
      const offeredBeverages = this.resolveBeveragePrices(menuItem);
      const selectedBeverages = this.resolveSelectedPriced(
        offeredBeverages,
        item.beverageIds,
        menuItem.name,
        'la bebida seleccionada',
      );
      this.validateGroupSelection(
        menuItem.name,
        offeredBeverages,
        selectedBeverages,
        menuItem.beverageGroupRequired,
        menuItem.beverageGroupMaxSelectable,
        { one: 'una bebida', many: 'bebida(s)' },
      );
      const selectedExtraPortions = this.resolveSelectedPriced(
        menuItem.extraPortions,
        item.extraPortionIds,
        menuItem.name,
        'la porción extra seleccionada',
      );
      this.validateGroupSelection(
        menuItem.name,
        menuItem.extraPortions,
        selectedExtraPortions,
        menuItem.extraPortionsGroupRequired,
        menuItem.extraPortionsGroupMaxSelectable,
        { one: 'una porción extra', many: 'porción extra(s)' },
      );
      const selectedFriesTypes = this.resolveSelectedFriesTypes(menuItem, item);
      this.validateGroupSelection(
        menuItem.name,
        menuItem.friesTypes,
        selectedFriesTypes === null
          ? null
          : selectedFriesTypes.map((name) => ({ name })),
        menuItem.friesTypeGroupRequired,
        menuItem.friesTypeGroupMaxSelectable,
        { one: 'un tipo de papas', many: 'tipo(s) de papas' },
      );
      const comment = this.resolveComment(item);
      // Las bebidas/porciones extras suman su precio aunque `unitPrice` sea 0 por
      // un premio canjeado — el premio cubre el producto base, no lo que el
      // cliente agregó encima (ver doc de OrderItem.subtotal).
      const extrasUnitPrice = this.round2(
        [...(selectedBeverages ?? []), ...(selectedExtraPortions ?? [])].reduce(
          (sum, selected) => sum + selected.price,
          0,
        ),
      );
      const subtotal = this.round2(
        (unitPrice + extrasUnitPrice) * item.quantity,
      );
      result.push(
        this.orderItemsRepository.create({
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPrice,
          quantity: item.quantity,
          subtotal,
          selectedSauces,
          selectedBeverages,
          selectedExtraPortions,
          selectedFriesTypes,
          comment,
        }),
      );
    }
    return { items: result, rewardClaims };
  }

  /**
   * Valida `friesTypeIds` contra los tipos de papas que el producto ofrece (400 si
   * no está en su lista) y devuelve el SNAPSHOT de nombres. Mismo tri-state que
   * `resolveSelectedSauces`: omitido → `null`; `[]` → `[]`; con ids → nombres.
   */
  private resolveSelectedFriesTypes(
    menuItem: MenuItem,
    item: CreateOrderItemDto,
  ): string[] | null {
    if (item.friesTypeIds === undefined) {
      return null;
    }
    const offeredById = new Map(
      (menuItem.friesTypes ?? []).map((type) => [type.id, type.name]),
    );
    return item.friesTypeIds.map((friesTypeId) => {
      const name = offeredById.get(friesTypeId);
      if (!name) {
        throw new BadRequestException(
          `El producto "${menuItem.name}" no ofrece el tipo de papas seleccionado`,
        );
      }
      return name;
    });
  }

  /**
   * Valida `sauceIds` contra las salsas que el producto realmente ofrece (400 si el
   * cliente manda una que no está en su lista) y devuelve el SNAPSHOT de nombres a
   * guardar en el OrderItem. Tri-state real, no colapsar `undefined` y `[]`:
   * - `undefined` (nunca se mandó el campo) → `null`: no aplica.
   * - `[]` (mandado explícito) → `[]`: el cliente eligió "Sin salsas" a propósito.
   * - con ids → nombres validados contra las salsas que ofrece el producto.
   */
  private resolveSelectedSauces(
    menuItem: MenuItem,
    item: CreateOrderItemDto,
  ): string[] | null {
    if (item.sauceIds === undefined) {
      return null;
    }
    if (item.sauceIds.length === 0) {
      return [];
    }
    const offeredById = new Map(
      (menuItem.sauces ?? []).map((sauce) => [sauce.id, sauce.name]),
    );
    const names: string[] = [];
    for (const sauceId of item.sauceIds) {
      const name = offeredById.get(sauceId);
      if (!name) {
        throw new BadRequestException(
          `El producto "${menuItem.name}" no ofrece la salsa seleccionada`,
        );
      }
      names.push(name);
    }
    return names;
  }

  /**
   * Valida `selectedIds` (bebidas o porciones extras) contra lo que el producto
   * realmente ofrece (400 si el cliente manda un id que no está en su lista) y
   * devuelve el SNAPSHOT `{ name, price }` a guardar en el OrderItem. Mismo
   * tri-state que `resolveSelectedSauces`, con precio (a diferencia de las
   * salsas, bebidas/porciones extras SÍ suman al subtotal — ver `buildItems`).
   */
  /**
   * Precio efectivo de cada bebida ofrecida por el producto: 0 si el producto
   * está en `beverage.includeFreeTo` (combo con bebida gratis incluida), su
   * `price` normal en caso contrario. Nunca modifica la entidad `Beverage` ni
   * su catálogo compartido — el precio 0 aplica solo a este `menuItem`. Mismo
   * criterio que `GET /menu` (`MenuService.findPublicMenu`): lo que se muestra
   * al cliente y lo que se cobra en `POST /orders` siempre deben coincidir.
   */
  private resolveBeveragePrices(
    menuItem: MenuItem,
  ): { id: string; name: string; price: number }[] {
    return (menuItem.beverages ?? []).map((beverage) => ({
      id: beverage.id,
      name: beverage.name,
      price: beverage.includeFreeTo?.includes(menuItem.id) ? 0 : beverage.price,
    }));
  }

  private resolveSelectedPriced(
    offered: { id: string; name: string; price: number }[] | undefined,
    selectedIds: string[] | undefined,
    menuItemName: string,
    notOfferedLabel: string,
  ): { name: string; price: number }[] | null {
    if (selectedIds === undefined) {
      return null;
    }
    if (selectedIds.length === 0) {
      return [];
    }
    const offeredById = new Map(
      (offered ?? []).map((option) => [option.id, option]),
    );
    const selected: { name: string; price: number }[] = [];
    for (const id of selectedIds) {
      const option = offeredById.get(id);
      if (!option) {
        throw new BadRequestException(
          `El producto "${menuItemName}" no ofrece ${notOfferedLabel}`,
        );
      }
      selected.push({ name: option.name, price: option.price });
    }
    return selected;
  }

  /**
   * Aplica `sauceGroupRequired`/`Max`, `beverageGroupRequired`/`Max` y
   * `extraPortionsGroupRequired`/`Max` del producto (config de OptionGroup)
   * contra lo que el cliente eligió. Sin esto,
   * el backend confiaba en que la app Flutter respetara esos límites — mismo
   * principio que el resto del proyecto ("el total y los subtotales se calculan
   * SIEMPRE en el backend, nunca se confía en el frontend"), hallazgo real de
   * `@tester` en la auditoría de esta feature.
   *
   * Sin efecto si el producto no ofrece nada de esta categoría (`offered` vacío
   * o ausente) — el `groupRequired`/`Max` configurado no importa si no hay nada
   * para elegir. `groupMaxSelectable === null` = sin tope máximo (el
   * `groupRequired` se sigue aplicando).
   */
  private validateGroupSelection(
    menuItemName: string,
    offered: { id: string }[] | undefined,
    selected: { name: string }[] | null,
    groupRequired: boolean,
    groupMaxSelectable: number | null,
    // Con artículo y plural propios: "una salsa" pero "un tipo de papas".
    itemLabel: { one: string; many: string },
  ): void {
    if (!offered || offered.length === 0) {
      return;
    }
    if (groupRequired && (selected === null || selected.length === 0)) {
      throw new BadRequestException(
        `El producto "${menuItemName}" requiere elegir al menos ${itemLabel.one}`,
      );
    }
    // `null` = sin límite (hoy solo `sauceGroupMaxSelectable` puede serlo).
    if (
      selected !== null &&
      groupMaxSelectable !== null &&
      selected.length > groupMaxSelectable
    ) {
      throw new BadRequestException(
        `El producto "${menuItemName}" permite elegir como máximo ${groupMaxSelectable} ${itemLabel.many}`,
      );
    }
  }

  /**
   * Comentario libre del ítem (texto simple, sin la lógica tri-state de
   * `resolveSelectedSauces`): trimea y devuelve `null` si queda vacío.
   */
  private resolveComment(item: CreateOrderItemDto): string | null {
    const trimmed = item.comment?.trim();
    return trimmed ? trimmed : null;
  }

  /** Link de WhatsApp: https://wa.me/<número>?text=<mensaje codificado>. */
  private async buildWhatsappUrl(
    orderId: string,
    items: WhatsappMessageItem[],
    total: number,
    addressSnapshot: string,
    subtotal: number,
    deliveryFee: number,
    discountAmount: number,
    couponCode: string | null,
    /** Celular del cliente (pedido manual del admin); null = número del negocio. */
    recipient: string | null = null,
  ): Promise<string> {
    // El número vive en la tabla settings (gestionable desde el panel). Si la tabla
    // está vacía, SettingsService cae al valor de .env y loguea un warning.
    const number =
      recipient ?? (await this.settingsService.getWhatsappNumber());
    const message = this.buildWhatsappMessage({
      // Al negocio le llega un pedido nuevo; al cliente, el resumen a confirmar.
      heading: recipient ? 'CONFIRMA TU PEDIDO' : 'NUEVO PEDIDO',
      orderId,
      items,
      total,
      addressSnapshot,
      subtotal,
      deliveryFee,
      discountAmount,
      couponCode,
    });
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }

  /**
   * Texto del mensaje de WhatsApp de un pedido. Único lugar que arma el mensaje:
   * lo usan la creación (`buildWhatsappUrl`) y los links de un pedido ya creado
   * (`getWhatsappLinks`), así ambos nunca divergen.
   */
  private buildWhatsappMessage(params: {
    heading: 'NUEVO PEDIDO' | 'CONFIRMA TU PEDIDO';
    orderId: string;
    items: WhatsappMessageItem[];
    total: number;
    addressSnapshot: string;
    subtotal: number;
    deliveryFee: number;
    discountAmount: number;
    couponCode: string | null;
  }): string {
    const {
      heading,
      orderId,
      items,
      total,
      addressSnapshot,
      subtotal,
      deliveryFee,
      discountAmount,
      couponCode,
    } = params;
    const itemsText = items
      .map((item) => {
        // null = no aplica (sin sufijo); [] = "Sin salsas" elegido a propósito;
        // con nombres = las salsas elegidas. No confundir [] con null.
        const sauces =
          item.selectedSauces === null
            ? ''
            : ` (Salsas: ${item.selectedSauces.length > 0 ? item.selectedSauces.join(', ') : 'Sin salsas'})`;
        // Bebidas/porciones extras: a diferencia de las salsas SÍ tienen precio,
        // así que se listan con su costo para que el dueño pueda verificar el
        // monto del ítem sin abrir el panel admin (mismo criterio que el
        // desglose de subtotal/cupón/envío más abajo).
        const beverages =
          item.selectedBeverages && item.selectedBeverages.length > 0
            ? ` (Bebidas: ${item.selectedBeverages
                .map((b) => `${b.name} +S/${b.price.toFixed(2)}`)
                .join(', ')})`
            : '';
        const extraPortions =
          item.selectedExtraPortions && item.selectedExtraPortions.length > 0
            ? ` (Extras: ${item.selectedExtraPortions
                .map((e) => `${e.name} +S/${e.price.toFixed(2)}`)
                .join(', ')})`
            : '';
        const friesTypes =
          item.selectedFriesTypes && item.selectedFriesTypes.length > 0
            ? ` (Papas: ${item.selectedFriesTypes.join(', ')})`
            : '';
        const comment = item.comment === null ? '' : ` — Nota: ${item.comment}`;
        return `  • ${item.quantity}x ${item.name}${friesTypes}${sauces}${beverages}${extraPortions}${comment}`;
      })
      .join('\n');
    // Desglose para que el dueño pueda verificar el monto sin abrir el panel admin:
    // subtotal → cupón (solo si hubo descuento real) → envío, y el total ya existente al final.
    // Sin código (no debería pasar en un pedido vigente) se muestra "Cupón" a secas
    // en vez de "Cupón (null)".
    const couponLabel = couponCode ? `Cupón (${couponCode})` : 'Cupón';
    const couponLine =
      discountAmount > 0
        ? `\n🎟️ *${couponLabel}:* -S/ ${discountAmount.toFixed(2)}`
        : '';
    return `📌 *${heading} #${orderId.slice(0, 8).toUpperCase()}*

🛒 *Detalle:*
${itemsText}

📍 *Dirección de entrega:*
  ${this.readableAddress(addressSnapshot)}${this.mapsLinksBlock(addressSnapshot)}

🧾 *Subtotal:* S/ ${subtotal.toFixed(2)}${couponLine}
🛵 *Envío:* S/ ${deliveryFee.toFixed(2)}
💰 *Total a pagar:* S/ ${total.toFixed(2)}`;
  }

  /** Convierte el snapshot JSON a texto legible para el mensaje de WhatsApp. */
  private readableAddress(snapshot: string): string {
    try {
      const parsed = JSON.parse(snapshot) as {
        fullAddress?: string;
        district?: string;
        reference?: string | null;
      };
      const parts = [parsed.fullAddress, parsed.district].filter(Boolean);
      const ref = parsed.reference ? ` (ref: ${parsed.reference})` : '';
      return `${parts.join(', ')}${ref}`;
    } catch {
      return snapshot;
    }
  }

  /**
   * Links de Google Maps + Waze a partir de las coordenadas del snapshot, como bloque
   * ya formateado (con los saltos de línea previos incluidos) para insertar tal cual
   * después de la dirección legible. Si el snapshot no trae latitude/longitude
   * (direcciones viejas o creadas sin pasar por el mapa), devuelve '' — el mensaje
   * queda exactamente igual que antes, sin línea vacía ni "N/A".
   */
  private mapsLinksBlock(snapshot: string): string {
    try {
      const parsed = JSON.parse(snapshot) as {
        latitude?: number | null;
        longitude?: number | null;
      };
      if (parsed.latitude == null || parsed.longitude == null) {
        return '';
      }
      const coords = `${parsed.latitude},${parsed.longitude}`;
      return `\n\n🗺️ Google Maps: https://www.google.com/maps/search/?api=1&query=${coords}\n🚗 Waze: https://waze.com/ul?ll=${coords}&navigate=yes`;
    } catch {
      return '';
    }
  }

  private round2(value: number): number {
    return Number(value.toFixed(2));
  }
}
