import { EventEmitter } from 'events';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { OrderEventsService } from './order-events.service';
import { ListenerClient } from './postgres-listener';

jest.mock('./postgres-listener', () => ({ ListenerClient: jest.fn() }));

describe('Dedicated PostgreSQL listener lifecycle', () => {
  let client: EventEmitter & {
    connect: jest.Mock;
    end: jest.Mock;
    query: jest.Mock;
  };
  let service: OrderEventsService;
  let databaseIdentity: string;
  beforeEach(() => {
    jest.useFakeTimers();
    databaseIdentity = 'outbox-identity';
    client = Object.assign(new EventEmitter(), {
      connect: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string) =>
        Promise.resolve({
          rows: sql.includes('current_database')
            ? [{ database: 'local-test', listening: true }]
            : sql.includes('streamId')
              ? [{ streamId: databaseIdentity }]
              : [],
        }),
      ),
    });
    jest
      .mocked(ListenerClient)
      .mockReset()
      .mockImplementation(() => client);
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('streamId')
          ? [{ streamId: 'outbox-identity' }]
          : [{ head: '0', floor: '0' }],
      ),
    );
    const db = {
      options: { type: 'postgres', host: '127.0.0.1', database: 'local-test' },
      query,
      transaction: jest.fn((...args: unknown[]) =>
        (args.at(-1) as (manager: unknown) => Promise<unknown>)({
          query: jest.fn((sql: string) =>
            Promise.resolve(
              sql.includes('pg_try_advisory')
                ? [{ acquired: false }]
                : sql.includes('head::text')
                  ? [{ head: '0', floor: '0' }]
                  : [],
            ),
          ),
        }),
      ),
    };
    service = new OrderEventsService(
      db as unknown as DataSource,
      new ConfigService({
        orderEvents: { enabled: true, listenerMode: 'direct' },
      }),
    );
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('opens one listener regardless of subscriber count and cleans it up', async () => {
    for (let i = 0; i < 40; i++) service.subscribe(jest.fn());
    await service.onModuleInit();
    expect(service.ready).toBe(true);
    expect(ListenerClient).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith('LISTEN celtas_order_events_v1');
  });

  it('closes streams after listener loss and reestablishes a dedicated session', async () => {
    const subscriber = jest.fn();
    service.subscribe(subscriber);
    await service.onModuleInit();
    client.emit('error', new Error('controlled disconnect'));
    expect(service.ready).toBe(false);
    expect(subscriber).toHaveBeenCalledWith(null);
    await jest.advanceTimersByTimeAsync(5000);
    expect(service.ready).toBe(true);
    expect(ListenerClient).toHaveBeenCalledTimes(2);
  });

  it('rejects another database with the same name but another outbox identity', async () => {
    databaseIdentity = 'different-database';
    await service.onModuleInit();
    expect(service.ready).toBe(false);
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
