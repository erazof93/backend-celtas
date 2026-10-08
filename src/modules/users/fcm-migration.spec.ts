import { QueryRunner } from 'typeorm';
import { FcmGenerations1791414000000 } from '../../migrations/1791414000000-FcmGenerations';

/** Captures SQL only; never connects to a database or executes a migration. */
describe('FCM additive migration definition', () => {
  it('adds nullable ownership and durable revocations without changing existing rows', async () => {
    const query = jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined);
    await new FcmGenerations1791414000000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(2);
    const sql = query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sql).toContain('CREATE TABLE "fcm_generations"');
    expect(sql).toContain('PRIMARY KEY ("userId", "generation")');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('ADD COLUMN "fcmGeneration" uuid NULL');
    expect(sql).not.toMatch(/\b(DROP|UPDATE|TRUNCATE)\b/);
  });
  it('refuses automatic deletion of persistent revocations', async () => {
    await expect(new FcmGenerations1791414000000().down()).rejects.toThrow(
      'reviewed schema rollback',
    );
  });
});
