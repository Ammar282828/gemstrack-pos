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

/**
 * Wraps a card/row in a swipe-left-to-reveal-delete gesture on touch devices.
 * Desktop users see no difference — the underlying content renders normally.
 */
export function SwipeToDelete({ onDelete, children, className, threshold = 60 }: SwipeToDeleteProps) {
  const startXRef = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const REVEAL_WIDTH = 72; // px width of the delete button area

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    const dx = startXRef.current - e.touches[0].clientX;
    if (dx < 0) {
      // Swiping right — close if revealed
      if (revealed) setOffset(Math.max(0, REVEAL_WIDTH + dx));
      return;
    }
    const clamped = Math.min(dx, REVEAL_WIDTH + 8);
    setOffset(clamped);
  };

  const handleTouchEnd = () => {
    startXRef.current = null;
    if (offset >= threshold) {
      setOffset(REVEAL_WIDTH);
      setRevealed(true);
    } else {
      setOffset(0);
      setRevealed(false);
    }
  };

  const handleClose = () => {
    setOffset(0);
    setRevealed(false);
  };

  return (
    <div ref={containerRef} className={cn('relative overflow-hidden', className)}>
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

      {/* Content layer — slides left */}
      <div
        className="relative bg-background transition-transform"
        style={{
          transform: `translateX(-${offset}px)`,
          transition: startXRef.current !== null ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
