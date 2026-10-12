/**
 * POST one flat picture (multipart `file`, or JSON `{ url }`) → the plan to rebuild it as editable layers
 * (plan §4.3), for the owner and marketing only (`designGate('ads')`; staff are refused, to protect the AI
 * quota — DESIGN_LAYERS in layers.ts). One image, read once, resized to 1600 px before any model.
 *
 *   1. one vision call: the lettering (text, box, role, font class, colour), the subject box, the background;
 *   2. the subject cut out — Magnific's remover is NOT reachable from here (retouch.ts removeBackground), so
 *      this step is skipped and said so;
 *   3. so the plate is the original photograph, untouched; the lettering comes back as text layers to review
 *      (accept or skip each), and the subject box goes to the resize. The jewellery is never redrawn, and no
 *      "same piece" check is needed because no pixel of the piece is generated.
 * Without the AI the answer is an empty plan with a note, never an error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { aiConfigured, generateJson, TEXT_MODEL } from '@/lib/social/ai';
import { BACKGROUND_REMOVAL, removeBackground } from '@/lib/social/retouch';
import { designFail, designGate, noStore } from '@/lib/design/gate';
import { bounded, imageFromRequest } from '@/lib/design/image-in';
import { ANALYZE_SCHEMA, ANALYZE_SYSTEM, DESIGN_LAYERS, normalizeAnalysis, planSplit } from '@/lib/design/layers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  if (!DESIGN_LAYERS) return NextResponse.json({ error: 'The layer splitter is off.' }, { status: 404 });
  const who = await designGate(req, 'ads');
  if (who instanceof NextResponse) return who;
  try {
    const img = await imageFromRequest(req);
    const frame = { w: img.width, h: img.height };
    const notes: string[] = [];
    if (!aiConfigured()) {
      return NextResponse.json({ width: img.width, height: img.height, layers: [], subject: null, plate: 'original', cutout: null, notes: ['The AI isn’t set up, so the picture can’t be split into layers.'], ai: false }, { headers: noStore });
    }
    const raw = await bounded(generateJson<unknown>({
      model: TEXT_MODEL, system: ANALYZE_SYSTEM, schema: ANALYZE_SCHEMA, temperature: 0,
      parts: [{ inlineData: img.inline }, { text: 'Read this picture.' }],
    }), 50_000, 'layers');
    const analysis = normalizeAnalysis(raw);
    if (!analysis) {
      return NextResponse.json({ width: img.width, height: img.height, layers: [], subject: null, plate: 'original', cutout: null, notes: ['Couldn’t read the picture just now (the AI is busy or out of quota). The photograph stays as it is. Try again in a minute.'], ai: false }, { headers: noStore });
    }
    const plan = planSplit(analysis, frame);
    notes.push(...plan.notes);

    let cutout: { mimeType: string; data: string } | null = null;
    if (BACKGROUND_REMOVAL && analysis.subject) {
      try { cutout = (await removeBackground(img.jpeg)).image; }
      catch (e) { notes.push(e instanceof Error ? e.message : 'The cut-out failed.'); }
    } else {
      notes.push('The piece isn’t cut out (background removal isn’t available yet): the photograph stays whole, with the lettering as layers above it.');
    }
    return NextResponse.json({
      width: img.width, height: img.height, layers: plan.layers, subject: plan.subject, plate: plan.plate, cutout,
      category: analysis.category, background: analysis.background, headline: analysis.headline, notes, ai: true,
    }, { headers: noStore });
  } catch (e) {
    return designFail(e, 'layers');
  }
}
