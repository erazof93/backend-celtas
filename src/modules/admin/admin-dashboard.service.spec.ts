import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { AdminDashboardService } from './admin-dashboard.service';

/** Tipo del query builder mockeado. */
interface QbMock {
  select: jest.Mock;
  addSelect: jest.Mock;
  innerJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
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
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getCount: jest.fn(),
  getRawMany: jest.fn(),
  getRawOne: jest.fn(),
  ...overrides,
});

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;
  let ordersRepo: { createQueryBuilder: jest.Mock };
  let orderItemsRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    ordersRepo = { createQueryBuilder: jest.fn() };
    orderItemsRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemsRepo },
      ],
    }).compile();

    service = module.get(AdminDashboardService);
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
  });
});
