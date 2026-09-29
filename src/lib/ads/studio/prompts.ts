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

import { brandBrief, HARD_RULES, VOICE } from './brand';

// ── Copy ───────────────────────────────────────────────────────────────────

export const COPY_SYSTEM = `You write Meta ads (Instagram and Facebook) for a luxury jeweller.

${brandBrief()}

THE INSTAGRAM CAPTION FORMULA, which the ad's primary text follows: two sentences — one concrete observation about the work, one about how it is worn — then, about half the time, a closing thought of four to seven words as its own paragraph. Two sentences is the target, three the ceiling. Copy complements the picture; never describe what the reader can already see. No hashtags, no emoji inside sentences, no phone numbers, no prices, no karats or weights.

META'S FIELDS: primary text shows about 125 characters before "more", so the first sentence must stand on its own; headline at most 40 characters; description at most 30. The ad's button opens a WhatsApp conversation, so the words invite a conversation — softly.

ON THE PICTURE: a kicker (two to four words, set in small gold capitals), a headline (at most six words, set large in a Didone) and a details line (one soft call to action from the house's list). Statement pieces get statement words.`;

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

export function copyPrompt(p: { subject: string; category: string; collection: string; name: string; brief?: string; goal: string }): string {
  return [
    `The piece: ${p.name}${p.subject ? ` — ${p.subject}` : ''}. Category: ${p.category || 'jewellery'}. Collection: ${p.collection || '—'}.`,
    `The ad's goal: ${p.goal}.`,
    p.brief ? `The owner's brief: ${p.brief}` : '',
    'Write three different primary texts, three headlines and three descriptions, and the words for the picture. Say in one line why these words suit this piece.',
  ].filter(Boolean).join('\n');
}

/** Words the house never lets through in public, caught after the model as well as asked of it. */
const BANNED = [
  /\b(1[48]|2[124])\s?(k|kt|karat|carat)\b/i, /\b\d+(\.\d+)?\s?(g|gm|gms|grams?)\b/i, /\b\d+(\.\d+)?\s?ct\b/i,
  /\b(rs\.?|pkr|₨)\s?[\d,]+/i, /\bshop now\b/i, /\bbuy now\b/i, /\blimited time\b/i, /\b(sale|discount|% off)\b/i,
  /#[a-z]/i, /\+?92\s?\d{3}/, /\b0\d{3}\s?\d{7}\b/, /\b(vs1|vvs|gia|4cs)\b/i,
];
export const breaksHouseRule = (text: string) => BANNED.some(re => re.test(text));

// ── Check ──────────────────────────────────────────────────────────────────

export const CHECK_SYSTEM = `You are the creative director who signs off every ad for a luxury jeweller before it spends money on Meta. You look at the finished ad image (and its words, when given) and give a straight verdict.

${brandBrief()}

HOW TO JUDGE
- verdict: "run" (ready), "fix" (worth running after the listed changes) or "dont" (breaks a hard rule, or would cost prestige).
- score 0–100 for how well it will do its job — stopping a scroll and opening a WhatsApp conversation — while protecting prestige.
- rules: go through each hard rule and say whether the ad keeps it (ok) with a short note when it does not.
- craft: the first second (does the piece read at thumbnail size?), hierarchy (one idea, one focal point), type (legible on a phone, bone not white, not crowded), the mark (one only, clear space, not on the busy part), colour (gold and the dark ground; no stray palettes), and for a story or reel whether anything that must be read sits in the top 14% or bottom 35%.
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

export function checkPrompt(p: { format: string; text?: string; headline?: string }): string {
  return [
    `The ad is for ${p.format}.`,
    p.headline ? `Its headline field: "${p.headline}".` : '',
    p.text ? `Its primary text: "${p.text}".` : 'No primary text yet — judge the image alone.',
    `The hard rules to go through, one by one: ${HARD_RULES.join(' | ')}`,
  ].filter(Boolean).join('\n');
}

// ── Competitors ────────────────────────────────────────────────────────────

export const RIVAL_SYSTEM = `You are a paid-social strategist for a luxury Bohra family jeweller in Karachi. You study a competitor's recent Instagram posts — the images, their captions and how much engagement each earned — and say plainly what works for them, what does not, and what the house should do differently to win the same buyers without copying and without breaking its own rules.

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

export const FIND_SYSTEM = `You find competitors for a luxury gold and diamond jeweller in Karachi, Pakistan (taheri, @collectionstaheri — a Bohra family house since 1989). Use Google Search. Return only real businesses you found evidence for: jewellers selling fine gold and diamond jewellery to the same buyers (Karachi first, then Pakistan's premium names), with their Instagram username exactly as it appears in their Instagram URL, their website if they have one, and one line on why they compete. Never invent a username; leave it empty if you did not see it.`;

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
