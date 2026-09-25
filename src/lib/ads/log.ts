/**
 * Every change the POS makes to this house's ads — made, switched on, paused,
 * budget, audience, deleted — written down in `ads_log`: when, by whom (under
 * open access, "counter"), and what. The Ads pages are open like the rest of the
 * POS, so "who raised that budget?" needs an answer. Never throws.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';

export async function logAds(entry: { by: string; action: string; target?: string; name?: string; detail?: Record<string, unknown> }): Promise<void> {
  try {
    await adminDb.collection('ads_log').add({ at: new Date().toISOString(), ...entry });
  } catch (e) {
    console.warn('[ads] could not log:', e instanceof Error ? e.message : e);
  }
}

export async function recentAdsLog(limit = 30): Promise<Record<string, unknown>[]> {
  const snap = await adminDb.collection('ads_log').orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
