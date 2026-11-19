'use client';

/**
 * Frequency of use (2026-11-19, the owner's motion list: "the more often something is used, the less animation you should
 * put in it"): true the first time this page is shown in this browser session, false after. A page's sections all mount
 * in the same moment, so the visit is noted a little after the first one asks: every section of that first showing
 * staggers, none of the next.
 */

import { useState } from 'react';

const KEY = 'erp-shown-pages';
const pending = new Set<string>();

function seen(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(KEY) || '[]') as string[]); } catch { return new Set(); }
}

export function useFirstShow(): boolean {
  const [first] = useState(() => {
    if (typeof window === 'undefined') return false;
    const page = window.location.pathname;
    if (pending.has(page)) return true;
    if (seen().has(page)) return false;
    pending.add(page);
    setTimeout(() => {
      try { const s = seen(); s.add(page); sessionStorage.setItem(KEY, JSON.stringify([...s].slice(-200))); } catch { /* private mode: every visit staggers */ }
      pending.delete(page);
    }, 1500);
    return true;
  });
  return first;
}
