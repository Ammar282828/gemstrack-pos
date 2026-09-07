/**
 * One spoken sentence in, one structured reading out.
 *
 * The key never reaches the browser, so the audio comes here and Gemini is asked to do the
 * listening and the understanding in a single call — there is no separate transcription
 * step to disagree with. What comes back is a claim about what was meant, not an
 * instruction: nothing is written here, and nothing is written on the client either until
 * resolveIntent() has pinned the name to a real row and the shop has said yes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { generateJson, geminiConfigured, GeminiError } from '@/lib/voice/gemini';
import { systemPrompt } from '@/lib/voice/prompt';
import { VOICE_ACTIONS } from '@/lib/voice/resolve';
import type { RosterEntry } from '@/lib/voice/phonetics';

export const runtime = 'nodejs';
/** Audio in, a model call out — there is nothing here worth caching. */
export const dynamic = 'force-dynamic';

/**
 * Who may spend the shop's Vertex AI budget.
 *
 * Normally: a verified owner token. These routes bill to the shop's Google Cloud
 * account, so an ungated one is an open relay on somebody's money.
 *
 * While NEXT_PUBLIC_OPEN_ACCESS is set the app has no sign-in, so there is no token
 * to check and this would refuse every call — which is exactly what happened: voice
 * reported "could not reach Gemini" when the truth was that it never asked. The gate
 * follows the same flag the rest of the app does, deliberately, so that ONE switch
 * governs the whole posture rather than leaving voice broken in a way that reads as
 * a Google outage.
 *
 * The cost of that is real and worth stating: while open, anyone who reaches these
 * routes can spend the shop's Vertex credits. Closing NEXT_PUBLIC_OPEN_ACCESS closes
 * this with it.
 */
const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

async function denyUnlessOwner(req: NextRequest): Promise<NextResponse | null> {
  if (OPEN_ACCESS) return null;
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') {
    return NextResponse.json({ error: 'Not available on this account.' }, { status: 403 });
  }
  return null;
}


/** Long enough for a sentence said slowly, short enough that a stuck request gives up. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const READING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: {
      type: 'STRING',
      description: 'What was actually said, in the script it was said in. Never cleaned up.',
    },
    action: {
      type: 'STRING',
      enum: [...VOICE_ACTIONS],
      description: 'Which of the shop\'s actions this sentence is.',
    },
    summary: {
      type: 'STRING',
      description: 'One short English sentence: what was recorded, who for, the figure. Or the question to ask.',
    },
    person: {
      type: 'OBJECT',
      description: 'Who this entry belongs to. Omit only for expense and other_income.',
      properties: {
        spoken_as: { type: 'STRING', description: 'The name exactly as it was heard, in Roman letters.' },
        name: { type: 'STRING', description: 'The roster name you believe that to be.' },
        kind: { type: 'STRING', enum: ['customer', 'karigar'] },
      },
    },
    for_customer: {
      type: 'STRING',
      description: 'A customer named as who the work is for, when that is somebody other than the person above.',
    },
    amount: { type: 'NUMBER', description: 'Rupees. The remainder after any part-payment, never the total.' },
    grams: { type: 'NUMBER', description: 'Weight in grams, for gold_received and gold_paid only.' },
    karat: { type: 'NUMBER', description: 'Purity, only when it was actually said.' },
    description: { type: 'STRING', description: 'What the entry was for, in his own words.' },
    screen: { type: 'STRING', description: 'For navigate: dashboard, customers, karigars, orders, products, hisaab, expenses, analytics, calendar, settings.' },
    query: { type: 'STRING', description: 'For ask: what is being asked about.' },
    fields: {
      type: 'OBJECT',
      description: 'For new_/edit_ actions: the record fields being set, camelCase.',
      properties: {
        name: { type: 'STRING' },
        phone: { type: 'STRING' },
        altPhone: { type: 'STRING' },
        city: { type: 'STRING' },
        address: { type: 'STRING' },
        country: { type: 'STRING' },
        ringSize: { type: 'STRING' },
        bangleSize: { type: 'STRING' },
        braceletSize: { type: 'STRING' },
        chainLength: { type: 'STRING' },
        birthday: { type: 'STRING' },
        anniversary: { type: 'STRING' },
        preference: { type: 'STRING' },
        specialty: { type: 'STRING' },
        workshop: { type: 'STRING' },
        contact: { type: 'STRING' },
        notes: { type: 'STRING' },
      },
    },
  },
  required: ['action', 'summary'],
} as const;

export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner(req);
  if (denied) return denied;

  if (!geminiConfigured()) {
    return NextResponse.json({ error: 'Voice is not set up on this deployment.' }, { status: 503 });
  }

  let body: {
    audio?: string;
    mimeType?: string;
    text?: string;
    roster?: RosterEntry[];
    shopName?: string;
    today?: string;
    orderKarat?: string | number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  const { audio, mimeType, text, roster = [], shopName = 'the shop', today, orderKarat } = body;

  if (!audio && !text) {
    return NextResponse.json({ error: 'Nothing to listen to.' }, { status: 400 });
  }
  if (audio && audio.length * 0.75 > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'That recording is too long.' }, { status: 413 });
  }

  try {
    const parts = audio
      ? [
          { text: 'Write down what is said in this recording.' },
          { inlineData: { mimeType: mimeType || 'audio/webm', data: audio } },
        ]
      : [{ text: `Write down what is said here: ${text}` }];

    const parsed = await generateJson<unknown>({
      system: systemPrompt({
        shopName,
        today: today || new Date().toISOString().slice(0, 10),
        roster: roster.slice(0, 4000),
        orderKarat,
      }),
      parts,
      schema: READING_SCHEMA as unknown as Record<string, unknown>,
    });
    return NextResponse.json(parsed);
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error('[voice/listen]', err.status, err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Voice failed.';
    console.error('[voice/listen]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
