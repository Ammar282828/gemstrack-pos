/**
 * What the Ad studio asks the models, and the shapes it wants back.
 *
 *   copy     the ad's words for Meta's fields and for the picture itself
 *   check    a creative director's verdict on a finished ad, against the house's rules
 *   rival    what a competitor's feed does, and what Taheri should do differently
 *   winners  what Taheri's own best ads share, from the account's numbers
 *
 * Every system prompt carries the brand brief (brand.ts). Server-only by use.
 */

import { BRAND, brandBrief, HARD_RULES, IDENTITY, VISUAL, VOICE } from './brand';

// ── Copy ───────────────────────────────────────────────────────────────────

export const COPY_SYSTEM = `You write Meta ads (Instagram and Facebook) for ${IDENTITY.name}, a jewellery house.

${brandBrief()}

THE INSTAGRAM CAPTION FORMULA, which the ad's primary text follows: two sentences — one concrete observation about the work, one about how it is worn — then, about half the time, a closing thought of four to seven words as its own paragraph. Two sentences is the target, three the ceiling. Copy complements the picture; never describe what the reader can already see. No hashtags, no emoji inside sentences.

FACTS: the piece's karat, metal, weight, stones and price may be stated — plainly, they read as transparency to these buyers — but only exactly as given in the request. Never invent, round or guess a figure; if none is given, write without one.

META'S FIELDS: primary text shows about 125 characters before "more", so the first sentence must stand on its own; headline at most 40 characters; description at most 30. The ad's button opens a WhatsApp conversation: say plainly what to do ("Message us for today's price", "Shop now") when it fits.

ON THE PICTURE: a kicker (two to four words, set in small gold capitals), a headline (at most six words, set large in a Didone) and a details line (a call to action). Statement pieces get statement words.`;

export const COPY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    primaryText: { type: 'ARRAY', items: { type: 'STRING' } },
    headlines: { type: 'ARRAY', items: { type: 'STRING' } },
    descriptions: { type: 'ARRAY', items: { type: 'STRING' } },
    onImage: { type: 'OBJECT', properties: { kicker: { type: 'STRING' }, headline: { type: 'STRING' }, details: { type: 'STRING' } }, required: ['kicker', 'headline', 'details'] },
    why: { type: 'STRING' },
  },
  required: ['primaryText', 'headlines', 'descriptions', 'onImage', 'why'],
};

export interface CopyResult {
  primaryText: string[];
  headlines: string[];
  descriptions: string[];
  onImage: { kicker: string; headline: string; details: string };
  why: string;
}

export function copyPrompt(p: { subject: string; category: string; collection: string; name: string; brief?: string; goal: string; specs?: string; price?: string }): string {
  return [
    `The piece: ${p.name}${p.subject ? ` — ${p.subject}` : ''}. Category: ${p.category || 'jewellery'}. Collection: ${p.collection || '—'}.`,
    p.specs ? `Its facts, from the ERP (use exactly, or not at all): ${p.specs}.` : 'No karat, weight or stone figures are known — state none.',
    p.price ? `Its price, from the owner (use exactly, or not at all): ${p.price}.` : 'No price is given — state none.',
    `The ad's goal: ${p.goal}.`,
    p.brief ? `The owner's brief: ${p.brief}` : '',
    'Write three different primary texts, three headlines and three descriptions, and the words for the picture. Say in one line why these words suit this piece.',
  ].filter(Boolean).join('\n');
}

/**
 * Words the house still never lets through, caught after the model as well as asked of it:
 * sale and discount language, and hashtags. (Prices, specs and direct calls to action were
 * allowed by the owner on 2026-09-29.)
 */
export const breaksHouseRule = (text: string) => BRAND.banned.some(re => re.test(text));

/** The figures in a text (a karat, a weight, a carat, a rupee amount), to hold them against the ERP's own. */
export function figuresIn(text: string): string[] {
  const out = text.match(/\b\d{1,2}\s?(?:k|kt|karat)\b|\b\d+(?:\.\d+)?\s?(?:g|gm|gms|grams?|ct|carats?)\b|(?:rs\.?|pkr|₨)\s?[\d,]+(?:\.\d+)?/gi) ?? [];
  return out.map(f => f.toLowerCase().replace(/\s+/g, ''));
}

/** One way of writing each figure: 45.35 gm → 45.35g, 21 karat → 21k, PKR 1,000 → rs1,000. */
const normFigure = (f: string) => f.replace(/(gm|gms|grams?)$/, 'g').replace(/carats?$/, 'ct').replace(/(kt|karat)$/, 'k').replace(/^(rs\.?|pkr|₨)/, 'rs');
const unitOf = (f: string) => f.replace(/[\d.,]/g, '');
const valueOf = (f: string) => parseFloat(f.replace(/[^\d.]/g, ''));

/** Figures the text states that the given facts don't contain — what the model made up. */
export function inventedFigures(text: string, facts: string): string[] {
  const known = figuresIn(facts).map(normFigure);
  return figuresIn(text).map(normFigure).filter(f =>
    // "45.35g" in the text against "45.350g" in the facts is the same weight.
    !known.some(k => unitOf(k) === unitOf(f) && Math.abs(valueOf(k) - valueOf(f)) < 0.001));
}

// ── Check ──────────────────────────────────────────────────────────────────

export const CHECK_SYSTEM = `You are the creative director who signs off every ad for ${IDENTITY.name} before it spends money on Meta. You look at the finished ad image (and its words, when given) and give a straight verdict.

${brandBrief()}

HOW TO JUDGE
- verdict: "run" (ready), "fix" (worth running after the listed changes) or "dont" (breaks a hard rule, or would cost prestige).
- score 0–100 for how well it will do its job — stopping a scroll and opening a WhatsApp conversation — while protecting prestige.
- rules: go through each hard rule and say whether the ad keeps it (ok) with a short note when it does not.
- craft: the first second (does the piece read at thumbnail size?), hierarchy (one idea, one focal point), type (legible on a phone, the house's off-white not pure white, not crowded), the mark (one only, clear space, not on the busy part), colour (the house's palette; no stray colours), and for a story or reel whether anything that must be read sits in the top 14% or bottom 35%.
- figures: every karat, weight, carat or price on the ad must match the facts given; name any that doesn't. A rupee price shown on an ad that runs several days goes stale as the gold rate moves — say so if one is shown.
- fixes: concrete, in the order to do them, each one sentence.
- strengths: what to keep.`;

export const CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['run', 'fix', 'dont'] },
    score: { type: 'NUMBER' },
    summary: { type: 'STRING' },
    rules: { type: 'ARRAY', items: { type: 'OBJECT', properties: { rule: { type: 'STRING' }, ok: { type: 'BOOLEAN' }, note: { type: 'STRING' } }, required: ['rule', 'ok', 'note'] } },
    craft: { type: 'ARRAY', items: { type: 'OBJECT', properties: { aspect: { type: 'STRING' }, ok: { type: 'BOOLEAN' }, note: { type: 'STRING' } }, required: ['aspect', 'ok', 'note'] } },
    fixes: { type: 'ARRAY', items: { type: 'STRING' } },
    strengths: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['verdict', 'score', 'summary', 'rules', 'craft', 'fixes', 'strengths'],
};

export interface CheckVerdict {
  verdict: 'run' | 'fix' | 'dont';
  score: number;
  summary: string;
  rules: { rule: string; ok: boolean; note: string }[];
  craft: { aspect: string; ok: boolean; note: string }[];
  fixes: string[];
  strengths: string[];
}

export function checkPrompt(p: { format: string; text?: string; headline?: string; facts?: string }): string {
  return [
    `The ad is for ${p.format}.`,
    p.facts ? `The piece's facts from the ERP: ${p.facts}.` : 'The ERP gave no facts for this piece: any karat, weight or price on the ad is unverified — say so.',
    p.headline ? `Its headline field: "${p.headline}".` : '',
    p.text ? `Its primary text: "${p.text}".` : 'No primary text yet — judge the image alone.',
    `The hard rules to go through, one by one: ${HARD_RULES.join(' | ')}`,
  ].filter(Boolean).join('\n');
}

// ── Competitors ────────────────────────────────────────────────────────────

export const RIVAL_SYSTEM = `You are a paid-social strategist for ${IDENTITY.name}: ${IDENTITY.line} You study a competitor's recent Instagram posts — the images, their captions and how much engagement each earned — and say plainly what works for them, what does not, and what the house should do differently to win the same buyers without copying and without breaking its own rules.

${brandBrief()}`;

export const RIVAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    positioning: { type: 'STRING' },
    visualStyle: { type: 'STRING' },
    whatWorks: { type: 'ARRAY', items: { type: 'STRING' } },
    whatDoesnt: { type: 'ARRAY', items: { type: 'STRING' } },
    ourMoves: { type: 'ARRAY', items: { type: 'STRING' } },
    avoid: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['positioning', 'visualStyle', 'whatWorks', 'whatDoesnt', 'ourMoves', 'avoid'],
};
export interface RivalReading { positioning: string; visualStyle: string; whatWorks: string[]; whatDoesnt: string[]; ourMoves: string[]; avoid: string[] }

export const FIND_SYSTEM = `You find competitors for ${IDENTITY.name} — ${IDENTITY.line} Use Google Search. Return only real businesses you found evidence for: ${BRAND.competitors}, with their Instagram username exactly as it appears in their Instagram URL, their website if they have one, and one line on why they compete. Never invent a username; leave it empty if you did not see it.`;

export interface FoundCompetitor { name: string; instagram: string; website: string; city: string; why: string }

// ── Taheri's own winners ───────────────────────────────────────────────────

export const WINNERS_SYSTEM = `You analyse a jeweller's own Meta ads: the images of its best and worst ads over a period, each with its spend, results and cost per result. Say what the winners share and the losers lack — in the picture (piece, shot, crop, light, words on the image) and in the words — and turn it into rules for the next ads. Be specific to these images; no generic advice.

${brandBrief()}`;

export const WINNERS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    winnersShare: { type: 'ARRAY', items: { type: 'STRING' } },
    losersShare: { type: 'ARRAY', items: { type: 'STRING' } },
    nextAds: { type: 'ARRAY', items: { type: 'STRING' } },
    stop: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'STRING' },
  },
  required: ['headline', 'winnersShare', 'losersShare', 'nextAds', 'stop', 'confidence'],
};
export interface WinnersReading { headline: string; winnersShare: string[]; losersShare: string[]; nextAds: string[]; stop: string[]; confidence: string }

export { VOICE };

// ── Make it with AI ────────────────────────────────────────────────────────

/** The layouts the art director may choose (templates.ts), as it reads them. */
const TAHERI_LAYOUTS = [
  ['clean', 'the photo alone, the monogram low in a corner — for a photo strong enough to stand alone'],
  ['headline', 'a Didone headline over a soft shade at the bottom of the photo, specs and call to action beneath'],
  ['framed', 'the photo inset on the dark house ground in a fine frame, words beneath — for busy or catalogue photos'],
  ['heritage', '"Since 1989" above the photo in an arch, words beneath — heritage and trust'],
  ['band', 'a dark band across the lower part with the words — the most legible on a small screen'],
  ['certified', 'an "HRD Antwerp certified" badge over the photo — only for certified diamonds'],
] as const;
const MINA_LAYOUTS = [
  ['clean', 'the photo alone, the mark in a corner — for a photo strong enough to stand alone'],
  ['headline', 'a headline over a soft shade at the bottom of the photo, specs and call to action beneath'],
  ['framed', 'the photo inset on the dark house ground in a fine rose frame, words beneath'],
  ['heritage', 'the house’s name above the photo in an arch, words beneath'],
  ['band', 'a dark band across the lower part with the words — the most legible on a small screen'],
  ['certified', 'a "925 Sterling Silver" badge over the photo'],
] as const;
/** The layouts the art director may choose (templates.ts), as it reads them. */
export const LAYOUT_CHOICES: readonly (readonly [string, string])[] = BRAND.identity.name === 'taheri' ? TAHERI_LAYOUTS : MINA_LAYOUTS;

export const DIRECT_SYSTEM = `You are the art director making one Meta ad for ${IDENTITY.name} from one photograph. You choose the layout, write every word, and decide what the photograph needs — and the ERP lays it out exactly.

${brandBrief()}

LAYOUTS (choose one id): ${LAYOUT_CHOICES.map(([id, d]) => `${id} — ${d}`).join('; ')}.

WORDS: the ERP prints the piece's facts (metal, stones, weight) on their own line under the headline — never repeat them in the kicker or the headline. kicker (two to four words, small gold capitals — an occasion, a collection or a mood, not the metal), headline (at most six words, a Didone — statement pieces get statement words; no full stop), cta (the call to action on the picture: direct is fine, e.g. "Message us for today's price"), three primary texts (two sentences each; the first stands alone in 125 characters), three headlines for under the ad (at most 40 characters). Use the piece's figures only exactly as given; never invent one.

THE PHOTO: say whether it needs extending to the ad's shape (true when cropping to the shape would cut the piece or leave it tiny) and, only if its setting works against the piece, which new setting would suit it (a scene id from the list, else null).`;

export const DIRECT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    layout: { type: 'STRING', enum: LAYOUT_CHOICES.map(([id]) => id) },
    kicker: { type: 'STRING' },
    headline: { type: 'STRING' },
    cta: { type: 'STRING' },
    primaryText: { type: 'ARRAY', items: { type: 'STRING' } },
    adHeadlines: { type: 'ARRAY', items: { type: 'STRING' } },
    extend: { type: 'BOOLEAN' },
    scene: { type: 'STRING', nullable: true },
    why: { type: 'STRING' },
  },
  required: ['layout', 'kicker', 'headline', 'cta', 'primaryText', 'adHeadlines', 'extend', 'why'],
};

export interface Direction {
  layout: 'clean' | 'headline' | 'framed' | 'heritage' | 'band' | 'certified';
  kicker: string; headline: string; cta: string;
  primaryText: string[]; adHeadlines: string[];
  extend: boolean; scene: string | null; why: string;
}

export function directPrompt(p: { name: string; collection: string; specs: string; price: string; format: string; brief: string; scenes: string; destination: string }): string {
  return [
    `The piece: ${p.name || 'unnamed'}. Collection: ${p.collection || '—'}.`,
    p.specs ? `Its facts from the ERP (exact): ${p.specs}.` : 'No figures are known — state none.',
    p.price ? `Its price, from the owner (exact): ${p.price}.` : 'No price — state none.',
    `The ad is ${p.format}. People who press it go to ${p.destination}.`,
    p.brief ? `The owner's brief: ${p.brief}` : '',
    `Scenes for a new setting: ${p.scenes}.`,
    'Make the ad.',
  ].filter(Boolean).join('\n');
}

/** The whole ad painted by the image model: the piece kept exactly, the house's dress, the words spelled exactly. */
export function paintPrompt(p: { aspect: string; kicker: string; headline: string; specs: string; cta: string; story: boolean; brief: string }): string {
  const lines = [
    p.kicker && `a small line "${p.kicker}" in widely spaced capitals, colour ${VISUAL.gold}`,
    `the headline "${p.headline}" in an elegant high-contrast Didone serif, italic, colour ${VISUAL.bone}, large`,
    p.specs && `beneath it "${p.specs}" in a light, clean geometric sans-serif, colour ${VISUAL.bone}, about a third of the headline's size`,
    p.cta && `then "${p.cta}" small, colour ${VISUAL.lightGold}`,
  ].filter(Boolean);
  return [
    'The attached photograph is the real piece and must stay the real piece. Do not redraw, re-render, re-arrange or re-imagine the jewellery: keep it exactly as photographed — the same stones (each cluster, each cut, each colour), settings, links, arrangement, angle and proportions. Build the advertisement around the photograph instead: extend and darken its surroundings, relight gently, and add the frame and lettering.',
    `Design a finished jewellery advertisement for ${IDENTITY.name} at ${p.aspect}: the photographed piece is the hero, large and sharp — the metal gleaming, stones sparking — on a deep ground (${VISUAL.ground}) with a soft vignette and a fine hairline corner-accent frame in ${VISUAL.gold}; ${VISUAL.rules[0]}`,
    p.story ? 'It is a 9:16 story: keep every word and the piece between 14% from the top and 35% from the bottom; the top and bottom bands stay calm.' : '',
    `Set the lettering, stacked and centred in calm space away from the piece: ${lines.join('; ')}.`,
    p.brief ? `The owner's direction: ${p.brief}.` : '',
    'Spell every word and number exactly as given, character for character. Crisp, flat, perfectly legible lettering; no effects, no outlines, no shadows. Leave the top-right corner empty — the house adds its own mark.',
    'Avoid: any other text, logos, watermarks, price tags, discount bursts, stickers, extra jewellery, changes to the piece.',
  ].filter(Boolean).join(' ');
}
