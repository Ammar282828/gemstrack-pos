'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Long lists drawn a page at a time (owner, 2026-11-08: "not snappy or smooth"). Drawn whole, the
 * Orders tab built its entire history before anything changed on screen: ~0.8 s of React and ~1.6 s
 * of style and layout at a phone's speed, the tab not even lit until it finished, and the same again
 * on Back. Now the first rows draw at once and the next page as the end nears the screen.
 *
 * How many are drawn is kept per page for the visit (sessionStorage), so Back returns to the same
 * length and the browser can put the scroll back where it was.
 */
const PAGE = 40;

function readShown(key: string): number {
  try { const n = Number(sessionStorage.getItem('grow:' + key)); return n > PAGE ? n : PAGE; } catch { return PAGE; }
}

export function useGrowing(key: string, total: number): { shown: number; sentinel: React.ReactNode } {
  const [shown, setShown] = useState(() => (typeof window === 'undefined' ? PAGE : readShown(key)));
  const ref = useRef<HTMLDivElement>(null);
  const more = shown < total;
  useEffect(() => {
    try { sessionStorage.setItem('grow:' + key, String(shown)); } catch { /* private mode */ }
  }, [key, shown]);
  useEffect(() => {
    const el = ref.current;
    if (!more || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setShown(n => n + PAGE * 2); }, { rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown]);
  const sentinel = more ? React.createElement('div', { ref, 'aria-hidden': true, className: '!border-0 !p-0 h-px' }) : null;
  return { shown, sentinel };
}

/**
 * The sections with `drawn`, the rows to draw, so that no more than `limit` are drawn in all (a
 * section may be cut part-way). `rows` stays whole, for the section's count and total.
 */
export function takeRows<S extends { rows: unknown[] }>(sections: S[], limit: number): Array<S & { drawn: S['rows'] }> {
  const out: Array<S & { drawn: S['rows'] }> = [];
  let left = limit;
  for (const s of sections) {
    if (left <= 0) break;
    out.push({ ...s, drawn: (s.rows.length <= left ? s.rows : s.rows.slice(0, left)) as S['rows'] });
    left -= s.rows.length;
  }
  return out;
}

/** Whether the screen is lg (1024px) or wider: the table, not the app's rows. False until mounted. */
export function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const read = () => setWide(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  return wide;
}
