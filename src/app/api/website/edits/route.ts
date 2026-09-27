/**
 * Website → Edit a piece (src/lib/website/site-edits.ts).
 *
 *   GET                 every piece on this house's website with the counter's
 *                       changes (hidden ones too), and the last changes made
 *   GET ?id=            one piece, its last design (to re-open as it was) and its
 *                       original photograph's address when the photo was re-made
 *   POST (multipart)    id, and any of:
 *                         words     JSON: name, about, facts[], stone, metal, karat,
 *                                   cut, style, weightGrams, hidden — the whole of
 *                                   what the piece should say; anything equal to
 *                                   the site's own is sent as "put back"
 *                         file      the re-made photograph (JPEG), with
 *                         design    the editor's document (JSON), shape, ai (JSON list),
 *                                   stamped ("1" when the weight is on it)
 *                         photo     "revert": the original photograph back
 *                         action    "revert": every change undone
 *
 * The piece must be one the website lists, and the key and photograph the site
 * is told about come from that list, never from the request. taheri.shop's
 * weights stay where the site's prices read them (website_pieces, as Photo
 * Weights writes them); the catalogue's go with its change.
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate } from '@/lib/social/gate';
import { STORE_SITE_EDIT } from '@/lib/store-config';
import { forgetSitePieces, getSitePiece, getSitePieces, siteOrigin, type SitePiece } from '@/lib/website/site-pieces';
import {
  SiteEditError, TEXT_LIMITS, getSavedDesign, logChange, originalUrl, recentChanges, saveDesign, sendChange,
  type Fields, type TextField,
} from '@/lib/website/site-edits';
import { setPosWeight } from '@/lib/website/weights';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_PHOTO = 25 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_EDIT);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id');
  try {
    if (!id) {
      const [{ site, pieces }, recent] = await Promise.all([
        getSitePieces({ all: true, fresh: req.nextUrl.searchParams.has('fresh') }),
        recentChanges().catch(() => []),
      ]);
      return NextResponse.json({ site, pieces, recent }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const piece = await getSitePiece(id, { all: true, fresh: true });
    if (!piece) return NextResponse.json({ error: 'No such piece on the website.' }, { status: 404 });
    const design = await getSavedDesign(piece.id).catch(() => null);
    const edited = !!piece.change?.photo?.edited && piece.change.photo.image === piece.imagePath;
    return NextResponse.json({
      piece, design,
      original: edited && piece.imagePath ? originalUrl(siteOrigin(), piece.imagePath) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: `Could not read the website’s pieces: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

/** What changes, as the site takes it: each field against the site's own, "put back" (null) where they agree. */
function fieldsFor(piece: SitePiece, words: Record<string, unknown>): { fields: Fields; weight?: number | null } {
  const fields: Fields = {};
  const texts: TextField[] = piece.source === 'attributes'
    ? ['name', 'about', 'stone', 'metal', 'karat', 'cut', 'style']
    : ['name', 'about'];
  for (const k of texts) {
    if (!(k in words)) continue;
    const v = cleanText(words[k], TEXT_LIMITS[k]);
    const own = piece.own[k as keyof typeof piece.own];
    // An empty name means the site's own; any other field may be emptied on purpose.
    fields[k] = (k === 'name' && !v) || same(v, typeof own === 'string' ? own.trim() : own) ? null : v;
  }
  if (piece.source === 'pieces' && Array.isArray(words.facts)) {
    const facts = words.facts.map(f => cleanText(f, 200)).filter(Boolean).slice(0, 12);
    fields.facts = same(facts, piece.own.facts) ? null : facts;
  }
  if ('hidden' in words) fields.hidden = words.hidden ? true : null;
  let weight: number | null | undefined;
  if ('weightGrams' in words) {
    const w = Number(words.weightGrams);
    weight = Number.isFinite(w) && w > 0 && w < 5000 ? Math.round(w * 1000) / 1000 : null;
    // The catalogue has no weights of its own: they live with its change.
    if (piece.source === 'pieces') fields.weightGrams = weight;
  }
  return { fields, weight };
}

export async function POST(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_EDIT);
  if (who instanceof NextResponse) return who;
  const site = siteOrigin();
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Send the change as a form.' }, { status: 400 }); }
  const id = String(form.get('id') || '');
  const piece = id ? await getSitePiece(id, { all: true, fresh: true }) : null;
  if (!piece) return NextResponse.json({ error: 'No such piece on the website.' }, { status: 404 });

  const revertAll = form.get('action') === 'revert';
  const revertPhoto = form.get('photo') === 'revert';
  const file = form.get('file');
  const photo = file instanceof Blob && file.size > 0 ? file : null;
  if (photo && photo.size > MAX_PHOTO) return NextResponse.json({ error: 'That photograph is too large.' }, { status: 413 });
  if ((photo || revertPhoto) && !piece.imagePath) return NextResponse.json({ error: 'This piece’s photograph can’t be replaced from here.' }, { status: 400 });

  let words: Record<string, unknown> = {};
  try { const raw = form.get('words'); if (raw) words = JSON.parse(String(raw)); } catch { return NextResponse.json({ error: 'The words did not arrive whole.' }, { status: 400 }); }
  const { fields, weight } = revertAll ? { fields: {} as Fields, weight: undefined } : fieldsFor(piece, words);
  // The photograph now shows the weight (stamped here), or no longer does.
  if (photo) fields.weightOnPhoto = form.get('stamped') === '1' ? true : null;
  if (revertPhoto) fields.weightOnPhoto = null;
  const weightChanged = weight !== undefined && !same(weight, piece.weightGrams);

  // Only what differs from what the site shows now.
  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => !same(v ?? null, (piece.change as Record<string, unknown> | null)?.[k] ?? null))) as Fields;
  if (!revertAll && !revertPhoto && !photo && !Object.keys(changed).length && !weightChanged) {
    return NextResponse.json({ piece, change: piece.change, note: 'Nothing had changed.' });
  }

  try {
    let change = piece.change;
    if (revertAll || revertPhoto || photo || Object.keys(changed).length) {
      change = await sendChange(site, {
        key: piece.id,
        fields: changed,
        image: photo || revertPhoto || (revertAll && piece.change?.photo?.edited) ? piece.imagePath : null,
        file: photo,
        photo: revertPhoto ? 'revert' : undefined,
        action: revertAll ? 'revert' : undefined,
      });
    }
    // taheri.shop's weights: where its prices and its weight labels read them (a
    // weight is the piece's, not a change to undo, so "put everything back" leaves it).
    if (piece.source === 'attributes' && weightChanged && !revertAll) {
      await setPosWeight(piece.id, weight ?? null, who);
      forgetSitePieces();
    }
    const by = who === 'counter' ? 'the counter' : who;
    if (photo) {
      const design = String(form.get('design') || '');
      let ai: string[] = [];
      try { ai = JSON.parse(String(form.get('ai') || '[]')); } catch { /* none */ }
      if (design) await saveDesign(piece.id, site, { design, shape: form.get('shape') === 'square' ? 'square' : 'own', ai: ai.map(String).slice(0, 10), at: new Date().toISOString(), by }).catch(() => false);
    } else if (revertPhoto || revertAll) {
      await saveDesign(piece.id, site, null).catch(() => undefined);
    }
    const what = revertAll ? ['everything put back'] : [
      ...(photo ? ['photo'] : revertPhoto ? ['original photo back'] : []),
      ...Object.keys(changed).filter(k => k !== 'weightOnPhoto').map(k => (k === 'hidden' ? (changed.hidden ? 'hidden' : 'shown again') : k)),
      ...(weightChanged && piece.source === 'attributes' ? ['weightGrams'] : []),
    ];
    await logChange({ key: piece.id, site, name: piece.words.name, what, by }).catch(() => undefined);
    const fresh = await getSitePiece(piece.id, { all: true });
    return NextResponse.json({ piece: fresh ?? piece, change });
  } catch (e) {
    const status = e instanceof SiteEditError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
