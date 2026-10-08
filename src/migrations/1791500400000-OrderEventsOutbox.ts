import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive: the previous backend ignores these tables. Never drops business data. */
export class OrderEventsOutbox1791500400000 implements MigrationInterface {
  name = 'OrderEventsOutbox1791500400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE order_event_state (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      "streamId" uuid NOT NULL DEFAULT gen_random_uuid(),
      head bigint NOT NULL DEFAULT 0, floor bigint NOT NULL DEFAULT 0,
      CHECK (floor >= 0 AND head >= floor)
    )`);
    await runner.query(
      'INSERT INTO order_event_state (singleton) VALUES (true)',
    );
    await runner.query(`CREATE TABLE order_events (
      "eventId" uuid PRIMARY KEY,
      "dedupeKey" varchar(160) NOT NULL UNIQUE,
      type varchar(32) NOT NULL CHECK (type IN ('order.created','order.status_changed','order.updated')),
      "orderId" uuid NOT NULL,
      status varchar(24) NOT NULL CHECK (status IN ('pendiente','confirmado','en_camino','entregado','cancelado')),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      cursor bigint UNIQUE,
      "publishedAt" timestamptz,
      CHECK ((cursor IS NULL AND "publishedAt" IS NULL) OR (cursor > 0 AND "publishedAt" IS NOT NULL))
    )`);
    await runner.query(
      `CREATE INDEX "IDX_order_events_pending" ON order_events ("occurredAt", "eventId") WHERE cursor IS NULL`,
    );
    await runner.query(
      `CREATE INDEX "IDX_order_events_retention" ON order_events ("publishedAt", cursor) WHERE cursor IS NOT NULL`,
    );
  }

  down(): Promise<void> {
    throw new Error(
      'Revertir el código y desactivar ORDER_EVENTS_ENABLED; conservar el historial. La eliminación requiere revisión explícita.',
    );
  }
}
