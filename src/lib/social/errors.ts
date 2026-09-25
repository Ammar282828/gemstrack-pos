/**
 * Every Post a Piece failure, written down with what to do about it.
 *
 * `social_errors` in Firestore: when, where (website / whatsapp / instagram /
 * ai …), what the outside system said, and the diagnosis. The checks panel
 * shows the last day's, so "it didn't post yesterday" has an answer the next
 * morning, and a problem that keeps recurring is visible as a pattern rather
 * than a string of one-off toasts. Never throws — a failure to log a failure
 * must not become the error the counter sees.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { diagnose, type DiagnoseContext, type Where } from './diagnose';

export const ERRORS = 'social_errors';

/** Where the fixes point, from this deployment's configuration. */
export function diagnoseContext(): DiagnoseContext {
  const site = (process.env.NEXT_PUBLIC_STORE_WEBSITE_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const phone = (process.env.NEXT_PUBLIC_STORE_WHATSAPP_URL || '').match(/wa\.me\/(\d+)/)?.[1];
  return {
    site: site || undefined,
    aiProject: process.env.IMAGE_AI_PROJECT || undefined,
    posProject: process.env.GOOGLE_CLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined,
    metaAppId: process.env.INSTAGRAM_META_APP_ID || undefined,
    waLine: phone ? `+${phone}` : undefined,
    igUsername: process.env.INSTAGRAM_USERNAME || undefined,
    wahaUrl: (process.env.WAHA_URL || '').replace(/\/+$/, '') || undefined,
  };
}

export async function recordError(where: Where, err: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined;
  const message = err instanceof Error ? err.message : String(err ?? '');
  const d = diagnose(where, { status, message }, diagnoseContext());
  console.error(`[post] ${where} failed: ${message}`);
  try {
    await adminDb.collection(ERRORS).add({ at: new Date().toISOString(), where, status: status ?? null, message: message.slice(0, 500), title: d.title, fix: d.fix, ...extra });
  } catch (e) {
    console.warn('[post] could not record the error:', e instanceof Error ? e.message : e);
  }
}

export interface RecordedError { at: string; where: Where; message: string; title: string; fix: string }

export async function recentErrors(hours = 24, limit = 20): Promise<RecordedError[]> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const snap = await adminDb.collection(ERRORS).where('at', '>=', since).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map(d => d.data() as RecordedError);
}
