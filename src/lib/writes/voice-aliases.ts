/**
 * Settings → Voice: a name the assistant learned, taken back ("Forget"). The one copy, for the iPhone app
 * (/api/app/write `forgetVoiceAlias`, ops-settings2.ts) on the Admin SDK; the browser's store
 * (`forgetVoiceAlias`) deletes the document itself and can call this with its client port instead.
 *
 * Not behind the delete code: it is a settings list, outside the books (decision "Delete code": settings
 * lists are not gated). Nothing is logged, as the store logs nothing for it. A name already forgotten (on
 * another device, a moment ago) is said, not deleted twice.
 */

import type { DbPort } from '@/lib/db-port';

export const VOICE_ALIASES = 'voice_aliases';

export type ForgottenAlias = { id: string; heard: string; refName: string };

export async function forgetVoiceAlias(db: DbPort, id: string): Promise<ForgottenAlias> {
  const held = await db.get<{ heard?: unknown; refName?: unknown }>(VOICE_ALIASES, id);
  if (!held) throw new Error('No such name: it has already been forgotten.');
  const b = db.batch();
  b.delete(VOICE_ALIASES, id);
  await b.commit();
  return {
    id,
    heard: typeof held.heard === 'string' ? held.heard : '',
    refName: typeof held.refName === 'string' ? held.refName : '',
  };
}
