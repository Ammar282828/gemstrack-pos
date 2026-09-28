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
