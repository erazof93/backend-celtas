import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `sauce_group_max_selectable` pasa a nullable (NULL = sin límite de salsas).
 * Los productos existentes conservan su valor actual (no se tocan datos);
 * solo los nuevos que no lo especifiquen quedan en NULL.
 */
export class MakeSauceGroupMaxSelectableNullable1790726082297 implements MigrationInterface {
  name = 'MakeSauceGroupMaxSelectableNullable1790726082297';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_items" ALTER COLUMN "sauce_group_max_selectable" DROP NOT NULL`,
    );
    // DROP DEFAULT en Postgres = default NULL.
    await queryRunner.query(
      `ALTER TABLE "menu_items" ALTER COLUMN "sauce_group_max_selectable" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sin esto, SET NOT NULL falla si algún producto ya quedó "sin límite".
    await queryRunner.query(
      `UPDATE "menu_items" SET "sauce_group_max_selectable" = 1 WHERE "sauce_group_max_selectable" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ALTER COLUMN "sauce_group_max_selectable" SET DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ALTER COLUMN "sauce_group_max_selectable" SET NOT NULL`,
    );
  }
}
