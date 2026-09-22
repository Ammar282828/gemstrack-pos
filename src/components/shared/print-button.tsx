"use client";

/**
 * Print, with the per-piece option beside it when there is more than one piece.
 *
 * A split button rather than a menu: printing the bill is the thing done a
 * hundred times a day and stays one tap. The chevron only appears on a
 * multi-piece invoice, and opens the one other way of printing it — each
 * piece as its own invoice on its own page, for a customer taking three
 * pieces to three people.
 */

import React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Printer, ChevronDown, Files } from 'lucide-react';
import { cn } from '@/lib/utils';

export const PrintButton: React.FC<{
  onPrint: () => void;
  /** Offered only when `pieces` is more than one. */
  onPrintPerPiece?: () => void;
  pieces: number;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}> = ({ onPrint, onPrintPerPiece, pieces, label = 'Print', variant = 'ghost', size = 'sm', className }) => {
  const split = pieces > 1 && !!onPrintPerPiece;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className={cn('inline-flex items-stretch', className)} onClick={stop}>
      <Button
        variant={variant} size={size}
        className={cn('justify-center', split && 'rounded-r-none pr-2', className?.includes('flex-1') && 'flex-1')}
        onClick={(e) => { e.stopPropagation(); onPrint(); }}
      >
        <Printer className="w-4 h-4 mr-1.5" /> {label}
      </Button>
      {split && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={variant} size={size} aria-label="More ways to print"
              className="rounded-l-none border-l border-border/60 px-1.5"
              onClick={stop}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={stop}>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPrintPerPiece?.(); }}>
              <Files className="w-4 h-4 mr-2" />
              <span>
                Each piece on its own page
                <span className="block text-2xs text-muted-foreground">{pieces} invoices, one per piece</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
