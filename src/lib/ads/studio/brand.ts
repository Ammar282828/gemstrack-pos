/**
 * Each house's brand book, as the Ad studio's model reads it and the Guide shows it — one
 * shape, two houses, the active one chosen by `NEXT_PUBLIC_STORE_BRAND` (every difference
 * between the shops is a variable, never a fork of the code).
 *
 * Taheri: distilled from the owner's own vault (Google Drive → Taheri Vault; read 2026-09-29):
 * Brand Identity, Content Restrictions, Decision Rules, Brand Voice, Audience, Business Tensions,
 * Pakistani Market Context, Brand Colours, Logos, Visual Production, Channels Overview, the
 * Instagram caption formula, the Pre-Send Checklist, Muharram Protocol. The owner lifted three of
 * its hard rules for ads on 2026-09-29 ("all are incorrect now, i have zero issues with these"):
 * prices, specs and direct calls to action are allowed; accuracy replaces them.
 *
 * House of Mina (2026-09-29, owner: "do the same thing for houseofmina"): from what the ERP
 * already says in Mina's name — its voice in the caption prompts (its own community posts), its
 * link page and post footer, its palette and mark — and the market research of that day. It has
 * no vault; nothing here is invented beyond what those say.
 *
 * Kept as text in code rather than read at run time: these rules decide what the model approves.
 */

import { STORE_BRAND } from '@/lib/store-config';

export interface HouseBrand {
  identity: { name: string; line: string; pillars: readonly string[]; positioning: string; routing: string; /** The heritage layout's line. */ since: string; /** The badge layout's words. */ badge: string };
  decisionRules: readonly string[];
  hardRules: readonly string[];
  voice: { oneLine: string; feel: readonly string[]; never: readonly string[]; rules: readonly string[]; closers: readonly string[]; ctas: readonly string[]; avoid: readonly string[] };
  audience: { primary: string; secondary: readonly string[]; values: readonly string[]; notes: readonly string[] };
  markRules: readonly string[];
  /** `gold` and `lightGold` are the house's accent and its light shade (rose for Mina). */
  visual: { gold: string; lightGold: string; ground: string; ground2: string; bone: string; rules: readonly string[] };
  market: readonly string[];
  /** Keep ads off the Bohra calendar's sacred and quiet days (calendar.ts). */
  calendar: boolean;
  /** Words the house never lets through in an ad, after the model (prompts.ts). */
  banned: readonly RegExp[];
  /** Who the competitor search looks for. */
  competitors: string;
  /** Where the shoots are, for the Drive card. */
  driveHint: string;
}

const TAHERI: HouseBrand = {
  identity: {
    name: 'taheri',
    line: 'Luxury gold and diamond jewellery since 1989 — a generational Bohri family house in Karachi.',
    pillars: ['legacy', 'tradition', 'heritage', 'prestige', 'trust'],
    positioning: 'The go-to jeweller for the Bohra community.',
    routing: 'WhatsApp closes. Everything else routes into WhatsApp. Instagram is judged on WhatsApp community joins and conversations — not likes, not reach.',
    since: 'Since 1989',
    badge: 'HRD Antwerp certified',
  },
  decisionRules: [
    'When in doubt, in this order: 1. Protect prestige. 2. Protect community sensitivity. 3. Choose subtlety over loudness. 4. Avoid sounding transactional during religious moments.',
    'If unsure whether a date is sacred → treat it as sacred.',
    'If unsure whether a line is too salesy → cut it.',
    'If unsure whether a post is too long → it is.',
  ],
  hardRules: [
    'Never invent a figure: a price, karat, weight, carat or grade appears only exactly as the ERP gives it — a wrong weight is worse than none.',
    'No discount or sale language (“% off”, “sale”).',
    'On sacred Bohra dates, and in the days just before them: no product ads and no calls to action of any kind.',
    'Muharram, the first ten days: no product mentions, no jewellery or gold imagery, and no black styling.',
    'No trend-chasing visuals that reduce prestige: no memes, stickers, loud gradients, discount bursts.',
    'Never the word "investment" for diamonds; outside the Investments by Taheri series, avoid it altogether.',
    'No hashtags. No bridal framing in the copy. Never compare diamonds to gold.',
  ],
  voice: {
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
    ctas: ['Message us for today’s price.', 'Shop now.', 'DM us to order.', 'Visit us today.', 'Available in-store and by appointment.', 'Inquiries welcome.'],
    avoid: ['Sale', 'Discount', 'Questions? Feel free to reach out.', 'investment (for diamonds)', 'lightweight (as a selling point)', 'bridal'],
  },
  audience: {
    primary: 'The Bohra community.',
    secondary: ['heritage-conscious jewellery buyers', 'occasion and gifting buyers', 'women buying for family milestones', 'loyal repeat customers', 'trust-first, relationship-first buyers'],
    values: ['trust', 'prestige', 'family reputation', 'cultural fit', 'quality', 'long-term relationship'],
    notes: [
      'Business-minded and financially intelligent: investment framing lands (for gold, in its own series); condescension does not.',
      'Reputation travels fast in a tight community — one bad interaction is a network event.',
      'Personal messages outperform broadcasts: an ad should open a conversation, not close a sale.',
    ],
  },
  markRules: [
    'The wordmark is lowercase, always — never "TAHERI" in capitals.',
    'One mark per surface: the wordmark or the monogram, never both.',
    'On product photography: the monogram in bone at low opacity in a corner, or nothing. Never on a busy part of the photo.',
    'Never stretch, rotate, outline or shadow a mark; never recolour it outside the palette.',
  ],
  visual: {
    gold: '#C9A45A', lightGold: '#E4C983', ground: '#0A1111', ground2: '#132020', bone: '#F8F8F8',
    rules: [
      'A dark ground with gold: a dark gradient, gold primary #C9A45A, light gold #E4C983, a fine gold corner-accent frame.',
      'Bone (#F8F8F8), not pure white, for type on dark. One gold accent, used sparingly.',
      'The image carries the weight — keep type restrained. One idea per frame.',
      'The green pine/sage palette is only a candidate the owner has not adopted — not in ads.',
      'Every visual comes as a pair: the story (1080 × 1920) and the square (1080 × 1080).',
    ],
  },
  market: [
    'Gold is financial infrastructure, not decoration: buyers track rates like stocks and read transparency as confidence.',
    'Frame a rate drop as a timing window, not a sale; the upgrade angle — buy better, not just cheaper.',
    'Buyers silently check Taheri against the Sarafa market rate: never cite it, never ignore it.',
    'A rate is always an estimate, rounded: "~PKR 515,000 per tola".',
    'A rupee price moves with the gold rate while an ad runs for days: prefer the weight and karat with “today’s price”, or refresh a fixed price as the rate moves.',
  ],
  calendar: true,
  banned: [/\b(on sale|sale|discount(ed)?|\d+\s?% off)\b/i, /(^|\s)#[a-z]/i],
  competitors: 'fine gold and diamond jewellers in Karachi first (bridal and heritage houses, diamond boutiques, the premium names Bohra and Karachi families buy from), then Pakistan-wide premium jewellers that advertise on Instagram',
  driveHint: '“taheri content” (the shoots), “TC” (the archive) and the Vault’s logos',
};

const MINA: HouseBrand = {
  identity: {
    name: 'House of Mina',
    line: 'Bespoke jewellery in 925 sterling silver, designed in-house in Karachi and shipped worldwide.',
    pillars: ['design', 'colour and light', 'craft in silver', 'wit', 'a studio, not a shop floor'],
    positioning: 'Modern silver jewellery with character — rings, cuffs, sets and men’s pieces made to be worn every day.',
    routing: 'Instagram is the shop window, WhatsApp and DMs close the order (card or bank transfer, shipped worldwide), and the catalogue shows the whole range.',
    since: 'House of Mina',
    badge: '925 Sterling Silver',
  },
  decisionRules: [
    'When in doubt, in this order: 1. Keep it clean. 2. Colour and light first. 3. Short beats clever; clever beats long.',
    'If unsure whether a line gushes → cut it.',
    'If unsure whether a figure is right → leave it out.',
  ],
  hardRules: [
    'Never invent a figure: a price, weight or stone appears only exactly as the ERP or the catalogue gives it.',
    'The metal is 925 sterling silver — never call it white gold or platinum; plating is named only as the catalogue names it.',
    'Stones are named as the catalogue names them; never “natural” or “real” unless the catalogue says so.',
    'No hashtags in an ad.',
    'No cluttered or cheap-looking visuals: no stickers, no bursts, no stock clip-art.',
  ],
  voice: {
    oneLine: 'Modern, confident and clean — short, vivid lines with a little wit.',
    feel: ['modern', 'confident', 'clean', 'witty', 'colour-led'],
    never: ['gushing', 'salesy', 'fussy', 'generic'],
    rules: [
      'Colour and light first: say what the piece does in the light, not what it is made of.',
      'Short, vivid lines. One idea a line. A little wit where it fits.',
      'Its own posts read like “Cut to catch every light in the room.” and “Red, blue, green. Pick your side.”',
      'Specs are welcome when given — the silver, the stones, a weight or a price — stated plainly, exactly as given.',
      'British spelling.',
    ],
    closers: ['Bespoke, designed in-house.', 'Pick your side.', 'Made to be worn, every day.'],
    ctas: ['DM to order.', 'Order on WhatsApp.', 'Shop now.', 'See the whole catalogue.', 'Shipped worldwide.'],
    avoid: ['gushing superlatives', 'white gold (for silver)', 'real / natural (unless the catalogue says so)'],
  },
  audience: {
    primary: 'Style-led buyers of silver jewellery in Pakistan and abroad.',
    secondary: ['gift buyers', 'men buying rings, chains and cuffs', 'people who follow the house on Instagram', 'repeat customers who collect'],
    values: ['design', 'colour', 'wearability', 'quality silver', 'a quick, personal reply'],
    notes: [
      'Instagram-native: many will want to DM rather than WhatsApp — the messaging-apps goal suits them.',
      'Worldwide shipping widens the audience beyond Karachi; card and bank transfer are the ways to pay.',
    ],
  },
  markRules: [
    'The MINA wordmark once per surface, clear of the piece.',
    'Never stretch, rotate, outline or shadow the mark; never recolour it outside the palette.',
  ],
  visual: {
    gold: '#E8A5AE', lightGold: '#F2C4CB', ground: '#140B0B', ground2: '#2A1416', bone: '#F8F1EE',
    rules: [
      'A deep maroon-black ground (#140B0B) with the house’s dusty rose (#E8A5AE) as the one accent.',
      'Warm ivory (#F8F1EE), not pure white, for type on dark.',
      'Colour and light first: let the stones and the silver shine; keep type short and clean.',
      'Every visual comes as a pair: the story (1080 × 1920) and the square or 4:5.',
    ],
  },
  market: [
    'Silver is bought on design and price, not by weight like gold: a clear price and the piece in the light sell it.',
    'Pay by card or bank transfer, shipped worldwide — say so; it removes the question before it is asked.',
  ],
  calendar: false,
  banned: [/(^|\s)#[a-z]/i],
  competitors: 'sterling-silver, oxidised, demi-fine and fashion jewellery brands in Pakistan that sell on Instagram and online (Karachi and Lahore first), and men’s silver jewellery brands',
  driveHint: 'the folders with House of Mina’s shoots',
};

/** The active house's brand. */
export const BRAND: HouseBrand = STORE_BRAND === 'mina' ? MINA : TAHERI;

export const IDENTITY = BRAND.identity;
export const DECISION_RULES = BRAND.decisionRules;
export const HARD_RULES = BRAND.hardRules;
export const VOICE = BRAND.voice;
export const AUDIENCE = BRAND.audience;
export const MARK_RULES = BRAND.markRules;
export const VISUAL = BRAND.visual;
export const MARKET = BRAND.market;

/** The whole brief as the model reads it. */
export function brandBrief(): string {
  const list = (xs: readonly string[]) => xs.map(x => `- ${x}`).join('\n');
  return [
    `THE HOUSE: ${IDENTITY.name} — ${IDENTITY.line} Pillars: ${IDENTITY.pillars.join(', ')}. ${IDENTITY.positioning}`,
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
