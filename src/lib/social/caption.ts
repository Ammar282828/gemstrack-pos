/**
 * The words that go out with a piece: the story's lines and the WhatsApp caption.
 *
 * Pure functions, so the page, the tests and any later bot build the same text
 * from the same fields. The caption follows the shape the shop already posts in
 * (the jewelry-whatsapp-post format: a starred header with metal and weight, an
 * optional hook, an italic stones line, then where to ask) with one deliberate
 * change: no street address. Customer-facing copy never names the market.
 */

export interface PieceText {
  /** The big line: "Bangle & Ring", "Set of the Day". */
  headline: string;
  /** Optional small line above it: "Lightweight", "For the love of". */
  kicker?: string;
  /** Exactly as typed at the counter — "45.350" stays "45.350". Grams. */
  weight?: string;
  /** The weight is per piece ("10g each"), not for the lot. */
  weightEach?: boolean;
  /** "21K Yellow Gold". */
  metal?: string;
  /** "Simulated Sapphires", "Natural Rubies". */
  stones?: string;
  /** One optional sentence under the header in the caption. */
  hook?: string;
}

/** "45.350" → "45.350g", "10" + each → "10g each". Empty when there is no usable weight. */
export function weightLabel(p: Pick<PieceText, 'weight' | 'weightEach'>): string {
  const w = String(p.weight ?? '').trim().replace(/\s*g$/i, '');
  if (!w || !Number.isFinite(Number(w)) || Number(w) <= 0) return '';
  return `${w}g${p.weightEach ? ' each' : ''}`;
}

/**
 * The story's small line: metal, stones and (unless the weight has its own
 * line) the weight, pipe-separated the way the shop writes them —
 * "21K Yellow Gold | Simulated Sapphires | 45.350g".
 */
export function detailsLine(p: PieceText, includeWeight: boolean): string {
  return [p.metal, p.stones, includeWeight ? weightLabel(p) : '']
    .map(s => String(s ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

/** "https://wa.me/923352275553" → "+923352275553". Empty for anything else. */
export function waNumberFromUrl(url: string | undefined | null): string {
  const m = String(url ?? '').match(/wa\.me\/(\d{8,15})/);
  return m ? `+${m[1]}` : '';
}

export interface CaptionContext {
  /** Numbers to ask on, already formatted: ["+923352275553", "+923262275554"]. */
  whatsappNumbers: string[];
  /** Where to see it: the collection's page, or the site itself. */
  link?: string;
  /** The house's line after the stones: "Bespoke, designed in-house." (NEXT_PUBLIC_STORE_POST_TAGLINE). */
  tagline?: string;
  /** The house's own closing lines (NEXT_PUBLIC_STORE_POST_FOOTER); without them, "Ask for today's price" and the numbers. */
  footer?: string;
}

/**
 * The WhatsApp caption. Everything in it is editable on the page before it is
 * sent; this is the first draft, not the last word.
 */
export function whatsappCaption(p: PieceText, ctx: CaptionContext): string {
  const headline = p.headline.trim();
  const header = [p.metal?.trim(), weightLabel(p)].filter(Boolean).join(' | ');
  const lines: string[] = [];
  lines.push(`✨ *${headline}*${header ? ` — _${header}_` : ''}`);
  if (p.hook?.trim()) lines.push('', p.hook.trim());
  const tail = [p.stones?.trim() ? `_${p.stones.trim()}_` : '', ctx.tagline?.trim() || ''].filter(Boolean);
  if (tail.length) lines.push('', tail.join(' '));
  const footer = ctx.footer?.trim();
  if (footer) {
    // A house with its own closing (Mina: DM to order, card / bank transfer, shipping) has no prices to ask for.
    if (ctx.link) lines.push('', `🌐 See it: *${ctx.link}*`);
    lines.push('', footer);
    return lines.join('\n');
  }
  const ask: string[] = [];
  if (ctx.whatsappNumbers.length) ask.push(`💬 WhatsApp: ${ctx.whatsappNumbers.join(', ')}`);
  if (ctx.link) ask.push(`🌐 See it at *${ctx.link}*`);
  if (ask.length) lines.push('', '*Ask for today’s price:*', ...ask);
  return lines.join('\n');
}

/**
 * A file name the website can show as the piece's name: "Bangle and Ring.jpg",
 * "Bangle and Ring 2.jpg". The site builds image URLs with encodeURI, which
 * leaves & # ? % alone, so those never reach a file name.
 */
export function websiteFileName(name: string, index: number): string {
  const base = name.replace(/&/g, ' and ').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Piece';
  return `${base}${index > 0 ? ` ${index + 1}` : ''}.jpg`;
}

// ── A piece from the house's own website ───────────────────────────────────

/** A piece as the website publishes it (see src/lib/website/site-pieces.ts). */
export interface SitePieceText {
  name: string;
  /** The piece's own page, in full. */
  url: string;
  weightGrams?: number | null;
  /** Stones, cut, style, plating — whatever the site knows, most telling first. */
  facts?: string[];
  /** The site's own words about it (Mina's catalogue has a paragraph per piece). */
  about?: string;
}
export interface SitePieceContext {
  /** Shown beside the weight: "21K Gold". Only used when there is a weight. */
  metal?: string;
  /** The house's line after the facts: "Bespoke, designed in-house." */
  tagline?: string;
  /** The closing lines, as the house writes them. Without them, "Ask for today's price" and the numbers. */
  footer?: string;
  whatsappNumbers: string[];
}

/**
 * A community post for a piece already on the website, in the house's shape:
 *
 *   ✨ *Turquoise Floral Cluster Tops* — _21K Gold | 3.84g_
 *   (the site's paragraph about it, when it has one)
 *   _Turquoise · Floral_
 *   🌐 See it: *https://taheri.shop/tops/turquoise-floral-cluster-tops*
 *   *Ask for today's price:* … (or the house's own closing lines)
 */
export function sitePieceCaption(p: SitePieceText, ctx: SitePieceContext): string {
  const w = p.weightGrams && p.weightGrams > 0 ? `${Number(p.weightGrams.toFixed(3))}g` : '';
  const header = w ? [ctx.metal?.trim(), w].filter(Boolean).join(' | ') : '';
  const lines: string[] = [`✨ *${p.name.trim()}*${header ? ` — _${header}_` : ''}`];
  if (p.about?.trim()) lines.push('', p.about.trim());
  const facts = (p.facts ?? []).map(f => f.trim()).filter(f => f && !/^none$/i.test(f));
  const tail = [facts.length ? `_${facts.join(' · ')}_` : '', ctx.tagline?.trim() || ''].filter(Boolean);
  if (tail.length) lines.push('', tail.join(' '));
  lines.push('', `🌐 See it: *${p.url}*`);
  const footer = ctx.footer?.trim();
  if (footer) lines.push('', footer);
  else if (ctx.whatsappNumbers.length) lines.push('', '*Ask for today’s price:*', `💬 WhatsApp: ${ctx.whatsappNumbers.join(', ')}`);
  return lines.join('\n');
}
