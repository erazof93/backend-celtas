import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarketingNotifications1787157787761 implements MigrationInterface {
  name = 'AddMarketingNotifications1787157787761';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "marketing_notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "body" text NOT NULL, "adminId" uuid, "sentCount" integer NOT NULL, "totalCount" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_506243e53f6669bb7b7c66e450e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "marketing_notifications" ADD CONSTRAINT "FK_456e3e8cf59df8a0701737f2f82" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "marketing_notifications" DROP CONSTRAINT "FK_456e3e8cf59df8a0701737f2f82"`,
    );
    await queryRunner.query(`DROP TABLE "marketing_notifications"`);
  }
}
