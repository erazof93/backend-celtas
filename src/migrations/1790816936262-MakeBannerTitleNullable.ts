import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeBannerTitleNullable1790816936262 implements MigrationInterface {
  name = 'MakeBannerTitleNullable1790816936262';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "banners" ALTER COLUMN "title" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rellena los títulos null antes de volver a exigir NOT NULL (si no, el revert falla).
    await queryRunner.query(
      `UPDATE "banners" SET "title" = '' WHERE "title" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ALTER COLUMN "title" SET NOT NULL`,
    );
  }
}
