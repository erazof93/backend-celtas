import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelReasonToOrders1787841923730 implements MigrationInterface {
  name = 'AddCancelReasonToOrders1787841923730';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD "cancelReason" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "cancelReason"`);
  }
}
