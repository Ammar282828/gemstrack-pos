/**
 * Designs (lib/design/store.ts).
 *
 * GET             the folders and every design the caller may see (ads-scope ones and the legacy saved ads, as
 *                 `saved:<id>`, only for the owner and marketing)
 * POST multipart  meta (JSON), [id], and files named 'doc:<page>' / 'image:<page>' / 'photo:<photoId>' — save a
 *                 design (with `id`: over itself; a `saved:<id>` writes the design that supersedes it)
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { designFail, designGate, mayUseAds, noStore } from '@/lib/design/gate';
import { DESIGN_ID, FILE_KEY, designInput, fileKey } from '@/lib/design/model';
import { listDesigns, listFolders, saveDesign, getDesign } from '@/lib/design/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX = 12 * 1024 * 1024;
const MAX_FILES = 40;

const thumbOf = async (buf: Buffer) => `data:image/jpeg;base64,${(await sharp(buf).rotate().resize(200, 200, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()).toString('base64')}`;

export async function GET(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  try {
    const [folders, items] = await Promise.all([listFolders(), listDesigns({ ads: mayUseAds(who) })]);
    return NextResponse.json({ folders, items }, { headers: noStore });
  } catch (e) {
    return designFail(e, 'designs');
  }
}

export async function POST(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  try {
    const form = await req.formData();
    let meta: unknown = null;
    try { meta = JSON.parse(String(form.get('meta') || 'null')); } catch { /* refused below */ }
    const input = designInput(meta);
    if (!input) return NextResponse.json({ error: 'That isn’t a design to save.' }, { status: 400 });
    if (input.scope === 'ads' && !mayUseAds(who)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const id = String(form.get('id') || '') || undefined;
    if (id && !DESIGN_ID.test(id)) return NextResponse.json({ error: 'Not a design.' }, { status: 400 });
    // Saving over someone's ads-scope design is for those who may see it.
    if (id) {
      const prior = await getDesign(id);
      if (prior?.scope === 'ads' && !mayUseAds(who)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const files: Record<string, Buffer> = {};
    for (const [name, f] of form.entries()) {
      if (!(f instanceof File) || name === 'meta') continue;
      if (!FILE_KEY.test(name)) return NextResponse.json({ error: `“${name.slice(0, 40)}” isn’t a file of a design.` }, { status: 400 });
      if (Object.keys(files).length >= MAX_FILES) return NextResponse.json({ error: 'Too many files.' }, { status: 413 });
      if (f.size > MAX) return NextResponse.json({ error: `The ${name} is over 12 MB.` }, { status: 413 });
      files[name] = Buffer.from(await f.arrayBuffer());
    }
    const masterImage = files[fileKey('image', input.master)];
    if (!input.thumb && masterImage) input.thumb = await thumbOf(masterImage);
    return NextResponse.json({ item: await saveDesign(input, files, who, id) }, { headers: noStore });
  } catch (e) {
    return designFail(e, 'designs');
  }
}
