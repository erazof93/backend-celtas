import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { CouponsService } from '../coupons/coupons.service';
import { MenuItem } from '../menu/entities/menu-item.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { Address } from '../users/entities/address.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { CreateOrderDto, CreateOrderItemDto } from './dto/create-order.dto';
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
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
  ) {}

  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    const addressSnapshot = await this.resolveAddressSnapshot(userId, dto);
    const items = await this.buildItems(dto.items);
    const subtotal = this.round2(
      items.reduce((sum, item) => sum + item.subtotal, 0),
    );
    // El id se genera acá para poder construir el whatsappUrl y marcar el cupón usado.
    const orderId = randomUUID();

    // Transacción explícita: el pedido y el canje del cupón se crean/revientan juntos.
    return this.dataSource.transaction(async (manager) => {
      let total = subtotal;
      let coupon:
        | Awaited<ReturnType<CouponsService['applyToOrder']>>['coupon']
        | null = null;
      if (dto.couponCode) {
        const applied = await this.couponsService.applyToOrder(manager, {
          code: dto.couponCode,
          userId,
          subtotal,
        });
        total = applied.discountedTotal;
        coupon = applied.coupon;
      }

      const order = manager.create(Order, {
        id: orderId,
        userId,
        status: OrderStatus.PENDIENTE,
        addressSnapshot,
        total,
        items,
      } as Partial<Order>);
      order.whatsappUrl = await this.buildWhatsappUrl(
        orderId,
        items,
        total,
        addressSnapshot,
      );

      const savedOrder = await manager.save(Order, order);

      // Marcar el cupón usado DESPUÉS de persistir el pedido (la FK usedInOrderId
      // debe apuntar a un pedido que ya exista). Si algo falla, todo se revierte.
      if (coupon) {
        await this.couponsService.markUsed(manager, coupon, savedOrder.id);
      }

      return savedOrder;
    });
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
      relations: { items: true },
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
      relations: { items: true },
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
      });
    }
    if (dto.addressSnapshot) {
      return dto.addressSnapshot;
    }
    throw new BadRequestException(
      'Debes indicar una dirección (addressId o addressSnapshot)',
    );
  }

  /** Valida los productos y construye los OrderItem con precio/nombre SNAPSHOT y subtotales. */
  private async buildItems(items: CreateOrderItemDto[]): Promise<OrderItem[]> {
    const ids = items.map((item) => item.menuItemId);
    const menuItems = await this.menuItemsRepository.find({
      where: { id: In(ids) },
    });
    const byId = new Map(menuItems.map((menuItem) => [menuItem.id, menuItem]));

    const result: OrderItem[] = [];
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
      const subtotal = this.round2(menuItem.price * item.quantity);
      result.push(
        this.orderItemsRepository.create({
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPrice: menuItem.price,
          quantity: item.quantity,
          subtotal,
        }),
      );
    }
    return result;
  }

  /** Link de WhatsApp: https://wa.me/<número>?text=<mensaje codificado>. */
  private async buildWhatsappUrl(
    orderId: string,
    items: { name: string; quantity: number }[],
    total: number,
    addressSnapshot: string,
  ): Promise<string> {
    // El número vive en la tabla settings (gestionable desde el panel). Si la tabla
    // está vacía, SettingsService cae al valor de .env y loguea un warning.
    const number = await this.settingsService.getWhatsappNumber();
    const itemsText = items
      .map((item) => `${item.quantity}x ${item.name}`)
      .join(', ');
    //const message = `Pedido #${orderId} - ${itemsText} - Total: S/${total.toFixed(2)} - Dirección: ${this.readableAddress(addressSnapshot)}`;
    const message = `📌 *NUEVO PEDIDO #${orderId.slice(0, 8).toUpperCase()}*

🛒 *Detalle:*
${itemsText
  .split(', ')
  .map((item) => `  • ${item}`)
  .join('\n')}

📍 *Dirección de entrega:*
  ${this.readableAddress(addressSnapshot)}

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

  private round2(value: number): number {
    return Number(value.toFixed(2));
  }
}
