/**
 * What went out, in the counter's terms: the send log (`social_posts`, one row per photo per
 * destination — Post a Piece, the hub's website pieces, the queue and the Instagram story all write
 * it) gathered into one line per piece, for the Posts hub's "Out today".
 *
 * A piece is its website piece, its queue entry, or its file name, sent within a few minutes; an
 * Instagram story (which logs no piece) joins the send nearest to it, as Post a Piece sends it with
 * the WhatsApp post. Pure, so it is tested.
 */

export interface SentRow {
  at: string;
  destination: string;
  sitePiece?: string;
  queue?: string;
  fileName?: string;
  caption?: string;
}

export interface Sent {
  key: string;
  /** The last send of the piece. */
  at: string;
  title: string;
  sitePiece?: string;
  /** Log names ("whatsapp-community", "whatsapp-channel", "whatsapp-group:diamonds", "instagram-story"), in the order they went. */
  destinations: string[];
}

/** A send this close to the piece's last one is the same piece going somewhere else. */
const SAME_MS = 10 * 60_000;
/** An Instagram story this close to a send is that piece's story. */
const STORY_MS = 5 * 60_000;

/** "✨ *Open Loop Bead Bracelet* — _21K_" → "Open Loop Bead Bracelet"; else the file's name in words. */
export function titleOf(r: Pick<SentRow, 'caption' | 'fileName'>): string {
  const first = (r.caption || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  const bold = first.match(/\*([^*]+)\*/);
  const words = (bold ? bold[1] : first.replace(/^[^\p{L}\p{N}]+/u, '')).trim();
  if (words) return words.slice(0, 120);
  const file = (r.fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return file ? file.charAt(0).toUpperCase() + file.slice(1) : '';
}

export function groupSends(rows: readonly SentRow[]): Sent[] {
  const sorted = [...rows].filter(r => r?.at && r.destination).sort((a, b) => a.at.localeCompare(b.at));
  const out: (Sent & { first: number; last: number; story: boolean })[] = [];
  const stories: SentRow[] = [];
  for (const r of sorted) {
    if (r.destination === 'instagram-story' && !r.sitePiece && !r.fileName) { stories.push(r); continue; }
    const key = r.sitePiece ? `site:${r.sitePiece}` : r.queue ? `queue:${r.queue}` : `file:${r.fileName || r.at}`;
    const t = Date.parse(r.at);
    const g = out.find(x => x.key === key && t - x.last <= SAME_MS);
    if (g) {
      g.last = t; g.at = r.at;
      if (!g.destinations.includes(r.destination)) g.destinations.push(r.destination);
      if (!g.title) g.title = titleOf(r);
    } else {
      out.push({ key, at: r.at, first: t, last: t, story: false, title: titleOf(r), destinations: [r.destination], ...(r.sitePiece ? { sitePiece: r.sitePiece } : {}) });
    }
  }
  for (const s of stories) {
    const t = Date.parse(s.at);
    const near = out.filter(g => !g.story && t >= g.first - STORY_MS && t <= g.last + STORY_MS)
      .sort((a, b) => Math.abs(t - a.last) - Math.abs(t - b.last))[0];
    if (near) { near.story = true; near.destinations.push('instagram-story'); if (t > near.last) { near.last = t; near.at = s.at; } }
    else out.push({ key: `story:${s.at}`, at: s.at, first: t, last: t, story: true, title: '', destinations: ['instagram-story'] });
  }
  return out.sort((a, b) => b.last - a.last).map(({ first: _f, last: _l, story: _s, ...g }) => g);
}
