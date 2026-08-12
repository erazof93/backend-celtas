import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDaysOfWeekToBanners1786508821865 implements MigrationInterface {
  name = 'AddDaysOfWeekToBanners1786508821865';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "banners" ADD "daysOfWeek" integer array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "banners" DROP COLUMN "daysOfWeek"`);
  }
}
