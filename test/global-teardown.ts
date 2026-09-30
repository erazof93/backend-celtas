import { countAllTables, TABLE_COUNTS_GLOBAL } from './helpers/table-counts';

/**
 * Guard de limpieza e2e: compara las filas por tabla con la foto de
 * global-setup.ts y FALLA la corrida si alguna suite dejó datos (o borró datos
 * que no eran suyos). Nació de encontrar 536 usuarios, 3350 banners y 804
 * cupones acumulados por afterAll incompletos. Asume que nadie más escribe en la
 * BD local durante la corrida (ej. el backend levantado con la app apuntándole).
 */
export default async function globalTeardown(): Promise<void> {
  const before = (globalThis as Record<string, unknown>)[
    TABLE_COUNTS_GLOBAL
  ] as Record<string, number> | undefined;
  if (!before) {
    throw new Error(
      'E2E cleanup guard: no hay foto inicial (¿falló global-setup.ts?)',
    );
  }

  const after = await countAllTables();
  const tables = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const diffs = tables
    .filter((table) => (before[table] ?? 0) !== (after[table] ?? 0))
    .map((table) => {
      const delta = (after[table] ?? 0) - (before[table] ?? 0);
      return `  ${table}: ${before[table] ?? 0} → ${after[table] ?? 0} (${delta > 0 ? '+' : ''}${delta})`;
    });

  if (diffs.length > 0) {
    throw new Error(
      `E2E cleanup failed: ${diffs.length} tabla(s) cambiaron después de la corrida — alguna suite no limpió sus datos en afterAll:\n${diffs.join('\n')}`,
    );
  }
  console.log(`\n✅ E2E cleanup verified: ${tables.length} tablas sin cambios`);
}
