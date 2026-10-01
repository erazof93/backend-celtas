import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  calendarDatesBetween,
  limaDayRange,
  limaDaySql,
  mondayOfCalendarDate,
} from '../../common/utils/lima-time.util';
import { normalizePhone } from '../../common/utils/phone.util';
import { OrderItem } from '../orders/entities/order-item.entity';
import {
  Order,
  OrderSource,
  OrderStatus,
} from '../orders/entities/order.entity';
import { User, UserRole } from '../users/entities/user.entity';
import {
  ReportChannel,
  ReportComparisonQueryDto,
  ReportDailyMetricsQueryDto,
  ReportGroupBy,
  ReportRangeQueryDto,
  ReportSummaryQueryDto,
  ReportTopProductsQueryDto,
} from './dto/report-query.dto';
import { parsePeriod } from './dto/report-range.validators';

/** Métricas de un conjunto de pedidos entregados. */
export interface ChannelMetrics {
  revenue: number;
  orders: number;
  customers: number;
  averageTicket: number;
}

export interface SummaryRow {
  period: string;
  revenue: number;
  revenueApp: number;
  revenuePhone: number;
  orders: number;
  ordersApp: number;
  ordersPhone: number;
  customers: number;
  customersApp: number;
  customersPhone: number;
  averageTicket: number;
  averageTicketApp: number;
  averageTicketPhone: number;
}

export interface ReportSummary {
  period: { start: string; end: string };
  summary: {
    totalRevenue: number;
    totalOrders: number;
    totalCustomers: number;
    averageTicket: number;
  };
  byChannel: { app: ChannelMetrics; phone: ChannelMetrics };
  data: SummaryRow[];
}

interface PeriodTotals {
  period: string;
  revenue: number;
  orders: number;
  averageTicket: number;
}

export interface ReportComparison {
  current: PeriodTotals;
  previous: PeriodTotals;
  comparison: {
    revenueChange: string | null;
    ordersChange: string | null;
    ticketChange: string | null;
  };
  byChannel: Record<
    'app' | 'phone',
    {
      current: { revenue: number; change: string | null };
      previous: { revenue: number };
    }
  >;
}

export interface ReportTopProduct {
  id: string | null;
  name: string;
  quantity: number;
  revenue: number;
  revenuePercentage: number;
  quantityPercentage: number;
  averagePrice: number;
  byChannel: Record<'app' | 'phone', { quantity: number; revenue: number }>;
}

export interface ReportConversion {
  period: string;
  phoneOrders: number;
  phoneCustomers: number;
  convertedToApp: number;
  conversionRate: string;
  timeline: {
    phoneOrderDate: string;
    appOrderDate: string;
    daysDiff: number;
  }[];
}

export interface DailyMetricsDay {
  date: string;
  revenue: number;
  revenueApp: number;
  revenuePhone: number;
  orders: number;
  ordersApp: number;
  ordersPhone: number;
  customers: number;
  averageTicket: number;
  deliveredOrders?: number;
  pendingOrders?: number;
  cancelledOrders?: number;
}

/** Pedido ENTREGADO normalizado para agregar en memoria. */
interface DeliveredOrder {
  /** Día de entrega (YYYY-MM-DD) en Lima. */
  day: string;
  deliveredAt: Date;
  channel: 'app' | 'phone';
  total: number;
  /** Identidad del cliente: userId, o `tel:<celular>` si es anónimo sin cuenta. */
  customer: string;
}

/** Acumulador de un canal. */
interface Bucket {
  revenue: number;
  orders: number;
  customers: Set<string>;
}

interface Totals {
  all: Bucket;
  app: Bucket;
  phone: Bucket;
}

const channelOf = (source: OrderSource): 'app' | 'phone' =>
  source === OrderSource.ADMIN ? 'phone' : 'app';

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round1 = (value: number): number => Math.round(value * 10) / 10;

const emptyBucket = (): Bucket => ({
  revenue: 0,
  orders: 0,
  customers: new Set(),
});

const aggregate = (orders: DeliveredOrder[]): Totals => {
  const totals: Totals = {
    all: emptyBucket(),
    app: emptyBucket(),
    phone: emptyBucket(),
  };
  for (const order of orders) {
    for (const bucket of [totals.all, totals[order.channel]]) {
      bucket.revenue += order.total;
      bucket.orders += 1;
      bucket.customers.add(order.customer);
    }
  }
  return totals;
};

const averageTicket = (bucket: Bucket): number =>
  bucket.orders > 0 ? round2(bucket.revenue / bucket.orders) : 0;

const toMetrics = (bucket: Bucket): ChannelMetrics => ({
  revenue: round2(bucket.revenue),
  orders: bucket.orders,
  customers: bucket.customers.size,
  averageTicket: averageTicket(bucket),
});

/**
 * Variación porcentual con 1 decimal y signo ("+11.6%", "-3.0%", "0.0%"). null
 * si el valor anterior es 0: no hay base para un porcentaje.
 */
export const percentChange = (
  current: number,
  previous: number,
): string | null => {
  if (previous === 0) return null;
  const change = round1(((current - previous) / previous) * 100);
  if (change === 0) return '0.0%';
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
};

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );

/**
 * Reportes del panel admin (app vs. teléfono).
 *
 * BASE: revenue, orders, customers y averageTicket salen SIEMPRE del mismo
 * conjunto: pedidos ENTREGADOS en el rango, por `deliveredAt` en America/Lima.
 * Así averageTicket = revenue / orders es coherente. Única excepción:
 * daily-metrics con includeStatus, que cuenta pedidos CREADOS ese día por estado.
 *
 * CANAL: `app` = `source` app (POST /orders); `phone` = `source` admin (cargado
 * desde el panel). revenue = `order.total` (incluye delivery y descuentos), igual
 * que el dashboard; en top-products, revenue de producto = unitPrice × quantity.
 *
 * CLIENTE: `userId`; si el pedido es anónimo, el cliente registrado con ese mismo
 * celular (ambos normalizados con normalizePhone); si no hay, `tel:<celular>`.
 * Un cliente que compró por los dos canales cuenta una vez en el total.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async summary(query: ReportSummaryQueryDto): Promise<ReportSummary> {
    const { startDate, endDate } = query;
    const groupBy = query.groupBy ?? ReportGroupBy.DAY;
    const orders = await this.deliveredOrders(startDate, endDate);
    const totals = aggregate(orders);

    const periodOf = (day: string): string => {
      if (groupBy === ReportGroupBy.WEEK) return mondayOfCalendarDate(day);
      if (groupBy === ReportGroupBy.MONTH) return `${day.slice(0, 8)}01`;
      return day;
    };
    // Todos los períodos del rango (incluye los vacíos), en orden.
    const byPeriod = new Map<string, DeliveredOrder[]>();
    for (const day of calendarDatesBetween(startDate, endDate)) {
      if (!byPeriod.has(periodOf(day))) byPeriod.set(periodOf(day), []);
    }
    for (const order of orders) byPeriod.get(periodOf(order.day))?.push(order);

    const data = [...byPeriod.entries()].map(([period, periodOrders]) => {
      const t = aggregate(periodOrders);
      return {
        period,
        revenue: round2(t.all.revenue),
        revenueApp: round2(t.app.revenue),
        revenuePhone: round2(t.phone.revenue),
        orders: t.all.orders,
        ordersApp: t.app.orders,
        ordersPhone: t.phone.orders,
        customers: t.all.customers.size,
        customersApp: t.app.customers.size,
        customersPhone: t.phone.customers.size,
        averageTicket: averageTicket(t.all),
        averageTicketApp: averageTicket(t.app),
        averageTicketPhone: averageTicket(t.phone),
      };
    });

    return {
      period: { start: startDate, end: endDate },
      summary: {
        totalRevenue: round2(totals.all.revenue),
        totalOrders: totals.all.orders,
        totalCustomers: totals.all.customers.size,
        averageTicket: averageTicket(totals.all),
      },
      byChannel: { app: toMetrics(totals.app), phone: toMetrics(totals.phone) },
      data,
    };
  }

  async comparison(query: ReportComparisonQueryDto): Promise<ReportComparison> {
    // El DTO ya validó el formato con IsPeriodRange.
    const current = parsePeriod(query.current)!;
    const previous = parsePeriod(query.previous)!;
    const cur = aggregate(await this.deliveredOrders(current.from, current.to));
    const prev = aggregate(
      await this.deliveredOrders(previous.from, previous.to),
    );

    const totalsOf = (
      period: { from: string; to: string },
      t: Totals,
    ): PeriodTotals => ({
      period: `${period.from} al ${period.to}`,
      revenue: round2(t.all.revenue),
      orders: t.all.orders,
      averageTicket: averageTicket(t.all),
    });
    const channel = (key: 'app' | 'phone') => ({
      current: {
        revenue: round2(cur[key].revenue),
        change: percentChange(cur[key].revenue, prev[key].revenue),
      },
      previous: { revenue: round2(prev[key].revenue) },
    });

    return {
      current: totalsOf(current, cur),
      previous: totalsOf(previous, prev),
      comparison: {
        revenueChange: percentChange(cur.all.revenue, prev.all.revenue),
        ordersChange: percentChange(cur.all.orders, prev.all.orders),
        ticketChange: percentChange(
          averageTicket(cur.all),
          averageTicket(prev.all),
        ),
      },
      byChannel: { app: channel('app'), phone: channel('phone') },
    };
  }

  async topProducts(
    query: ReportTopProductsQueryDto,
  ): Promise<ReportTopProduct[]> {
    const { start, end } = limaDayRange(query.startDate, query.endDate);
    const limit = query.limit ?? 10;
    const channel = query.channel ?? ReportChannel.ALL;

    const qb = this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(Order, 'order', 'order.id = item.orderId')
      .select('item.menuItemId', 'menuItemId')
      .addSelect('MAX(item.name)', 'name')
      .addSelect('order.source', 'source')
      .addSelect('SUM(item.quantity)', 'quantity')
      .addSelect('SUM(item.unitPrice * item.quantity)', 'revenue')
      .where('order.deliveredAt IS NOT NULL')
      .andWhere('order.deliveredAt >= :start', { start })
      .andWhere('order.deliveredAt <= :end', { end });
    if (channel !== ReportChannel.ALL) {
      qb.andWhere('order.source = :source', {
        source:
          channel === ReportChannel.PHONE ? OrderSource.ADMIN : OrderSource.APP,
      });
    }
    const rows = await qb
      .groupBy('item.menuItemId')
      .addGroupBy('order.source')
      .getRawMany<{
        menuItemId: string | null;
        name: string;
        source: OrderSource;
        quantity: string;
        revenue: string;
      }>();

    const products = new Map<string | null, ReportTopProduct>();
    let totalQuantity = 0;
    let totalRevenue = 0;
    for (const row of rows) {
      const quantity = parseInt(row.quantity, 10);
      const revenue = parseFloat(row.revenue);
      totalQuantity += quantity;
      totalRevenue += revenue;
      let product = products.get(row.menuItemId);
      if (!product) {
        product = {
          id: row.menuItemId,
          name: row.name,
          quantity: 0,
          revenue: 0,
          revenuePercentage: 0,
          quantityPercentage: 0,
          averagePrice: 0,
          byChannel: {
            app: { quantity: 0, revenue: 0 },
            phone: { quantity: 0, revenue: 0 },
          },
        };
        products.set(row.menuItemId, product);
      }
      product.quantity += quantity;
      product.revenue += revenue;
      const byChannel = product.byChannel[channelOf(row.source)];
      byChannel.quantity += quantity;
      byChannel.revenue += revenue;
    }

    return [...products.values()]
      .sort(
        (a, b) =>
          b.quantity - a.quantity ||
          b.revenue - a.revenue ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit)
      .map((product) => ({
        ...product,
        revenue: round2(product.revenue),
        // Porcentajes sobre el total del canal pedido, no solo del top devuelto.
        revenuePercentage:
          totalRevenue > 0 ? round1((product.revenue / totalRevenue) * 100) : 0,
        quantityPercentage:
          totalQuantity > 0
            ? round1((product.quantity / totalQuantity) * 100)
            : 0,
        averagePrice:
          product.quantity > 0 ? round2(product.revenue / product.quantity) : 0,
        byChannel: {
          app: {
            quantity: product.byChannel.app.quantity,
            revenue: round2(product.byChannel.app.revenue),
          },
          phone: {
            quantity: product.byChannel.phone.quantity,
            revenue: round2(product.byChannel.phone.revenue),
          },
        },
      }));
  }

  /**
   * Clientes con pedidos por teléfono entregados en el rango que DESPUÉS de su
   * primer pedido por teléfono del rango hicieron un pedido por app entregado
   * (en cualquier momento hasta hoy). Un anónimo solo puede convertirse si su
   * celular coincide con el de un cliente registrado.
   */
  async conversion(query: ReportRangeQueryDto): Promise<ReportConversion> {
    const { startDate, endDate } = query;
    const phoneOrders = (await this.deliveredOrders(startDate, endDate)).filter(
      (order) => order.channel === 'phone',
    );

    // Primer pedido por teléfono de cada cliente (vienen ordenados por deliveredAt).
    const firstPhone = new Map<string, DeliveredOrder>();
    for (const order of phoneOrders) {
      if (!firstPhone.has(order.customer)) {
        firstPhone.set(order.customer, order);
      }
    }

    const userIds = [...firstPhone.keys()].filter(
      (customer) => !customer.startsWith('tel:'),
    );
    const appRows = userIds.length
      ? await this.ordersRepository
          .createQueryBuilder('order')
          .select('order.userId', 'userId')
          .addSelect('order.deliveredAt', 'deliveredAt')
          .addSelect(limaDaySql('order.deliveredAt'), 'day')
          .where('order.source = :source', { source: OrderSource.APP })
          .andWhere('order.deliveredAt IS NOT NULL')
          .andWhere('order.userId IN (:...userIds)', { userIds })
          .orderBy('order.deliveredAt', 'ASC')
          .getRawMany<{ userId: string; deliveredAt: Date; day: string }>()
      : [];

    const timeline: ReportConversion['timeline'] = [];
    for (const [customer, phoneOrder] of firstPhone) {
      const appOrder = appRows.find(
        (row) =>
          row.userId === customer &&
          new Date(row.deliveredAt).getTime() >
            phoneOrder.deliveredAt.getTime(),
      );
      if (appOrder) {
        timeline.push({
          phoneOrderDate: phoneOrder.day,
          appOrderDate: appOrder.day,
          daysDiff: daysBetween(phoneOrder.day, appOrder.day),
        });
      }
    }
    timeline.sort(
      (a, b) =>
        a.phoneOrderDate.localeCompare(b.phoneOrderDate) ||
        a.appOrderDate.localeCompare(b.appOrderDate),
    );

    const phoneCustomers = firstPhone.size;
    return {
      period: `${startDate} al ${endDate}`,
      phoneOrders: phoneOrders.length,
      phoneCustomers,
      convertedToApp: timeline.length,
      conversionRate: `${(phoneCustomers > 0 ? (timeline.length / phoneCustomers) * 100 : 0).toFixed(1)}%`,
      timeline,
    };
  }

  async dailyMetrics(
    query: ReportDailyMetricsQueryDto,
  ): Promise<{ days: DailyMetricsDay[] }> {
    const { startDate, endDate } = query;
    const orders = await this.deliveredOrders(startDate, endDate);
    const byDay = new Map<string, DeliveredOrder[]>(
      calendarDatesBetween(startDate, endDate).map((day) => [day, []]),
    );
    for (const order of orders) byDay.get(order.day)?.push(order);

    const statusByDay = query.includeStatus
      ? await this.createdOrdersByStatus(startDate, endDate)
      : null;

    const days = [...byDay.entries()].map(([date, dayOrders]) => {
      const t = aggregate(dayOrders);
      const day: DailyMetricsDay = {
        date,
        revenue: round2(t.all.revenue),
        revenueApp: round2(t.app.revenue),
        revenuePhone: round2(t.phone.revenue),
        orders: t.all.orders,
        ordersApp: t.app.orders,
        ordersPhone: t.phone.orders,
        customers: t.all.customers.size,
        averageTicket: averageTicket(t.all),
      };
      if (statusByDay) {
        Object.assign(
          day,
          statusByDay.get(date) ?? {
            deliveredOrders: 0,
            pendingOrders: 0,
            cancelledOrders: 0,
          },
        );
      }
      return day;
    });
    return { days };
  }

  /** Pedidos entregados en [from, to] (días de Lima), ordenados por deliveredAt. */
  private async deliveredOrders(
    from: string,
    to: string,
  ): Promise<DeliveredOrder[]> {
    const { start, end } = limaDayRange(from, to);
    const rows = await this.ordersRepository
      .createQueryBuilder('order')
      .select(limaDaySql('order.deliveredAt'), 'day')
      .addSelect('order.deliveredAt', 'deliveredAt')
      .addSelect('order.source', 'source')
      .addSelect('order.total', 'total')
      .addSelect('order.userId', 'userId')
      .addSelect('order.customerPhone', 'customerPhone')
      .where('order.deliveredAt IS NOT NULL')
      .andWhere('order.deliveredAt >= :start', { start })
      .andWhere('order.deliveredAt <= :end', { end })
      .orderBy('order.deliveredAt', 'ASC')
      .getRawMany<{
        day: string;
        deliveredAt: Date;
        source: OrderSource;
        total: string;
        userId: string | null;
        customerPhone: string | null;
      }>();

    const customerOf = await this.customerResolver(rows);
    return rows.map((row) => ({
      day: row.day,
      deliveredAt: new Date(row.deliveredAt),
      channel: channelOf(row.source),
      total: parseFloat(row.total),
      customer: customerOf(row),
    }));
  }

  /**
   * Identidad de cliente por pedido: userId; si es anónimo, el cliente registrado
   * (rol cliente) con ese celular; si no hay ninguno, `tel:<celular>`.
   *
   * Los DOS lados pasan por normalizePhone, igual que la vinculación de anónimos
   * (OrdersService.findCustomerForLinking): hay `users.phone` viejos en formato
   * libre ("987 654 321") y pedidos anónimos previos a la normalización. En SQL
   * solo se prefiltra por los últimos 8 dígitos (todo celular normalizable tiene
   * al menos 8); la coincidencia exacta se decide en memoria.
   *
   * `users.phone` no es único: si dos clientes comparten celular, gana la cuenta
   * más antigua (orden determinista).
   */
  private async customerResolver(
    rows: { userId: string | null; customerPhone: string | null }[],
  ): Promise<
    (row: { userId: string | null; customerPhone: string | null }) => string
  > {
    const phoneOf = (raw: string | null): string | null =>
      normalizePhone(raw) ?? raw;
    const phones = new Set(
      rows
        .filter((row) => !row.userId && row.customerPhone)
        .map((row) => phoneOf(row.customerPhone) as string),
    );

    const userIdByPhone = new Map<string, string>();
    if (phones.size > 0) {
      const candidates = await this.usersRepository
        .createQueryBuilder('user')
        .select(['user.id', 'user.phone'])
        .where('user.role = :role', { role: UserRole.CLIENTE })
        .andWhere(
          "right(regexp_replace(user.phone, '[^0-9]', '', 'g'), 8) IN (:...tails)",
          { tails: [...phones].map((phone) => phone.slice(-8)) },
        )
        .orderBy('user.createdAt', 'ASC')
        .addOrderBy('user.id', 'ASC')
        .getMany();
      for (const user of candidates) {
        const phone = normalizePhone(user.phone);
        if (phone && phones.has(phone) && !userIdByPhone.has(phone)) {
          userIdByPhone.set(phone, user.id);
        }
      }
    }

    return (row) => {
      if (row.userId) return row.userId;
      const phone = phoneOf(row.customerPhone);
      return (
        (phone && userIdByPhone.get(phone)) ?? `tel:${phone ?? 'desconocido'}`
      );
    };
  }

  /** Pedidos CREADOS por día de Lima, según su estado actual. */
  private async createdOrdersByStatus(
    from: string,
    to: string,
  ): Promise<
    Map<
      string,
      {
        deliveredOrders: number;
        pendingOrders: number;
        cancelledOrders: number;
      }
    >
  > {
    const { start, end } = limaDayRange(from, to);
    const rows = await this.ordersRepository
      .createQueryBuilder('order')
      .select(limaDaySql('order.createdAt'), 'day')
      .addSelect('order.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('order.createdAt >= :start', { start })
      .andWhere('order.createdAt <= :end', { end })
      .groupBy('"day"')
      .addGroupBy('order.status')
      .getRawMany<{ day: string; status: OrderStatus; count: string }>();

    const result = new Map<
      string,
      {
        deliveredOrders: number;
        pendingOrders: number;
        cancelledOrders: number;
      }
    >();
    for (const row of rows) {
      const counts = result.get(row.day) ?? {
        deliveredOrders: 0,
        pendingOrders: 0,
        cancelledOrders: 0,
      };
      const count = parseInt(row.count, 10);
      if (row.status === OrderStatus.ENTREGADO) counts.deliveredOrders += count;
      else if (row.status === OrderStatus.CANCELADO)
        counts.cancelledOrders += count;
      // pendiente, confirmado y en_camino: todavía en curso.
      else counts.pendingOrders += count;
      result.set(row.day, counts);
    }
    return result;
  }
}
