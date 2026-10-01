import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSourceToOrder1790819204462 implements MigrationInterface {
  name = 'AddSourceToOrder1790819204462';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."orders_source_enum" AS ENUM('app', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "source" "public"."orders_source_enum" NOT NULL DEFAULT 'app'`,
    );
    // Backfill: un pedido sin userId solo puede venir de POST /orders/admin. Los
    // manuales antiguos CON cliente no son distinguibles y quedan como 'app'.
    await queryRunner.query(
      `UPDATE "orders" SET "source" = 'admin' WHERE "userId" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "source"`);
    await queryRunner.query(`DROP TYPE "public"."orders_source_enum"`);
  }
}
