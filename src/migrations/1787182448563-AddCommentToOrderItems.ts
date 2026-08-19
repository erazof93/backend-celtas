import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommentToOrderItems1787182448563 implements MigrationInterface {
  name = 'AddCommentToOrderItems1787182448563';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD "comment" character varying(140)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "comment"`);
  }
}
