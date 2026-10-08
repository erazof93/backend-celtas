import { EventEmitter } from 'events';
import { DataSource } from 'typeorm';
import { Response } from 'express';
import { StreamRequest } from './order-events.guard';
import { OrderEventsStreamService } from './order-events-stream.service';
import { OrderEventsService } from './order-events.service';
import { OrderEventRow } from './order-events.types';

class FakeResponse extends EventEmitter {
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  write = jest.fn<boolean, [string]>(() => true);
  status = jest.fn(() => this);
  setHeader = jest.fn();
  flushHeaders = jest.fn(() => {
    this.headersSent = true;
  });
  end = jest.fn(() => {
    this.writableEnded = true;
    this.emit('close');
  });
  destroy = jest.fn(() => {
    this.destroyed = true;
    this.emit('close');
  });
}
describe('OrderEventsStreamService', () => {
  let events: {
    enabled: boolean;
    ready: boolean;
    replay: jest.Mock;
    subscribe: jest.Mock;
  };
  let emit: (rows: OrderEventRow[] | null) => void;
  let service: OrderEventsStreamService;
  let query: jest.Mock;
  const request = (cursor?: string, userId = 'user') =>
    ({
      user: { userId, expiresAt: Date.now() + 120_000 },
      headers: cursor === undefined ? {} : { 'last-event-id': cursor },
    }) as StreamRequest;
  const row = (cursor = '1') =>
    ({
      cursor,
      eventId: 'event',
      orderId: 'order',
      type: 'order.created',
      status: 'pendiente',
      occurredAt: new Date(0),
    }) as OrderEventRow;
  const open = (response: FakeResponse, req = request()) =>
    service.open(req, response as unknown as Response);
  beforeEach(() => {
    jest.useFakeTimers();
    events = {
      enabled: true,
      ready: true,
      replay: jest.fn().mockResolvedValue({
        state: { head: '0', floor: '0' },
        rows: [],
        reset: false,
      }),
      subscribe: jest.fn((callback: (rows: OrderEventRow[] | null) => void) => {
        emit = callback;
        return jest.fn();
      }),
    };
    query = jest.fn().mockResolvedValue([{ id: 'user' }]);
    service = new OrderEventsStreamService(
      events as unknown as OrderEventsService,
      { query } as unknown as DataSource,
    );
    service.onModuleInit();
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('uses SSE headers, emits once per cursor and cleans up on disconnect', async () => {
    const response = new FakeResponse();
    await open(response);
    emit([row(), row()]);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream; charset=utf-8',
    );
    expect(
      response.write.mock.calls.filter(([frame]) =>
        String(frame).includes('order.created'),
      ),
    ).toHaveLength(1);
    response.emit('close');
    emit([row('2')]);
    expect(
      response.write.mock.calls.filter(([frame]) =>
        String(frame).includes('order.created'),
      ),
    ).toHaveLength(1);
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
    'delivers replay and deduplicates live overlap exactly after %s',
    async (cursor, cursors) => {
      events.replay.mockResolvedValue({
        state: { head: cursors.at(-1)!, floor: cursor },
        rows: cursors.map(row),
        reset: false,
      });
      const response = new FakeResponse();
      await open(response, request(cursor));
      emit(cursors.map(row));
      expect(events.replay).toHaveBeenCalledWith(cursor);
      expect(
        response.write.mock.calls
          .map(([frame]) => /^id: (\d+)\n/.exec(frame)?.[1])
          .filter((value) => value !== undefined),
      ).toEqual(cursors);
    },
  );

  it('accepts the PostgreSQL bigint maximum Last-Event-ID without rounding', async () => {
    const cursor = '9223372036854775807';
    events.replay.mockResolvedValue({
      state: { head: cursor, floor: cursor },
      rows: [],
      reset: false,
    });
    const response = new FakeResponse();
    await open(response, request(cursor));
    expect(events.replay).toHaveBeenCalledWith(cursor);
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining(`"headCursor":"${cursor}"`),
    );
    expect(response.writableEnded).toBe(false);
  });

  it('buffers live delivery during replay and deduplicates overlapping publication', async () => {
    let resolve!: (value: unknown) => void;
    events.replay.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const response = new FakeResponse();
    const pending = open(response, request('0'));
    emit([row(), row('2')]);
    resolve({ state: { head: '1', floor: '0' }, rows: [row()], reset: false });
    await pending;
    expect(
      response.write.mock.calls.filter(([frame]) =>
        String(frame).includes('order.created'),
      ),
    ).toHaveLength(2);
  });

  it('returns reset and closes on unavailable cursor', async () => {
    events.replay.mockResolvedValue({
      state: { head: '10', floor: '5' },
      rows: [],
      reset: true,
    });
    const response = new FakeResponse();
    await open(response, request('0'));
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('stream.reset'),
    );
    expect(response.writableEnded).toBe(true);
  });

  it.each(['-1', '1.5', '01', '9223372036854775808', 'token'])(
    'rejects malformed cursor %s before starting stream',
    async (cursor) => {
      const response = new FakeResponse();
      await expect(open(response, request(cursor))).rejects.toMatchObject({
        status: 400,
      });
      expect(response.flushHeaders).not.toHaveBeenCalled();
    },
  );

  it('limits user connections and frees slots on close', async () => {
    const responses = Array.from({ length: 4 }, () => new FakeResponse());
    for (const response of responses) await open(response);
    await expect(open(new FakeResponse())).rejects.toMatchObject({
      status: 429,
    });
    responses[0].emit('close');
    await open(new FakeResponse());
  });

  it('heartbeats do not query PostgreSQL; role checks are batched', async () => {
    await open(new FakeResponse());
    await open(new FakeResponse());
    await jest.advanceTimersByTimeAsync(20_000);
    expect(query).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(40_000);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), [['user'], 'admin']);
  });

  it('closes when role is revoked and on session expiry', async () => {
    query.mockResolvedValue([]);
    const response = new FakeResponse();
    await open(response);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('access.revoked'),
    );
    const expiring = new FakeResponse();
    await open(expiring, {
      ...request(),
      user: { userId: 'user', expiresAt: Date.now() + 100 },
    } as StreamRequest);
    await jest.advanceTimersByTimeAsync(100);
    expect(expiring.writableEnded).toBe(true);
  });

  it('destroys slow clients instead of retaining an unbounded queue', async () => {
    const response = new FakeResponse();
    response.write.mockReturnValue(false);
    await open(response);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(response.destroyed).toBe(true);
  });

  it('continues after drain and closes on transport loss', async () => {
    const response = new FakeResponse();
    response.write.mockReturnValueOnce(false);
    await open(response);
    response.emit('drain');
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('stream.ready'),
    );
    emit(null);
    expect(response.writableEnded).toBe(true);
  });

  it('fails closed when authorization cannot finish within five seconds', async () => {
    query.mockReturnValue(new Promise(() => undefined));
    const response = new FakeResponse();
    await open(response);
    await jest.advanceTimersByTimeAsync(65_000);
    expect(response.writableEnded).toBe(true);
  });

  it('enforces the instance limit across different users', async () => {
    for (let i = 0; i < 40; i++)
      await open(new FakeResponse(), request(undefined, `user-${i}`));
    await expect(
      open(new FakeResponse(), request(undefined, 'another')),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('rate limits repeated opens even when previous sockets were closed', async () => {
    for (let i = 0; i < 12; i++) {
      const response = new FakeResponse();
      await open(response);
      response.emit('close');
    }
    await expect(open(new FakeResponse())).rejects.toMatchObject({
      status: 429,
    });
  });

  it('does not keep delivering to a disconnected initializing client', async () => {
    let resolve!: (value: unknown) => void;
    events.replay.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const response = new FakeResponse();
    const pending = open(response);
    response.destroy();
    emit([row()]);
    resolve({ state: { head: '0', floor: '0' }, rows: [], reset: false });
    await pending;
    expect(response.write).not.toHaveBeenCalled();
  });
});
