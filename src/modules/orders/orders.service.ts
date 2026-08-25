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
import { CouponsService } from '../coupons/coupons.service';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RewardRedemption } from '../rewards/entities/reward-redemption.entity';
import { RewardsService } from '../rewards/rewards.service';
import { DeliveryFeeTier, SettingsService } from '../settings/settings.service';
import { Address } from '../users/entities/address.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { CreateOrderDto, CreateOrderItemDto } from './dto/create-order.dto';
import { EstimateDeliveryFeeDto } from './dto/estimate-delivery-fee.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus } from './entities/order.entity';

/** Transiciones válidas de estado (no se puede saltar ni retroceder). */
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDIENTE]: [OrderStatus.CONFIRMADO, OrderStatus.CANCELADO],
  [OrderStatus.CONFIRMADO]: [OrderStatus.EN_CAMINO, OrderStatus.CANCELADO],
  [OrderStatus.EN_CAMINO]: [OrderStatus.ENTREGADO],
  [OrderStatus.ENTREGADO]: [],
  [OrderStatus.CANCELADO]: [],
};

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

    const addressSnapshot = await this.resolveAddressSnapshot(userId, dto);
    const { deliveryFee, isFarOrder } =
      await this.resolveDelivery(addressSnapshot);
    const { items, rewardClaims } = await this.buildItems(dto.items);
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

  /** Lista los pedidos del usuario autenticado (más recientes primero). */
  async findMyOrders(userId: string): Promise<Order[]> {
    return this.ordersRepository.find({
      where: { userId },
      relations: { items: true },
      order: { createdAt: 'DESC' },
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
   * pendiente a entregado; cancelado solo desde pendiente/confirmado). Al pasar a
   * `entregado` suma el total al `user.totalSpent` dentro de la misma transacción;
   * al pasar a `cancelado` reactiva el cupón que el pedido hubiera canjeado.
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

        order.status = dto.status;

        if (dto.status === OrderStatus.CANCELADO) {
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
          const user = await manager.findOne(User, {
            where: { id: order.userId },
          });
          if (!user) {
            throw new NotFoundException('Usuario del pedido no encontrado');
          }
          user.totalSpent = this.round2(user.totalSpent + order.total);
          await manager.save(User, user);
          // Marca la entrega real: las ventas del dashboard se miden con esta fecha.
          order.deliveredAt = new Date();
        }

        return manager.save(Order, order);
      })
      .then(async (saved) => {
        // Disparo directo del módulo de cupones tras el commit (el cron es el respaldo).
        // Si falla, no debe romper la respuesta del PATCH: la entrega ya quedó registrada.
        if (saved.status === OrderStatus.ENTREGADO) {
          try {
            await this.couponsService.checkAndGenerateForUser(saved.userId);
          } catch (err) {
            this.logger.error(
              `No se pudo generar el cupón automático para el usuario ${saved.userId}`,
              err as Error,
            );
          }
          try {
            await this.rewardsService.recalculateForUser(saved.userId);
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
        await this.notificationsService.sendPushNotification(saved.userId, {
          title: `Tu pedido está ${this.statusLabel(saved.status)}`,
          body: `El estado de tu pedido #${saved.id} cambió a "${this.statusLabel(saved.status)}".`,
          data: { orderId: saved.id, status: saved.status },
        });

        return saved;
      });
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
    userId: string,
    dto: CreateOrderDto,
  ): Promise<string> {
    if (dto.addressId) {
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

    return {
      deliveryFee: this.feeForDistance(distanceMeters, tiers),
      isFarOrder: distanceMeters > alertRadiusMeters,
      distanceMeters,
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
      relations: { sauces: true },
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
      if (!menuItem.available) {
        throw new BadRequestException(
          `El producto "${menuItem.name}" no está disponible`,
        );
      }

      let unitPrice = menuItem.price;
      if (item.rewardRedemptionId) {
        if (!menuItem.redeemableWithStars) {
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
      const comment = this.resolveComment(item);
      const subtotal = this.round2(unitPrice * item.quantity);
      result.push(
        this.orderItemsRepository.create({
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPrice,
          quantity: item.quantity,
          subtotal,
          selectedSauces,
          comment,
        }),
      );
    }
    return { items: result, rewardClaims };
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
    items: {
      name: string;
      quantity: number;
      selectedSauces: string[] | null;
      comment: string | null;
    }[],
    total: number,
    addressSnapshot: string,
    subtotal: number,
    deliveryFee: number,
    discountAmount: number,
    couponCode: string | null,
  ): Promise<string> {
    // El número vive en la tabla settings (gestionable desde el panel). Si la tabla
    // está vacía, SettingsService cae al valor de .env y loguea un warning.
    const number = await this.settingsService.getWhatsappNumber();
    const itemsText = items
      .map((item) => {
        // null = no aplica (sin sufijo); [] = "Sin salsas" elegido a propósito;
        // con nombres = las salsas elegidas. No confundir [] con null.
        const sauces =
          item.selectedSauces === null
            ? ''
            : ` (Salsas: ${item.selectedSauces.length > 0 ? item.selectedSauces.join(', ') : 'Sin salsas'})`;
        const comment = item.comment === null ? '' : ` — Nota: ${item.comment}`;
        return `  • ${item.quantity}x ${item.name}${sauces}${comment}`;
      })
      .join('\n');
    // Desglose para que el dueño pueda verificar el monto sin abrir el panel admin:
    // subtotal → cupón (solo si hubo descuento real) → envío, y el total ya existente al final.
    const couponLine =
      discountAmount > 0
        ? `\n🎟️ *Cupón (${couponCode}):* -S/ ${discountAmount.toFixed(2)}`
        : '';
    const message = `📌 *NUEVO PEDIDO #${orderId.slice(0, 8).toUpperCase()}*

🛒 *Detalle:*
${itemsText}

📍 *Dirección de entrega:*
  ${this.readableAddress(addressSnapshot)}${this.mapsLinksBlock(addressSnapshot)}

🧾 *Subtotal:* S/ ${subtotal.toFixed(2)}${couponLine}
🛵 *Envío:* S/ ${deliveryFee.toFixed(2)}
💰 *Total a pagar:* S/ ${total.toFixed(2)}`;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
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
