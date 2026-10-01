import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from '../orders/entities/order-item.entity';
import {
  Order,
  OrderSource,
  OrderStatus,
} from '../orders/entities/order.entity';
import { User, UserRole } from '../users/entities/user.entity';
import {
  DashboardQueryDto,
  DaysQueryDto,
  TopProductsQueryDto,
} from './dto/dashboard-query.dto';
import {
  limaDayRange,
  limaDaySql,
  mondayOfCalendarDate,
  shiftCalendarDate,
  toLimaDateString,
} from '../../common/utils/lima-time.util';

/** Días por defecto de las series diarias (revenue-trend, new-customers). */
const DEFAULT_TREND_DAYS = 7;

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

/** Métricas de un período: pedidos creados (por canal) y ventas entregadas. */
export interface PeriodMetrics {
  orders: number;
  revenue: number;
  ordersApp: number;
  ordersPhone: number;
}

export interface DashboardMetrics {
  today: PeriodMetrics;
  week: PeriodMetrics;
  month: PeriodMetrics & { newCustomers: number };
}

export interface RevenueTrendDay {
  date: string;
  revenue: number;
  ordersApp: number;
  ordersPhone: number;
}

export interface NewCustomersResult {
  total: number;
  byDay: { date: string; count: number }[];
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
 *
 * PEDIDOS: los conteos de pedidos (`orders`, `ordersApp`, `ordersPhone`) se miden
 * por `createdAt` e incluyen todos los estados, igual que `summary.ordersCount`.
 * `ordersPhone` = pedidos con `source = admin` (cargados desde el panel).
 *
 * SERIES DIARIAS: se agrupan por día de Lima en SQL. Todas las fechas son
 * timestamptz, así que los rangos se comparan directo contra los Date de JS.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
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

    return {
      ordersCount,
      ordersByStatus: statusRows.map((row) => ({
        status: row.status,
        count: parseInt(row.count, 10),
      })),
      revenue: await this.deliveredRevenue(start, end),
    };
  }

  /** Hoy, semana calendario (desde el lunes) y mes calendario (desde el día 1), en Lima. */
  async metrics(): Promise<DashboardMetrics> {
    const today = toLimaDateString();
    const weekStart = mondayOfCalendarDate(today);
    const monthStart = `${today.slice(0, 8)}01`;

    const todayMetrics = await this.periodMetrics(today, today);
    const weekMetrics = await this.periodMetrics(weekStart, today);
    const monthMetrics = await this.periodMetrics(monthStart, today);
    const { start, end } = limaDayRange(monthStart, today);
    const newCustomers = (await this.newCustomersByDay(start, end)).reduce(
      (sum, row) => sum + row.count,
      0,
    );

    return {
      today: todayMetrics,
      week: weekMetrics,
      month: { ...monthMetrics, newCustomers },
    };
  }

  /** Serie diaria de los últimos N días (incluye hoy y los días sin movimiento, en 0). */
  async revenueTrend(query: DaysQueryDto): Promise<RevenueTrendDay[]> {
    const dates = this.lastDays(query.days ?? DEFAULT_TREND_DAYS);
    const { start, end } = limaDayRange(dates[0], dates[dates.length - 1]);

    const revenueRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select(limaDaySql('order.deliveredAt'), 'day')
      .addSelect('COALESCE(SUM(order.total), 0)', 'revenue')
      .where('order.deliveredAt IS NOT NULL')
      .andWhere('order.deliveredAt >= :start', { start })
      .andWhere('order.deliveredAt <= :end', { end })
      .groupBy('"day"')
      .getRawMany<{ day: string; revenue: string }>();

    const orderRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select(limaDaySql('order.createdAt'), 'day')
      .addSelect('order.source', 'source')
      .addSelect('COUNT(*)', 'count')
      .where('order.createdAt >= :start', { start })
      .andWhere('order.createdAt <= :end', { end })
      .groupBy('"day"')
      .addGroupBy('order.source')
      .getRawMany<{ day: string; source: OrderSource; count: string }>();

    const byDay = new Map<string, RevenueTrendDay>(
      dates.map((date) => [
        date,
        { date, revenue: 0, ordersApp: 0, ordersPhone: 0 },
      ]),
    );
    for (const row of revenueRows) {
      const day = byDay.get(row.day);
      if (day) day.revenue = parseFloat(row.revenue);
    }
    for (const row of orderRows) {
      const day = byDay.get(row.day);
      if (!day) continue;
      const count = parseInt(row.count, 10);
      if (row.source === OrderSource.ADMIN) day.ordersPhone += count;
      else day.ordersApp += count;
    }
    return [...byDay.values()];
  }

  /** Clientes (rol cliente) registrados en los últimos N días, total y por día. */
  async newCustomers(query: DaysQueryDto): Promise<NewCustomersResult> {
    const dates = this.lastDays(query.days ?? DEFAULT_TREND_DAYS);
    const { start, end } = limaDayRange(dates[0], dates[dates.length - 1]);
    const rows = await this.newCustomersByDay(start, end);

    const counts = new Map<string, number>(dates.map((date) => [date, 0]));
    for (const row of rows) {
      if (counts.has(row.day)) counts.set(row.day, row.count);
    }
    const byDay = [...counts.entries()].map(([date, count]) => ({
      date,
      count,
    }));
    return {
      total: byDay.reduce((sum, day) => sum + day.count, 0),
      byDay,
    };
  }

  async topProducts(query: TopProductsQueryDto): Promise<TopProductsResult> {
    const { start, end } = query.days
      ? this.lastDaysRange(query.days)
      : this.resolveRange(query);
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

  /** Pedidos creados en el período (por canal) + ventas entregadas en el período. */
  private async periodMetrics(
    from: string,
    to: string,
  ): Promise<PeriodMetrics> {
    const { start, end } = limaDayRange(from, to);
    const sourceRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.source', 'source')
      .addSelect('COUNT(*)', 'count')
      .where('order.createdAt >= :start', { start })
      .andWhere('order.createdAt <= :end', { end })
      .groupBy('order.source')
      .getRawMany<{ source: OrderSource; count: string }>();

    let ordersApp = 0;
    let ordersPhone = 0;
    for (const row of sourceRows) {
      const count = parseInt(row.count, 10);
      if (row.source === OrderSource.ADMIN) ordersPhone += count;
      else ordersApp += count;
    }
    return {
      orders: ordersApp + ordersPhone,
      revenue: await this.deliveredRevenue(start, end),
      ordersApp,
      ordersPhone,
    };
  }

  /** Suma de `total` de los pedidos ENTREGADOS en [start, end] (por deliveredAt). */
  private async deliveredRevenue(start: Date, end: Date): Promise<number> {
    const row = await this.ordersRepository
      .createQueryBuilder('order')
      .select('COALESCE(SUM(order.total), 0)', 'revenue')
      .where('order.deliveredAt IS NOT NULL')
      .andWhere('order.deliveredAt >= :start', { start })
      .andWhere('order.deliveredAt <= :end', { end })
      .getRawOne<{ revenue: string }>();
    return parseFloat(row?.revenue ?? '0');
  }

  /** Clientes (rol cliente) registrados en [start, end], agrupados por día de Lima. */
  private async newCustomersByDay(
    start: Date,
    end: Date,
  ): Promise<{ day: string; count: number }[]> {
    const rows = await this.usersRepository
      .createQueryBuilder('user')
      .select(limaDaySql('user.createdAt'), 'day')
      .addSelect('COUNT(*)', 'count')
      .where('user.role = :role', { role: UserRole.CLIENTE })
      .andWhere('user.createdAt >= :start', { start })
      .andWhere('user.createdAt <= :end', { end })
      .groupBy('"day"')
      .getRawMany<{ day: string; count: string }>();
    return rows.map((row) => ({
      day: row.day,
      count: parseInt(row.count, 10),
    }));
  }

  /**
   * Resuelve el rango [start, end] en Lima. Si no vienen fechas, usa "hoy" en Lima.
   * `start` = 00:00:00.000 y `end` = 23:59:59.999 del día (o días) en America/Lima.
   */
  private resolveRange(query: DashboardQueryDto): {
    start: Date;
    end: Date;
  } {
    const from = query.from ?? toLimaDateString();
    const to = query.to ?? from;
    return limaDayRange(from, to);
  }

  /** Rango de los últimos N días incluyendo hoy, en Lima. */
  private lastDaysRange(days: number): { start: Date; end: Date } {
    const dates = this.lastDays(days);
    return limaDayRange(dates[0], dates[dates.length - 1]);
  }

  /** Los últimos N días (YYYY-MM-DD) en Lima, en orden ascendente, terminando hoy. */
  private lastDays(days: number): string[] {
    const today = toLimaDateString();
    return Array.from({ length: days }, (_, i) =>
      shiftCalendarDate(today, i - (days - 1)),
    );
  }
}
