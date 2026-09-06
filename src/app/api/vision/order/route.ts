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
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { ORDER_CATEGORIES } from '@/lib/vision/order-draft';

export const runtime = 'nodejs';
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


/** A phone photo of a slip, at the size a browser canvas hands one over. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const DRAFT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      description: 'One entry per piece written on the slip. A slip for a set lists several.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          description: { type: SchemaType.STRING, description: 'What you would call the piece, e.g. "Ring with ruby".' },
          itemCategory: { type: SchemaType.STRING, enum: [...ORDER_CATEGORIES] },
          karat: { type: SchemaType.NUMBER, description: 'Only if a karat is actually written. 18, 21, 22 or 24.' },
          weightG: { type: SchemaType.NUMBER, description: 'Weight in GRAMS. Convert from tola at 11.6638 g and set weightWasTola.' },
          weightWasTola: { type: SchemaType.BOOLEAN },
          stoneWeightG: { type: SchemaType.NUMBER },
          makingCharges: { type: SchemaType.NUMBER, description: 'Labour / majoori in rupees, if written.' },
          size: { type: SchemaType.STRING, description: 'Ring or bangle size as written, e.g. "12.5".' },
          stoneDetails: { type: SchemaType.STRING },
          note: { type: SchemaType.STRING, description: 'Anything else about this piece, in the words on the slip.' },
        },
      },
    },
    karigarNameHeard: { type: SchemaType.STRING, description: 'The craftsman\'s name EXACTLY as written, in Roman letters. Do not correct it.' },
    customerNameHeard: { type: SchemaType.STRING, description: 'The customer\'s name EXACTLY as written, in Roman letters. Do not correct it.' },
    customerPhone: { type: SchemaType.STRING },
    advancePayment: { type: SchemaType.NUMBER, description: 'Baiyana / advance in rupees, if written.' },
    expectedDate: { type: SchemaType.STRING, description: 'YYYY-MM-DD, only if a date is actually written.' },
    notes: { type: SchemaType.STRING },
    unreadable: { type: SchemaType.STRING, description: 'What you could not make out. Say so rather than guessing.' },
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

  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'Scanning is not set up. GOOGLE_GENAI_API_KEY is missing.' }, { status: 503 });
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

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      // Reading handwriting is transcription, not composition.
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: DRAFT_SCHEMA as never,
    },
  });

  try {
    const result = await model.generateContent([
      { text: PROMPT },
      { inlineData: { mimeType: mimeType || 'image/jpeg', data: image } },
    ]);
    const raw = result.response.text();
    try {
      return NextResponse.json(JSON.parse(raw));
    } catch {
      return NextResponse.json({ error: 'Could not read that photo.', raw }, { status: 502 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scanning failed.';
    console.error('[vision/order]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
