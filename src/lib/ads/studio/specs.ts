/**
 * A piece's specs line for an ad — "21K Yellow Gold · Ruby · 45.35g" — from what the ERP
 * knows (the site's tags and the counter's weight), never guessed. Prices, karats and weights
 * in ads were allowed by the owner on 2026-09-29; this is the one place their words are made,
 * and the copy and the check hold every figure in an ad against it. Pure (tested).
 */

export interface SpecSource { karat?: string; metal?: string; stone?: string; weightGrams: number | null }

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const NONE = /^(none|no stones?|plain|n\/a|-)$/i;

export function pieceSpecs(p: SpecSource): string {
  const karat = clean(p.karat).replace(/^(\d{1,2})\s?(k|kt|karat)$/i, '$1K');
  const metal = clean(p.metal);
  const stone = clean(p.stone);
  const metalLine = karat && metal ? (metal.toLowerCase().includes(karat.toLowerCase()) ? metal : `${karat} ${metal}`)
    : karat ? `${karat} Gold` : metal;
  const w = p.weightGrams !== null && Number.isFinite(p.weightGrams) && p.weightGrams > 0 ? `${p.weightGrams}g` : '';
  return [metalLine, stone && !NONE.test(stone) ? stone : '', w].filter(Boolean).join(' · ');
}
