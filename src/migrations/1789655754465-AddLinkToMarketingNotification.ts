import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLinkToMarketingNotification1789655754465 implements MigrationInterface {
  name = 'AddLinkToMarketingNotification1789655754465';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "marketing_notifications" ADD "link" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "marketing_notifications" DROP COLUMN "link"`,
    );
  }
}
