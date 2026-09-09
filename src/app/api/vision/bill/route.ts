/**
 * Reading a written bill into invoice lines.
 *
 * Sibling of /api/vision/order. That one drafts work to be made; this one drafts a
 * sale already agreed and written down. Neither creates anything: the answer goes back
 * as a draft, is shown beside the photo it came from, and the shopkeeper decides.
 *
 * The prompt's whole job is to stop the model completing a bill it cannot read. A slip
 * that says "Box chain 45,000" and nothing else is a finished, agreed sale — inventing
 * a weight to justify that figure would put numbers on a customer's invoice that
 * nobody wrote and nobody checked, sitting there looking as solid as the real ones.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { generateJson, geminiConfigured, GeminiError } from '@/lib/voice/gemini';
import { ORDER_CATEGORIES } from '@/lib/vision/order-draft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

const BILL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    lines: {
      type: 'ARRAY',
      description: 'One entry per line written on the bill.',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING', description: 'The piece as written, e.g. "Box chain".' },
          itemCategory: { type: 'STRING', enum: [...ORDER_CATEGORIES] },
          metalType: { type: 'STRING', enum: ['gold', 'palladium', 'platinum', 'silver'] },
          karat: { type: 'NUMBER', description: 'Only if written. 12, 18, 21, 22 or 24.' },
          weightG: { type: 'NUMBER', description: 'GRAMS. Convert from tola at 11.6638 and set weightWasTola.' },
          weightWasTola: { type: 'BOOLEAN' },
          stoneWeightG: { type: 'NUMBER' },
          makingCharges: { type: 'NUMBER', description: 'Making / majoori for this line, if written.' },
          stoneCharges: { type: 'NUMBER' },
          diamondCharges: { type: 'NUMBER' },
          lineTotal: { type: 'NUMBER', description: 'The amount written against this line.' },
          brokenDown: { type: 'BOOLEAN', description: 'True only if this line shows a weight.' },
          note: { type: 'STRING' },
        },
      },
    },
    customerNameHeard: { type: 'STRING', description: 'The customer name EXACTLY as written, Roman letters. Do not correct it.' },
    customerPhone: { type: 'STRING' },
    subtotal: { type: 'NUMBER' },
    discount: { type: 'NUMBER' },
    grandTotal: { type: 'NUMBER', description: 'The final figure at the foot of the bill.' },
    amountPaid: { type: 'NUMBER', description: 'Only if the bill records a payment.' },
    date: { type: 'STRING', description: 'YYYY-MM-DD, only if a date is written.' },
    unreadable: { type: 'STRING', description: 'What you could not make out. Say so rather than guessing.' },
  },
} as const;

const PROMPT = `This is a jewellery shop's written bill from Karachi — a handwritten
estimate or receipt. Read what is on it.

The handwriting mixes English, Urdu and Gujarati. Figures use the local grouping.

RULES, hardest first:

1. NEVER COMPLETE A LINE THAT IS NOT THERE.
   A bill line is one of two kinds and you must not turn the second into the first.

   BROKEN DOWN — it shows a weight, e.g. "Chain 21k 12.4g making 3500". Fill in
   weightG, karat, makingCharges and whatever else is written.

   NOT BROKEN DOWN — a name and a figure, e.g. "Box chain .......... 45,000". Put the
   figure in lineTotal, set brokenDown false, and LEAVE weightG NULL. Do not derive a
   weight from the price. Do not guess a karat. A shop that wrote only a total meant
   only a total, and a weight you invent will be read as one the shop wrote.

2. NAMES ARE COPIED, NOT CORRECTED. The customer's name goes down exactly as the
   characters look, in Roman letters. Do not resolve it to anyone or tidy the spelling
   — the shop's own book matches it by sound, and is better at it than you are.

3. WEIGHTS ARE GRAMS. Older slips are written in tola: 1 tola = 11.6638 g. Convert and
   set weightWasTola so the shop can see you did.

4. A FIGURE YOU CANNOT READ CLEANLY IS UNREADABLE. A 4 and a 9 are one hurried stroke
   apart and a wrong one is a wrong bill. Put what you could not read into "unreadable"
   rather than choosing the likelier digit.

5. COPY THE FOOT OF THE BILL AS WRITTEN — subtotal, discount, total, anything paid.
   Do not recompute them to agree with the lines. If they disagree, that disagreement
   is information and the shop needs to see it.`;

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
      schema: BILL_SCHEMA as unknown as Record<string, unknown>,
    });
    return NextResponse.json(parsed);
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error('[vision/bill]', err.status, err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Scanning failed.';
    console.error('[vision/bill]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
