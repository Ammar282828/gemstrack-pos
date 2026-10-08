/**
 * The widget's side of the server: its keys (`widget_keys`, by hash: the key itself lives only in
 * the phone's keychain) and its figures, worked out at most every fifteen minutes however many
 * phones ask (`app_private/widget_summary`), as each working-out reads the book's collections whole.
 *
 * Server-only.
 */

import crypto from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { roleForEmail } from '@/lib/roles';
import { STORE_CONFIG } from '@/lib/store-config';
import { loadRates } from '@/lib/website/config';
import { rows, theDayRows } from '@/lib/notifications/reports';
import { widgetSummary, type WidgetRows, type WidgetSummary } from './summary';

const KEYS = () => adminDb.collection('widget_keys');
const CACHE = () => adminDb.collection('app_private').doc('widget_summary');
const FRESH_MS = 15 * 60_000;
const hash = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

/** A new key for one phone's widget; the ERP keeps only its hash. */
export async function newWidgetKey(email: string, label: string): Promise<string> {
  const key = crypto.randomBytes(32).toString('base64url');
  await KEYS().doc(hash(key)).set({ email, label: label.slice(0, 60), createdAt: new Date().toISOString() });
  return key;
}

/** The owner behind a key, or null: an unknown key, or one whose owner no longer is. */
export async function widgetKeyOwner(key: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(key)) return null;
  const ref = KEYS().doc(hash(key));
  const snap = await ref.get();
  const email = snap.exists ? String(snap.data()?.email || '') : '';
  if (!email || roleForEmail(email) !== 'owner') return null;
  ref.update({ lastUsedAt: new Date().toISOString() }).catch(() => undefined);
  return email;
}

let memo: { at: number; summary: WidgetSummary } | null = null;

export async function currentWidgetSummary(now = new Date()): Promise<WidgetSummary> {
  if (memo && now.getTime() - memo.at < FRESH_MS) return memo.summary;
  const cached = (await CACHE().get()).data() as { at?: number; summary?: WidgetSummary } | undefined;
  if (cached?.summary && cached.at && now.getTime() - cached.at < FRESH_MS) {
    memo = { at: cached.at, summary: cached.summary };
    return cached.summary;
  }
  const [day, hisaab, rates] = await Promise.all([theDayRows(), rows('hisaab'), loadRates()]);
  const input = { ...day, hisaab, rates } as unknown as WidgetRows;
  const summary = widgetSummary(input, STORE_CONFIG.name, STORE_CONFIG.defaultMetal, now);
  memo = { at: now.getTime(), summary };
  await CACHE().set({ at: now.getTime(), summary }).catch(() => undefined);
  return summary;
}
