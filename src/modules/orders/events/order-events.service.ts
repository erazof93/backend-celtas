import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ListenerClient,
  ListenerOptions,
  PostgresListener,
} from './postgres-listener';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  EventState,
  ORDER_EVENTS_CHANNEL,
  OrderEventRow,
  OrderEventType,
} from './order-events.types';

@Injectable()
export class OrderEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderEventsService.name);
  private client?: PostgresListener;
  private timer?: NodeJS.Timeout;
  private retry?: NodeJS.Timeout;
  private stopped = false;
  private publication?: Promise<void>;
  private distributing = false;
  private dirty = false;
  private position = '0';
  private callbacks = new Set<(rows: OrderEventRow[] | null) => void>();
  ready = false;

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.config.get<boolean>('orderEvents.enabled') === true;
  }

  async record(
    manager: EntityManager,
    type: OrderEventType,
    order: { id: string; status: string },
    operation: string,
  ): Promise<void> {
    if (!this.enabled) return;
    await manager.query(
      `INSERT INTO order_events ("eventId","dedupeKey",type,"orderId",status)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("dedupeKey") DO NOTHING`,
      [randomUUID(), `${operation}:${order.id}`, type, order.id, order.status],
    );
  }

  subscribe(callback: (rows: OrderEventRow[] | null) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    if (
      !['direct', 'session'].includes(
        this.config.get<string>('orderEvents.listenerMode') ?? '',
      )
    )
      throw new Error(
        'Declare ORDER_EVENTS_LISTENER_MODE=direct or session; transaction pooling is unsupported',
      );
    // Fail startup clearly if enabled before migration. Do not silently lose events.
    const state = await this.db.query<EventState[]>(
      'SELECT head, floor FROM order_event_state WHERE singleton',
    );
    if (state.length !== 1)
      throw new Error(
        'Order event state is missing; verify the additive migration',
      );
    await this.connectListener();
    this.timer = setInterval(() => {
      this.wake();
      void this.distribute();
    }, 30_000);
    this.timer.unref();
    this.wake();
  }

  private listenerConfig(): ListenerOptions {
    const options = this.db.options;
    if (options.type !== 'postgres')
      throw new Error('Order events require PostgreSQL');
    const listener = this.config.get<{
      host?: string;
      port?: number;
      username?: string;
      password?: string;
    }>('orderEvents.listener');
    return {
      host: listener?.host ?? options.host,
      port: listener?.port ?? options.port,
      user: listener?.username ?? options.username,
      password: listener?.password ?? options.password,
      database: options.database,
      ssl: options.ssl,
      application_name: 'celtas-order-events-listener',
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    };
  }

  private async connectListener(): Promise<void> {
    if (this.stopped) return;
    const client = new ListenerClient(this.listenerConfig());
    this.client = client;
    const lost = () => {
      if (this.client !== client || this.stopped) return;
      this.ready = false;
      this.client = undefined;
      for (const callback of this.callbacks) callback(null);
      void client.end().catch(() => undefined);
      this.retry = setTimeout(() => {
        void this.connectListener();
      }, 5_000);
      this.retry.unref();
    };
    client.on('error', lost);
    client.on('end', lost);
    client.on('notification', (message) => {
      if (message.channel === ORDER_EVENTS_CHANNEL && this.ready)
        void this.distribute();
    });
    try {
      await client.connect();
      if (this.stopped) {
        await client.end();
        return;
      }
      // Explicit session mode verification: LISTEN must survive a transaction.
      await client.query(`LISTEN ${ORDER_EVENTS_CHANNEL}`);
      const result = await client.query<{
        database: string;
        listening: boolean;
      }>(
        `SELECT current_database() AS database,
        EXISTS (SELECT 1 FROM pg_listening_channels() AS channel WHERE channel=$1) AS listening`,
        [ORDER_EVENTS_CHANNEL],
      );
      if (
        result.rows[0].database !== this.db.options.database ||
        !result.rows[0].listening
      )
        throw new Error(
          'Listener must target the same database using a direct/session connection',
        );
      const [identity] = await this.db.query<{ streamId: string }[]>(
        'SELECT "streamId" FROM order_event_state WHERE singleton',
      );
      const listenerIdentity = await client.query<{ streamId: string }>(
        'SELECT "streamId" FROM order_event_state WHERE singleton',
      );
      if (listenerIdentity.rows[0]?.streamId !== identity.streamId)
        throw new Error('Listener points to a different outbox/database');
      const [state] = await this.db.query<EventState[]>(
        'SELECT head::text, floor::text FROM order_event_state WHERE singleton',
      );
      this.position = state.head;
      this.ready = true;
      // Connections use their own durable replay; this head is only for live fanout.
      await this.distribute();
    } catch {
      this.logger.warn(
        'Listener SSE no disponible; comprobar conexión directa/modo sesión (sin revelar credenciales).',
      );
      lost();
    }
  }

  /** Called ONLY after business commit. Failure cannot reject a REST operation. */
  wake(): void {
    if (this.enabled && !this.stopped)
      void this.publish().catch(() => {
        this.logger.warn(
          'Publicación de eventos pendiente; se reintentará sin revertir pedidos.',
        );
      });
  }

  publish(): Promise<void> {
    if (!this.publication)
      this.publication = this.publishBatch().finally(() => {
        this.publication = undefined;
      });
    return this.publication;
  }

  private async publishBatch(): Promise<void> {
    await this.db.transaction(async (manager) => {
      await manager.query("SET LOCAL statement_timeout = '5000ms'");
      const [lock] = await manager.query<{ acquired: boolean }[]>(
        'SELECT pg_try_advisory_xact_lock(731942, 101) AS acquired',
      );
      if (!lock.acquired) return;
      const [state] = await manager.query<EventState[]>(
        'SELECT head::text, floor::text FROM order_event_state WHERE singleton FOR UPDATE',
      );
      const pending = await manager.query<{ eventId: string }[]>(
        `SELECT "eventId" FROM order_events WHERE cursor IS NULL ORDER BY "occurredAt", "eventId" LIMIT 100 FOR UPDATE`,
      );
      let head = BigInt(state.head);
      for (const row of pending) {
        head += 1n;
        await manager.query(
          'UPDATE order_events SET cursor=$1, "publishedAt"=clock_timestamp() WHERE "eventId"=$2',
          [head.toString(), row.eventId],
        );
      }
      if (pending.length) {
        await manager.query(
          'UPDATE order_event_state SET head=$1 WHERE singleton',
          [head.toString()],
        );
        await manager.query('SELECT pg_notify($1,$2)', [
          ORDER_EVENTS_CHANNEL,
          head.toString(),
        ]);
      }
      // A contiguous prefix only: retention never creates holes in replay.
      const [expired] = await manager.query<
        { cursor: string | null }[]
      >(`SELECT max(cursor)::text AS cursor FROM
          (SELECT cursor FROM order_events WHERE cursor IS NOT NULL AND "publishedAt" < now()-interval '48 hours' ORDER BY cursor LIMIT 1000) old`);
      if (expired.cursor) {
        await manager.query('DELETE FROM order_events WHERE cursor <= $1', [
          expired.cursor,
        ]);
        await manager.query(
          'UPDATE order_event_state SET floor=$1 WHERE singleton',
          [expired.cursor],
        );
      }
    });
  }

  async replay(
    cursor?: string,
  ): Promise<{ state: EventState; rows: OrderEventRow[]; reset: boolean }> {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await manager.query("SET LOCAL statement_timeout = '5000ms'");
      const [state] = await manager.query<EventState[]>(
        'SELECT head::text, floor::text FROM order_event_state WHERE singleton',
      );
      if (cursor === undefined) return { state, rows: [], reset: false };
      if (
        BigInt(cursor) < BigInt(state.floor) ||
        BigInt(cursor) > BigInt(state.head)
      )
        return { state, rows: [], reset: true };
      const rows = await manager.query<OrderEventRow[]>(
        `SELECT "eventId",type,"orderId",status,"occurredAt",cursor::text FROM order_events WHERE cursor > $1 AND cursor <= $2 ORDER BY order_events.cursor LIMIT 101`,
        [cursor, state.head],
      );
      return {
        state,
        rows: rows.length > 100 ? [] : rows,
        reset: rows.length > 100,
      };
    });
  }

  private async distribute(): Promise<void> {
    if (!this.ready || this.stopped) return;
    if (this.distributing) {
      this.dirty = true;
      return;
    }
    this.distributing = true;
    try {
      do {
        this.dirty = false;
        const replay = await this.replay(this.position);
        if (replay.reset) {
          for (const callback of this.callbacks) callback(null);
        } else if (replay.rows.length) {
          for (const callback of this.callbacks) callback(replay.rows);
        }
        this.position = replay.state.head;
      } while (this.dirty && this.ready);
    } catch {
      for (const callback of this.callbacks) callback(null);
      this.logger.warn(
        'Recuperación SSE interrumpida; los clientes deben reconectar y consultar REST.',
      );
    } finally {
      this.distributing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    clearInterval(this.timer);
    clearTimeout(this.retry);
    for (const callback of this.callbacks) callback(null);
    await this.publication?.catch(() => undefined);
    await this.client?.end().catch(() => undefined);
  }
}
