import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catálogo `fries_types` (fritas / al hilo) + relación `menu_item_fries_types` +
 * config de grupo en `menu_items` + snapshot `order_items.selectedFriesTypes`.
 * El seed inicial NO va acá: lo hace `FriesTypesService.onModuleInit` si la tabla
 * está vacía.
 */
export class CreateFriesTypeEntity1790741660809 implements MigrationInterface {
  name = 'CreateFriesTypeEntity1790741660809';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fries_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "is_default" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_d4414991108909789be7b8a80c5" UNIQUE ("name"), CONSTRAINT "PK_0580a745373febc4ea5dc6bc268" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "menu_item_fries_types" ("menuItemId" uuid NOT NULL, "friesTypeId" uuid NOT NULL, CONSTRAINT "PK_d6e783f507c9c70b9cb6f597b5c" PRIMARY KEY ("menuItemId", "friesTypeId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5e7fc3af29eadf8993d6054015" ON "menu_item_fries_types"  ("menuItemId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5acffdea3d54b045d789dfe6c7" ON "menu_item_fries_types"  ("friesTypeId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "fries_type_group_required" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "fries_type_group_max_selectable" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD "selectedFriesTypes" text array`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_fries_types" ADD CONSTRAINT "FK_5e7fc3af29eadf8993d60540159" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_fries_types" ADD CONSTRAINT "FK_5acffdea3d54b045d789dfe6c77" FOREIGN KEY ("friesTypeId") REFERENCES "fries_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_item_fries_types" DROP CONSTRAINT "FK_5acffdea3d54b045d789dfe6c77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_fries_types" DROP CONSTRAINT "FK_5e7fc3af29eadf8993d60540159"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP COLUMN "selectedFriesTypes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "fries_type_group_max_selectable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "fries_type_group_required"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5acffdea3d54b045d789dfe6c7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5e7fc3af29eadf8993d6054015"`,
    );
    await queryRunner.query(`DROP TABLE "menu_item_fries_types"`);
    await queryRunner.query(`DROP TABLE "fries_types"`);
  }
}
