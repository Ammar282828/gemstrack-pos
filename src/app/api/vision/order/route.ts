/**
 * Reading an order off a photograph.
 *
 * A parchi comes across the counter, or a picture of the piece arrives on WhatsApp, and
 * the same details get typed into the order form by hand. This reads the photo. It does
 * not create anything: the answer goes back to the browser as a draft, is shown beside
 * the photo it came from, and the shopkeeper presses Create.
 *
 * A model reading somebody's handwriting is guessing MORE than one listening to speech —
 * a 4 that is really a 9, a karigar's name in Urdu shorthand, a weight in tola where the
 * form wants grams. So every field is nullable, the prompt says to leave it null rather
 * than fill it, and names come back as heard for the phonetic matcher to rank on the
 * client. The model never picks the person.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { generateJson, geminiConfigured, GeminiError } from '@/lib/voice/gemini';
import { ORDER_CATEGORIES } from '@/lib/vision/order-draft';

export const runtime = 'nodejs';
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


/** A phone photo of a slip, at the size a browser canvas hands one over. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const DRAFT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      description: 'One entry per piece written on the slip. A slip for a set lists several.',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING', description: 'What you would call the piece, e.g. "Ring with ruby".' },
          itemCategory: { type: 'STRING', enum: [...ORDER_CATEGORIES] },
          karat: { type: 'NUMBER', description: 'Only if a karat is actually written. 18, 21, 22 or 24.' },
          weightG: { type: 'NUMBER', description: 'Weight in GRAMS. Convert from tola at 11.6638 g and set weightWasTola.' },
          weightWasTola: { type: 'BOOLEAN' },
          stoneWeightG: { type: 'NUMBER' },
          makingCharges: { type: 'NUMBER', description: 'Labour / majoori in rupees, if written.' },
          size: { type: 'STRING', description: 'Ring or bangle size as written, e.g. "12.5".' },
          stoneDetails: { type: 'STRING' },
          note: { type: 'STRING', description: 'Anything else about this piece, in the words on the slip.' },
        },
      },
    },
    karigarNameHeard: { type: 'STRING', description: 'The craftsman\'s name EXACTLY as written, in Roman letters. Do not correct it.' },
    customerNameHeard: { type: 'STRING', description: 'The customer\'s name EXACTLY as written, in Roman letters. Do not correct it.' },
    customerPhone: { type: 'STRING' },
    advancePayment: { type: 'NUMBER', description: 'Baiyana / advance in rupees, if written.' },
    expectedDate: { type: 'STRING', description: 'YYYY-MM-DD, only if a date is actually written.' },
    notes: { type: 'STRING' },
    unreadable: { type: 'STRING', description: 'What you could not make out. Say so rather than guessing.' },
  },
} as const;

const PROMPT = `This is a jewellery shop's order slip (a "parchi"), or a photograph of a
piece being ordered, from a shop in Karachi. Read what is on it.

The handwriting mixes English, Urdu and Gujarati, often within one line.

RULES, in order of importance:

1. LEAVE IT NULL RATHER THAN GUESS. A photo of a bare ring says nothing about who is
   making it or when it is due. Every field here is optional. A null costs somebody five
   seconds of typing; a wrong weight or a wrong karigar costs them gold.

2. NAMES ARE COPIED, NOT CORRECTED. Put the name down exactly as the characters look, in
   Roman letters. Do not resolve it to anyone, do not tidy the spelling, do not guess a
   surname. The shop's own book does the matching, by sound, and it is better at it than
   you are.

3. WEIGHTS ARE GRAMS. An older slip is often written in tola — 1 tola = 11.6638 g. If the
   slip says tola, convert it and set weightWasTola true so the shop can see you did.

4. A FIGURE YOU CANNOT READ CLEANLY IS UNREADABLE. A 4 and a 9 look alike in a hurried
   hand and a wrong one is a wrong bill. Put what you could not read into "unreadable".

5. ONE ENTRY PER PIECE. A slip for a set lists bangles AND a ring AND tops, each with its
   own weight. Do not total them.`;

export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner(req);
  if (denied) return denied;

  if (!geminiConfigured()) {
    return NextResponse.json({ error: 'Scanning is not set up on this deployment.' }, { status: 503 });
  }

  let body: { image?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  const { image, mimeType } = body;
  if (!image) return NextResponse.json({ error: 'No photo.' }, { status: 400 });
  if (image.length * 0.75 > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'That photo is too large.' }, { status: 413 });
  }

  try {
    const parsed = await generateJson<unknown>({
      system: PROMPT,
      parts: [{ inlineData: { mimeType: mimeType || 'image/jpeg', data: image } }],
      schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    });
    return NextResponse.json(parsed);
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error('[vision/order]', err.status, err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Scanning failed.';
    console.error('[vision/order]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
