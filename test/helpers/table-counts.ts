import { AppDataSource } from '../../src/data-source';

/** Clave global donde globalSetup deja la foto para globalTeardown (mismo proceso). */
export const TABLE_COUNTS_GLOBAL = '__E2E_TABLE_COUNTS__';

/**
 * Filas por tabla del schema public (salvo `migrations`). `COUNT(*)::int`
 * porque `pg` devuelve bigint como string ("5" !== 5 rompería la comparación).
 */
export async function countAllTables(): Promise<Record<string, number>> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();
  try {
    const tables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name <> 'migrations'
        ORDER BY table_name`,
    );
    const counts: Record<string, number> = {};
    for (const { table_name } of tables) {
      const [{ n }] = await dataSource.query<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "${table_name}"`,
      );
      counts[table_name] = n;
    }
    return counts;
  } finally {
    await dataSource.destroy();
  }
}
