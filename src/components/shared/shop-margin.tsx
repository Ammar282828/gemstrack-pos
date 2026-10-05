'use client';

/**
 * The shop's margin on an order or sale, and the 24k rate it is worked out from (lib/margin.ts).
 *
 * For owners and staff only, and never for the customer (the owner, 2026-10-05). These render on
 * the shop's own screens — the sale, the order form, Finalize, an invoice's and an order's page —
 * and nothing they show is printed, sent or stored where the customer's link can read it (the
 * public invoice route strips costRate24k). The figure is blurred until tapped: the counter turns
 * its screen to show a customer the bill, and a margin beside the total is the one thing they
 * must not read off it.
 *
 * Nothing renders in a house that doesn't cost by gold (NEXT_PUBLIC_STORE_COST_RATTI_LESS "none").
 */

import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { AmountInput } from '@/components/ui/amount-input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { COST_RATTI_LESS, ASSUMED_MARGIN, goldCostPerGram, percentLabel, type Margin } from '@/lib/margin';

export const SHOP_MARGIN_ON = COST_RATTI_LESS !== null;

const rs = (n: number) => `PKR ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;

/** "24k rate now", with today's rate sheet one tap away. Empty is allowed: the sale is then taken at 10%. */
export function CostRateField({ value, onChange, sheetRate24k, id = 'cost-rate-24k', className }: {
  value: number | string | null | undefined;
  onChange: (v: number | undefined) => void;
  /** The rate sheet's 24k, offered, never filled in by itself. */
  sheetRate24k?: number;
  id?: string;
  className?: string;
}) {
  if (!SHOP_MARGIN_ON) return null;
  const typed = Number(value) || 0;
  const sheet = Number(sheetRate24k) || 0;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-warning" />24k rate now (PKR / g)</Label>
      <AmountInput id={id} value={typed || ''} onValueChange={v => onChange(Number(v) > 0 ? Number(v) : undefined)} placeholder="For our margin — leave empty for 10%" />
      <p className="text-xs text-muted-foreground">
        {typed > 0
          ? <>Our cost: {rs(goldCostPerGram(typed))} a gram of jewellery (24k less {COST_RATTI_LESS} ratti).</>
          : <>Without it the margin is taken as {Math.round(ASSUMED_MARGIN * 100)}%.</>}
        {sheet > 0 && Math.round(sheet) !== Math.round(typed) && (
          <> <button type="button" className="underline underline-offset-2 text-foreground" onClick={() => onChange(sheet)}>Use the rate sheet&apos;s {sheet.toLocaleString('en-PK')}</button></>
        )}
      </p>
    </div>
  );
}

/** What the shop earns on this, blurred until tapped. */
export function MarginFigure({ margin, className, compact = false }: { margin: Margin | null; className?: string; compact?: boolean }) {
  const [shown, setShown] = useState(false);
  if (!SHOP_MARGIN_ON || !margin) return null;
  const tone = margin.assumed ? 'text-muted-foreground' : margin.percent < 0 ? 'text-destructive' : 'text-success';
  const words = margin.assumed
    ? `≈ ${percentLabel(margin)} (no 24k rate given — assumed)`
    : `${percentLabel(margin)} · ${rs(margin.profit)}${margin.costedShare < 0.999 ? ` · ${Math.round((1 - margin.costedShare) * 100)}% of it at ${Math.round(ASSUMED_MARGIN * 100)}% (no weight)` : ''}`;
  return (
    <button
      type="button"
      onClick={() => setShown(s => !s)}
      aria-label={shown ? 'Hide our margin' : 'Show our margin'}
      aria-pressed={shown}
      className={cn('flex w-full items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-left text-sm', className)}
    >
      <span className="flex items-center gap-1.5 text-muted-foreground"><Lock className="h-3.5 w-3.5 text-warning" />{compact ? 'Margin' : 'We earn'}</span>
      <span className={cn('tabular-nums font-medium transition-[filter]', tone, !shown && 'blur-sm select-none')} aria-hidden={!shown}>
        {shown ? words : '00.0% · PKR 00,000'}
      </span>
    </button>
  );
}
