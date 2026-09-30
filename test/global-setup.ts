import { countAllTables, TABLE_COUNTS_GLOBAL } from './helpers/table-counts';

/**
 * Foto de filas por tabla ANTES de la corrida e2e. La lee global-teardown.ts:
 * Jest corre globalSetup y globalTeardown en el mismo proceso, así que lo que se
 * deja en globalThis acá está disponible allá (una variable de módulo no: cada
 * archivo tendría la suya y el teardown compararía contra un objeto vacío).
 */
export default async function globalSetup(): Promise<void> {
  (globalThis as Record<string, unknown>)[TABLE_COUNTS_GLOBAL] =
    await countAllTables();
}
