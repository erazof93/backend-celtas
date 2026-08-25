import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStarsRewardsProgram1787683759116 implements MigrationInterface {
  name = 'AddStarsRewardsProgram1787683759116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reward_redemptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "earnedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "usedInOrderId" uuid, "menuItemId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e02d178fa8c54295d8edc8781b3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5490172918e20aa466c63c9ac1" ON "reward_redemptions"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "star_promotions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "label" character varying NOT NULL, "multiplier" numeric(4,2) NOT NULL, "startDate" date NOT NULL, "endDate" date NOT NULL, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2c19e2192a4f265341a64d7747f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "redeemableWithStars" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" ADD CONSTRAINT "FK_5490172918e20aa466c63c9ac12" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" ADD CONSTRAINT "FK_9b8baff0d18a94d4ffcaeab9917" FOREIGN KEY ("usedInOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" ADD CONSTRAINT "FK_a0743d0c77605fa8da807b05b24" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" DROP CONSTRAINT "FK_a0743d0c77605fa8da807b05b24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" DROP CONSTRAINT "FK_9b8baff0d18a94d4ffcaeab9917"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" DROP CONSTRAINT "FK_5490172918e20aa466c63c9ac12"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "redeemableWithStars"`,
    );
    await queryRunner.query(`DROP TABLE "star_promotions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5490172918e20aa466c63c9ac1"`,
    );
    await queryRunner.query(`DROP TABLE "reward_redemptions"`);
  }
}
