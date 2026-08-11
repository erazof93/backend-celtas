import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMinPurchaseAmountToCoupons1786489584429 implements MigrationInterface {
  name = 'AddMinPurchaseAmountToCoupons1786489584429';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD "minPurchaseAmount" numeric(10,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coupons" DROP COLUMN "minPurchaseAmount"`,
    );
  }
}
