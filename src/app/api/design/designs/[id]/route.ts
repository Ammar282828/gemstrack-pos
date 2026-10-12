/**
 * One design (lib/design/store.ts). The id is the design's own, or a legacy saved ad's (`saved:<id>`).
 *
 * GET              the design's record
 * GET ?key=…       one of its files: 'doc:<page>' (layout JSON), 'image:<page>' (the finished picture) or
 *                  'photo:<photoId>' (the photo it was drawn on)
 * PATCH { folder?, name?, published? }   file it, rename it, or note a send
 * DELETE
 */

import { NextRequest, NextResponse } from 'next/server';
import { designFail, designGate, mayUseAds, noStore } from '@/lib/design/gate';
import { DESIGN_ID, FILE_KEY, ID_OK, type DesignRecord, type PublishEntry } from '@/lib/design/model';
import { deleteDesign, getDesign, moveDesign, readDesignFile, recordPublish } from '@/lib/design/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** The design, or the answer to send: unknown id, a missing record, or one that is the ads' and not the caller's. */
async function open(req: NextRequest, ctx: Ctx): Promise<{ who: string; item: DesignRecord } | NextResponse> {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  const { id } = await ctx.params;
  if (!DESIGN_ID.test(id)) return NextResponse.json({ error: 'Which design?' }, { status: 400 });
  const item = await getDesign(id);
  if (!item) return NextResponse.json({ error: 'That design is gone.' }, { status: 404 });
  if (item.scope === 'ads' && !mayUseAds(who)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return { who, item };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const o = await open(req, ctx);
    if (o instanceof NextResponse) return o;
    const key = req.nextUrl.searchParams.get('key');
    if (key === null) return NextResponse.json({ item: o.item }, { headers: noStore });
    if (!FILE_KEY.test(key)) return NextResponse.json({ error: 'Which file?' }, { status: 400 });
    const data = await readDesignFile(o.item, key);
    if (!data) return NextResponse.json({ error: 'This design has no such file.' }, { status: 404 });
    return new NextResponse(new Uint8Array(data), { headers: { 'content-type': key.startsWith('doc:') ? 'application/json' : 'image/jpeg', 'cache-control': 'private, max-age=300' } });
  } catch (e) {
    return designFail(e, 'design');
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const o = await open(req, ctx);
    if (o instanceof NextResponse) return o;
    const b = (await req.json().catch(() => ({}))) as { folder?: string | null; name?: string; published?: Partial<PublishEntry> };
    const folder = b.folder === undefined ? undefined : typeof b.folder === 'string' && ID_OK.test(b.folder) ? b.folder : null;
    if (folder !== undefined || typeof b.name === 'string') await moveDesign(o.item.id, { folder, name: typeof b.name === 'string' ? b.name : undefined });
    const p = b.published;
    if (p && typeof p.dest === 'string' && p.dest) {
      await recordPublish(o.item.id, {
        at: new Date().toISOString(), by: o.who, dest: p.dest.slice(0, 40), ok: p.ok !== false,
        ...(typeof p.ref === 'string' ? { ref: p.ref.slice(0, 200) } : {}),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return designFail(e, 'design');
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const o = await open(req, ctx);
    if (o instanceof NextResponse) return o;
    await deleteDesign(o.item.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return designFail(e, 'design');
  }
}
