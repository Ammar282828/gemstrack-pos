/**
 * What Meta forgets, kept: run hourly from the five-minute tick (the cloud sessions can't create
 * Scheduler jobs; see /api/website/post/queue/tick).
 *
 * - A story's numbers exist only while it is up (24 hours), so each live story is read every hour
 *   and its latest numbers written to `social_stories/<id>`: the last read before it ends is its
 *   final count, give or take an hour.
 * - Follower counts are a single "now" on both platforms (Instagram's daily new-followers series
 *   goes back 30 days and is often empty), so each day's last count goes to `social_daily/<date>`,
 *   which is the follower history the Insights page draws.
 *
 * Server-only. Never throws: a failure is logged and the tick goes on.
 */

import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { graph } from '@/lib/ads/meta';
import { loadAdsSettings } from '@/lib/ads/settings';
import { STORE_META_ADS } from '@/lib/store-config';
import { mediaValues, pkDay } from './shape';
import { igRow, STORY_METRICS } from './fetch';

/** A story's picture, 480 px JPEG in Storage, under a download token like the product photos. */
async function keepPicture(id: string, url: string | undefined): Promise<string | null> {
  if (!url) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).resize(480, 480, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
  const bucket = adminBucket();
  const path = `social-stories/${id}.jpg`;
  const token = randomUUID();
  await bucket.file(path).save(jpeg, { resumable: false, contentType: 'image/jpeg', metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

const STATE = () => adminDb.collection('app_settings').doc('social_insights_snapshot');
const EVERY_MS = 55 * 60_000;

export async function snapshotIfDue(now = Date.now()): Promise<{ ran: boolean; stories?: number; error?: string }> {
  if (!STORE_META_ADS) return { ran: false };
  try {
    const state = await STATE().get();
    const last = Date.parse(String(state.data()?.lastRun ?? '')) || 0;
    if (now - last < EVERY_MS) return { ran: false };
    await STATE().set({ lastRun: new Date(now).toISOString() }, { merge: true });

    const s = await loadAdsSettings();
    if (!s.instagramUserId && !s.pageId) return { ran: false };
    const day = pkDay(now);

    const [ig, fb] = await Promise.all([
      s.instagramUserId ? graph<{ followers_count?: number }>(s.instagramUserId, { params: { fields: 'followers_count' } }).catch(() => null) : null,
      s.pageId ? graph<{ followers_count?: number; fan_count?: number }>(s.pageId, { params: { fields: 'followers_count,fan_count' } }).catch(() => null) : null,
    ]);
    await adminDb.collection('social_daily').doc(day).set({
      date: day,
      igFollowers: ig?.followers_count ?? null,
      fbFollowers: fb ? (fb.followers_count ?? fb.fan_count ?? null) : null,
      at: new Date(now).toISOString(),
    }, { merge: true });

    let stories = 0;
    if (s.instagramUserId) {
      const live = await graph<{ data?: { id: string; caption?: string; media_type?: string; media_product_type?: string; timestamp?: string; permalink?: string; thumbnail_url?: string; media_url?: string }[] }>(
        `${s.instagramUserId}/stories`, { params: { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url', limit: 50 } },
      ).catch(() => ({ data: [] }));
      for (const m of live.data ?? []) {
        const v = await graph<{ data?: never[] }>(`${m.id}/insights`, { params: { metric: STORY_METRICS.join(',') } })
          .catch(() => Promise.all(STORY_METRICS.map(x => graph<{ data?: never[] }>(`${m.id}/insights`, { params: { metric: x } }).catch(() => ({ data: [] }))))
            .then(parts => ({ data: parts.flatMap(p => p.data ?? []) })));
        const row = igRow({ ...m, media_product_type: 'STORY' }, mediaValues(v));
        const ref = adminDb.collection('social_stories').doc(m.id);
        // Meta's picture link dies with the story: the first read keeps a small copy of its own.
        const had = await ref.get();
        const thumb = had.exists && had.data()?.thumb && String(had.data()?.thumb).includes('firebasestorage') ? String(had.data()?.thumb) : await keepPicture(m.id, m.thumbnail_url ?? m.media_url).catch(() => row.thumb);
        await ref.set({ ...row, thumb, readAt: new Date(now).toISOString() }, { merge: true });
        stories++;
      }
    }
    return { ran: true, stories };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn('[insights/snapshot]', error);
    return { ran: true, error };
  }
}
