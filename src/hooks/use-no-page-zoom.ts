'use client';

import { useEffect } from 'react';

/**
 * While `on`, a trackpad pinch or ⌘/Ctrl + scroll never zooms the browser's page (2026-10-16, owner: "my trackpad
 * zooming shouldn't zoom the page in"). Chrome, Edge and Firefox send a pinch as a wheel event with ctrlKey;
 * Safari sends gesturestart/gesturechange instead. Screens that zoom their own canvas (the board, the designer)
 * still get the events: this only stops the browser's default, on every part of the page (the panels and bars
 * round a canvas included), and ⌘+ / ⌘− / ⌘0 are left to the screen's own keys.
 */
export function useNoPageZoom(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    const gesture = (e: Event) => e.preventDefault();
    window.addEventListener('wheel', wheel, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, gesture, { passive: false } as AddEventListenerOptions);
    return () => {
      window.removeEventListener('wheel', wheel);
      for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.removeEventListener(t, gesture);
    };
  }, [on]);
}

/** A wheel event's vertical step in pixels (Firefox can count lines or pages), kept to one notch's worth. */
export function wheelPx(e: WheelEvent, page = 800, max = 40): number {
  const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1);
  return Math.max(-max, Math.min(max, d));
}

/**
 * Fingers on the glass over `el`. Safari also sends gesture events for a two-finger touch pinch, which a screen's
 * own touch handling already zooms; its gesture handler skips while any finger is down, so a trackpad pinch is
 * counted once and a touch pinch is not counted twice.
 */
export function fingersOn(el: HTMLElement): { down: () => boolean; stop: () => void } {
  let n = 0;
  const set = (e: TouchEvent) => { n = e.touches.length; };
  for (const t of ['touchstart', 'touchend', 'touchcancel'] as const) el.addEventListener(t, set, { passive: true });
  return {
    down: () => n > 0,
    stop: () => { for (const t of ['touchstart', 'touchend', 'touchcancel'] as const) el.removeEventListener(t, set); },
  };
}
