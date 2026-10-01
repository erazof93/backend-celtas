import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Escrita a mano: TypeORM no modela índices de expresión.
 *
 * Índice de EXPRESIÓN, no sobre `phone` a secas: el prefiltro del cruce por
 * celular de reportes (ReportsService.customerResolver) compara
 * `right(regexp_replace(phone, '[^0-9]', '', 'g'), 8)`, y Postgres solo usa un
 * índice cuya expresión coincide exactamente con la de la consulta. Un índice
 * B-tree sobre `phone` no se usaría nunca para ese filtro.
 */
export class AddPhoneIndexToUsers1790900000000 implements MigrationInterface {
  name = 'AddPhoneIndexToUsers1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_users_phone_tail8" ON "users" (right(regexp_replace("phone", '[^0-9]', '', 'g'), 8))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_users_phone_tail8"`);
  }
}
