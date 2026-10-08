import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { OrderEventsService } from './order-events.service';
import { eventFrame, OrderEventRow } from './order-events.types';

describe('OrderEventsService', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let query: jest.Mock;
  let db: { transaction: jest.Mock };
  let service: OrderEventsService;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    db = {
      transaction: jest.fn(async (...args: unknown[]) =>
        (args.at(-1) as (m: unknown) => Promise<unknown>)({ query }),
      ),
    };
    service = new OrderEventsService(
      db as unknown as DataSource,
      new ConfigService({ orderEvents: { enabled: true } }),
    );
  });

  it('records only safe fields with the supplied transaction manager and a stable dedupe key', async () => {
    await service.record(
      { query } as unknown as EntityManager,
      'order.created',
      { id, status: 'pendiente' },
      'created',
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), [
      expect.any(String),
      `created:${id}`,
      'order.created',
      id,
      'pendiente',
    ]);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not touch tables while disabled', async () => {
    service = new OrderEventsService(
      db as unknown as DataSource,
      new ConfigService(),
    );
    await service.record(
      { query } as unknown as EntityManager,
      'order.created',
      { id, status: 'pendiente' },
      'created',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('serializes publishers before allocating cursors and notifies in the publication transaction', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([{ head: '9007199254740993', floor: '0' }])
      .mockResolvedValueOnce([{ eventId: id }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cursor: null }]);
    await service.publish();
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_xact_lock(731942, 101) AS acquired',
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET cursor=$1'),
      ['9007199254740994', id],
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_notify($1,$2)', [
      'celtas_order_events_v1',
      '9007199254740994',
    ]);
  });

  it('does not allocate or publish if another publisher holds the lock', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ acquired: false }]);
    await service.publish();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('retries after publication fails; no local flag hides durable pending events', async () => {
    db.transaction.mockRejectedValueOnce(new Error('commit failed'));
    await expect(service.publish()).rejects.toThrow('commit failed');
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ acquired: false }]);
    await service.publish();
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  it.each(['1', '11'])(
    'resets cursor outside retained range: %s',
    async (cursor) => {
      query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ head: '10', floor: '2' }]);
      expect((await service.replay(cursor)).reset).toBe(true);
      expect(db.transaction).toHaveBeenCalledWith(
        'REPEATABLE READ',
        expect.any(Function),
      );
    },
  );

  it('does not replay old events on a fresh connection', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ head: '10', floor: '2' }]);
    expect(await service.replay()).toEqual({
      state: { head: '10', floor: '2' },
      rows: [],
      reset: false,
    });
  });

  it('bounds replay and asks for REST instead of skipping an overflow silently', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ head: '105', floor: '0' }])
      .mockResolvedValueOnce(Array(101).fill({}));
    expect((await service.replay('0')).reset).toBe(true);
  });

  it.each([
    ['8', ['9', '10', '11', '12']],
    [
      '9007199254740991',
      [
        '9007199254740992',
        '9007199254740993',
        '9007199254740994',
        '9007199254740995',
      ],
    ],
  ])(
    'requests numeric replay order after %s without rounding parameters',
    async (cursor, cursors) => {
      const rows: OrderEventRow[] = cursors.map((value) => ({
        eventId: id,
        orderId: id,
        type: 'order.created',
        status: 'pendiente',
        occurredAt: new Date(0),
        cursor: value,
      }));
      const head = cursors.at(-1)!;
      query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ head, floor: cursor }])
        .mockResolvedValueOnce(rows);
      const replay = await service.replay(cursor);
      expect(query).toHaveBeenCalledWith(
        'SELECT "eventId",type,"orderId",status,"occurredAt",cursor::text FROM order_events WHERE cursor > $1 AND cursor <= $2 ORDER BY order_events.cursor LIMIT 101',
        [cursor, head],
      );
      expect(replay.reset).toBe(false);
      expect(replay.rows.map((row) => row.cursor)).toEqual(cursors);
    },
  );

  it.each(['9007199254740992', '9007199254740995'])(
    'resets an out-of-range large cursor exactly: %s',
    async (cursor) => {
      query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { head: '9007199254740994', floor: '9007199254740993' },
        ]);
      expect((await service.replay(cursor)).reset).toBe(true);
      expect(query).toHaveBeenCalledTimes(2);
    },
  );

  it('accepts exactly 100 replay rows without pagination or silent truncation', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      cursor: String(index + 1),
    }));
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ head: '100', floor: '0' }])
      .mockResolvedValueOnce(rows);
    expect(await service.replay('0')).toMatchObject({ rows, reset: false });
  });

  it('retains a numeric prefix and preserves a large floor as text', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([{ head: '9007199254740995', floor: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cursor: '9007199254740993' }]);
    await service.publish();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        '(SELECT cursor FROM order_events WHERE cursor IS NOT NULL AND "publishedAt" < now()-interval \'48 hours\' ORDER BY cursor LIMIT 1000) old',
      ),
    );
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM order_events WHERE cursor <= $1',
      ['9007199254740993'],
    );
    expect(query).toHaveBeenCalledWith(
      'UPDATE order_event_state SET floor=$1 WHERE singleton',
      ['9007199254740993'],
    );
  });

  it('frames an allowlisted event without exposing extra fields', () => {
    const frame = eventFrame({
      eventId: id,
      orderId: id,
      type: 'order.created',
      status: 'pendiente',
      occurredAt: new Date(0),
      cursor: '1',
      customerPhone: 'private',
    } as never);
    expect(frame).toContain('id: 1\nevent: order.created\n');
    expect(frame).not.toContain('private');
  });
});
