import { MigrationInterface, QueryRunner } from "typeorm";

export class AllowAnonymousManualOrders1790787155985 implements MigrationInterface {
    name = 'AllowAnonymousManualOrders1790787155985'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" ADD "customerName" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "customerPhone" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_151b79a83ba240b0cb31b2302d1"`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "userId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_151b79a83ba240b0cb31b2302d1" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revisado a mano: SET NOT NULL fallaría a mitad de camino si ya hay pedidos
        // manuales anónimos. Se aborta antes, sin borrar datos: decidir qué hacer con
        // esos pedidos (asignarlos a un cliente o eliminarlos) es una decisión manual.
        const [{ count }] = await queryRunner.query(`SELECT COUNT(*)::int AS "count" FROM "orders" WHERE "userId" IS NULL`);
        if (count > 0) {
            throw new Error(`No se puede revertir AllowAnonymousManualOrders: hay ${count} pedido(s) sin userId. Asígnalos a un cliente o elimínalos primero.`);
        }
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_151b79a83ba240b0cb31b2302d1"`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "userId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_151b79a83ba240b0cb31b2302d1" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "customerPhone"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "customerName"`);
    }

}
