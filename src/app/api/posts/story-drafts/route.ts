/**
 * Posts › Stories (src/lib/social/story-drafts.ts): the house's running order of website pieces as Instagram stories.
 *
 *   GET  → { drafts: StoryDraft[] }: each with the site's name and weight as they are now, and what the counter did
 *   POST { id, status: 'posted' | 'skipped' | null } → { draft }: mark one posted or skipped, or back to a draft
 *   POST { id, sent: 'instagram' } or { id, sent: 'whatsapp', to: [key…] } → { draft }: it went out from the tab
 *        (to Instagram, or to those WhatsApp places by their keys, destinations.ts), so it is posted, and where is kept
 *
 * The pictures are drawn in the browser (week-story.ts) from /api/website/site-pieces/image and sent by the routes
 * that send everything else (/api/instagram/story, /api/website/post); only what happened is kept, in `story_drafts`
 * (one document per piece, its id the key in base64url as Photo weights does). "Back to drafts" clears the status
 * and keeps where it went, so a second send doesn't forget the first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { postGate } from '@/lib/social/gate';
import { postChannel, postGroups } from '@/lib/social/destinations';
import { STORE_BRAND, STORE_SITE_POSTS } from '@/lib/store-config';
import { STORY_DRAFT_SEEDS, buildDrafts, type StoryDraftPlace, type StoryDraftState } from '@/lib/social/story-drafts';
import { getSitePieces } from '@/lib/website/site-pieces';
import { docIdFor } from '@/lib/website/weights';

export const dynamic = 'force-dynamic';

const COLLECTION = 'story_drafts';
const seeds = () => STORY_DRAFT_SEEDS[STORE_BRAND] ?? [];
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

async function states(): Promise<Record<string, StoryDraftState>> {
  const snap = await adminDb.collection(COLLECTION).get();
  const out: Record<string, StoryDraftState> = {};
  for (const d of snap.docs) {
    const x = d.data() as Partial<StoryDraftState> & { id?: string };
    if (!x.id || (x.status !== 'posted' && x.status !== 'skipped')) continue;
    const on = strings(x.on).filter((p): p is StoryDraftPlace => p === 'instagram' || p === 'whatsapp');
    const whatsapp = strings(x.whatsapp);
    out[x.id] = { status: x.status, at: String(x.at || ''), by: String(x.by || ''), ...(on.length ? { on } : {}), ...(whatsapp.length ? { whatsapp } : {}) };
  }
  return out;
}

async function drafts() {
  const [{ pieces }, done] = await Promise.all([getSitePieces({ all: true }), states()]);
  const byId = new Map(pieces.map(p => [p.id, { name: p.name, weightGrams: p.weightGrams, hidden: p.hidden, url: p.url }]));
  return buildDrafts(seeds(), byId, done);
}

export async function GET(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_POSTS);
  if (who instanceof NextResponse) return who;
  try {
    return NextResponse.json({ drafts: await drafts() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: `Could not read the story drafts: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_POSTS);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown; sent?: unknown; to?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!seeds().some(s => s.id === id)) return NextResponse.json({ error: 'No such story draft.' }, { status: 404 });
  const ref = adminDb.collection(COLLECTION).doc(docIdFor(id));
  const at = new Date().toISOString();

  if (body?.sent !== undefined) {
    const sent = body.sent;
    if (sent !== 'instagram' && sent !== 'whatsapp') return NextResponse.json({ error: 'sent is instagram or whatsapp.' }, { status: 400 });
    const keys = new Set([...postGroups(), ...(postChannel() ? [postChannel()!] : [])].map(d => d.key));
    const to = [...new Set(strings(body.to))];
    if (sent === 'whatsapp' && (!to.length || to.some(k => !keys.has(k)))) return NextResponse.json({ error: 'to is the WhatsApp places it went to, by key.' }, { status: 400 });
    await ref.set({
      id, status: 'posted', at, by: who, on: FieldValue.arrayUnion(sent),
      ...(sent === 'whatsapp' ? { whatsapp: FieldValue.arrayUnion(...to) } : {}),
    }, { merge: true });
  } else {
    const status = body?.status;
    if (status !== 'posted' && status !== 'skipped' && status !== null) return NextResponse.json({ error: 'status is posted, skipped or null.' }, { status: 400 });
    if (status === null) await ref.set({ id, status: FieldValue.delete(), at: FieldValue.delete(), by: FieldValue.delete() }, { merge: true });
    else await ref.set({ id, status, at, by: who }, { merge: true });
  }
  const draft = (await drafts()).find(d => d.id === id) ?? null;
  return NextResponse.json({ draft });
}
