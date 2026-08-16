import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSaucesCatalog1786846925971 implements MigrationInterface {
  name = 'AddSaucesCatalog1786846925971';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sauces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_fb8709a2f803cdf48a1987f933f" UNIQUE ("name"), CONSTRAINT "PK_782d0a478f4cbea6fbc52d01032" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "menu_item_sauces" ("menuItemId" uuid NOT NULL, "sauceId" uuid NOT NULL, CONSTRAINT "PK_9b5564272dbc67fea233b57206f" PRIMARY KEY ("menuItemId", "sauceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb39515d8759c6828d63ce6b5a" ON "menu_item_sauces"  ("menuItemId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_81b7f07ad4e2d7bd67d8a9dc84" ON "menu_item_sauces"  ("sauceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD "selectedSauces" text array`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_sauces" ADD CONSTRAINT "FK_eb39515d8759c6828d63ce6b5a7" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_sauces" ADD CONSTRAINT "FK_81b7f07ad4e2d7bd67d8a9dc84a" FOREIGN KEY ("sauceId") REFERENCES "sauces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_item_sauces" DROP CONSTRAINT "FK_81b7f07ad4e2d7bd67d8a9dc84a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_sauces" DROP CONSTRAINT "FK_eb39515d8759c6828d63ce6b5a7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP COLUMN "selectedSauces"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_81b7f07ad4e2d7bd67d8a9dc84"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb39515d8759c6828d63ce6b5a"`,
    );
    await queryRunner.query(`DROP TABLE "menu_item_sauces"`);
    await queryRunner.query(`DROP TABLE "sauces"`);
  }
}
