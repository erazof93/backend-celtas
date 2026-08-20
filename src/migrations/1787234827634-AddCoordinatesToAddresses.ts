import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoordinatesToAddresses1787234827634 implements MigrationInterface {
  name = 'AddCoordinatesToAddresses1787234827634';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "addresses" ADD "latitude" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "addresses" ADD "longitude" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "addresses" DROP COLUMN "longitude"`);
    await queryRunner.query(`ALTER TABLE "addresses" DROP COLUMN "latitude"`);
  }
}
