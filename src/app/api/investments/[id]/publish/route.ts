/**
 * POST { target, post?, teaser?, force? } → send one part of a day's
 * Investments post where it goes (group, channel, teaser or instagram — see
 * src/lib/investments-send.ts). The page's Send buttons, and Send all, which
 * calls this once per part.
 *
 * Each target is sent once: a second press answers "already sent" unless
 * `force` is set, so a double tap cannot post twice to 469 people. Edited
 * words sent with the press are what go out, and are saved.
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate, mediaOrigin } from '@/lib/social/gate';
import { STORE_INVESTMENTS } from '@/lib/store-config';
import { recordError } from '@/lib/social/errors';
import { getInvestmentPost, isDateId, type Target } from '@/lib/investments';
import { sendInvestmentPart } from '@/lib/investments-send';
import { TARGET_ORDER } from '@/lib/investments-schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await postGate(req, STORE_INVESTMENTS);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!isDateId(id)) return NextResponse.json({ error: 'No such post.' }, { status: 404 });
  const b = await req.json().catch(() => null) as { target?: Target; post?: string; teaser?: string; force?: boolean } | null;
  const target = b?.target;
  if (!target || !TARGET_ORDER.includes(target)) return NextResponse.json({ error: `target must be one of ${TARGET_ORDER.join(', ')}.` }, { status: 400 });

  const doc = await getInvestmentPost(id);
  if (!doc) return NextResponse.json({ error: 'That day’s post has not arrived.' }, { status: 404 });
  if (doc.sent[target] && !b?.force) return NextResponse.json({ error: 'Already sent.', sent: doc.sent[target] }, { status: 409 });

  try {
    const sent = await sendInvestmentPart(id, target, { by: who, origin: mediaOrigin(req), post: b?.post, teaser: b?.teaser });
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    await recordError(target === 'instagram' ? 'instagram' : 'whatsapp', e, { by: who, investments: id, target });
    const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Send failed' }, { status });
  }
}
