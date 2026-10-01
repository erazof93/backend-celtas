import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappSentAtToOrder1790802308089 implements MigrationInterface {
  name = 'AddWhatsappSentAtToOrder1790802308089';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "whatsappSentAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "whatsappSentAt"`,
    );
  }
}
