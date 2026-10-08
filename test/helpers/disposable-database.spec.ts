import { DataSource } from 'typeorm';
import {
  assertDisposableDatabase,
  DISPOSABLE_DATABASE_MARKER,
} from './disposable-database';

describe('Disposable database order event baseline', () => {
  const originalEnvironment = { ...process.env };
  const initialState = {
    singleton: true,
    streamId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    head: '0',
    floor: '0',
  };
  let state: unknown[];
  let eventCount: string;
  let businessCount: string;
  let ds: DataSource;

  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DB_HOST: 'localhost',
      DB_SSL: 'false',
      DB_PORT: '5432',
      DB_DATABASE: 'celtas_e2e_test_guard',
    });
    state = [{ ...initialState }];
    eventCount = '0';
    businessCount = '0';
    ds = {
      showMigrations: jest.fn().mockResolvedValue(false),
      query: jest.fn((sql: string) => {
        if (sql.includes('current_database()'))
          return Promise.resolve([
            {
              name: process.env.DB_DATABASE,
              marker: DISPOSABLE_DATABASE_MARKER,
            },
          ]);
        if (sql.includes('FROM fries_types'))
          return Promise.resolve([
            { name: 'Papas al hilo', is_default: false },
            { name: 'Papas fritas', is_default: true },
          ]);
        if (sql.includes('information_schema.tables'))
          return Promise.resolve([
            { table_name: 'order_event_state' },
            { table_name: 'order_events' },
            { table_name: 'orders' },
          ]);
        if (sql.includes('FROM order_event_state'))
          return Promise.resolve(state);
        if (sql.includes('FROM "order_events"'))
          return Promise.resolve([{ count: eventCount }]);
        if (sql.includes('FROM "orders"'))
          return Promise.resolve([{ count: businessCount }]);
        throw new Error(`Unexpected query: ${sql}`);
      }),
    } as unknown as DataSource;
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('accepts only the migration baseline with empty business tables', async () => {
    await expect(assertDisposableDatabase(ds)).resolves.toBeUndefined();
  });

  it.each([
    [],
    [initialState, initialState],
    [{ ...initialState, singleton: false }],
    [{ ...initialState, streamId: null }],
    [{ ...initialState, streamId: 'invalid' }],
    [{ ...initialState, head: '1' }],
    [{ ...initialState, floor: '1' }],
  ])('rejects a noninitial state %#', async (...rows) => {
    state = rows;
    await expect(assertDisposableDatabase(ds)).rejects.toThrow(
      'E2E requires the initial order event state',
    );
  });

  it('rejects retained order events', async () => {
    eventCount = '1';
    await expect(assertDisposableDatabase(ds)).rejects.toThrow(
      'E2E requires empty business tables: order_events',
    );
  });

  it('still rejects other business data', async () => {
    businessCount = '1';
    await expect(assertDisposableDatabase(ds)).rejects.toThrow(
      'E2E requires empty business tables: orders',
    );
  });
});
