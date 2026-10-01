import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `createdAt`/`updatedAt` pasan de `timestamp` (sin zona) a `timestamptz`.
 *
 * ESCRITA A MANO: `migration:generate` producía DROP COLUMN + ADD COLUMN, que
 * BORRA las fechas existentes (todas quedarían en el momento de la migración).
 * Acá se convierte en el lugar con `USING ... AT TIME ZONE 'UTC'`: los valores
 * actuales los escribió `now()` en la zona de la sesión de la BD, que es UTC
 * (Supabase y el Postgres local), así que se interpretan como hora UTC.
 * Antes de correrla en producción: `SHOW timezone;` en Supabase debe ser UTC.
 *
 * Un solo ALTER TABLE por tabla: el cambio de tipo con USING reescribe la tabla,
 * así Postgres la reescribe una vez aunque cambien dos columnas.
 *
 * Por qué: con `timestamp` sin zona, pg serializa/parsea los Date con la zona del
 * proceso Node y Postgres ignora el offset al castear. En Render (Node en UTC)
 * coincidía; con Node en Lima todo quedaba corrido 5 horas (dashboard, rewards,
 * fechas de la API). Con `timestamptz` el offset viaja siempre y la zona de Node
 * deja de importar.
 */
const TABLES: [table: string, columns: string[]][] = [
  ['addresses', ['createdAt', 'updatedAt']],
  ['banners', ['createdAt', 'updatedAt']],
  ['beverages', ['createdAt', 'updatedAt']],
  ['categories', ['createdAt', 'updatedAt']],
  ['coupons', ['createdAt']],
  ['extra_portions', ['createdAt', 'updatedAt']],
  ['fries_types', ['createdAt', 'updatedAt']],
  ['marketing_notifications', ['createdAt']],
  ['menu_items', ['createdAt', 'updatedAt']],
  ['order_items', ['createdAt', 'updatedAt']],
  ['orders', ['createdAt', 'updatedAt']],
  ['reward_milestones', ['createdAt', 'updatedAt']],
  ['reward_redemptions', ['createdAt', 'updatedAt']],
  ['sauces', ['createdAt', 'updatedAt']],
  ['settings', ['createdAt', 'updatedAt']],
  ['star_promotions', ['createdAt', 'updatedAt']],
  ['users', ['createdAt', 'updatedAt']],
];

const alterAll = async (
  queryRunner: QueryRunner,
  targetType: string,
): Promise<void> => {
  for (const [table, columns] of TABLES) {
    const changes = columns
      .map(
        (column) =>
          `ALTER COLUMN "${column}" TYPE ${targetType} USING "${column}" AT TIME ZONE 'UTC'`,
      )
      .join(', ');
    await queryRunner.query(`ALTER TABLE "${table}" ${changes}`);
  }
};

export class TimestampsToTimestamptz1790820718300 implements MigrationInterface {
  name = 'TimestampsToTimestamptz1790820718300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await alterAll(queryRunner, 'TIMESTAMP WITH TIME ZONE');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await alterAll(queryRunner, 'TIMESTAMP WITHOUT TIME ZONE');
  }
}
