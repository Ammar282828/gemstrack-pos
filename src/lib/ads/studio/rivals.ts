/**
 * The pure half of the competitor searcher and the account's own winners: reading
 * usernames, pulling the JSON out of a grounded answer, ranking a rival's posts by
 * how they did, and splitting Taheri's ads into what worked and what didn't.
 * Tested (rivals.test.ts).
 */

/** An Instagram username from whatever was typed or found: "@x", "instagram.com/x/", "X". Empty when it can't be one. */
export function cleanUsername(raw: string): string {
  let s = String(raw || '').trim();
  const m = s.match(/instagram\.com\/([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@+/, '').replace(/\/+$/, '').toLowerCase();
  if (['p', 'reel', 'reels', 'stories', 'explore', 'accounts'].includes(s)) return '';
  return /^[a-z0-9._]{1,30}$/.test(s) && !/^\.|\.$|\.\./.test(s) ? s : '';
}

/** The first JSON object in a model's text answer (a grounded answer can't be held to a schema). */
export function jsonIn<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)) as T; } catch { return null; }
    }
  }
  return null;
}

export interface RivalPost {
  id: string; caption: string; type: string; image: string | null; permalink: string | null;
  at: string | null; likes: number | null; comments: number | null;
}

/** Engagement a post earned, comments weighted (a comment is a conversation; a like is a thumb). Null when Meta hides the likes. */
export const engagement = (p: Pick<RivalPost, 'likes' | 'comments'>) => (p.likes === null ? null : p.likes + 3 * (p.comments ?? 0));

/** Per thousand followers, so accounts of different sizes compare. */
export const engagementRate = (p: Pick<RivalPost, 'likes' | 'comments'>, followers: number) => {
  const e = engagement(p);
  return e === null || !followers ? null : Math.round((e / followers) * 10000) / 10;
};

/** A rival's best and weakest posts with a picture: what the model is shown. */
export function bestAndWorst(posts: RivalPost[], best = 6, worst = 3): { best: RivalPost[]; worst: RivalPost[] } {
  const scored = posts.filter(p => p.image && engagement(p) !== null).sort((a, b) => engagement(b)! - engagement(a)!);
  if (!scored.length) return { best: posts.filter(p => p.image).slice(0, best), worst: [] };
  const top = scored.slice(0, best);
  const bottom = scored.length > best + 1 ? scored.slice(-Math.min(worst, scored.length - best)) : [];
  return { best: top, worst: bottom };
}

/** The Meta Ad Library, searched for a name, in Pakistan: every ad an advertiser runs, as the public sees it. */
export const adLibraryUrl = (q: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=PK&is_targeted_country=false&media_type=all&q=${encodeURIComponent(q)}&search_type=keyword_unordered`;

// ── Taheri's own ads ───────────────────────────────────────────────────────

export interface OwnAd { id: string; name: string; image: string | null; spend: number; results: number; resultLabel: string; ctr: number; body: string | null }
export interface RatedAd extends OwnAd { costPerResult: number | null }

/**
 * The ads worth learning from: enough spend to mean something (a tenth of the biggest
 * spender, and at least `floor`), with a picture. Winners are the cheapest results;
 * losers the dearest, and anything that spent and got nothing. Fewer than four ads can't
 * be compared honestly — `enough` says so.
 */
export function splitWinners(ads: OwnAd[], floor = 500): { winners: RatedAd[]; losers: RatedAd[]; enough: boolean; considered: number } {
  const max = Math.max(0, ...ads.map(a => a.spend));
  const min = Math.max(floor, max * 0.1);
  const rated: RatedAd[] = ads.filter(a => a.image && a.spend >= min)
    .map(a => ({ ...a, costPerResult: a.results > 0 ? a.spend / a.results : null }));
  const sorted = [...rated].sort((a, b) => (a.costPerResult ?? Infinity) - (b.costPerResult ?? Infinity) || b.ctr - a.ctr);
  const n = sorted.length;
  const k = Math.min(5, Math.max(1, Math.ceil(n / 3)));
  const winners = sorted.filter(a => a.costPerResult !== null).slice(0, k);
  const losers = sorted.slice(Math.max(winners.length, n - k)).reverse();
  return { winners, losers, enough: n >= 4 && winners.length > 0, considered: n };
}
