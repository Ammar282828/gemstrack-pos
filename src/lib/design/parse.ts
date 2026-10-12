/**
 * Smart input, the part that needs no network and no AI (plan §4.2): a pasted caption, a forwarded WhatsApp
 * message, a line typed at the counter -> the piece's words. Roman-Urdu (wazan, qeemat, tola, masha, ratti),
 * money (rs / k / lac / crore) and WhatsApp's forward noise are handled.
 *
 * The house rule (plan §6, brand.ts): **no figure appears that is not in the input.** Every field this
 * returns is built from the pasted words themselves, and the last step holds the result against the input
 * with `inventedFigures` (and `breaksHouseRule`) — a field that fails is dropped, with a warning. The same
 * test gates anything the AI adds (`acceptAiFields`). Pure; tested.
 */

import type { Fields } from '@/lib/social/editor';
import { pieceSpecs } from '@/lib/ads/studio/specs';
import { breaksHouseRule, inventedFigures } from '@/lib/ads/studio/prompts';
import { headlineOf } from '@/lib/website/site-photo';
import type { DesignKind } from './model';
import { findTolaWeights, parseMoney } from './units';

export type InputKind = 'text' | 'url' | 'image' | 'sku' | 'files';

export interface SnippetSpecs { karat?: string; metal?: string; stone?: string; weightG?: number; /** The weight as written ("2 tola 3 masha"). */ weightText?: string }
export interface SnippetPrice { amount: number; currency: 'PKR'; /** As written ("Rs 1.2 lac"). */ text: string }

export interface SnippetResult {
  name: string;
  fields: Partial<Fields>;
  specs: SnippetSpecs;
  price?: SnippetPrice;
  caption?: string;
  suggestedKind?: DesignKind;
  /** 0..1; under 0.6 the page asks the person. */
  confidence: number;
  warnings: string[];
  urls: string[];
}

// ── Cleaning ──────────────────────────────────────────────────────────────

const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
/** "[12/10/26, 3:45 PM] Ali:", "12/10/2026, 15:45 - Ali:", "1/2/26 3:45 pm - " … */
const WA_HEADER = /^\s*\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\]?\s*(?:[-–]\s*)?(?:[^:\n]{1,40}:\s*)?/i;
const WA_NOISE = /^\s*(?:_?\*?forwarded(?: many times)?\*?_?|<this message was edited>|\(?edited\)?|this message was deleted)\s*$/i;
const SENDER = /^\s*~\s*[^:\n]{1,40}:\s*/;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi;

export function urlsIn(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map(u => u.replace(/[.,;!?]+$/, '')))];
}

/** The text without WhatsApp's headers and forward notes, formatting marks, links and hashtags; a blank line where a message began. */
export function cleanForward(raw: string): { text: string; urls: string[] } {
  const urls = urlsIn(raw);
  const lines: string[] = [];
  for (let line of raw.replace(INVISIBLE, '').replace(/\r/g, '').split('\n')) {
    if (WA_NOISE.test(line)) continue;
    const had = WA_HEADER.test(line);
    line = line.replace(WA_HEADER, '').replace(SENDER, '');
    if (had) lines.push('');
    lines.push(line);
  }
  const text = lines.join('\n')
    .replace(URL_RE, ' ')
    .replace(/(^|\s)#[\p{L}\d_]+/gu, ' ')
    .replace(/[*_~`]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, urls };
}

// ── Facts ─────────────────────────────────────────────────────────────────

const METALS: [RegExp, string][] = [
  [/\brose[\s-]?gold\b/i, 'Rose Gold'], [/\bwhite[\s-]?gold\b/i, 'White Gold'], [/\byellow[\s-]?gold\b/i, 'Yellow Gold'],
  [/\b(?:gold|sona|sonay|sonai)\b/i, 'Gold'],
  [/\b(?:sterling(?:\s+silver)?|925(?:\s*(?:sterling|silver))?|(?:silver|chandi|chaandi)(?:\s*925)?)\b/i, '925 Silver'],
  [/\bplatinum\b/i, 'Platinum'], [/\bpalladium\b/i, 'Palladium'],
];
const STONES = ['ruby', 'emerald', 'diamond', 'polki', 'kundan', 'zircon', 'sapphire', 'pearl', 'moissanite', 'turquoise', 'firoza', 'yaqoot', 'panna', 'neelam', 'moti', 'heera', 'amethyst', 'garnet', 'opal', 'onyx', 'topaz', 'aquamarine', 'spinel', 'tanzanite', 'jade', 'coral', 'moonstone', 'citrine', 'peridot', 'american diamond', 'cubic zirconia', 'cz'];
const STONE_RE = new RegExp(`\\b(${STONES.sort((a, b) => b.length - a.length).join('|')})\\b`, 'i');
const NOT_NAME = /^(?:new arrivals?|just in|available|in stock|dm(?: to order| for order)?|order now|for orders?.*|contact.*|whatsapp.*|call.*|inbox.*|price|weight|details?|hello|hi|salam|assalam.*)\W*$/i;

const GRAM_RE = /(?<![\w.])(\d+(?:\.\d+)?)\s*(?:g|gm|gms|gr|grm|grms|gram|grams)\b\.?/gi;
const KARAT_RE = /(?<![\w.])(\d{1,2})\s?(?:k|kt|krt|karat|carat)\b/gi;
const UNITLESS_WEIGHT = /\b(?:wazan|wazn|vazan|weight|wt)\s*[:=\-]?\s*(\d+(?:\.\d+)?)(?!\s*(?:g|gm|gram|tola|masha|ratti|k\b))/i;
const MONEY_UNIT = String.raw`(?:k|lacs?|lakhs?|lack|crores?|cr|hazar|thousand)`;
const PRICE_RES: RegExp[] = [
  new RegExp(String.raw`(?:rs\.?|pkr|₨|rupees?|rupay[ae]?)\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(${MONEY_UNIT})?(?![\w])`, 'i'),
  new RegExp(String.raw`\b(?:price|qeemat|keemat|qimat|kimat|cost)\s*[:=\-]?\s*(?:rs\.?|pkr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(${MONEY_UNIT})?(?![\w])`, 'i'),
  new RegExp(String.raw`(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(lacs?|lakhs?|lack|crores?|hazar)\b`, 'i'),
  new RegExp(String.raw`(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(?:/-|rs\b|rupees\b|rupay[ae]?\b)`, 'i'),
  new RegExp(String.raw`(?<![\w.])(\d+(?:\.\d+)?)\s?(k)\b`, 'i'),
];

const karatOk = (n: number) => n >= 8 && n <= 24;

/** "21k" is a karat in a gold piece's text, not twenty-one thousand; in silver (925) a "9k" is money. */
function findPrice(text: string, silver: boolean): { price: SnippetPrice; span: string } | null {
  let best: { price: SnippetPrice; span: string; index: number } | null = null;
  for (const re of PRICE_RES) {
    for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
      if (m[2]?.toLowerCase() === 'k' && !/^\s*(?:rs|pkr)/i.test(m[0]) && /^\d+$/.test(m[1]) && karatOk(Number(m[1])) && !silver) continue;
      const amount = parseMoney(`${m[1]}${m[2] ? ` ${m[2]}` : ''}`);
      if (!amount || amount < 100) continue;
      if (!best || (m.index ?? 0) < best.index) best = { price: { amount, currency: 'PKR', text: m[0].trim().replace(/^[:=\-\s]+/, '') }, span: m[0], index: m.index ?? 0 };
      break;
    }
  }
  return best;
}

interface Facts { specs: SnippetSpecs; price?: SnippetPrice; spans: string[]; warnings: string[] }

/** Karat, metal, stone, weight and price out of one piece's text; `spans` are the words they came from. */
function factsOf(text: string): Facts {
  const spans: string[] = [];
  const warnings: string[] = [];
  const specs: SnippetSpecs = {};

  const tola = findTolaWeights(text);
  if (tola.length) {
    specs.weightG = tola[0].grams; specs.weightText = tola[0].text; spans.push(tola[0].text);
  } else {
    const g = [...text.matchAll(GRAM_RE)][0];
    if (g) { specs.weightG = Number(g[1]); specs.weightText = `${g[1]}g`; spans.push(g[0]); }
    else {
      const u = text.match(UNITLESS_WEIGHT);
      if (u) { specs.weightG = Number(u[1]); spans.push(u[0]); warnings.push(`The weight "${u[1]}" has no unit; read as grams, not put on the design. Check it.`); }
    }
  }
  for (const [re, label] of METALS) { const m = text.match(re); if (m) { specs.metal = label; break; } }
  const silver = specs.metal === '925 Silver';
  const price = findPrice(text, silver);
  if (price) spans.push(price.span);
  if (!silver) {
    for (const m of text.matchAll(KARAT_RE)) {
      const n = Number(m[1]);
      if (karatOk(n) && !(price && price.span.includes(m[0]))) { specs.karat = `${n}K`; spans.push(m[0]); break; }
    }
  }
  const st = text.match(STONE_RE);
  if (st) specs.stone = st[1].toLowerCase() === 'cz' ? 'CZ' : st[1].replace(/\b\w/g, c => c.toUpperCase());
  return { specs, price: price?.price, spans, warnings };
}

/** The specs line ("21K Gold · Ruby · 12.35g"), built from the facts found: grams as written, a tola weight in its own words. */
export function specsLine(s: SnippetSpecs): string {
  const base = pieceSpecs({ karat: s.karat, metal: s.metal, stone: s.stone, weightGrams: null });
  const w = s.weightText ?? '';
  return [base, w].filter(Boolean).join(' · ');
}

// ── Name ──────────────────────────────────────────────────────────────────

const LABEL = /\b(?:wazan|wazn|vazan|weight|wt|price|qeemat|keemat|qimat|kimat|cost|karat|carat|name|design|item)\b\s*[:=\-]?/gi;
const emojiStrip = (s: string) => s.replace(/[\p{Extended_Pictographic}️⃣]/gu, ' ');

function nameFrom(text: string, spans: string[]): string {
  for (const raw of text.split('\n')) {
    let line = emojiStrip(raw);
    for (const sp of spans) line = line.replace(sp, ' ');
    line = line.replace(/\b925\b/g, ' ').replace(LABEL, ' ').replace(/^\s*(?:\d{1,2}[.)]|[•·▪◦►➤*>-])\s+/, '')
      .replace(/[|•·▪–—:;,=]+/g, ' ').replace(/\s-\s/g, ' ').replace(/\s+/g, ' ').trim();
    line = line.replace(/^(?:and|aur|with|k sath|ka|ki|ke)\s+|\s+(?:and|aur|with|ka|ki|ke)$/gi, '').trim();
    if (!/\p{L}{3,}/u.test(line) || NOT_NAME.test(line)) continue;
    if (/^\W*(?:collection|set no|ref)\b/i.test(line) && line.split(' ').length < 2) continue;
    if (line.split(' ').length > 9 || line.length > 80) return '';
    return line;
  }
  return '';
}

// ── One piece, many pieces ─────────────────────────────────────────────────

const hasFact = (t: string) => { const f = factsOf(t); return !!(f.specs.weightG || f.price || f.specs.karat); };

/** Blocks of a paste that are separate pieces: a blank line, a new WhatsApp message, or a numbered/bulleted list. */
export function splitPieces(text: string): string[] {
  let blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  if (blocks.length < 2) {
    const lines = text.split('\n');
    const starts = lines.filter(l => /^\s*(?:\d{1,2}[.)]|[•▪◦➤]|[-*]\s)\s*\S/.test(l)).length;
    if (starts >= 2) {
      blocks = [];
      for (const l of lines) {
        if (/^\s*(?:\d{1,2}[.)]|[•▪◦➤]|[-*]\s)\s*\S/.test(l) || !blocks.length) blocks.push(l); else blocks[blocks.length - 1] += `\n${l}`;
      }
    }
  }
  const withFacts = blocks.filter(hasFact);
  if (withFacts.length < 2) return [text];
  // A block with no facts of its own (a lone name line before its facts, a closing "DM to order") rides with the next piece.
  const out: string[] = [];
  let carry = '';
  for (const b of blocks) {
    if (hasFact(b)) { out.push(carry ? `${carry}\n${b}` : b); carry = ''; }
    else if (out.length === 0 || b.split('\n').length === 1 && !NOT_NAME.test(b)) carry = carry ? `${carry}\n${b}` : b;
  }
  return out.length >= 2 ? out : [text];
}

const KIND_HINTS: [RegExp, DesignKind][] = [
  [/\bstor(?:y|ies)\b/i, 'story'], [/\bwhats\s?app\b|\bstatus\b/i, 'whatsapp'], [/\b(?:instagram post|post|square)\b/i, 'post'], [/\b(?:ad|ads|meta)\b/i, 'ad'],
];

/** One piece's text -> its words. */
export function parseSnippet(raw: string): SnippetResult {
  const { text, urls } = cleanForward(raw);
  return parseCleaned(text, urls, raw);
}

function parseCleaned(text: string, urls: string[], original: string): SnippetResult {
  const warnings: string[] = [];
  const facts = factsOf(text);
  warnings.push(...facts.warnings);
  let name = nameFrom(text, facts.spans);
  if (name && breaksHouseRule(name)) { warnings.push(`"${name}" has words the house doesn't use in public (sale, discount, hashtags). Not used.`); name = ''; }
  const headline = headlineOf(name);

  const fields: Partial<Fields> = {};
  if (headline) fields.headline = headline;
  const line = specsLine(facts.specs);
  if (line) fields.weight = line;
  const coll = text.match(/\bcollection\s*[:\-]\s*([^\n]{2,40})/i);
  if (coll) fields.kicker = coll[1].trim();

  // The rule: nothing on the design that the input does not say.
  for (const k of Object.keys(fields) as (keyof Fields)[]) {
    const bad = inventedFigures(fields[k] ?? '', text);
    if (bad.length) { warnings.push(`Left out ${k}: ${bad.join(', ')} isn't in what you pasted.`); delete fields[k]; }
  }

  const lines = text.split('\n').filter(l => l.trim());
  let caption: string | undefined;
  if (lines.length > 1 && text.length <= 2000) {
    if (breaksHouseRule(text)) warnings.push('The text has sale or discount words; the caption is left for you to write.');
    else caption = text;
  }
  const hint = KIND_HINTS.find(([re]) => re.test(original))?.[1];
  const found = [headline ? 0.3 : 0, facts.specs.weightG ? 0.25 : 0, facts.specs.karat || facts.specs.metal ? 0.15 : 0, facts.price ? 0.15 : 0, facts.specs.stone ? 0.15 : 0].reduce((a, b) => a + b, 0);
  const confidence = Math.min(1, Math.round((found + (found > 0 && text.length > 400 ? -0.1 : 0)) * 100) / 100);
  return { name: headline || name, fields, specs: facts.specs, ...(facts.price ? { price: facts.price } : {}), ...(caption ? { caption } : {}), ...(hint ? { suggestedKind: hint } : {}), confidence: Math.max(0, confidence), warnings, urls };
}

/** A paste with several pieces in it: one result each (a single piece comes back as a list of one). */
export function parseMany(raw: string): SnippetResult[] {
  const { text, urls } = cleanForward(raw);
  const parts = splitPieces(text);
  return parts.map(p => parseCleaned(p, parts.length === 1 ? urls : urlsIn(p), raw));
}

// ── What kind of thing was pasted ──────────────────────────────────────────

const SKU_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/;
const NOT_SKU = /^(?:dsc|img|pxl|mvimg|photo|image|screenshot)[\s_-]?\d|^\d+(?:\.\d+)?(?:g|gm|gms|k|kt|tola|masha|ratti|lac|lakh|crore|cr)$|^(?:925|\d{1,2}k)$/i;

export function looksLikeSku(s: string): boolean {
  const t = s.trim();
  return SKU_RE.test(t) && !NOT_SKU.test(t);
}

/** text | url | sku: a lone link is a url, a lone code a sku, anything else text (links inside it are listed in `urls`). */
export function classifyInput(raw: string): { kind: 'text' | 'url' | 'sku'; urls: string[] } {
  const t = raw.replace(INVISIBLE, '').trim();
  const urls = urlsIn(t);
  if (urls.length >= 1) {
    const rest = t.replace(URL_RE, ' ').replace(/[\s,;|]+/g, ' ').trim();
    if (rest.length < 4) return { kind: 'url', urls };
    return { kind: 'text', urls };
  }
  if (looksLikeSku(t)) return { kind: 'sku', urls };
  return { kind: 'text', urls };
}

// ── Holding the AI to the same rules ───────────────────────────────────────

export interface AiFields {
  kicker?: string; headline?: string; weight?: string; details?: string;
  karat?: string; metal?: string; stone?: string; weightG?: number; priceAmount?: number;
  suggestedKind?: string;
}

const numbersIn = (t: string) => (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * What the AI answered, kept only where it passes the house rules against the pasted text: no figure the
 * text lacks, no sale words, a weight or price only if it is in the text (a number written there, or the
 * conversion of tola/masha/ratti or lac/crore written there). The deterministic result wins where it has a value.
 */
export function acceptAiFields(base: SnippetResult, ai: AiFields, input: string): SnippetResult {
  const { text } = cleanForward(input);
  const out: SnippetResult = { ...base, fields: { ...base.fields }, specs: { ...base.specs }, warnings: [...base.warnings] };
  const nums = numbersIn(text);
  const tolaG = findTolaWeights(text).map(w => w.grams);
  for (const k of ['kicker', 'headline', 'weight', 'details'] as const) {
    const v = (ai[k] ?? '').trim().slice(0, 200);
    if (!v || out.fields[k]) continue;
    if (breaksHouseRule(v)) { out.warnings.push(`AI's ${k} had words the house doesn't use; left out.`); continue; }
    const bad = inventedFigures(v, text);
    if (bad.length) { out.warnings.push(`AI's ${k} had ${bad.join(', ')}, which isn't in what you pasted; left out.`); continue; }
    out.fields[k] = v;
  }
  if (out.specs.weightG === undefined && typeof ai.weightG === 'number' && ai.weightG > 0
    && (nums.some(n => Math.abs(n - ai.weightG!) < 0.001) || tolaG.some(g => Math.abs(g - ai.weightG!) < 0.002))) out.specs.weightG = ai.weightG;
  if (!out.price && typeof ai.priceAmount === 'number' && ai.priceAmount > 0) {
    const ok = nums.some(n => [1, 1e3, 1e5, 1e7].some(m => Math.abs(n * m - ai.priceAmount!) < 1));
    if (ok) out.price = { amount: ai.priceAmount, currency: 'PKR', text: '' };
  }
  if (!out.specs.karat && ai.karat && karatOk(parseInt(ai.karat, 10)) && new RegExp(`\\b${parseInt(ai.karat, 10)}\\s?(?:k|kt|karat|carat)`, 'i').test(text)) out.specs.karat = `${parseInt(ai.karat, 10)}K`;
  if (!out.specs.metal && ai.metal && METALS.some(([re, l]) => l.toLowerCase() === ai.metal!.toLowerCase() && re.test(text))) out.specs.metal = ai.metal;
  if (!out.specs.stone && ai.stone && text.toLowerCase().includes(ai.stone.toLowerCase())) out.specs.stone = ai.stone;
  if (!out.fields.weight) { const l = specsLine(out.specs); if (l && !inventedFigures(l, text).length) out.fields.weight = l; }
  const kind = (['piece', 'ad', 'story', 'post', 'whatsapp', 'site', 'custom'] as const).find(k => k === ai.suggestedKind);
  if (kind && !out.suggestedKind) out.suggestedKind = kind;
  return out;
}

// ── What the routes answer with ────────────────────────────────────────────

/** A photo the page should fetch: `site:<id>` (a website piece's original, via /api/website/site-pieces/image), `url:<https…>` (via /api/design/fetch), `sku:<sku>`. */
export interface ParsedPhoto { ref: string; role: 'main' | 'alt' }
export interface ParsedPiece {
  name: string;
  fields: Partial<Fields>;
  specs: SnippetSpecs;
  price?: SnippetPrice;
  piece?: { siteId?: string; productId?: string; name: string; collection?: string; url?: string };
  photos: ParsedPhoto[];
  caption?: string;
  suggestedKind?: DesignKind;
  confidence: number;
  warnings: string[];
}
export interface ParseResponse {
  kind: InputKind;
  /** More than one when a paste held several pieces: one design each. */
  pieces: ParsedPiece[];
  /** The AI helped read it (a deterministic read is always made first). */
  usedAi: boolean;
  /** A Drive folder link: the owner can add it as a folder. */
  drive?: { folderId: string };
  warnings: string[];
}

export const toPiece = (r: SnippetResult, photos: ParsedPhoto[] = [], piece?: ParsedPiece['piece']): ParsedPiece => ({
  name: r.name, fields: r.fields, specs: r.specs, ...(r.price ? { price: r.price } : {}), ...(piece ? { piece } : {}),
  photos, ...(r.caption ? { caption: r.caption } : {}), ...(r.suggestedKind ? { suggestedKind: r.suggestedKind } : {}),
  confidence: r.confidence, warnings: r.warnings,
});

// ── Dropped files, grouped by piece ────────────────────────────────────────

export interface DroppedFile { name: string; lastModified?: number }
const SHOT = /^([A-Za-z]{2,5})[_-]?(\d{3,6})(?=$|[^\d])/;

/**
 * Which dropped photos are one piece: a camera sequence (DSC09342, DSC09343 …) shot within 90 seconds of
 * each other (or, with no times, numbered within 1), or files named alike ("ruby-1.jpg", "ruby-2.jpg").
 * Returns indices into `files`, in the order given; the first of a group is its main photo.
 */
export function groupByPiece(files: DroppedFile[]): number[][] {
  const order = files.map((f, i) => ({ f, i }));
  const stem = (n: string) => n.replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase().replace(/[\s_-]*(?:\(\d+\)|\d{1,2})$/, '').trim();
  const groups: number[][] = [];
  const camera = order.filter(o => SHOT.test(o.f.name.split('/').pop() ?? '')).sort((a, b) => {
    const ma = (a.f.name.match(SHOT)!), mb = (b.f.name.match(SHOT)!);
    return ma[1].localeCompare(mb[1]) || Number(ma[2]) - Number(mb[2]);
  });
  let cur: typeof camera = [];
  const flush = () => { if (cur.length) groups.push(cur.map(c => c.i)); cur = []; };
  for (const o of camera) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const pm = prev.f.name.match(SHOT)!, om = o.f.name.match(SHOT)!;
      const near = pm[1] === om[1] && Number(om[2]) - Number(pm[2]) <= 1;
      const dt = typeof prev.f.lastModified === 'number' && typeof o.f.lastModified === 'number' ? Math.abs(o.f.lastModified - prev.f.lastModified) : 0;
      if (!near || dt > 90_000) flush();
    }
    cur.push(o);
  }
  flush();
  const named = new Map<string, number[]>();
  for (const o of order) {
    if (SHOT.test(o.f.name.split('/').pop() ?? '')) continue;
    const k = stem(o.f.name) || o.f.name;
    named.set(k, [...(named.get(k) ?? []), o.i]);
  }
  groups.push(...named.values());
  return groups.sort((a, b) => a[0] - b[0]);
}
