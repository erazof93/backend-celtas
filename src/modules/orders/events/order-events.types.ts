export const ORDER_EVENTS_CHANNEL = 'celtas_order_events_v1';
export type OrderEventType =
  'order.created' | 'order.status_changed' | 'order.updated';
export interface OrderEventRow {
  eventId: string;
  type: OrderEventType;
  orderId: string;
  status: string;
  occurredAt: Date;
  cursor: string;
}
export interface EventState {
  head: string;
  floor: string;
}
export const STREAM_LIMITS = {
  total: 40,
  perUser: 4,
  startsPerMinute: 12,
  heartbeatMs: 20_000,
  roleCheckMs: 60_000,
  slowClientMs: 10_000,
  bytes: 65_536,
  replay: 100,
} as const;

export function eventFrame(row: OrderEventRow): string {
  // Explicit allowlist: never serialize the order, user or arbitrary JSON.
  return `id: ${row.cursor}\nevent: ${row.type}\ndata: ${JSON.stringify({
    v: 1,
    eventId: row.eventId,
    orderId: row.orderId,
    status: row.status,
    occurredAt: row.occurredAt.toISOString(),
  })}\n\n`;
}
export function controlFrame(
  type: string,
  data: Record<string, unknown> = {},
): string {
  return `event: ${type}\ndata: ${JSON.stringify({ v: 1, ...data })}\n\n`;
}
