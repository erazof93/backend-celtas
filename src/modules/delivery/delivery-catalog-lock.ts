import { EntityManager } from 'typeorm';

/** Shared by mode changes and catalog writes, always before reading either. */
export async function lockDeliveryCatalog(
  manager: EntityManager,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(731942, 1)');
}
