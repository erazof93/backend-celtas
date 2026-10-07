import { MigrationInterface, QueryRunner } from 'typeorm';

/** Reviewed manual migration: no reachable local database for generation.
 * Legacy orders keep a null snapshot rather than inventing historical settings.
 * delivery_mode is seeded by SettingsService, following existing delivery settings.
 */
export class AddDeliveryZones1791244800000 implements MigrationInterface {
  name = 'AddDeliveryZones1791244800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "delivery_zones" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "name" character varying(100) NOT NULL,
      "polygon" jsonb NOT NULL,
      "fee" numeric(10,2) NOT NULL,
      "active" boolean NOT NULL DEFAULT true,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_delivery_zones" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_delivery_zones_fee" CHECK ("fee" >= 0 AND "fee" <= 99999999.99)
    )`);
    await queryRunner.query(
      'ALTER TABLE "orders" ADD "deliverySnapshot" jsonb',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "orders" DROP COLUMN "deliverySnapshot"',
    );
    await queryRunner.query('DROP TABLE "delivery_zones"');
  }
}
