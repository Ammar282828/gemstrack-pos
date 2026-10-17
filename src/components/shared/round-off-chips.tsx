'use client';

/**
 * The round-off offers beside a discount field (owner, 2026-10-17), and the "Settle" offer at payment
 * time. The rule is lib/round-off.ts; this is only the chips (the app's capsule, ledger/chip.tsx).
 *
 * `payable` is what the bill comes to before any discount (subtotal less the exchange). The chips
 * work from what is left after the discount already typed. Tapping one adds its extra to that
 * discount; tapping the lit one puts the discount back as it was. Typing in the discount field
 * afterwards simply stops it being lit.
 */

import * as React from 'react';
import { FilterChip } from '@/components/ledger/chip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { rupees } from '@/lib/money';
import { useCanGiveDiscount } from '@/lib/use-can-discount';
import { discountWithOffer, roundOffLabel, roundOffOffers, settleRemainderOffer } from '@/lib/money-round';

export function RoundOffChips({ payable, discount, onDiscountChange, className }: {
  payable: number;
  discount: number;
  onDiscountChange: (next: number) => void;
  className?: string;
}) {
  const [applied, setApplied] = React.useState<{ base: number; target: number } | null>(null);
  const disc = rupees(discount);
  const whole = rupees(payable);
  // Lit while the bill still comes to the target that tap made.
  const lit = applied && whole - disc === applied.target ? applied : null;
  const base = lit ? lit.base : disc;
  const offers = roundOffOffers(whole, base);
  if (!offers.length) return null;
  return (
    <div role="group" aria-label="Round the bill off" className={cn('flex flex-wrap justify-end gap-2', className)}>
      {offers.map((o) => {
        const chosen = lit?.target === o.target;
        return (
          <FilterChip
            key={o.target}
            title={roundOffLabel(o)}
            chosen={chosen}
            className="h-9"
            onClick={() => {
              if (chosen) { setApplied(null); onDiscountChange(base); return; }
              setApplied({ base, target: o.target });
              onDiscountChange(discountWithOffer(base, o));
            }}
          />
        );
      })}
    </div>
  );
}

/** "Settle — give the remaining PKR 2,340 off": shown only when the remainder is under 5,000. */
export function SettleOffer({ remaining, onSettle, busy, className }: {
  remaining: number;
  /** Receives the amount to add to the bill's discount. */
  onSettle: (extraDiscount: number) => void;
  busy?: boolean;
  className?: string;
}) {
  // Giving a discount is the owner's: staff may take the payment, and never see the offer.
  const canDiscount = useCanGiveDiscount();
  const x = settleRemainderOffer(remaining);
  if (x === null || !canDiscount) return null;
  return (
    <Button type="button" variant="secondary" size="sm" disabled={busy} className={className} onClick={() => onSettle(x)}>
      Settle — give the remaining PKR {x.toLocaleString('en-US')} off
    </Button>
  );
}
