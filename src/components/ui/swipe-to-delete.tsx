"use client";

import React from 'react';
import { Trash2 } from 'lucide-react';
import { SwipeRow } from '@/components/ledger/swipe-row';

interface SwipeToDeleteProps {
  onDelete: () => void;
  children: React.ReactNode;
  className?: string;
  /** Kept for existing callers; the gesture's thresholds now live in ledger/helpers.ts. */
  threshold?: number;
}

/**
 * Swipe-left-to-reveal-delete on touch devices; desktop sees the content untouched.
 * A thin wrapper over `SwipeRow` (components/ledger) with one trailing "Delete" action.
 */
export function SwipeToDelete({ onDelete, children, className }: SwipeToDeleteProps) {
  return (
    <SwipeRow
      className={className}
      surfaceClassName="bg-background"
      trailing={[{ label: 'Delete', icon: <Trash2 />, tone: 'late', onSelect: onDelete }]}
    >
      {children}
    </SwipeRow>
  );
}
