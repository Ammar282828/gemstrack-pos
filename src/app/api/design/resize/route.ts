/**
 * POST /api/design/resize — the AI step of Resize (docs/features/design-studio-plan.md §3.2). The page has already laid every
 * target out without AI; this asks the text model once, for all of them, whether a layer should sit elsewhere.
 *
 * body    { goal?, source: { frame, layers, thumb? }, targets: [{ frame, score, problems?, layers, plan?, thumb? }] }
 *         (`layers` are summaries: id, role, kind, box, the words as they are; `thumb` a small JPEG, base64)
 * answer  200 { ai, plans, reason? } — `plans[i]` is the cleaned plan for target i, or null.
 *
 * Always 200 once the caller is let in and the body is a request: a rate limit, a busy or exhausted model, a slow answer,
 * junk, a plan that changes a word or names a layer that isn't there — all come back as `ai: false` with nulls, and the
 * page keeps its deterministic layouts. The AI never sees the photograph to change it and returns no pixels. One model
 * call per request (text only; `generateJson` hands over to the stand-in model at once on a 429, lib/ai-fallback.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { designGate, noStore } from '@/lib/design/gate';
import { RESIZE_SCHEMA, RESIZE_SYSTEM, cleanRequest, plansFromAnswer, resizePrompt, type ResizeAiResponse } from '@/lib/design/resize-ai';
import { aiConfigured, generateJson } from '@/lib/social/ai';
import { callerKey, rateLimit } from '@/lib/website/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAILY = Number(process.env.DESIGN_AI_DAILY_CAP) || 200;
const MAX_BODY = 3 * 1024 * 1024;
/** Longer than this and the person is better served by the layouts already on screen. */
const ANSWER_MS = 25_000;

const none = (n: number, reason: string): ResizeAiResponse => ({ ai: false, plans: Array.from({ length: n }, () => null), reason });
const reply = (body: ResizeAiResponse) => NextResponse.json(body, { headers: noStore });

export async function POST(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;

  let body: unknown = null;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return NextResponse.json({ error: 'That is too much to send.' }, { status: 413 });
    body = JSON.parse(text);
  } catch { /* refused below */ }
  const ask = cleanRequest(body);
  if (!ask) return NextResponse.json({ error: 'That isn’t a resize to improve.' }, { status: 400 });

  const n = ask.targets.length;
  if (!aiConfigured()) return reply(none(n, 'off'));
  try {
    const [day, hour] = await Promise.all([
      rateLimit('design-ai-day', 'shop', DAILY, 86_400),
      rateLimit('design-ai-hour', callerKey(req.headers), 60, 3_600),
    ]);
    if (!day.ok || !hour.ok) return reply(none(n, 'limit'));
  } catch {
    return reply(none(n, 'limit'));
  }

  try {
    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
    if (ask.source.thumb) parts.push({ text: 'The source design:' }, { inlineData: { mimeType: 'image/jpeg', data: ask.source.thumb } });
    ask.targets.forEach((t, i) => { if (t.thumb) parts.push({ text: `Proposed layout for TARGET ${i}:` }, { inlineData: { mimeType: 'image/jpeg', data: t.thumb } }); });
    parts.push({ text: resizePrompt(ask) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = await Promise.race([
      generateJson<unknown>({ system: RESIZE_SYSTEM, parts, schema: RESIZE_SCHEMA, temperature: 0.3 }),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ANSWER_MS); }),
    ]).finally(() => clearTimeout(timer));
    if (answer === null) return reply(none(n, 'slow'));
    const plans = plansFromAnswer(answer, ask);
    return reply({ ai: plans.some(Boolean), plans, ...(plans.some(Boolean) ? {} : { reason: 'junk' }) });
  } catch (e) {
    // A 429 after the stand-in model also answered 429, an outage, a bad key: the layouts on screen are the answer.
    console.warn('[design] resize AI fell back:', e instanceof Error ? e.message : e);
    return reply(none(n, 'busy'));
  }
}
