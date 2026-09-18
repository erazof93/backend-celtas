import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSauceGroupFieldsToMenuItem1789486222991 implements MigrationInterface {
  name = 'AddSauceGroupFieldsToMenuItem1789486222991';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "sauce_group_required" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "sauce_group_max_selectable" integer NOT NULL DEFAULT '1'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "sauce_group_max_selectable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "sauce_group_required"`,
    );
  }
}
