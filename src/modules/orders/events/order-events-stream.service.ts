import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { OrderEventsService } from './order-events.service';
import {
  controlFrame,
  eventFrame,
  OrderEventRow,
  STREAM_LIMITS,
} from './order-events.types';
import { StreamRequest } from './order-events.guard';

interface Connection {
  userId: string;
  response: Response;
  expiresAt: number;
  cursor: bigint;
  initializing: boolean;
  pending: OrderEventRow[];
  queue: string[];
  bytes: number;
  blockedAt?: number;
  closed: boolean;
  close: () => void;
  send: (frame: string) => void;
}

@Injectable()
export class OrderEventsStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderEventsStreamService.name);
  private connections = new Set<Connection>();
  private starts = new Map<string, { at: number; count: number }>();
  private heartbeat?: NodeJS.Timeout;
  private roles?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private checkingRoles = false;

  constructor(
    private readonly events: OrderEventsService,
    private readonly db: DataSource,
  ) {}

  onModuleInit(): void {
    if (!this.events.enabled) return;
    this.unsubscribe = this.events.subscribe((rows) => {
      for (const connection of this.connections) {
        if (rows === null) {
          this.stop(connection, 'stream.reset', 'transport_unavailable');
          continue;
        }
        if (connection.initializing) {
          connection.pending.push(...rows);
          if (connection.pending.length > STREAM_LIMITS.replay)
            this.stop(connection, 'stream.reset', 'replay_overflow');
        } else for (const row of rows) this.deliver(connection, row);
      }
    });
    this.heartbeat = setInterval(() => this.tick(), STREAM_LIMITS.heartbeatMs);
    this.roles = setInterval(() => {
      void this.checkRoles();
    }, STREAM_LIMITS.roleCheckMs);
    this.heartbeat.unref();
    this.roles.unref();
  }

  async open(request: StreamRequest, response: Response): Promise<void> {
    if (!this.events.enabled || !this.events.ready)
      throw new ServiceUnavailableException(
        'Eventos de pedidos no disponibles',
      );
    const cursor = request.headers['last-event-id'];
    if (
      cursor !== undefined &&
      (typeof cursor !== 'string' ||
        !/^(0|[1-9]\d{0,18})$/.test(cursor) ||
        BigInt(cursor) > 9223372036854775807n)
    )
      throw new BadRequestException('Last-Event-ID inválido');
    const { userId, expiresAt } = request.user;
    const now = Date.now();
    const starts = this.starts.get(userId);
    const count = starts && now - starts.at < 60_000 ? starts.count + 1 : 1;
    if (
      count > STREAM_LIMITS.startsPerMinute ||
      this.connections.size >= STREAM_LIMITS.total ||
      [...this.connections].filter((c) => c.userId === userId).length >=
        STREAM_LIMITS.perUser
    ) {
      response.setHeader('Retry-After', '30');
      throw new HttpException('Límite de conexiones SSE alcanzado', 429);
    }
    this.starts.set(userId, { at: count === 1 ? now : starts!.at, count });
    const connection: Connection = {
      userId,
      response,
      expiresAt,
      cursor: 0n,
      initializing: true,
      pending: [],
      queue: [],
      bytes: 0,
      closed: false,
      close: () => undefined,
      send: () => undefined,
    };
    let slow: NodeJS.Timeout | undefined;
    const drain = () => {
      if (connection.closed) return;
      connection.blockedAt = undefined;
      clearTimeout(slow);
      while (connection.queue.length) {
        const frame = connection.queue.shift()!;
        connection.bytes -= Buffer.byteLength(frame);
        if (!response.write(frame)) {
          blocked();
          break;
        }
      }
    };
    const blocked = () => {
      connection.blockedAt = Date.now();
      slow = setTimeout(() => connection.close(), STREAM_LIMITS.slowClientMs);
      slow.unref();
    };
    connection.close = () => {
      if (connection.closed) return;
      connection.closed = true;
      this.connections.delete(connection);
      clearTimeout(expiration);
      clearTimeout(slow);
      response.off('drain', drain);
      response.off('close', connection.close);
      response.off('error', connection.close);
      connection.pending = [];
      connection.queue = [];
      if (response.headersSent && !response.writableEnded) {
        // Destroy a blocked socket: end() could keep its buffered payload alive.
        if (connection.blockedAt) response.destroy();
        else response.end();
      }
    };
    connection.send = (frame) => {
      if (connection.closed) return;
      if (connection.blockedAt) {
        connection.bytes += Buffer.byteLength(frame);
        if (connection.bytes > STREAM_LIMITS.bytes) {
          connection.close();
          return;
        }
        connection.queue.push(frame);
      } else if (!response.write(frame)) blocked();
    };
    this.connections.add(connection); // Reserve before awaiting replay; buffer live events.
    response.on('close', connection.close);
    response.on('error', connection.close);
    response.on('drain', drain);
    const expiration = setTimeout(
      () => this.stop(connection, 'auth.expiring', 'reconnect_required'),
      Math.max(1, Math.min(expiresAt - now, 600_000)),
    );
    expiration.unref();
    let initializationTimeout: NodeJS.Timeout | undefined;
    try {
      const replay = await Promise.race([
        this.events.replay(cursor),
        new Promise<never>((_resolve, reject) => {
          initializationTimeout = setTimeout(
            () =>
              reject(
                new ServiceUnavailableException('Inicialización SSE agotada'),
              ),
            5_000,
          );
          initializationTimeout.unref();
        }),
      ]);
      if (response.destroyed) {
        connection.close();
        return;
      }
      if (connection.closed)
        throw new ServiceUnavailableException(
          'Inicialización SSE interrumpida',
        );
      if (!this.events.ready)
        throw new ServiceUnavailableException(
          'Eventos de pedidos no disponibles',
        );
      response.status(200);
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
      connection.send('retry: 5000\n\n');
      connection.send(
        controlFrame('stream.ready', {
          headCursor: replay.state.head,
          floorCursor: replay.state.floor,
          recovery: 'rest',
        }),
      );
      if (replay.reset) {
        this.stop(connection, 'stream.reset', 'cursor_unavailable');
        return;
      }
      connection.cursor = BigInt(cursor ?? replay.state.head);
      for (const row of replay.rows) this.deliver(connection, row);
      connection.initializing = false;
      for (const row of connection.pending) this.deliver(connection, row);
      connection.pending = [];
    } catch (error) {
      const sent = response.headersSent;
      connection.close();
      if (!sent) throw error;
      this.logger.warn('Stream SSE cerrado durante inicialización.');
    } finally {
      clearTimeout(initializationTimeout);
    }
  }

  private deliver(connection: Connection, row: OrderEventRow): void {
    if (connection.closed || BigInt(row.cursor) <= connection.cursor) return;
    if (Date.now() >= connection.expiresAt) {
      this.stop(connection, 'auth.expiring', 'token_expired');
      return;
    }
    connection.send(eventFrame(row));
    connection.cursor = BigInt(row.cursor);
  }

  private stop(connection: Connection, type: string, reason: string): void {
    if (connection.response.headersSent)
      connection.send(controlFrame(type, { reason }));
    connection.close();
  }

  private tick(): void {
    const now = Date.now();
    for (const [userId, start] of this.starts)
      if (now - start.at >= 60_000) this.starts.delete(userId);
    for (const connection of this.connections) {
      if (now >= connection.expiresAt)
        this.stop(connection, 'auth.expiring', 'token_expired');
      else if (!connection.initializing) connection.send(': heartbeat\n\n');
    }
  }

  private async checkRoles(): Promise<void> {
    if (this.checkingRoles || !this.connections.size) return;
    this.checkingRoles = true;
    let timeout: NodeJS.Timeout | undefined;
    try {
      const checked = [...this.connections];
      const ids = [...new Set(checked.map((c) => c.userId))];
      const users = await Promise.race([
        this.db.query<{ id: string }[]>(
          'SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role=$2',
          [ids, 'admin'],
        ),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Authorization timeout')),
            5_000,
          );
          timeout.unref();
        }),
      ]);
      const allowed = new Set(users.map((u) => u.id));
      for (const connection of checked)
        if (!allowed.has(connection.userId))
          this.stop(connection, 'access.revoked', 'role_changed');
    } catch {
      // Fail closed when continuing authorization cannot be checked.
      for (const connection of this.connections)
        this.stop(connection, 'stream.reset', 'authorization_unavailable');
    } finally {
      clearTimeout(timeout);
      this.checkingRoles = false;
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    clearInterval(this.roles);
    this.unsubscribe?.();
    for (const connection of this.connections)
      this.stop(connection, 'stream.reset', 'server_shutdown');
    this.starts.clear();
  }
}
