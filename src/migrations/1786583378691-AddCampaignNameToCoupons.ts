import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignNameToCoupons1786583378691 implements MigrationInterface {
  name = 'AddCampaignNameToCoupons1786583378691';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD "campaignName" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a3fba499091392a384c434fa3d" ON "coupons"  ("campaignName") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a3fba499091392a384c434fa3d"`,
    );
    await queryRunner.query(`ALTER TABLE "coupons" DROP COLUMN "campaignName"`);
  }
}
