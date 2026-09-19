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
 *
 * Several photos may arrive at once — front and back of the slip, a second page, the
 * piece beside its parchi — and are read as one order. A slip that shows its hisaab
 * (rate × weight, making, old gold taken off, the balance) has each figure copied into
 * its own field, never recomputed: the client checks the slip against itself and shows
 * where it disagrees, which is how a misread digit gets caught.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { generateJson, geminiConfigured, GeminiError } from '@/lib/voice/gemini';
import { ORDER_CATEGORIES, SLIP_METALS } from '@/lib/vision/order-draft';
import type { Part } from '@/lib/voice/gemini';

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
/**
 * Front and back of a slip, a second page, and a picture of the piece is four. Six
 * leaves room; more than that is somebody's whole camera roll, and every photo is
 * billed to the shop's Vertex account.
 */
const MAX_PHOTOS = 6;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

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
          metalType: { type: 'STRING', enum: [...SLIP_METALS], description: 'Only if the slip says. "Chandi" is silver.' },
          karat: { type: 'NUMBER', description: 'Only if a karat is actually written. 18, 21, 22 or 24.' },
          weightG: { type: 'NUMBER', description: 'Weight in GRAMS. Convert from tola at 11.664 g and set weightWasTola.' },
          weightWasTola: { type: 'BOOLEAN' },
          stoneWeightG: { type: 'NUMBER' },
          makingCharges: { type: 'NUMBER', description: 'TOTAL labour / majoori for this piece in rupees, if written. If written per gram, multiply by the weight and set makingWasPerGram.' },
          makingWasPerGram: { type: 'BOOLEAN' },
          stoneCharges: { type: 'NUMBER', description: 'Stone / nag charge for this piece in rupees, if written.' },
          ratePerGram: { type: 'NUMBER', description: 'The metal rate written for this piece, PER GRAM. A rate written once at the top applies to every piece under it. If written per tola, divide by 11.664 and set rateWasPerTola.' },
          rateWasPerTola: { type: 'BOOLEAN' },
          wastagePercent: { type: 'NUMBER', description: 'Wastage / kasar as a PERCENT, only if the sum on the slip shows one.' },
          lineTotal: { type: 'NUMBER', description: 'The amount written against this piece — the result of its sum, or a bare figure with no working. Copy it; never compute it.' },
          size: { type: 'STRING', description: 'Ring or bangle size as written, e.g. "12.5".' },
          stoneDetails: { type: 'STRING' },
          photoIndex: { type: 'INTEGER', description: 'When several photos were sent and one of them is a PICTURE of this piece (not a slip), its number, counting from 1.' },
          note: { type: 'STRING', description: 'Anything else about this piece, in the words on the slip.' },
        },
      },
    },
    karigarNameHeard: { type: 'STRING', description: 'The craftsman\'s name EXACTLY as written, in Roman letters. Do not correct it.' },
    customerNameHeard: { type: 'STRING', description: 'The customer\'s name EXACTLY as written, in Roman letters. Do not correct it.' },
    customerPhone: { type: 'STRING' },
    advancePayment: { type: 'NUMBER', description: 'Baiyana / advance CASH in rupees, if written. Gold given goes under exchange, not here.' },
    exchange: {
      type: 'OBJECT',
      description: 'Old gold or jewellery the customer gave against the order — "purana sona", "old", "exchange", "less" with a weight. Only if written.',
      properties: {
        description: { type: 'STRING', description: 'What was given, in the words on the slip.' },
        weightG: { type: 'NUMBER', description: 'GRAMS. Convert from tola at 11.664 and set weightWasTola.' },
        weightWasTola: { type: 'BOOLEAN' },
        karat: { type: 'NUMBER' },
        ratePerGram: { type: 'NUMBER', description: 'The rate written AGAINST THE OLD GOLD, per gram. Do not copy the new piece\'s rate here; old gold is often taken at a lower one.' },
        rateWasPerTola: { type: 'BOOLEAN' },
        value: { type: 'NUMBER', description: 'The deduction as written in rupees. Leave null if only a weight was written.' },
        note: { type: 'STRING' },
      },
    },
    discount: { type: 'NUMBER', description: 'Discount / "less" / "kam" in rupees, if written. Not the exchange.' },
    subtotal: { type: 'NUMBER', description: 'The total of the pieces as written, before anything is taken off. Copy; never compute.' },
    balanceDue: { type: 'NUMBER', description: 'The final figure the customer owes, as written ("baqi", "balance", "due"). Copy; never compute.' },
    expectedDate: { type: 'STRING', description: 'YYYY-MM-DD, only if a date is actually written.' },
    notes: { type: 'STRING' },
    unreadable: { type: 'STRING', description: 'What you could not make out. Say so rather than guessing.' },
  },
} as const;

const PROMPT = `This is a jewellery shop's order slip (a "parchi"), or a photograph of a
piece being ordered, from a shop in Karachi. Read what is on it.

You may be given several photos. They are the same order: the front and back of one
slip, a second page, or a picture of the piece next to its slip. Read them together as
ONE order. A piece that appears in two photos is one piece, not two. If a photo is a
picture of a piece rather than writing, say which piece it shows with photoIndex.

The handwriting mixes English, Urdu and Gujarati, often within one line. Figures use
the local grouping (2,45,000 is 245,000).

RULES, in order of importance:

1. LEAVE IT NULL RATHER THAN GUESS. A photo of a bare ring says nothing about who is
   making it or when it is due. Every field here is optional. A null costs somebody five
   seconds of typing; a wrong weight or a wrong karigar costs them gold.

2. NAMES ARE COPIED, NOT CORRECTED. Put the name down exactly as the characters look, in
   Roman letters. Do not resolve it to anyone, do not tidy the spelling, do not guess a
   surname. The shop's own book does the matching, by sound, and it is better at it than
   you are.

3. WEIGHTS ARE GRAMS, RATES ARE PER GRAM. An older slip is often written in tola —
   1 tola = 11.664 g. A weight in tola is converted (× 11.664) and weightWasTola set; a
   rate per tola is converted (÷ 11.664) and rateWasPerTola set, so the shop can see
   you did.

4. COPY THE HISAAB, DO NOT DO IT. Many slips show the sum: "12.5 × 24500 = 306250",
   "+ making 8000", "less purana sona 5g = 120000", "advance 50000", "baqi 144250".
   Put each figure where it belongs — the rate in ratePerGram, the piece's amount in
   lineTotal, the old gold under exchange, the cash advance in advancePayment, the
   final figure in balanceDue — exactly as written. Never recompute a figure to make
   the slip add up. If it does not add up, that is information the shop needs.

5. OLD GOLD IS NOT AN ADVANCE. Gold, a ring or a chain the customer handed over is the
   exchange, with its weight, its own rate if one is written, and the deduction as
   written. Cash is the advance. Keep them apart even when the slip lumps them.

6. A FIGURE YOU CANNOT READ CLEANLY IS UNREADABLE. A 4 and a 9 look alike in a hurried
   hand and a wrong one is a wrong bill. Put what you could not read into "unreadable".

7. ONE ENTRY PER PIECE. A slip for a set lists bangles AND a ring AND tops, each with its
   own weight. Do not total them. A rate written once at the top of the slip applies to
   every piece under it; put it on each.`;

export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner(req);
  if (denied) return denied;

  if (!geminiConfigured()) {
    return NextResponse.json({ error: 'Scanning is not set up on this deployment.' }, { status: 503 });
  }

  let body: { image?: string; mimeType?: string; images?: Array<{ data?: string; mimeType?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  // One photo the old way, or several. Both arrive as base64 JPEGs off a canvas.
  const photos = Array.isArray(body.images)
    ? body.images
    : body.image ? [{ data: body.image, mimeType: body.mimeType }] : [];
  const images = photos
    .map((p) => ({ data: String(p?.data ?? ''), mimeType: String(p?.mimeType || 'image/jpeg') }))
    .filter((p) => p.data.length > 0);

  if (images.length === 0) return NextResponse.json({ error: 'No photo.' }, { status: 400 });
  if (images.length > MAX_PHOTOS) {
    return NextResponse.json({ error: `At most ${MAX_PHOTOS} photos at a time.` }, { status: 413 });
  }
  const bytes = images.map((p) => p.data.length * 0.75);
  if (bytes.some((b) => b > MAX_IMAGE_BYTES) || bytes.reduce((a, b) => a + b, 0) > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: 'Those photos are too large.' }, { status: 413 });
  }

  const parts: Part[] = images.length === 1
    ? [{ inlineData: images[0] }]
    : images.flatMap((p, i): Part[] => [{ text: `Photo ${i + 1} of ${images.length}:` }, { inlineData: p }]);

  try {
    const parsed = await generateJson<unknown>({
      system: PROMPT,
      parts,
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
