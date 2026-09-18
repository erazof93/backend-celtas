import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllowWithoutToMenuItem1789703153546 implements MigrationInterface {
  name = 'AddAllowWithoutToMenuItem1789703153546';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "sauce_allow_without" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "beverage_allow_without" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "extra_portions_allow_without" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "extra_portions_allow_without"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "beverage_allow_without"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "sauce_allow_without"`,
    );
  }
}
