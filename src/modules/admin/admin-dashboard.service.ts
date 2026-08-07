import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import {
  DashboardQueryDto,
  TopProductsQueryDto,
} from './dto/dashboard-query.dto';

/** Zona horaria de Lima (UTC-5, sin horario de verano). */
const LIMA_TIMEZONE = 'America/Lima';
const LIMA_OFFSET = '-05:00';

export interface DashboardSummary {
  ordersCount: number;
  ordersByStatus: { status: OrderStatus; count: number }[];
  revenue: number;
}

export interface TopProduct {
  menuItemId: string | null;
  name: string;
  quantity: number;
  revenue: number;
}

export interface TopProductsResult {
  items: TopProduct[];
  limit: number;
}

/**
 * Dashboard del panel admin.
 *
 * ZONA HORARIA: todas las métricas se calculan sobre el día en America/Lima. El
 * rango [from, to] se interpreta como días completos en Lima (00:00:00.000 a
 * 23:59:59.999). No se usa UTC directo porque contaría mal las horas de la noche
 * (Lima es UTC-5).
 *
 * VENTAS: `revenue` y `top-products` se miden por `deliveredAt` (cuándo se entregó
 * realmente), NO por `createdAt`. Un pedido creado ayer pero entregado hoy cuenta
 * en las ventas de hoy. Los pedidos cancelados o pendientes no tienen `deliveredAt`
 * y por eso quedan fuera de las ventas.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
  ) {}

  async summary(query: DashboardQueryDto): Promise<DashboardSummary> {
    const { start, end } = this.resolveRange(query);

    const ordersCount = await this.ordersRepository
      .createQueryBuilder('order')
      .where('order.createdAt >= :start', { start })
      .andWhere('order.createdAt <= :end', { end })
      .getCount();

    const statusRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('order.createdAt >= :start', { start })
      .andWhere('order.createdAt <= :end', { end })
      .groupBy('order.status')
      .getRawMany<{ status: OrderStatus; count: string }>();

    const revenueRow = await this.ordersRepository
      .createQueryBuilder('order')
      .select('COALESCE(SUM(order.total), 0)', 'revenue')
      .where('order.deliveredAt IS NOT NULL')
      .andWhere('order.deliveredAt >= :start', { start })
      .andWhere('order.deliveredAt <= :end', { end })
      .getRawOne<{ revenue: string }>();

    return {
      ordersCount,
      ordersByStatus: statusRows.map((row) => ({
        status: row.status,
        count: parseInt(row.count, 10),
      })),
      revenue: parseFloat(revenueRow?.revenue ?? '0'),
    };
  }

  async topProducts(query: TopProductsQueryDto): Promise<TopProductsResult> {
    const { start, end } = this.resolveRange(query);
    const limit = query.limit ?? 10;

    const rows = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(Order, 'order', 'order.id = item.orderId')
      .select('item.menuItemId', 'menuItemId')
      .addSelect('MAX(item.name)', 'name')
      .addSelect('SUM(item.quantity)', 'quantity')
      .addSelect('SUM(item.unitPrice * item.quantity)', 'revenue')
      .where('order.deliveredAt IS NOT NULL')
      .andWhere('order.deliveredAt >= :start', { start })
      .andWhere('order.deliveredAt <= :end', { end })
      .groupBy('item.menuItemId')
      .orderBy('"quantity"', 'DESC')
      .limit(limit)
      .getRawMany<{
        menuItemId: string | null;
        name: string;
        quantity: string;
        revenue: string;
      }>();

    return {
      items: rows.map((row) => ({
        menuItemId: row.menuItemId,
        name: row.name,
        quantity: parseInt(row.quantity, 10),
        revenue: parseFloat(row.revenue),
      })),
      limit,
    };
  }

  /**
   * Resuelve el rango [start, end] en Lima. Si no vienen fechas, usa "hoy" en Lima.
   * `start` = 00:00:00.000 y `end` = 23:59:59.999 del día (o días) en America/Lima.
   */
  private resolveRange(query: DashboardQueryDto): {
    start: Date;
    end: Date;
  } {
    const from = query.from ?? this.todayInLima();
    const to = query.to ?? from;
    const start = new Date(`${from}T00:00:00.000${LIMA_OFFSET}`);
    const end = new Date(`${to}T23:59:59.999${LIMA_OFFSET}`);
    return { start, end };
  }

  /** Fecha de hoy (YYYY-MM-DD) en la zona horaria de Lima. */
  private todayInLima(): string {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: LIMA_TIMEZONE,
    });
  }
}
