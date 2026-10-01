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

/** Zona horaria de Lima (UTC-5, sin horario de verano). */
const LIMA_TIMEZONE = 'America/Lima';
const LIMA_OFFSET = '-05:00';

/** Días por defecto de las series diarias (revenue-trend, new-customers). */
const DEFAULT_TREND_DAYS = 7;

/**
 * `createdAt` (orders/users) es `timestamp` SIN zona, escrito por `now()` de la
 * BD en la zona de su sesión (UTC en Supabase y en el Postgres local). Se convierte
 * a instante real con esa misma zona antes de comparar o agrupar.
 *
 * Comparar la columna cruda contra un Date de JS depende de la zona del proceso
 * Node: pg serializa el Date con el offset local y Postgres IGNORA el offset al
 * castearlo a `timestamp`. En Render (Node en UTC) coincidía; con Node en Lima
 * (desarrollo local) los rangos quedaban corridos 5 horas.
 */
const createdAtInstant = (alias: string): string =>
  `(${alias}.createdAt AT TIME ZONE current_setting('TimeZone'))`;

/** Día calendario (YYYY-MM-DD) en Lima de una expresión timestamptz. */
const limaDay = (instant: string): string =>
  `to_char(${instant} AT TIME ZONE '${LIMA_TIMEZONE}', 'YYYY-MM-DD')`;

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
 * SERIES DIARIAS: se agrupan por día de Lima en SQL. `deliveredAt` es timestamptz;
 * `createdAt` es timestamp SIN zona y pasa antes por `createdAtInstant`.
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
      .where(`${createdAtInstant('order')} >= :start`, { start })
      .andWhere(`${createdAtInstant('order')} <= :end`, { end })
      .getCount();

    const statusRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where(`${createdAtInstant('order')} >= :start`, { start })
      .andWhere(`${createdAtInstant('order')} <= :end`, { end })
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
    const today = this.todayInLima();
    const weekStart = this.mondayOf(today);
    const monthStart = `${today.slice(0, 8)}01`;

    const todayMetrics = await this.periodMetrics(today, today);
    const weekMetrics = await this.periodMetrics(weekStart, today);
    const monthMetrics = await this.periodMetrics(monthStart, today);
    const { start, end } = this.rangeBounds(monthStart, today);
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
    const { start, end } = this.rangeBounds(dates[0], dates[dates.length - 1]);

    const revenueRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select(limaDay('order.deliveredAt'), 'day')
      .addSelect('COALESCE(SUM(order.total), 0)', 'revenue')
      .where('order.deliveredAt IS NOT NULL')
      .andWhere('order.deliveredAt >= :start', { start })
      .andWhere('order.deliveredAt <= :end', { end })
      .groupBy('"day"')
      .getRawMany<{ day: string; revenue: string }>();

    const orderRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select(limaDay(createdAtInstant('order')), 'day')
      .addSelect('order.source', 'source')
      .addSelect('COUNT(*)', 'count')
      .where(`${createdAtInstant('order')} >= :start`, { start })
      .andWhere(`${createdAtInstant('order')} <= :end`, { end })
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
    const { start, end } = this.rangeBounds(dates[0], dates[dates.length - 1]);
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
    const { start, end } = this.rangeBounds(from, to);
    const sourceRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select('order.source', 'source')
      .addSelect('COUNT(*)', 'count')
      .where(`${createdAtInstant('order')} >= :start`, { start })
      .andWhere(`${createdAtInstant('order')} <= :end`, { end })
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
      .select(limaDay(createdAtInstant('user')), 'day')
      .addSelect('COUNT(*)', 'count')
      .where('user.role = :role', { role: UserRole.CLIENTE })
      .andWhere(`${createdAtInstant('user')} >= :start`, { start })
      .andWhere(`${createdAtInstant('user')} <= :end`, { end })
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
    const from = query.from ?? this.todayInLima();
    const to = query.to ?? from;
    return this.rangeBounds(from, to);
  }

  /** Rango de los últimos N días incluyendo hoy, en Lima. */
  private lastDaysRange(days: number): { start: Date; end: Date } {
    const dates = this.lastDays(days);
    return this.rangeBounds(dates[0], dates[dates.length - 1]);
  }

  /** Inicio (00:00:00.000) de `from` y fin (23:59:59.999) de `to`, en Lima. */
  private rangeBounds(from: string, to: string): { start: Date; end: Date } {
    return {
      start: new Date(`${from}T00:00:00.000${LIMA_OFFSET}`),
      end: new Date(`${to}T23:59:59.999${LIMA_OFFSET}`),
    };
  }

  /** Los últimos N días (YYYY-MM-DD) en Lima, en orden ascendente, terminando hoy. */
  private lastDays(days: number): string[] {
    const today = this.todayInLima();
    return Array.from({ length: days }, (_, i) =>
      this.shiftDate(today, i - (days - 1)),
    );
  }

  /** Lunes de la semana de `date` (YYYY-MM-DD). */
  private mondayOf(date: string): string {
    const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay(); // 0=domingo
    return this.shiftDate(date, -((dayOfWeek + 6) % 7));
  }

  /** Suma `days` días a una fecha calendario YYYY-MM-DD (aritmética en UTC, sin zona). */
  private shiftDate(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** Fecha calendario (YYYY-MM-DD) de un instante, en la zona horaria de Lima. */
  private toLimaDate(instant: Date): string {
    return instant.toLocaleDateString('en-CA', { timeZone: LIMA_TIMEZONE });
  }

  /** Fecha de hoy (YYYY-MM-DD) en la zona horaria de Lima. */
  private todayInLima(): string {
    return this.toLimaDate(new Date());
  }
}
