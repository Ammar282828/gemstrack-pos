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
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { systemPrompt } from '@/lib/voice/prompt';
import { VOICE_ACTIONS } from '@/lib/voice/resolve';
import type { RosterEntry } from '@/lib/voice/phonetics';

export const runtime = 'nodejs';
/** Audio in, a model call out — there is nothing here worth caching. */
export const dynamic = 'force-dynamic';

/**
 * Who may spend the shop's Gemini quota.
 *
 * These routes hold the key, so an ungated one is an open relay: anybody who can reach the
 * server could post audio or photographs all day on the shop's account. Gated on the same
 * verified Firebase ID token the staff and karigar routes use, and narrowed to owners —
 * voice and scanning are owner tools, and widening that is a deliberate decision rather
 * than a default.
 */
async function denyUnlessOwner(req: NextRequest): Promise<NextResponse | null> {
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
  type: SchemaType.OBJECT,
  properties: {
    transcript: {
      type: SchemaType.STRING,
      description: 'What was actually said, in the script it was said in. Never cleaned up.',
    },
    action: {
      type: SchemaType.STRING,
      enum: [...VOICE_ACTIONS],
      description: 'Which of the shop\'s actions this sentence is.',
    },
    summary: {
      type: SchemaType.STRING,
      description: 'One short English sentence: what was recorded, who for, the figure. Or the question to ask.',
    },
    person: {
      type: SchemaType.OBJECT,
      description: 'Who this entry belongs to. Omit only for expense and other_income.',
      properties: {
        spoken_as: { type: SchemaType.STRING, description: 'The name exactly as it was heard, in Roman letters.' },
        name: { type: SchemaType.STRING, description: 'The roster name you believe that to be.' },
        kind: { type: SchemaType.STRING, enum: ['customer', 'karigar'] },
      },
    },
    for_customer: {
      type: SchemaType.STRING,
      description: 'A customer named as who the work is for, when that is somebody other than the person above.',
    },
    amount: { type: SchemaType.NUMBER, description: 'Rupees. The remainder after any part-payment, never the total.' },
    grams: { type: SchemaType.NUMBER, description: 'Weight in grams, for gold_received and gold_paid only.' },
    karat: { type: SchemaType.NUMBER, description: 'Purity, only when it was actually said.' },
    description: { type: SchemaType.STRING, description: 'What the entry was for, in his own words.' },
    screen: { type: SchemaType.STRING, description: 'For navigate: dashboard, customers, karigars, orders, products, hisaab, expenses, analytics, calendar, settings.' },
    query: { type: SchemaType.STRING, description: 'For ask: what is being asked about.' },
    fields: {
      type: SchemaType.OBJECT,
      description: 'For new_/edit_ actions: the record fields being set, camelCase.',
      properties: {
        name: { type: SchemaType.STRING },
        phone: { type: SchemaType.STRING },
        altPhone: { type: SchemaType.STRING },
        city: { type: SchemaType.STRING },
        address: { type: SchemaType.STRING },
        country: { type: SchemaType.STRING },
        ringSize: { type: SchemaType.STRING },
        bangleSize: { type: SchemaType.STRING },
        braceletSize: { type: SchemaType.STRING },
        chainLength: { type: SchemaType.STRING },
        birthday: { type: SchemaType.STRING },
        anniversary: { type: SchemaType.STRING },
        preference: { type: SchemaType.STRING },
        specialty: { type: SchemaType.STRING },
        workshop: { type: SchemaType.STRING },
        contact: { type: SchemaType.STRING },
        notes: { type: SchemaType.STRING },
      },
    },
  },
  required: ['action', 'summary'],
} as const;

export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner(req);
  if (denied) return denied;

  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'Voice is not set up. GOOGLE_GENAI_API_KEY is missing.' },
      { status: 503 },
    );
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

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt({
      shopName,
      today: today || new Date().toISOString().slice(0, 10),
      roster: roster.slice(0, 4000),
      orderKarat,
    }),
    generationConfig: {
      // Nothing here benefits from invention; the numbers especially do not.
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: READING_SCHEMA as never,
    },
  });

  try {
    const parts = audio
      ? [
          { text: 'Write down what is said in this recording.' },
          { inlineData: { mimeType: mimeType || 'audio/webm', data: audio } },
        ]
      : [{ text: `Write down what is said here: ${text}` }];

    const result = await model.generateContent(parts);
    const raw = result.response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A schema was asked for, so this is rare; when it happens the honest answer is that
      // nothing was understood rather than a half-parsed guess at an amount.
      return NextResponse.json({ error: 'Could not read that back.', raw }, { status: 502 });
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Voice failed.';
    console.error('[voice/listen]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
