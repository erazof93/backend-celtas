import { DataSource } from 'typeorm';
import { cleanupOrderEventFixtures } from './order-events-cleanup';

describe('Order event fixture cleanup without PostgreSQL', () => {
  const baseline = {
    singleton: true,
    streamId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    head: '0',
    floor: '0',
  };
  let query: jest.Mock;
  let transaction: jest.Mock;
  let db: DataSource;
  let current: typeof baseline;
  let cursors: { cursor: string }[];
  let foreign: boolean;
  let acquired: boolean;
  let failure: string | undefined;
  let committed: boolean;

  beforeEach(() => {
    current = { ...baseline, head: '2' };
    cursors = [{ cursor: '1' }, { cursor: '2' }];
    foreign = false;
    acquired = true;
    failure = undefined;
    committed = false;
    query = jest.fn((sql: string) => {
      if (failure && sql.includes(failure))
        return Promise.reject(new Error('controlled cleanup failure'));
      if (sql.includes('pg_try_advisory_xact_lock'))
        return Promise.resolve([{ acquired }]);
      if (sql.includes('FOR UPDATE')) return Promise.resolve([current]);
      if (sql.includes('SELECT EXISTS'))
        return Promise.resolve([{ present: foreign }]);
      if (sql.includes('SELECT cursor::text')) return Promise.resolve(cursors);
      return Promise.resolve([]);
    });
    transaction = jest.fn(
      async (callback: (manager: unknown) => Promise<void>) => {
        await callback({ query });
        committed = true;
      },
    );
    db = { transaction } as unknown as DataSource;
  });

  it('deletes only fixture IDs and restores both cursors in one transaction', async () => {
    await cleanupOrderEventFixtures(db, ['fixture'], baseline);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(committed).toBe(true);
    const writes = query.mock.calls.filter(([sql]: [string]) =>
      /^(DELETE|UPDATE)/.test(sql),
    );
    expect(writes).toEqual([
      [
        'DELETE FROM order_events WHERE "orderId" = ANY($1::uuid[])',
        [['fixture']],
      ],
      ['DELETE FROM orders WHERE id = ANY($1::uuid[])', [['fixture']]],
      [
        'UPDATE order_event_state SET head=$1, floor=$2 WHERE singleton AND "streamId"=$3',
        ['0', '0', baseline.streamId],
      ],
    ]);
    expect(
      query.mock.calls.findIndex(([sql]: [string]) => sql.startsWith('LOCK')),
    ).toBeLessThan(
      query.mock.calls.findIndex(([sql]: [string]) => sql.startsWith('DELETE')),
    );
  });

  it('accepts a fully retained prefix without hiding missing published events', async () => {
    current.floor = '2';
    cursors = [];
    await expect(
      cleanupOrderEventFixtures(db, ['fixture'], baseline),
    ).resolves.toBeUndefined();
  });

  it.each(['foreign', 'publisher', 'identity', 'hole', 'gap', 'head', 'floor'])(
    'refuses writes on %s interference or invariant failure',
    async (scenario) => {
      if (scenario === 'foreign') foreign = true;
      if (scenario === 'publisher') acquired = false;
      if (scenario === 'identity') current.streamId = 'changed';
      if (scenario === 'hole') cursors = [{ cursor: '2' }];
      if (scenario === 'gap') cursors = [{ cursor: '1' }, { cursor: '3' }];
      if (scenario === 'head') current.head = '3';
      if (scenario === 'floor') current.floor = '-1';
      await expect(
        cleanupOrderEventFixtures(db, ['fixture'], baseline),
      ).rejects.toThrow('SSE cleanup:');
      expect(committed).toBe(false);
      expect(
        query.mock.calls.some(([sql]: [string]) =>
          /^(DELETE|UPDATE)/.test(sql),
        ),
      ).toBe(false);
    },
  );

  it.each([
    'DELETE FROM order_events',
    'DELETE FROM orders',
    'UPDATE order_event_state',
  ])(
    'propagates failure at %s so the transaction cannot commit',
    async (sql) => {
      failure = sql;
      await expect(
        cleanupOrderEventFixtures(db, ['fixture'], baseline),
      ).rejects.toThrow('controlled cleanup failure');
      expect(committed).toBe(false);
    },
  );

  it('rejects a noninitial baseline before any transaction', async () => {
    await expect(
      cleanupOrderEventFixtures(db, [], { ...baseline, head: '1' }),
    ).rejects.toThrow('initial baseline');
    expect(transaction).not.toHaveBeenCalled();
  });
});
