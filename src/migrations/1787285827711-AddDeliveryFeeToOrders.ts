import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeliveryFeeToOrders1787285827711 implements MigrationInterface {
  name = 'AddDeliveryFeeToOrders1787285827711';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "deliveryFee" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "deliveryFee"`);
  }
}
