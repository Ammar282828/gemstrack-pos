"use client";

import React, { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SwipeToDeleteProps {
  onDelete: () => void;
  children: React.ReactNode;
  className?: string;
  /** Minimum swipe distance (px) to trigger delete reveal. Default 60 */
  threshold?: number;
}

const REVEAL_WIDTH = 72; // px width of the delete button area
/** How far the finger moves before the gesture decides it is a swipe or a scroll. */
const SLOP = 8;
/** A flick this fast (px/ms) opens or closes whatever the distance. */
const FLICK = 0.45;
/** Where it settles, on the ERP's arriving curve (tailwind.config.ts, `ease-enter`). */
const SETTLE = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Wraps a card/row in a swipe-left-to-reveal-delete gesture on touch devices.
 * Desktop users see no difference — the underlying content renders normally.
 *
 * The row follows the finger without React (2026-10-07): it set state on every touchmove, a render a
 * frame, and moved sideways whenever a thumb scrolling the list drifted left. Now the first 8px decide
 * — across, it is a swipe; down, the page scrolls and the row stays put — and the row moves by its own
 * transform, with a little give past the button and a flick that counts.
 */
export function SwipeToDelete({ onDelete, children, className, threshold = 60 }: SwipeToDeleteProps) {
  const [revealed, setRevealed] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const g = useRef<{ x: number; y: number; t: number; axis: 'x' | 'y' | null; base: number; off: number; lastX: number; lastT: number } | null>(null);

  const place = (off: number, settle: boolean) => {
    const el = rowRef.current;
    if (!el) return;
    el.style.transition = settle ? SETTLE : 'none';
    el.style.transform = off ? `translateX(${-off}px)` : '';
  };

  const settleTo = (open: boolean) => {
    place(open ? REVEAL_WIDTH : 0, true);
    setRevealed(open);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const base = revealed ? REVEAL_WIDTH : 0;
    g.current = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null, base, off: base, lastX: t.clientX, lastT: e.timeStamp };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const s = g.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = s.x - t.clientX, dy = t.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (s.axis !== 'x') return; // the page is scrolling
    let off = s.base + dx;
    // Past the button it gives a little and no more; it never goes the other way.
    if (off > REVEAL_WIDTH) off = REVEAL_WIDTH + Math.min(24, (off - REVEAL_WIDTH) * 0.3);
    if (off < 0) off = 0;
    s.off = off;
    s.lastX = t.clientX; s.lastT = e.timeStamp;
    place(off, false);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const s = g.current;
    g.current = null;
    if (!s || s.axis !== 'x') return;
    const dt = Math.max(1, e.timeStamp - s.lastT);
    const lastX = e.changedTouches[0]?.clientX ?? s.lastX;
    const v = (s.lastX - lastX) / dt; // px/ms, leftwards positive
    if (v > FLICK) settleTo(true);
    else if (v < -FLICK) settleTo(false);
    else settleTo(s.off >= (s.base ? REVEAL_WIDTH - threshold / 2 : threshold));
  };

  const handleClose = () => settleTo(false);

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Delete button revealed behind */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-destructive text-destructive-foreground"
        style={{ width: REVEAL_WIDTH }}
      >
        <button
          onClick={() => { handleClose(); onDelete(); }}
          className="flex flex-col items-center justify-center w-full h-full gap-1 text-xs font-medium active:opacity-80"
          aria-label="Delete"
        >
          <Trash2 className="w-5 h-5" />
          Delete
        </button>
      </div>

      {/* Content layer — slides left. pan-y: the browser keeps vertical scrolling, the row keeps sideways. */}
      <div
        ref={rowRef}
        className="relative bg-background"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Tap anywhere on the content while revealed → close */}
        {revealed && (
          <div className="absolute inset-0 z-10" onClick={handleClose} />
        )}
        {children}
      </div>
    </div>
  );
}
