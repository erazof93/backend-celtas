import * as pg from 'pg';
import type { TlsOptions } from 'tls';

// pg is already a runtime dependency. A narrow boundary avoids adding @types/pg
// just for a dedicated LISTEN client; all application queries remain typed.
export interface ListenerOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string | (() => string) | (() => Promise<string>);
  database?: string;
  ssl?: boolean | TlsOptions;
  application_name: string;
  connectionTimeoutMillis: number;
  keepAlive: boolean;
}
export interface PostgresListener {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<T = Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ rows: T[] }>;
  on(
    event: 'notification',
    callback: (message: { channel: string }) => void,
  ): this;
  on(event: 'error' | 'end', callback: () => void): this;
}
export const ListenerClient = (
  pg as unknown as {
    Client: new (options: ListenerOptions) => PostgresListener;
  }
).Client;
