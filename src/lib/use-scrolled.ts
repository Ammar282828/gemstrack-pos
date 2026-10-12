'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the page has scrolled past its top — the document, or an inner
 * scroller named by `inner` (the shell's <main> scrolls itself on some
 * screens). Drives the top bar's scroll edge under Liquid Glass: Apple's
 * appears only once content passes beneath the bar; drawn always, it tinted
 * the content column and not the sidebar's, a hard seam at the top of every
 * page (the owner, 2026-09-28: "there shouldn't be a cut at all in between").
 * False on the server and on the first client render, so hydration matches.
 */
export function useScrolled(inner?: string, threshold = 2): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => {
      const el = inner ? document.querySelector<HTMLElement>(inner) : null;
      setScrolled(window.scrollY > threshold || (el?.scrollTop ?? 0) > threshold);
    };
    read();
    // Capture: an inner scroller's scroll event does not bubble to the document.
    document.addEventListener('scroll', read, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', read, { capture: true });
  }, [inner, threshold]);
  return scrolled;
}

/**
 * True once the page's large title (the first <h1> under `scope`) has scrolled out of view above the
 * top bar, so the bar can show the title itself, as the app's navigation bar does. False until then,
 * and when the page has no <h1>. Re-reads when `key` (the pathname) changes.
 */
export function useTitleScrolledOut(scope: string, key: string): boolean {
  const [out, setOut] = useState(false);
  useEffect(() => {
    setOut(false);
    if (typeof IntersectionObserver === 'undefined') return;
    let io: IntersectionObserver | undefined;
    let tries = 0;
    let timer = 0;
    // The page paints its heading after the route changes: look for it for a moment.
    const find = () => {
      const h1 = document.querySelector<HTMLElement>(scope + ' h1');
      if (!h1) { if (tries++ < 20) timer = window.setTimeout(find, 100); return; }
      io = new IntersectionObserver(([e]) => setOut(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-56px 0px 0px 0px' });
      io.observe(h1);
    };
    timer = window.setTimeout(find, 0);
    return () => { clearTimeout(timer); io?.disconnect(); };
  }, [scope, key]);
  return out;
}
