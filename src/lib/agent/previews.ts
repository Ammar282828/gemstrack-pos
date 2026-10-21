/**
 * Pictures for the REST twin. A ChatGPT Action can't show base64 in JSON, so a picture a tool answers with
 * (a post as drawn, a photograph) is held for an hour at an unguessable address and the answer carries the
 * address: /api/agent/preview/<token>. MCP sends pictures inline and never comes here. Like the
 * `social_media` relay Instagram fetches from: a draft's picture, nothing else, and gone after the hour.
 * Server-only.
 */

import { randomBytes } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';

const COL = 'ai_previews';
const HOLD_MS = 60 * 60_000;
const MAX = 900 * 1024;

export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** Hold a picture; answers its address under `origin`. */
export async function holdPreview(origin: string, data: Buffer, mimeType: string): Promise<string> {
  if (data.length > MAX) throw new Error('That picture is too big to show.');
  const token = randomBytes(24).toString('base64url');
  const now = Date.now();
  await adminDb.collection(COL).doc(token).set({ data, mimeType, until: now + HOLD_MS });
  // Old ones go as new ones come, a few at a time.
  adminDb.collection(COL).where('until', '<', now).limit(20).get()
    .then(s => Promise.all(s.docs.map(d => d.ref.delete()))).catch(() => undefined);
  return `${origin.replace(/\/+$/, '')}/api/agent/preview/${token}`;
}

export async function readPreview(token: string): Promise<{ data: Buffer; mimeType: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const s = await adminDb.collection(COL).doc(token).get();
  const d = s.data() as { data?: Buffer; mimeType?: string; until?: number } | undefined;
  if (!d?.data || !d.until || d.until < Date.now()) return null;
  return { data: Buffer.from(d.data), mimeType: d.mimeType || 'image/jpeg' };
}
