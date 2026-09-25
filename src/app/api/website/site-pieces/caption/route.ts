/**
 * POST { id, weight? } → AI words for a website piece in this house's voice
 * (src/lib/social/site-caption.ts): { line, facts }. The page puts them in the
 * house's frame. The photograph is fetched here from the website — only a piece
 * it lists — so the page never uploads anything. Shares Post a Piece's limits.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { postGate } from '@/lib/social/gate';
import { STORE_BRAND, STORE_SITE_POSTS } from '@/lib/store-config';
import { getSitePiece, siteOrigin } from '@/lib/website/site-pieces';
import { generateJson } from '@/lib/social/ai';
import { recordError } from '@/lib/social/errors';
import { SITE_CAPTION_SCHEMA, siteCaptionSystem, siteCaptionUser, tidyAiWords } from '@/lib/social/site-caption';
import { callerKey, rateLimit } from '@/lib/website/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_POSTS);
  if (who instanceof NextResponse) return who;
  const b = await req.json().catch(() => null) as { id?: string; weight?: string } | null;
  const piece = b?.id ? await getSitePiece(b.id) : null;
  if (!piece || !piece.image.startsWith(`${siteOrigin()}/`)) return NextResponse.json({ error: 'No such piece on the website.' }, { status: 404 });
  const [shop, caller] = await Promise.all([rateLimit('post-ai-day', 'shop', Number(process.env.IMAGE_AI_DAILY_CAP) || 300, 86_400), rateLimit('post-ai-hour', callerKey(req.headers), 60, 3_600)]);
  if (!shop.ok || !caller.ok) return NextResponse.json({ error: 'The AI limit for now is reached. Try again a little later.' }, { status: 429 });
  try {
    const res = await fetch(piece.image, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw Object.assign(new Error(`The website didn’t send the photograph (${res.status}).`), { status: 502 });
    const photo = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
    const house = STORE_BRAND === 'mina' ? 'mina' : 'taheri';
    const out = await generateJson<{ line: string; facts: string }>({
      system: siteCaptionSystem(house),
      parts: [{ inlineData: { mimeType: 'image/jpeg', data: photo.toString('base64') } }, { text: siteCaptionUser({ name: piece.name, collection: piece.collection, facts: piece.facts, about: piece.about, weight: String(b?.weight || '') }) }],
      schema: SITE_CAPTION_SCHEMA,
    });
    const line = tidyAiWords(out.line), facts = tidyAiWords(out.facts);
    if (!line && !facts) throw Object.assign(new Error('The AI returned no words.'), { status: 502 });
    return NextResponse.json({ ok: true, line, facts });
  } catch (e) {
    await recordError('caption', e, { by: who, sitePiece: piece.id });
    const status = typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI request failed' }, { status });
  }
}
