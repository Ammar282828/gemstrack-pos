/**
 * The Emergency lock (Activity → "Lock Database Now", settings-sections.tsx EmergencyLock): `databaseLocked` on
 * the shop's settings, after which every write is refused, in the browser (store.ts) and on the server
 * (/api/app/write, /api/staff/write), until a developer restores access. One way only: there is no unlock
 * here, nor anywhere a person can reach, by design. lib/writes/settings.ts keeps the flag out of
 * updateSettings, so this is the one write that sets it.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';

const SETTINGS = 'app_settings';
const GLOBAL = 'global';

/** The lock, merged over the settings (nothing else in them is touched), and a line in the activity log. */
export async function lockDatabase(db: DbPort, input: { by: string; at?: string }, fx: SideEffects = {}): Promise<{ locked: true; at: string }> {
  const at = input.at ?? new Date().toISOString();
  const b = db.batch();
  b.set(SETTINGS, GLOBAL, { databaseLocked: true }, true);
  await b.commit();
  void Promise.resolve(fx.log?.('settings.lock', 'Database locked', `Emergency lock by ${input.by || 'an owner'}`, GLOBAL)).catch(() => undefined);
  return { locked: true, at };
}
