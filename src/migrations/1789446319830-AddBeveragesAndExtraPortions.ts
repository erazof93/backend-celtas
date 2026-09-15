import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBeveragesAndExtraPortions1789446319830 implements MigrationInterface {
  name = 'AddBeveragesAndExtraPortions1789446319830';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "extra_portions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "price" numeric(10,2) NOT NULL, "active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_b0c287eecf55d9025eac5ed6292" UNIQUE ("name"), CONSTRAINT "PK_2bba4e4c6c56149932ea34dd6b5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "beverages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "price" numeric(10,2) NOT NULL, "active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_f9b029bc67e6e1af59eb34a4a9b" UNIQUE ("name"), CONSTRAINT "PK_0bfd563a0b71116a22b63025c57" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "menu_item_beverages" ("menuItemId" uuid NOT NULL, "beverageId" uuid NOT NULL, CONSTRAINT "PK_2c7460bec2469d3633e4304368c" PRIMARY KEY ("menuItemId", "beverageId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_71e9040a4546ffdcef1dc4a5be" ON "menu_item_beverages"  ("menuItemId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9053a61ad013193307fd091ce" ON "menu_item_beverages"  ("beverageId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "menu_item_extra_portions" ("menuItemId" uuid NOT NULL, "extraPortionId" uuid NOT NULL, CONSTRAINT "PK_e5e7561a160c30dc6b19f8b9439" PRIMARY KEY ("menuItemId", "extraPortionId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3809a4490a0b67cab08eb9b628" ON "menu_item_extra_portions"  ("menuItemId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_044f7d6a3370d5e17fa996c427" ON "menu_item_extra_portions"  ("extraPortionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "beverage_group_required" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "beverage_group_max_selectable" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "extra_portions_group_required" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "extra_portions_group_max_selectable" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD "selectedBeverages" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD "selectedExtraPortions" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_beverages" ADD CONSTRAINT "FK_71e9040a4546ffdcef1dc4a5beb" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_beverages" ADD CONSTRAINT "FK_c9053a61ad013193307fd091ce3" FOREIGN KEY ("beverageId") REFERENCES "beverages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_extra_portions" ADD CONSTRAINT "FK_3809a4490a0b67cab08eb9b6282" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_extra_portions" ADD CONSTRAINT "FK_044f7d6a3370d5e17fa996c427c" FOREIGN KEY ("extraPortionId") REFERENCES "extra_portions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_item_extra_portions" DROP CONSTRAINT "FK_044f7d6a3370d5e17fa996c427c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_extra_portions" DROP CONSTRAINT "FK_3809a4490a0b67cab08eb9b6282"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_beverages" DROP CONSTRAINT "FK_c9053a61ad013193307fd091ce3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_beverages" DROP CONSTRAINT "FK_71e9040a4546ffdcef1dc4a5beb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP COLUMN "selectedExtraPortions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP COLUMN "selectedBeverages"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "extra_portions_group_max_selectable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "extra_portions_group_required"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "beverage_group_max_selectable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "beverage_group_required"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_044f7d6a3370d5e17fa996c427"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3809a4490a0b67cab08eb9b628"`,
    );
    await queryRunner.query(`DROP TABLE "menu_item_extra_portions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9053a61ad013193307fd091ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_71e9040a4546ffdcef1dc4a5be"`,
    );
    await queryRunner.query(`DROP TABLE "menu_item_beverages"`);
    await queryRunner.query(`DROP TABLE "beverages"`);
    await queryRunner.query(`DROP TABLE "extra_portions"`);
  }
}
