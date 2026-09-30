import { UserThrottlerGuard } from './user-throttler.guard';

/** Expone el getTracker protegido sin levantar el módulo de throttler completo. */
class TestableGuard extends UserThrottlerGuard {
  tracker(req: Record<string, any>) {
    return this.getTracker(req);
  }
}

describe('UserThrottlerGuard', () => {
  const guard = Object.create(TestableGuard.prototype) as TestableGuard;

  it('con req.user → trackea por userId (no por IP)', async () => {
    await expect(
      guard.tracker({ user: { userId: 'u-1' }, ip: '200.48.0.1' }),
    ).resolves.toBe('user:u-1');
  });

  it('dos usuarios con la misma IP (CGNAT) → trackers distintos', async () => {
    const ip = '200.48.0.1';
    const a = await guard.tracker({ user: { userId: 'u-1' }, ip });
    const b = await guard.tracker({ user: { userId: 'u-2' }, ip });

    expect(a).not.toBe(b);
  });

  it('sin req.user (guard mal ordenado) → cae a la IP', async () => {
    await expect(guard.tracker({ ip: '200.48.0.1' })).resolves.toBe(
      '200.48.0.1',
    );
  });
});
