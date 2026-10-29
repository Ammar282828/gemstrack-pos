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
 * Every caption the house sends has one shape, so a run of posts in the community reads as one hand
 * (the owner, 2026-10-29: "some lines are close together some are far … it needs to look good and
 * professional"). Up to four blocks, one blank line between blocks and none inside one:
 *
 *   ✨ *Name*                       the heading: the name, then metal and weight in italics
 *   _21K Yellow Gold · 35.13g_
 *
 *   The piece in a sentence.        the body: the words about it, then its facts in italics
 *   _Ruby · Oval · Statement_
 *
 *   🌐 See it: *https://…*          the link
 *
 *   *Ask for today’s price*         how to ask: the house's own lines, or the numbers
 *   💬 WhatsApp: +92…, +92…
 */
export function captionBlocks(blocks: (string | false | null | undefined)[][]): string {
  return blocks
    .map(b => b.map(l => (l || '').trim()).filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

/** One paragraph: the site's words come with stray line breaks and doubled spaces, which read as gaps in a chat. */
const paragraph = (v?: string) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** The italic line under a name: "21K Yellow Gold · 35.13g". */
const subLine = (...parts: (string | undefined)[]) => {
  const s = parts.map(x => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return s ? `_${s}_` : '';
};

/** The italic facts, with the house's tagline after them. */
const factsLine = (facts: string, tagline?: string) =>
  [facts.trim() ? `_${facts.trim()}_` : '', tagline?.trim() || ''].filter(Boolean).join(' ');

/** How to ask: the house's own closing (Mina: DM to order, card / bank transfer, shipping), else the line and the numbers. */
export function askBlock(numbers: string[], footer?: string, ask = '*Ask for today’s price*'): string[] {
  if (footer?.trim()) return footer.trim().split('\n');
  return [ask, numbers.length ? `💬 WhatsApp: ${numbers.join(', ')}` : ''];
}

/**
 * Whatever is about to go out, typed or drafted: Windows line ends and spaces at line ends dropped, and
 * never more than one blank line in a row, so an edit in the box cannot open a gap the drafts never make.
 */
export function tidyCaption(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n').map(l => l.replace(/[ \t\u00a0]+$/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The WhatsApp caption. Everything in it is editable on the page before it is
 * sent; this is the first draft, not the last word.
 */
export function whatsappCaption(p: PieceText, ctx: CaptionContext): string {
  return captionBlocks([
    [`✨ *${p.headline.trim()}*`, subLine(p.metal, weightLabel(p))],
    [paragraph(p.hook), factsLine(p.stones ?? '', ctx.tagline)],
    [ctx.link && `🌐 See it: *${ctx.link}*`],
    askBlock(ctx.whatsappNumbers, ctx.footer),
  ]);
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

/** A community post for a piece already on the website, in the house's shape (captionBlocks). */
export function sitePieceCaption(p: SitePieceText, ctx: SitePieceContext): string {
  const w = p.weightGrams && p.weightGrams > 0 ? `${Number(p.weightGrams.toFixed(3))}g` : '';
  const facts = (p.facts ?? []).map(f => f.trim()).filter(f => f && !/^none$/i.test(f));
  return captionBlocks([
    [`✨ *${p.name.trim()}*`, w ? subLine(ctx.metal, w) : ''],
    [paragraph(p.about), factsLine(facts.join(' · '), ctx.tagline)],
    [`🌐 See it: *${p.url}*`],
    askBlock(ctx.whatsappNumbers, ctx.footer),
  ]);
}
