import { NextResponse } from 'next/server';

// 1 tola = 11.6638 grams (standard Pakistani tola)
const GRAMS_PER_TOLA = 11.6638;

/**
 * Attempts to extract a PKR rate from a string that may look like:
 *   "Rs. 249,530", "PKR 249530", "249,530", "249530"
 */
function parseRate(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) || n <= 0 ? null : n;
}

/**
 * Fetches the gold.pk homepage and extracts per-gram rates for 24k, 22k, 21k, 18k.
 * gold.pk shows rates per tola; we divide by 11.6638 to get per-gram.
 *
 * The site uses div-based layout:
 *   <div class='column25'><b>per tola Gold Price</b></div>
 *   <div class='column15'>Rs. 523500</div>  ← 24k
 *   <div class='column15'>Rs. 479872</div>  ← 22k
 *   <div class='column15'>Rs. 458063</div>  ← 21k
 *   <div class='column15'>Rs. 392625</div>  ← 18k
 */
async function scrapeGoldPk(): Promise<{ k24: number; k22: number; k21: number; k18: number } | null> {
  const res = await fetch('https://gold.pk/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GemsTrack/1.0)',
      'Accept': 'text/html',
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const html = await res.text();

  let k24tola: number | null = null;
  let k22tola: number | null = null;
  let k21tola: number | null = null;
  let k18tola: number | null = null;

  // Strategy 1: Isolate the "per tola Gold Price" row section (everything up to the next column25 div),
  // then sequentially pull the Rs. values: order is 24k → 22k → 21k → 18k → 12k.
  // Using a section approach avoids greedy quantifiers skipping values.
  const perTolaSection = html.match(/per tola Gold Price([\s\S]*?)(?:<div class=['"]column25['"])/);
  if (perTolaSection) {
    const section = perTolaSection[1];
    const valueRe = /Rs\.\s*([\d,]+(?:\.\d+)?)/g;
    const rates: (number | null)[] = [];
    let m: RegExpExecArray | null;
    while ((m = valueRe.exec(section)) !== null) {
      rates.push(parseRate(m[1]));
    }
    if (rates.length >= 4) {
      k24tola = rates[0];
      k22tola = rates[1];
      k21tola = rates[2];
      k18tola = rates[3];
    }
  }

  // Strategy 2: Fallback – parse per-gram directly from goldratehome paragraph
  // <p class='goldratehome'>Rs.44882.00</p>
  // <p>24 Karat Gold Rate <b>(1 Gram)</b></p>
  if (!k24tola) {
    const gramMatch = html.match(/class='goldratehome'>Rs\.\s*([\d,]+(?:\.\d+)?)<\/p>[\s\S]{0,120}1 Gram/);
    if (gramMatch) {
      const k24gram = parseRate(gramMatch[1]);
      if (k24gram) k24tola = k24gram * GRAMS_PER_TOLA;
    }
  }

  if (!k24tola) return null;

  // Derive missing karats proportionally if not separately parsed
  const k22 = k22tola ?? (k24tola * 22) / 24;
  const k21 = k21tola ?? (k24tola * 21) / 24;
  const k18 = k18tola ?? (k24tola * 18) / 24;

  return {
    k24: Math.round(k24tola / GRAMS_PER_TOLA),
    k22: Math.round(k22 / GRAMS_PER_TOLA),
    k21: Math.round(k21 / GRAMS_PER_TOLA),
    k18: Math.round(k18 / GRAMS_PER_TOLA),
  };
}

export async function GET() {
  try {
    const rates = await scrapeGoldPk();

    if (!rates) {
      return NextResponse.json({ error: 'Could not parse gold rates from gold.pk' }, { status: 502 });
    }

    return NextResponse.json({
      goldRatePerGram24k: rates.k24,
      goldRatePerGram22k: rates.k22,
      goldRatePerGram21k: rates.k21,
      goldRatePerGram18k: rates.k18,
      fetchedAt: new Date().toISOString(),
      source: 'gold.pk',
    });
  } catch (err) {
    console.error('[/api/gold-rates] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch gold rates' }, { status: 500 });
  }
}
