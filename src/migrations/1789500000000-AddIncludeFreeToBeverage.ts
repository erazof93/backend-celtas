import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIncludeFreeToBeverage1789500000000 implements MigrationInterface {
  name = 'AddIncludeFreeToBeverage1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "beverages" ADD "includeFreeTo" uuid array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "beverages" DROP COLUMN "includeFreeTo"`,
    );
  }
}
