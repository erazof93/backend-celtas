import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { OrderEventsService } from './modules/orders/events/order-events.service';
import { OrderEventsStreamService } from './modules/orders/events/order-events-stream.service';
import {
  ListenerClient,
  type PostgresListener,
} from './modules/orders/events/postgres-listener';

jest.mock('./modules/orders/events/postgres-listener', () => ({
  ListenerClient: jest.fn(),
}));

it('Nest closes the PostgreSQL listener and periodic work, preserving TLS across session endpoints', async () => {
  jest.useFakeTimers();
  const ssl = { rejectUnauthorized: true, ca: 'test-ca' };
  const client = Object.assign(new EventEmitter(), {
    connect: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql: string) =>
      Promise.resolve({
        rows: sql.includes('current_database')
          ? [{ database: 'isolated', listening: true }]
          : [{ streamId: 'identity' }],
      }),
    ),
  });
  jest
    .mocked(ListenerClient)
    .mockImplementation(() => client as unknown as PostgresListener);
  const db = {
    options: { type: 'postgres', database: 'isolated', host: 'api-host', ssl },
    query: jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('streamId')
          ? [{ streamId: 'identity' }]
          : [{ head: '0', floor: '0' }],
      ),
    ),
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
  const module = await Test.createTestingModule({
    providers: [
      OrderEventsService,
      { provide: DataSource, useValue: db },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          orderEvents: {
            enabled: true,
            listenerMode: 'session',
            listener: { host: 'session-host', port: 5432 },
          },
        }),
      },
    ],
  }).compile();
  try {
    await module.init();
    const service = module.get(OrderEventsService);
    expect(service.ready).toBe(true);
    expect(ListenerClient).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'session-host',
        database: 'isolated',
        ssl,
      }),
    );
    await module.close();
    expect(service.ready).toBe(false);
    expect(client.end).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(ListenerClient).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('repeated stream cleanup ends responses once and releases timers and socket listeners', async () => {
  jest.useFakeTimers();
  const events = {
    enabled: true,
    ready: true,
    subscribe: jest.fn(() => jest.fn()),
    replay: jest.fn().mockResolvedValue({
      state: { head: '0', floor: '0' },
      rows: [],
      reset: false,
    }),
  };
  const service = new OrderEventsStreamService(
    events as unknown as OrderEventsService,
    {} as DataSource,
  );
  const response = Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    status: jest.fn(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(() => {
      response.headersSent = true;
    }),
    write: jest.fn(() => true),
    end: jest.fn(() => {
      response.writableEnded = true;
    }),
    destroy: jest.fn(),
  });
  try {
    service.onModuleInit();
    await service.open(
      {
        headers: {},
        user: { userId: 'test-admin', expiresAt: Date.now() + 60_000 },
      } as never,
      response as never,
    );
    service.onModuleDestroy();
    service.onModuleDestroy();
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('server_shutdown'),
    );
    expect(jest.getTimerCount()).toBe(0);
    expect(response.listenerCount('drain')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
