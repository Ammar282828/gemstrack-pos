"use client";

import * as React from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from './tone';
import { ACTION_WIDTH, SWIPE_SLOP, clampSwipe, settleSwipe } from './helpers';

export interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  tone: Tone;
  onSelect: () => void;
}

export interface SwipeRowProps {
  /** Revealed by swiping right. */
  leading?: SwipeAction[];
  /** Revealed by swiping left. */
  trailing?: SwipeAction[];
  children: React.ReactNode;
  className?: string;
  /** Background of the sliding layer, so the actions behind stay hidden. Default `bg-card`. */
  surfaceClassName?: string;
}

/** Same settle curve as the ERP's `ease-enter`. */
const SETTLE = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Swipe actions on touch (generalises SwipeToDelete): the first 8px decide swipe vs scroll, the row
 * moves by its own transform (no React per move), a flick counts, and nothing ever auto-fires.
 * Mouse and keyboard users see the row untouched; callers show the same actions in the row's menu.
 */
export function SwipeRow({ leading = [], trailing = [], children, className, surfaceClassName = 'bg-card' }: SwipeRowProps) {
  const leadW = leading.length * ACTION_WIDTH;
  const trailW = trailing.length * ACTION_WIDTH;
  const [open, setOpen] = React.useState<'leading' | 'trailing' | null>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const g = React.useRef<{ x: number; y: number; axis: 'x' | 'y' | null; base: number; off: number; lastX: number; lastT: number } | null>(null);
  const baseFor = (o: typeof open) => (o === 'trailing' ? trailW : o === 'leading' ? -leadW : 0);

  const place = (off: number, settle: boolean) => {
    const el = rowRef.current;
    if (!el) return;
    el.style.transition = settle && !reduced() ? SETTLE : 'none';
    el.style.transform = off ? `translateX(${-off}px)` : '';
  };
  const settleTo = (off: number) => {
    place(off, true);
    setOpen(off > 0 ? 'trailing' : off < 0 ? 'leading' : null);
  };

  if (!leadW && !trailW) return <div className={className}>{children}</div>;

  const start = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const base = baseFor(open);
    g.current = { x: t.clientX, y: t.clientY, axis: null, base, off: base, lastX: t.clientX, lastT: e.timeStamp };
  };
  const move = (e: React.TouchEvent) => {
    const s = g.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = s.x - t.clientX, dy = t.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (s.axis !== 'x') return;
    const off = clampSwipe(s.base + dx, leadW, trailW);
    s.off = off; s.lastX = t.clientX; s.lastT = e.timeStamp;
    place(off, false);
  };
  const end = (e: React.TouchEvent) => {
    const s = g.current;
    g.current = null;
    if (!s || s.axis !== 'x') return;
    const dt = Math.max(1, e.timeStamp - s.lastT);
    const lastX = e.changedTouches[0]?.clientX ?? s.lastX;
    const v = (s.lastX - lastX) / dt;
    settleTo(settleSwipe(s.off, v, leadW, trailW));
  };

  const renderActions = (list: SwipeAction[], side: 'leading' | 'trailing') => (
    <div
      className={cn('absolute inset-y-0 flex', side === 'leading' ? 'left-0' : 'right-0')}
      style={{ width: list.length * ACTION_WIDTH }}
      aria-hidden={open !== side}
    >
      {list.map((a) => (
        <button
          key={a.label}
          type="button"
          tabIndex={open === side ? 0 : -1}
          onClick={() => { settleTo(0); a.onSelect(); }}
          className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-2xs font-medium active:opacity-80 [&>svg]:h-5 [&>svg]:w-5', toneClasses(a.tone).solid)}
        >
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {leadW ? renderActions(leading, 'leading') : null}
      {trailW ? renderActions(trailing, 'trailing') : null}
      <div
        ref={rowRef}
        className={cn('relative', surfaceClassName)}
        style={{ touchAction: 'pan-y' }}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
        onTouchCancel={end}
      >
        {open ? <div className="absolute inset-0 z-10" onClick={() => settleTo(0)} /> : null}
        {children}
      </div>
    </div>
  );
}
