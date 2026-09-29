/**
 * What the Ad studio knows about one photograph, and how photographs are ranked as ads.
 *
 * Every photo the studio can reach — taheri.shop's pieces and the shoots in the owner's
 * Google Drive — is looked at once by the vision model (assess.ts), which answers in the
 * shape below. `normalizeAssessment` is the gate between the model and the book: whatever
 * comes back is clamped, defaulted and trimmed here, so a malformed answer can never put
 * NaN in a score or an unknown fix on a button. Pure (tested).
 *
 * `rankForAds` turns assessments into picks for one placement: the placement's fit first,
 * the photograph's quality next, brand risks and burned-in text held against it, a piece
 * already running in an ad held back, and one collection never filling the whole row.
 */

/** Where an ad is seen, by its frame: feed square, feed portrait (4:5), stories and reels (9:16). */
export type Placement = 'square' | 'portrait' | 'story';
export const PLACEMENTS: readonly Placement[] = ['square', 'portrait', 'story'];
export const PLACEMENT_LABEL: Record<Placement, string> = { square: 'Feed 1:1', portrait: 'Feed 4:5', story: 'Stories & reels 9:16' };

export type ShotKind = 'packshot' | 'on-hand' | 'on-model' | 'lifestyle' | 'flatlay' | 'boxed' | 'graphic' | 'other';
const SHOTS: readonly ShotKind[] = ['packshot', 'on-hand', 'on-model', 'lifestyle', 'flatlay', 'boxed', 'graphic', 'other'];

export type Background = 'clean' | 'textured' | 'box' | 'busy';
const BACKGROUNDS: readonly Background[] = ['clean', 'textured', 'box', 'busy'];

/** What the studio can do about a photograph, each one a button that already exists in the ERP. */
export type FixCode = 'extend-portrait' | 'extend-story' | 'clear-labels' | 'retouch' | 'enhance' | 'restage' | 'crop-tighter';
export const FIXES: Record<FixCode, { label: string; why: string }> = {
  'extend-portrait': { label: 'Extend to 4:5', why: 'Feed ads show 4:5 largest; the photo needs room above and below.' },
  'extend-story': { label: 'Extend to 9:16', why: 'Stories and reels are 9:16; cropping this photo would cut the piece.' },
  'clear-labels': { label: 'Clear old labels', why: 'Burned-in labels and marks read as a catalogue shot; the maker can set the weight back cleanly.' },
  retouch: { label: 'Retouch', why: 'Soft detail on metal or stones; the upscaler sharpens without redrawing.' },
  enhance: { label: 'Enhance light', why: 'Flat or dim lighting; the metal should gleam and stones should spark.' },
  restage: { label: 'New setting', why: 'The background works against the piece; restage it on a clean set.' },
  'crop-tighter': { label: 'Crop tighter', why: 'The piece is small in the frame; on a phone it will be lost.' },
};

export interface AssetAssessment {
  /** 0–100: how ready it is to run as an ad as it stands. */
  score: number;
  /** 0–100 per placement: does the piece survive that frame, with room for the safe zones. */
  placements: Record<Placement, number>;
  /** One line: what the photograph shows. */
  subject: string;
  /** ring, bangle, necklace set, earrings, pendant, bracelet, chain, watch, set, other. */
  category: string;
  shot: ShotKind;
  background: Background;
  /** 0–10 each. */
  quality: { sharpness: number; lighting: number; composition: number; colour: number };
  /** Text on the photograph itself: a weight label, a watermark, a price. */
  burnedText: boolean;
  /** Things Taheri's own rules forbid in a public ad: sale text, another brand's mark, a meme look… */
  brandRisks: string[];
  strengths: string[];
  issues: string[];
  fixes: FixCode[];
  /** A headline it suggests, in the house's voice (no figures: the maker adds the ERP's own). */
  headline: string;
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? parseFloat(n) : NaN;
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
};
const text = (v: unknown, max = 160) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v: unknown, max = 5) => (Array.isArray(v) ? v.map(x => text(x, 140)).filter(Boolean).slice(0, max) : []);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v.toLowerCase()) ? v.toLowerCase() as T : fallback);

/** The model's answer, made safe to store and show. Returns null when there is nothing usable in it. */
export function normalizeAssessment(raw: unknown): AssetAssessment | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const p = (r.placements && typeof r.placements === 'object' ? r.placements : {}) as Record<string, unknown>;
  const q = (r.quality && typeof r.quality === 'object' ? r.quality : {}) as Record<string, unknown>;
  const score = clamp(r.score, 0, 100, NaN);
  if (!Number.isFinite(score)) return null;
  const fixes = (Array.isArray(r.fixes) ? r.fixes : [])
    .map(f => (typeof f === 'string' ? f.trim().toLowerCase() : ''))
    .filter((f): f is FixCode => f in FIXES);
  return {
    score,
    placements: {
      square: clamp(p.square, 0, 100, score),
      portrait: clamp(p.portrait, 0, 100, score),
      story: clamp(p.story, 0, 100, score),
    },
    subject: text(r.subject),
    category: text(r.category, 40).toLowerCase() || 'other',
    shot: oneOf(r.shot, SHOTS, 'other'),
    background: oneOf(r.background, BACKGROUNDS, 'textured'),
    quality: {
      sharpness: clamp(q.sharpness, 0, 10, 5),
      lighting: clamp(q.lighting, 0, 10, 5),
      composition: clamp(q.composition, 0, 10, 5),
      colour: clamp(q.colour, 0, 10, 5),
    },
    burnedText: r.burnedText === true || r.burnedText === 'true',
    brandRisks: list(r.brandRisks),
    strengths: list(r.strengths),
    issues: list(r.issues),
    fixes: [...new Set(fixes)],
    headline: text(r.headline, 90),
  };
}

export interface RankableAsset {
  id: string;
  collection: string;
  assessment: AssetAssessment | null;
  /** Running (or ran) in one of the account's ads. */
  usedInAds?: boolean;
}

/**
 * How good a photograph is as an ad in this placement, 0–100. Unassessed photographs are
 * not ranked (null). A brand risk costs more than burned-in text: the first breaks a rule
 * of the house's, the second only costs polish (and can be cleared).
 */
export function adScore(a: AssetAssessment, placement: Placement): number {
  const fit = a.placements[placement];
  const base = 0.55 * fit + 0.45 * a.score;
  const penalty = 18 * Math.min(2, a.brandRisks.length) + (a.burnedText ? 6 : 0) + (a.background === 'busy' ? 5 : 0);
  return Math.max(0, Math.min(100, Math.round(base - penalty)));
}

/**
 * The best photographs for a placement: by adScore, pieces already in an ad after the
 * rest, and no collection taking more than `perCollection` of the first `count`.
 */
export function rankForAds<T extends RankableAsset>(
  assets: readonly T[],
  opts: { placement: Placement; count?: number; perCollection?: number; minScore?: number },
): (T & { adScore: number })[] {
  const count = opts.count ?? 24;
  const perCollection = opts.perCollection ?? Math.max(2, Math.ceil(count / 4));
  const scored = assets
    .filter(a => a.assessment)
    .map(a => ({ ...a, adScore: adScore(a.assessment!, opts.placement) }))
    .filter(a => a.adScore >= (opts.minScore ?? 0))
    .sort((x, y) => Number(!!x.usedInAds) - Number(!!y.usedInAds) || y.adScore - x.adScore || x.id.localeCompare(y.id));
  const out: (T & { adScore: number })[] = [];
  const taken = new Map<string, number>();
  const held: (T & { adScore: number })[] = [];
  for (const a of scored) {
    if (out.length >= count) break;
    const n = taken.get(a.collection) ?? 0;
    if (n >= perCollection) { held.push(a); continue; }
    taken.set(a.collection, n + 1);
    out.push(a);
  }
  // A house with only a collection or two still fills the row, best first.
  for (const a of held) { if (out.length >= count) break; out.push(a); }
  return out;
}
