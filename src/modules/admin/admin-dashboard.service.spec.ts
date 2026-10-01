import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderItem } from '../orders/entities/order-item.entity';
import {
  Order,
  OrderSource,
  OrderStatus,
} from '../orders/entities/order.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { AdminDashboardService } from './admin-dashboard.service';

/** Tipo del query builder mockeado. */
interface QbMock {
  select: jest.Mock;
  addSelect: jest.Mock;
  innerJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  addGroupBy: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  getCount: jest.Mock;
  getRawMany: jest.Mock;
  getRawOne: jest.Mock;
}

/** Helper para construir un createQueryBuilder encadenable. */
const qb = (overrides: Partial<QbMock> = {}): QbMock => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getCount: jest.fn(),
  getRawMany: jest.fn(),
  getRawOne: jest.fn(),
  ...overrides,
});

/** Con fake timers solo se congela `Date`; las promesas y timers siguen siendo reales. */
type FakeableAPI = NonNullable<
  NonNullable<Parameters<typeof jest.useFakeTimers>[0]>['doNotFake']
>[number];

const REAL_TIMERS: FakeableAPI[] = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
];

/** Busca el parámetro `start`/`end` entre las llamadas a where/andWhere del query builder. */
const rangeArg = (q: QbMock, key: 'start' | 'end'): Date => {
  const calls = [
    ...(q.where.mock.calls as unknown[][]),
    ...(q.andWhere.mock.calls as unknown[][]),
  ];
  for (const call of calls) {
    const params = call[1] as Record<string, Date> | undefined;
    if (params?.[key]) return params[key];
  }
  throw new Error(`No se encontró el parámetro ${key}`);
};

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;
  let ordersRepo: { createQueryBuilder: jest.Mock };
  let orderItemsRepo: { createQueryBuilder: jest.Mock };
  let usersRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    ordersRepo = { createQueryBuilder: jest.fn() };
    orderItemsRepo = { createQueryBuilder: jest.fn() };
    usersRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
      ],
    }).compile();

    service = module.get(AdminDashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('summary', () => {
    it('calcula ordersCount, ordersByStatus y revenue', async () => {
      ordersRepo.createQueryBuilder
        .mockReturnValueOnce(qb({ getCount: jest.fn().mockResolvedValue(5) }))
        .mockReturnValueOnce(
          qb({
            getRawMany: jest.fn().mockResolvedValue([
              { status: OrderStatus.PENDIENTE, count: '2' },
              { status: OrderStatus.ENTREGADO, count: '3' },
            ]),
          }),
        )
        .mockReturnValueOnce(
          qb({ getRawOne: jest.fn().mockResolvedValue({ revenue: '150.50' }) }),
        );

      const result = await service.summary({});

      expect(result.ordersCount).toBe(5);
      expect(result.ordersByStatus).toEqual([
        { status: OrderStatus.PENDIENTE, count: 2 },
        { status: OrderStatus.ENTREGADO, count: 3 },
      ]);
      expect(result.revenue).toBe(150.5);
    });

    it('revenue usa deliveredAt (no createdAt) y excluye no entregados', async () => {
      ordersRepo.createQueryBuilder
        .mockReturnValueOnce(qb({ getCount: jest.fn().mockResolvedValue(0) }))
        .mockReturnValueOnce(
          qb({ getRawMany: jest.fn().mockResolvedValue([]) }),
        )
        .mockReturnValueOnce(
          qb({ getRawOne: jest.fn().mockResolvedValue({ revenue: '0' }) }),
        );

      await service.summary({});

      // La query de revenue debe filtrar por deliveredAt IS NOT NULL + rango.
      const revenueQb = ordersRepo.createQueryBuilder.mock.results[2]
        .value as QbMock;
      expect(revenueQb.where).toHaveBeenCalledWith(
        'order.deliveredAt IS NOT NULL',
      );
      expect(revenueQb.andWhere).toHaveBeenCalledTimes(2);
    });

    it('resuelve el rango en America/Lima (UTC-5)', async () => {
      ordersRepo.createQueryBuilder
        .mockReturnValueOnce(qb({ getCount: jest.fn().mockResolvedValue(0) }))
        .mockReturnValueOnce(
          qb({ getRawMany: jest.fn().mockResolvedValue([]) }),
        )
        .mockReturnValueOnce(
          qb({ getRawOne: jest.fn().mockResolvedValue({ revenue: '0' }) }),
        );

      await service.summary({ from: '2026-08-01', to: '2026-08-01' });

      // Lima es UTC-5: 00:00 Lima = 05:00 UTC; 23:59:59.999 Lima = 04:59:59.999 UTC del día siguiente.
      const countQb = ordersRepo.createQueryBuilder.mock.results[0]
        .value as QbMock;
      const startArg = (countQb.where.mock.calls[0] as unknown[])[1] as {
        start: Date;
      };
      const endArg = (countQb.andWhere.mock.calls[0] as unknown[])[1] as {
        end: Date;
      };
      expect(startArg.start.toISOString()).toBe('2026-08-01T05:00:00.000Z');
      expect(endArg.end.toISOString()).toBe('2026-08-02T04:59:59.999Z');
    });
  });

  describe('topProducts', () => {
    it('agrupa por menuItemId, suma quantity/revenue y ordena descendente', async () => {
      orderItemsRepo.createQueryBuilder.mockReturnValue(
        qb({
          getRawMany: jest.fn().mockResolvedValue([
            {
              menuItemId: 'a',
              name: 'Celtas Clásica',
              quantity: '10',
              revenue: '249.00',
            },
            {
              menuItemId: 'b',
              name: 'Papas',
              quantity: '4',
              revenue: '40.00',
            },
          ]),
        }),
      );

      const result = await service.topProducts({ limit: 10 });

      expect(result.limit).toBe(10);
      expect(result.items).toEqual([
        { menuItemId: 'a', name: 'Celtas Clásica', quantity: 10, revenue: 249 },
        { menuItemId: 'b', name: 'Papas', quantity: 4, revenue: 40 },
      ]);
      // Debe filtrar por deliveredAt y agrupar por menuItemId.
      const q = orderItemsRepo.createQueryBuilder.mock.results[0]
        .value as QbMock;
      expect(q.where).toHaveBeenCalledWith('order.deliveredAt IS NOT NULL');
      expect(q.groupBy).toHaveBeenCalledWith('item.menuItemId');
      expect(q.orderBy).toHaveBeenCalledWith('"quantity"', 'DESC');
      expect(q.limit).toHaveBeenCalledWith(10);
    });

    it('usa el nombre del snapshot (MAX) y no el del menú actual', async () => {
      orderItemsRepo.createQueryBuilder.mockReturnValue(
        qb({ getRawMany: jest.fn().mockResolvedValue([]) }),
      );

      await service.topProducts({});

      const q = orderItemsRepo.createQueryBuilder.mock.results[0]
        .value as QbMock;
      expect(q.addSelect).toHaveBeenCalledWith('MAX(item.name)', 'name');
    });

    it('days=7 usa los últimos 7 días en Lima en vez de from/to', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      jest.setSystemTime(new Date('2026-09-30T15:00:00.000Z')); // 10:00 Lima
      orderItemsRepo.createQueryBuilder.mockReturnValue(
        qb({ getRawMany: jest.fn().mockResolvedValue([]) }),
      );

      await service.topProducts({ days: 7 });

      const q = orderItemsRepo.createQueryBuilder.mock.results[0]
        .value as QbMock;
      expect(rangeArg(q, 'start').toISOString()).toBe(
        '2026-09-24T05:00:00.000Z',
      );
      expect(rangeArg(q, 'end').toISOString()).toBe('2026-10-01T04:59:59.999Z');
    });
  });

  describe('metrics', () => {
    /** 6 queries de pedidos (canal + revenue × hoy/semana/mes) + 1 de clientes. */
    const mockMetricsQueries = () => {
      for (const [app, admin, revenue] of [
        ['2', '1', '30.00'],
        ['10', '4', '250.50'],
        ['40', '15', '1200.00'],
      ]) {
        ordersRepo.createQueryBuilder
          .mockReturnValueOnce(
            qb({
              getRawMany: jest.fn().mockResolvedValue([
                { source: OrderSource.APP, count: app },
                { source: OrderSource.ADMIN, count: admin },
              ]),
            }),
          )
          .mockReturnValueOnce(
            qb({ getRawOne: jest.fn().mockResolvedValue({ revenue }) }),
          );
      }
      usersRepo.createQueryBuilder.mockReturnValueOnce(
        qb({
          getRawMany: jest.fn().mockResolvedValue([
            { day: '2026-09-02', count: '1' },
            { day: '2026-09-20', count: '1' },
          ]),
        }),
      );
    };

    it('separa app/teléfono, suma orders y cuenta clientes nuevos del mes', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      jest.setSystemTime(new Date('2026-09-30T15:00:00.000Z')); // miércoles
      mockMetricsQueries();

      const result = await service.metrics();

      expect(result).toEqual({
        today: { orders: 3, revenue: 30, ordersApp: 2, ordersPhone: 1 },
        week: { orders: 14, revenue: 250.5, ordersApp: 10, ordersPhone: 4 },
        month: {
          orders: 55,
          revenue: 1200,
          ordersApp: 40,
          ordersPhone: 15,
          newCustomers: 2,
        },
      });
      // Semana desde el lunes 28/09 y mes desde el 01/09 (00:00 Lima = 05:00 UTC).
      const weekQb = ordersRepo.createQueryBuilder.mock.results[2]
        .value as QbMock;
      const monthQb = ordersRepo.createQueryBuilder.mock.results[4]
        .value as QbMock;
      expect(rangeArg(weekQb, 'start').toISOString()).toBe(
        '2026-09-28T05:00:00.000Z',
      );
      expect(rangeArg(monthQb, 'start').toISOString()).toBe(
        '2026-09-01T05:00:00.000Z',
      );
      // Clientes nuevos: solo rol cliente.
      const usersQb = usersRepo.createQueryBuilder.mock.results[0]
        .value as QbMock;
      expect(usersQb.where).toHaveBeenCalledWith('user.role = :role', {
        role: UserRole.CLIENTE,
      });
    });

    it('un domingo, la semana empieza el lunes anterior (no el día siguiente)', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      jest.setSystemTime(new Date('2026-10-04T15:00:00.000Z')); // domingo
      mockMetricsQueries();

      await service.metrics();

      const weekQb = ordersRepo.createQueryBuilder.mock.results[2]
        .value as QbMock;
      expect(rangeArg(weekQb, 'start').toISOString()).toBe(
        '2026-09-28T05:00:00.000Z',
      );
    });

    /** Inicio/fin de [hoy, semana, mes] según los parámetros enviados a la BD. */
    const periodBounds = () =>
      [0, 2, 4].map((i) => {
        const q = ordersRepo.createQueryBuilder.mock.results[i].value as QbMock;
        return [
          rangeArg(q, 'start').toISOString(),
          rangeArg(q, 'end').toISOString(),
        ];
      });

    it('de noche en Lima (UTC ya es el día 1 del mes siguiente) sigue usando el día y mes de Lima', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      // 2026-10-01 02:00 UTC = miércoles 2026-09-30 21:00 Lima.
      jest.setSystemTime(new Date('2026-10-01T02:00:00.000Z'));
      mockMetricsQueries();

      await service.metrics();

      expect(periodBounds()).toEqual([
        ['2026-09-30T05:00:00.000Z', '2026-10-01T04:59:59.999Z'], // hoy 30/09
        ['2026-09-28T05:00:00.000Z', '2026-10-01T04:59:59.999Z'], // lunes 28/09
        ['2026-09-01T05:00:00.000Z', '2026-10-01T04:59:59.999Z'], // septiembre
      ]);
      const usersQb = usersRepo.createQueryBuilder.mock.results[0]
        .value as QbMock;
      expect(rangeArg(usersQb, 'start').toISOString()).toBe(
        '2026-09-01T05:00:00.000Z',
      );
    });

    it('el día 1 a las 00:30 Lima: mes = solo hoy; la semana cruza al mes anterior', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      // 2026-10-01 05:30 UTC = jueves 2026-10-01 00:30 Lima.
      jest.setSystemTime(new Date('2026-10-01T05:30:00.000Z'));
      mockMetricsQueries();

      await service.metrics();

      expect(periodBounds()).toEqual([
        ['2026-10-01T05:00:00.000Z', '2026-10-02T04:59:59.999Z'],
        ['2026-09-28T05:00:00.000Z', '2026-10-02T04:59:59.999Z'],
        ['2026-10-01T05:00:00.000Z', '2026-10-02T04:59:59.999Z'],
      ]);
    });

    it('un lunes, la semana empieza hoy mismo', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      jest.setSystemTime(new Date('2026-09-28T15:00:00.000Z')); // lunes 10:00 Lima
      mockMetricsQueries();

      await service.metrics();

      const [today, week] = periodBounds();
      expect(week).toEqual(today);
    });

    it('domingo 23:30 Lima (UTC ya es lunes): la semana sigue siendo la del lunes anterior', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      // 2026-10-05 04:30 UTC (lunes) = domingo 2026-10-04 23:30 Lima.
      jest.setSystemTime(new Date('2026-10-05T04:30:00.000Z'));
      mockMetricsQueries();

      await service.metrics();

      const [today, week] = periodBounds();
      expect(today[0]).toBe('2026-10-04T05:00:00.000Z');
      expect(week[0]).toBe('2026-09-28T05:00:00.000Z');
    });

    it('enero: la semana que empieza en diciembre cruza el cambio de año', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      jest.setSystemTime(new Date('2027-01-01T15:00:00.000Z')); // viernes 01/01 Lima
      mockMetricsQueries();

      await service.metrics();

      const [, week, month] = periodBounds();
      expect(week[0]).toBe('2026-12-28T05:00:00.000Z');
      expect(month[0]).toBe('2027-01-01T05:00:00.000Z');
    });
  });

  describe('revenueTrend', () => {
    it('de noche en Lima el último día de la serie es el día de Lima, no el de UTC', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      jest.setSystemTime(new Date('2026-10-01T02:00:00.000Z')); // 30/09 21:00 Lima
      ordersRepo.createQueryBuilder.mockReturnValue(
        qb({ getRawMany: jest.fn().mockResolvedValue([]) }),
      );

      const result = await service.revenueTrend({ days: 2 });

      expect(result.map((d) => d.date)).toEqual(['2026-09-29', '2026-09-30']);
    });

    it('devuelve N días ascendentes, con 0 en los días sin movimiento', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      jest.setSystemTime(new Date('2026-09-30T15:00:00.000Z'));
      ordersRepo.createQueryBuilder
        .mockReturnValueOnce(
          qb({
            getRawMany: jest
              .fn()
              .mockResolvedValue([{ day: '2026-09-30', revenue: '45.50' }]),
          }),
        )
        .mockReturnValueOnce(
          qb({
            getRawMany: jest.fn().mockResolvedValue([
              { day: '2026-09-29', source: OrderSource.APP, count: '1' },
              { day: '2026-09-30', source: OrderSource.ADMIN, count: '1' },
              { day: '2026-09-30', source: OrderSource.APP, count: '2' },
            ]),
          }),
        );

      const result = await service.revenueTrend({ days: 3 });

      expect(result).toEqual([
        { date: '2026-09-28', revenue: 0, ordersApp: 0, ordersPhone: 0 },
        { date: '2026-09-29', revenue: 0, ordersApp: 1, ordersPhone: 0 },
        { date: '2026-09-30', revenue: 45.5, ordersApp: 2, ordersPhone: 1 },
      ]);
      // createdAt es timestamptz: se compara directo y se agrupa por día de Lima.
      const ordersQb = ordersRepo.createQueryBuilder.mock.results[1]
        .value as QbMock;
      expect(ordersQb.select).toHaveBeenCalledWith(
        "to_char(order.createdAt AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')",
        'day',
      );
      expect(ordersQb.where).toHaveBeenCalledWith(
        'order.createdAt >= :start',
        expect.anything(),
      );
      expect(ordersQb.addGroupBy).toHaveBeenCalledWith('order.source');
    });

    it('usa 7 días por defecto', async () => {
      ordersRepo.createQueryBuilder.mockReturnValue(
        qb({ getRawMany: jest.fn().mockResolvedValue([]) }),
      );
      const result = await service.revenueTrend({});
      expect(result).toHaveLength(7);
    });
  });

  describe('newCustomers', () => {
    it('devuelve total y un elemento por día (incluye días en 0)', async () => {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS });
      jest.setSystemTime(new Date('2026-09-30T15:00:00.000Z'));
      usersRepo.createQueryBuilder.mockReturnValueOnce(
        qb({
          getRawMany: jest.fn().mockResolvedValue([
            { day: '2026-09-29', count: '1' },
            { day: '2026-09-30', count: '2' },
          ]),
        }),
      );

      const result = await service.newCustomers({ days: 3 });

      expect(result).toEqual({
        total: 3,
        byDay: [
          { date: '2026-09-28', count: 0 },
          { date: '2026-09-29', count: 1 },
          { date: '2026-09-30', count: 2 },
        ],
      });
      const usersQb = usersRepo.createQueryBuilder.mock.results[0]
        .value as QbMock;
      expect(usersQb.where).toHaveBeenCalledWith('user.role = :role', {
        role: UserRole.CLIENTE,
      });
    });
  });
});
