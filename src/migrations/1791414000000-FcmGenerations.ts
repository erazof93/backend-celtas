import { MigrationInterface, QueryRunner } from 'typeorm';

export class FcmGenerations1791414000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "fcm_generations" (
      "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "generation" uuid NOT NULL,
      "revokedAt" timestamptz NULL,
      PRIMARY KEY ("userId", "generation")
    )`);
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN "fcmGeneration" uuid NULL',
    );
  }

  down(): Promise<void> {
    // Removing tombstones would allow old requests to reactivate push.
    return Promise.reject(
      new Error(
        'FCM revocations require an explicitly reviewed schema rollback',
      ),
    );
  }
}
