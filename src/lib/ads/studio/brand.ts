/**
 * Taheri's brand book, as the Ad studio's model reads it and the Guide shows it.
 *
 * Distilled from the owner's own vault (Google Drive → Taheri Vault; read 2026-09-29):
 * Brand Identity, Content Restrictions, Decision Rules, Brand Voice, Audience, Business
 * Tensions, Pakistani Market Context, Brand Colours, Logos, Visual Production, Channels
 * Overview, the Instagram caption formula and audit, What To Stop Doing, the Pre-Send
 * Checklist, Muharram Protocol and the collection notes. Rules the vault states are quoted
 * as it states them; the vault has no paid-ads note, so ads are held to its rules for
 * public Instagram content. Where it leaves a question open (gold vs the green palette) its
 * own ruling holds: gold is the brand.
 *
 * The owner lifted three of the vault's hard rules for ads on 2026-09-29 ("all are incorrect
 * now, i have zero issues with these"): prices, specs (karat, weight, carat, grading) and
 * direct calls to action ("Shop now", phone numbers, urgency) are all allowed. What replaces
 * them is accuracy — a figure in an ad is only ever one the ERP holds, never the model's.
 *
 * Kept as text in code rather than read from Drive at run time: these rules decide what
 * the model approves, and a note edited in Obsidian should not change that silently.
 */

export const IDENTITY = {
  name: 'taheri',
  line: 'Luxury gold and diamond jewellery since 1989 — a generational Bohri family house in Karachi.',
  pillars: ['legacy', 'tradition', 'heritage', 'prestige', 'trust'],
  positioning: 'The go-to jeweller for the Bohra community.',
  /** Channels Overview: the one rule that governs every other. */
  routing: 'WhatsApp closes. Everything else routes into WhatsApp. Instagram is judged on WhatsApp community joins and conversations — not likes, not reach.',
} as const;

/** Decision Rules, verbatim. */
export const DECISION_RULES = [
  'When in doubt, in this order: 1. Protect prestige. 2. Protect community sensitivity. 3. Choose subtlety over loudness. 4. Avoid sounding transactional during religious moments.',
  'If unsure whether a date is sacred → treat it as sacred.',
  'If unsure whether a line is too salesy → cut it.',
  'If unsure whether a post is too long → it is.',
] as const;

/** The rules no public ad may break (Content Restrictions: "Hard rules. No exceptions."). */
export const HARD_RULES = [
  'Never invent a figure: a price, karat, weight, carat or grade appears only exactly as the ERP gives it — a wrong weight is worse than none.',
  'No discount or sale language (“% off”, “sale”).',
  'On sacred Bohra dates, and in the days just before them: no product ads and no calls to action of any kind.',
  'Muharram, the first ten days: no product mentions, no jewellery or gold imagery, and no black styling.',
  'No trend-chasing visuals that reduce prestige: no memes, stickers, loud gradients, discount bursts.',
  'Never the word "investment" for diamonds; outside the Investments by Taheri series, avoid it altogether.',
  'No hashtags. No bridal framing in the copy. Never compare diamonds to gold.',
] as const;

/** Brand Voice, with the corrections the owner has made. */
export const VOICE = {
  oneLine: 'Speak like a trusted family elder who also happens to be impeccably refined.',
  feel: ['professional', 'luxe and premium', 'engaging but refined', 'traditional yet modern', 'culturally aware — Bohra-first'],
  never: ['mass-market', 'loud or gimmicky', 'overly salesy', 'opportunistic during religious moments', 'cheap or trendy in a fast-fashion way'],
  rules: [
    'Statement pieces require statement copy: match the volume of the writing to the volume of the piece.',
    'Copy complements the image; it does not describe it. If a sentence says what the reader can already see, cut it.',
    'Aspirational framing positions the buyer; it does not flatter her.',
    'Describe the work and the wearing — one concrete observation about the craft, one about how it is worn.',
    'English by default; a warm Urdu close is allowed, never Urdu mid-sentence.',
    'Specs are welcome and read as transparency to this market: the karat, the weight, the stones, a grade or a price — stated plainly, exactly as given.',
    'Diamonds: an elevated register — light, brilliance, fire, clarity, permanence; "set by hand, held for generations"; "a stone that outlasts the occasion".',
    'Meenakari: the enamel is the story — hand-work, each piece fired individually; write the occasion and the woman, not the colours.',
  ],
  closers: ['Balance is the whole point.', 'An everyday kind of luxury.', 'For the woman who lets the jewellery speak.'],
  /** Calls to action — direct ones are fine (the owner, 2026-09-29). */
  ctas: ['Message us for today’s price.', 'Shop now.', 'DM us to order.', 'Visit us today.', 'Available in-store and by appointment.', 'Inquiries welcome.'],
  avoid: ['Sale', 'Discount', 'Questions? Feel free to reach out.', 'investment (for diamonds)', 'lightweight (as a selling point)', 'bridal'],
} as const;

export const AUDIENCE = {
  primary: 'The Bohra community.',
  secondary: ['heritage-conscious jewellery buyers', 'occasion and gifting buyers', 'women buying for family milestones', 'loyal repeat customers', 'trust-first, relationship-first buyers'],
  values: ['trust', 'prestige', 'family reputation', 'cultural fit', 'quality', 'long-term relationship'],
  notes: [
    'Business-minded and financially intelligent: investment framing lands (for gold, in its own series); condescension does not.',
    'Reputation travels fast in a tight community — one bad interaction is a network event.',
    'Personal messages outperform broadcasts: an ad should open a conversation, not close a sale.',
  ],
} as const;

/** How the wordmark and monogram are used (Logos). */
export const MARK_RULES = [
  'The wordmark is lowercase, always — never "TAHERI" in capitals.',
  'One mark per surface: the wordmark or the monogram, never both.',
  'On product photography: the monogram in bone at low opacity in a corner, or nothing. Never on a busy part of the photo.',
  'Never stretch, rotate, outline or shadow a mark; never recolour it outside the palette.',
] as const;

/** Visual Production and Brand Colours. */
export const VISUAL = {
  gold: '#C9A45A', lightGold: '#E4C983', ground: '#0A1111', bone: '#F8F8F8',
  rules: [
    'A dark ground with gold: a dark gradient, gold primary #C9A45A, light gold #E4C983, a fine gold corner-accent frame.',
    'Bone (#F8F8F8), not pure white, for type on dark. One gold accent, used sparingly.',
    'The image carries the weight — keep type restrained. One idea per frame.',
    'The green pine/sage palette is only a candidate the owner has not adopted — not in ads.',
    'Every visual comes as a pair: the story (1080 × 1920) and the square (1080 × 1080).',
  ],
} as const;

/** Pakistani Market Context. */
export const MARKET = [
  'Gold is financial infrastructure, not decoration: buyers track rates like stocks and read transparency as confidence.',
  'Frame a rate drop as a timing window, not a sale; the upgrade angle — buy better, not just cheaper.',
  'Buyers silently check Taheri against the Sarafa market rate: never cite it, never ignore it.',
  'A rate is always an estimate, rounded: "~PKR 515,000 per tola".',
  'A rupee price moves with the gold rate while an ad runs for days: prefer the weight and karat with “today’s price”, or refresh a fixed price as the rate moves.',
] as const;

/** The whole brief as the model reads it. */
export function brandBrief(): string {
  const list = (xs: readonly string[]) => xs.map(x => `- ${x}`).join('\n');
  return [
    `THE HOUSE: ${IDENTITY.name} (always lowercase) — ${IDENTITY.line} Pillars: ${IDENTITY.pillars.join(', ')}. ${IDENTITY.positioning}`,
    `WHAT AN AD IS FOR: ${IDENTITY.routing}`,
    `DECISION RULES:\n${list(DECISION_RULES)}`,
    `HARD RULES — a public ad that breaks one is rejected:\n${list(HARD_RULES)}`,
    `VOICE: ${VOICE.oneLine} It should feel ${VOICE.feel.join(', ')}; never ${VOICE.never.join(', ')}.\n${list(VOICE.rules)}\nCalls to action (direct is fine): ${VOICE.ctas.join(' / ')}\nSignature closers (about half the time): ${VOICE.closers.join(' / ')}\nNever: ${VOICE.avoid.join(', ')}.`,
    `AUDIENCE: ${AUDIENCE.primary} Also ${AUDIENCE.secondary.join(', ')}. They value ${AUDIENCE.values.join(', ')}.\n${list(AUDIENCE.notes)}`,
    `MARKS:\n${list(MARK_RULES)}`,
    `VISUAL:\n${list(VISUAL.rules)}`,
    `MARKET:\n${list(MARKET)}`,
  ].join('\n\n');
}
