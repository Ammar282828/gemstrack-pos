/**
 * Post a Piece's queue (src/lib/social/queue.ts).
 *
 *   GET   → the queue: what is waiting, scheduled or failed, and what went in the last two days
 *   POST  { headline, caption, fileBase, counts, website, instagram, whatsapp, thumb? }
 *         → a new draft; its images follow one by one (POST /queue/:id), then PATCH { action: 'ready' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { postGate } from '@/lib/social/gate';
import { postChannel, postGroups } from '@/lib/social/destinations';
import { createItem, listItems, toView } from '@/lib/social/queue';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ items: (await listItems()).map(toView) }, { headers: { 'Cache-Control': 'no-store' } });
}

const folderOk = (f: string) => { const s = f.split('/'); return s.length === 2 && !s.some(x => !x || x === '.' || x === '..' || /[\\\0]/.test(x)); };
const nameOk = (n: string) => !!n && !/[/\\\0]/.test(n) && !n.startsWith('.');

const Create = z.object({
  headline: z.string().max(200),
  caption: z.string().max(4000),
  fileBase: z.string().max(120).regex(/^[\w-]+$/),
  counts: z.object({ site: z.number().int().min(0).max(12), wa: z.number().int().min(0).max(12), story: z.boolean() }),
  website: z.object({ folder: z.string().max(200).refine(folderOk, 'Choose a collection.'), collection: z.string().max(200), names: z.array(z.string().max(200).refine(nameOk, 'A photo name is not usable.')).max(12), featured: z.boolean() }).nullable(),
  instagram: z.boolean(),
  whatsapp: z.array(z.string().max(80)).max(12),
  thumb: z.string().max(200_000).optional(),   // base64 JPEG
});

export async function POST(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Bad request' }, { status: 400 });
  const p = parsed.data;
  // Destinations by key, from configuration only — as for a send from the page.
  const known = new Set([...postGroups(), ...(postChannel() ? [postChannel()!] : [])].map(d => d.key));
  const unknown = p.whatsapp.filter(k => !known.has(k));
  if (unknown.length) return NextResponse.json({ error: `Unknown WhatsApp destination: ${unknown.join(', ')}.` }, { status: 400 });
  if (p.website && p.website.names.length !== p.counts.site) return NextResponse.json({ error: 'Every website photo needs a name.' }, { status: 400 });
  if (!p.website && !p.instagram && !p.whatsapp.length) return NextResponse.json({ error: 'This piece is not going anywhere.' }, { status: 400 });
  const item = await createItem({
    by: who, headline: p.headline.trim(), caption: p.caption, fileBase: p.fileBase, counts: p.counts,
    website: p.website, instagram: p.instagram, whatsapp: [...new Set(p.whatsapp)],
    thumb: p.thumb ? Buffer.from(p.thumb, 'base64') : undefined,
  });
  return NextResponse.json({ item: toView(item) });
}
