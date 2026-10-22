/**
 * What the house's site tells the ERP about each piece, anonymously: opened, looked at for how
 * long, saved (the heart), unsaved, asked about on WhatsApp. No person, no cookie, no account —
 * a count per piece and per day, in `piece_stats/<piece>` (the piece key with `/` as `~`).
 *
 * The sites send a batch with navigator.sendBeacon as text/plain (a simple request, so no
 * preflight): `{"e":[["view","mina/piece/leah"],["dwell","mina/piece/leah",8400],…]}`.
 * Read by the Website → Interest screen (/api/website/interest).
 */

export const EVENT_TYPES = ['view', 'dwell', 'save', 'unsave', 'enquire'] as const;
export type EventType = typeof EVENT_TYPES[number];

export const PIECE_STATS = 'piece_stats';
const MAX_EVENTS = 50;
/** A minute-long glance counts; a tab left open overnight does not count as a night of looking. */
const MAX_DWELL_MS = 10 * 60_000;
const MIN_DWELL_MS = 1_000;
/** The site's own key (SitePiece.id): `mina/piece/<handle>`, or taheri.shop's photo path ("Rings & Bands/Bands/Band 147.webp"). */
const PIECE_KEY = /^[^\s./\\\u0000-\u001f][^\\\u0000-\u001f]{0,299}$/;

export interface PieceTally { views: number; dwellMs: number; dwellN: number; saves: number; unsaves: number; enquiries: number }
const empty = (): PieceTally => ({ views: 0, dwellMs: 0, dwellN: 0, saves: 0, unsaves: 0, enquiries: 0 });

/** The body, parsed and summed per piece. Anything malformed is dropped, never thrown. */
export function tallyEvents(raw: unknown): Map<string, PieceTally> {
  const out = new Map<string, PieceTally>();
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { e?: unknown }).e) ? (raw as { e: unknown[] }).e : [];
  for (const ev of list.slice(0, MAX_EVENTS)) {
    if (!Array.isArray(ev)) continue;
    const [type, piece, ms] = ev as [unknown, unknown, unknown];
    if (!EVENT_TYPES.includes(type as EventType) || typeof piece !== 'string' || !PIECE_KEY.test(piece) || piece.includes('..')) continue;
    const t = out.get(piece) ?? empty();
    switch (type as EventType) {
      case 'view': t.views++; break;
      case 'save': t.saves++; break;
      case 'unsave': t.unsaves++; break;
      case 'enquire': t.enquiries++; break;
      case 'dwell': {
        const n = Math.round(Number(ms));
        if (!Number.isFinite(n) || n < MIN_DWELL_MS) continue;
        t.dwellMs += Math.min(n, MAX_DWELL_MS); t.dwellN++;
        break;
      }
    }
    out.set(piece, t);
  }
  return out;
}

export const statsDocId = (piece: string) => piece.replace(/\//g, '~');

/** Karachi's date, so a day is the shop's day. */
export const karachiDay = (d = new Date()) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);

export interface PieceStats extends PieceTally { piece: string; lastAt?: string; days?: Record<string, Partial<PieceTally>> }

/** Totals over the last `days` days (from the per-day counts), or all time when days is 0. */
export function windowed(s: PieceStats, days: number, today = karachiDay()): PieceTally {
  if (!days) return { views: s.views || 0, dwellMs: s.dwellMs || 0, dwellN: s.dwellN || 0, saves: s.saves || 0, unsaves: s.unsaves || 0, enquiries: s.enquiries || 0 };
  const from = new Date(Date.parse(today) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const t = empty();
  for (const [day, d] of Object.entries(s.days || {})) {
    if (day < from || day > today) continue;
    for (const k of Object.keys(t) as (keyof PieceTally)[]) t[k] += Number(d[k]) || 0;
  }
  return t;
}
