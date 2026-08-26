import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRewardMilestonesAndSpecialTier1787764736964 implements MigrationInterface {
  name = 'AddRewardMilestonesAndSpecialTier1787764736964';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reward_milestones" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "starsRequired" integer NOT NULL, "isSpecial" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_f15ca86e0ce59c45c2852beda74" UNIQUE ("starsRequired"), CONSTRAINT "PK_ab7bdb4263aea9c9ed0ac8cd4d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "specialReward" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" ADD "milestoneStars" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" ADD "isSpecial" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" DROP COLUMN "isSpecial"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reward_redemptions" DROP COLUMN "milestoneStars"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "specialReward"`,
    );
    await queryRunner.query(`DROP TABLE "reward_milestones"`);
  }
}
