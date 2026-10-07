import { DataSource } from 'typeorm';

export const DISPOSABLE_DATABASE_MARKER = 'celtas disposable local e2e';

export function assertDisposableEnvironment(): void {
  if (
    process.env.NODE_ENV !== 'test' ||
    !['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST ?? '') ||
    process.env.DB_SSL !== 'false' ||
    !Number.isInteger(Number(process.env.DB_PORT)) ||
    Number(process.env.DB_PORT) < 1 ||
    Number(process.env.DB_PORT) > 65535 ||
    (process.env.DB_DATABASE?.length ?? 0) > 63 ||
    !/^celtas_e2e_test_[a-z0-9_]+$/.test(process.env.DB_DATABASE ?? '')
  ) {
    throw new Error(
      'E2E requires a local disposable celtas_e2e_test_* database',
    );
  }
}

/** Read-only preflight, before AppModule can seed data or tests can write. */
export async function assertDisposableDatabase(ds: DataSource): Promise<void> {
  assertDisposableEnvironment();
  const [identity] = await ds.query<{ name: string; marker: string | null }[]>(
    `SELECT current_database() AS name,
       shobj_description(oid, 'pg_database') AS marker
       FROM pg_database WHERE datname = current_database()`,
  );
  if (
    identity.name !== process.env.DB_DATABASE ||
    identity.marker !== DISPOSABLE_DATABASE_MARKER
  ) {
    throw new Error('Database identity/ disposable marker mismatch');
  }
  if (await ds.showMigrations()) throw new Error('E2E migrations are pending');
  const fries = await ds.query<{ name: string; is_default: boolean }[]>(
    'SELECT name, is_default FROM fries_types ORDER BY name',
  );
  if (
    JSON.stringify(fries) !==
    JSON.stringify([
      { name: 'Papas al hilo', is_default: false },
      { name: 'Papas fritas', is_default: true },
    ])
  ) {
    throw new Error('E2E requires the untouched seed catalog of fries types');
  }
  const tables = await ds.query<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name NOT IN ('migrations', 'settings', 'fries_types')`,
  );
  for (const { table_name: name } of tables) {
    const [row] = await ds.query<{ count: string }[]>(
      `SELECT count(*) FROM "${name.replaceAll('"', '""')}"`,
    );
    if (Number(row.count) !== 0)
      throw new Error(`E2E requires empty business tables: ${name}`);
  }
}
