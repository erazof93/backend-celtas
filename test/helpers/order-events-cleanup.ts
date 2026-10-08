import { DataSource } from 'typeorm';

export interface OrderEventBaseline {
  singleton: boolean;
  streamId: string;
  head: string;
  floor: string;
}

/** Test-only reset, after publishers and their database transactions have stopped. */
export async function cleanupOrderEventFixtures(
  db: DataSource,
  orderIds: string[],
  baseline: OrderEventBaseline,
): Promise<void> {
  if (!baseline.singleton || baseline.head !== '0' || baseline.floor !== '0')
    throw new Error('SSE cleanup requires an initial baseline');
  await db.transaction(async (manager) => {
    await manager.query("SET LOCAL lock_timeout = '5000ms'");
    const [lock] = await manager.query<{ acquired: boolean }[]>(
      'SELECT pg_try_advisory_xact_lock(731942, 101) AS acquired',
    );
    if (!lock.acquired) throw new Error('SSE cleanup: publisher still active');
    await manager.query(
      'LOCK TABLE orders, order_events, order_event_state, order_items, reward_redemptions, coupons IN SHARE ROW EXCLUSIVE MODE',
    );
    const state = await manager.query<OrderEventBaseline[]>(
      'SELECT singleton, "streamId", head::text, floor::text FROM order_event_state FOR UPDATE',
    );
    if (
      state.length !== 1 ||
      state[0].singleton !== baseline.singleton ||
      state[0].streamId !== baseline.streamId ||
      BigInt(state[0].floor) < 0n ||
      BigInt(state[0].head) < BigInt(state[0].floor)
    )
      throw new Error('SSE cleanup: invalid or replaced stream state');
    const [foreign] = await manager.query<{ present: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM order_events WHERE NOT ("orderId" = ANY($1::uuid[])))
       OR EXISTS (SELECT 1 FROM orders WHERE NOT (id = ANY($1::uuid[])))
       OR EXISTS (SELECT 1 FROM order_items)
       OR EXISTS (SELECT 1 FROM reward_redemptions)
       OR EXISTS (SELECT 1 FROM coupons) AS present`,
      [orderIds],
    );
    if (foreign.present)
      throw new Error('SSE cleanup: foreign fixtures detected');
    const published = await manager.query<{ cursor: string }[]>(
      'SELECT cursor::text FROM order_events WHERE cursor IS NOT NULL ORDER BY order_events.cursor',
    );
    if (
      BigInt(published.length) !==
        BigInt(state[0].head) - BigInt(state[0].floor) ||
      published.some(
        (row, index) =>
          BigInt(row.cursor) !== BigInt(state[0].floor) + BigInt(index) + 1n,
      )
    )
      throw new Error('SSE cleanup: inconsistent published cursors');
    await manager.query(
      'DELETE FROM order_events WHERE "orderId" = ANY($1::uuid[])',
      [orderIds],
    );
    await manager.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [
      orderIds,
    ]);
    await manager.query(
      'UPDATE order_event_state SET head=$1, floor=$2 WHERE singleton AND "streamId"=$3',
      [baseline.head, baseline.floor, baseline.streamId],
    );
  });
}
