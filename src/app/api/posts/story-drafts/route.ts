/**
 * Posts › Stories (src/lib/social/story-drafts.ts): the house's running order of website pieces as Instagram stories.
 *
 *   GET  → { drafts: StoryDraft[] }: each with the site's name and weight as they are now, and what the counter did
 *   POST { id, status: 'posted' | 'skipped' | null } → { draft }: mark one posted or skipped, or back to a draft
 *
 * The pictures are drawn in the browser (week-story.ts) from /api/website/site-pieces/image; only the status is
 * kept, in `story_drafts` (one document per piece, its id the key in base64url as Photo weights does).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { postGate } from '@/lib/social/gate';
import { STORE_BRAND, STORE_SITE_POSTS } from '@/lib/store-config';
import { STORY_DRAFT_SEEDS, buildDrafts, type StoryDraftState } from '@/lib/social/story-drafts';
import { getSitePieces } from '@/lib/website/site-pieces';
import { docIdFor } from '@/lib/website/weights';

export const dynamic = 'force-dynamic';

const COLLECTION = 'story_drafts';
const seeds = () => STORY_DRAFT_SEEDS[STORE_BRAND] ?? [];

async function states(): Promise<Record<string, StoryDraftState>> {
  const snap = await adminDb.collection(COLLECTION).get();
  const out: Record<string, StoryDraftState> = {};
  for (const d of snap.docs) {
    const x = d.data() as Partial<StoryDraftState> & { id?: string };
    if (x.id && (x.status === 'posted' || x.status === 'skipped')) out[x.id] = { status: x.status, at: String(x.at || ''), by: String(x.by || '') };
  }
  return out;
}

async function drafts() {
  const [{ pieces }, done] = await Promise.all([getSitePieces({ all: true }), states()]);
  const byId = new Map(pieces.map(p => [p.id, { name: p.name, weightGrams: p.weightGrams, hidden: p.hidden }]));
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
  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  const status = body?.status;
  if (!seeds().some(s => s.id === id)) return NextResponse.json({ error: 'No such story draft.' }, { status: 404 });
  if (status !== 'posted' && status !== 'skipped' && status !== null) return NextResponse.json({ error: 'status is posted, skipped or null.' }, { status: 400 });
  const ref = adminDb.collection(COLLECTION).doc(docIdFor(id));
  if (status === null) await ref.delete();
  else await ref.set({ id, status, at: new Date().toISOString(), by: who });
  const draft = (await drafts()).find(d => d.id === id) ?? null;
  return NextResponse.json({ draft });
}
