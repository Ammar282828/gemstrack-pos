/**
 * Weight and money as a Karachi jeweller writes them (plan §4.2): tola / masha / ratti to grams, and
 * "125k", "1.2 lac", "1 crore" to rupees. Pure. The tola is the repo's one constant (lib/units.ts,
 * 11.664 g; the plan's 11.6638 is the older five-decimal figure the scanners parsed slips with).
 */

import { GRAMS_PER_TOLA } from '@/lib/units';

export const MASHA_PER_TOLA = 12;
export const RATTI_PER_MASHA = 8;
export const GRAMS_PER_MASHA = GRAMS_PER_TOLA / MASHA_PER_TOLA;
export const GRAMS_PER_RATTI = GRAMS_PER_MASHA / RATTI_PER_MASHA;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** tola + masha + ratti → grams (3 decimals). */
export function toGrams(p: { tola?: number; masha?: number; ratti?: number }): number {
  return r3((p.tola ?? 0) * GRAMS_PER_TOLA + (p.masha ?? 0) * GRAMS_PER_MASHA + (p.ratti ?? 0) * GRAMS_PER_RATTI);
}

/** grams → whole tola, whole masha, and the rest in ratti (to a quarter ratti), carrying over. */
export function fromGrams(g: number): { tola: number; masha: number; ratti: number } {
  let rest = Math.max(0, Number(g) || 0);
  const tola = Math.floor(rest / GRAMS_PER_TOLA + 1e-9); rest -= tola * GRAMS_PER_TOLA;
  let masha = Math.floor(rest / GRAMS_PER_MASHA + 1e-9); rest -= masha * GRAMS_PER_MASHA;
  let ratti = Math.round((rest / GRAMS_PER_RATTI) * 4) / 4;
  if (ratti >= RATTI_PER_MASHA) { ratti -= RATTI_PER_MASHA; masha += 1; }
  return { tola, masha, ratti };
}

const WORD_AMOUNT: Record<string, number> = { aadha: 0.5, adha: 0.5, half: 0.5, sawa: 1.25, dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5 };
const WORDS = 'aadha|adha|half|sawa|dedh|derh|dhai|dhaai';
const NUM = String.raw`\d+(?:\.\d+)?|\d+\s*/\s*\d+`;
const UNIT = String.raw`(tolas?|tolay|tole|tolah|tolo|masha|mashe|mashas|masa|ratti|rati|rattis)\b`;
const PART = String.raw`(?:${NUM}|${WORDS})\s*(?:-\s*)?${UNIT}`;

const num = (s: string): number => {
  const f = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  return f ? Number(f[1]) / Number(f[2]) : Number(s);
};

export interface TolaWeight { grams: number; text: string; index: number }

/** Every tola/masha/ratti weight in a text ("2 tola 3 masha", "adha tola", "1.5 tola 2 ratti"), in grams, with the words as written. */
export function findTolaWeights(text: string): TolaWeight[] {
  const out: TolaWeight[] = [];
  const whole = new RegExp(String.raw`(?<![\w.])${PART}(?:\s*(?:aur|and|\+|,)?\s*${PART}){0,2}`, 'gi');
  for (const m of text.matchAll(whole)) {
    const acc: { tola?: number; masha?: number; ratti?: number } = {};
    const each = new RegExp(String.raw`(${NUM}|${WORDS})\s*(?:-\s*)?${UNIT}`, 'gi');
    for (const p of m[0].matchAll(each)) {
      const raw = p[1].toLowerCase();
      const n = raw in WORD_AMOUNT ? WORD_AMOUNT[raw] : num(raw);
      const unit = p[2].toLowerCase();
      const k = unit.startsWith('tol') ? 'tola' : unit.startsWith('mas') ? 'masha' : 'ratti';
      acc[k] = (acc[k] ?? 0) + n;
    }
    const grams = toGrams(acc);
    if (grams > 0) out.push({ grams, text: m[0].trim(), index: m.index ?? 0 });
  }
  return out;
}

/** "1.2 lac", "125k", "2 crore", "Rs 85,000" → rupees; null when it isn't an amount. */
export function parseMoney(raw: string): number | null {
  const s = raw.toLowerCase().replace(/(?:rs\.?|pkr|₨|rupees?|rupay[ae]?|\/-)/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^([\d,]+(?:\.\d+)?)\s*(k|thousand|hazar|lac|lacs|lakh|lakhs|lack|crore|crores|cr)?$/);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const unit = m[2];
  const mult = !unit ? 1 : unit === 'k' || unit === 'thousand' || unit === 'hazar' ? 1e3 : /^(lac|lack|lakh)/.test(unit) ? 1e5 : 1e7;
  return Math.round(base * mult);
}
