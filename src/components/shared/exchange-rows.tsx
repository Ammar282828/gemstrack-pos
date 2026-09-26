"use client";

/**
 * The exchange block, the same in the order form and the cart (the owner, 2026-09-25: "make
 * the exchange gold field uniform and add the ability to add another"). Each row is one thing
 * handed over. It is one line — what it is and the amount that comes off the bill (the owner,
 * 2026-09-26: "a general exchange without details like just description and cash amount … make
 * it super simple"). Weight & rate fold away under the row: karat (gold houses only), grams and
 * the rate it was taken at, which fill the amount until someone types their own. A row that
 * already has any of them opens with them showing. Rows are kept as typed (strings) and become
 * ExchangeEntry (lib/exchange.ts) when the document is written.
 */

import React from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/amount-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STORE_CONFIG } from '@/lib/store-config';
import { type ExchangeRow, blankExchangeRow, exchangeRowsTotal, applyExchangeRowChange } from '@/lib/exchange';

// The rows as typed, and turning them into ExchangeEntry and back, live in lib/exchange.ts
// (pure, so they are tested); re-exported here for the forms that use this component.
export { type ExchangeRow, blankExchangeRow, rowsFromExchanges, exchangesFromRows, exchangeRowsTotal } from '@/lib/exchange';

const KARATS = ['24k', '22k', '21k', '18k'];
const NO_KARAT = 'none';
/** Karat only means something where the house sells gold; a silver house weighs without it. */
const GOLD_HOUSE = STORE_CONFIG.defaultMetal === 'gold';

const hasDetails = (r: ExchangeRow) => !!(r.karat || r.weightG || r.ratePerGram);

export function ExchangeRows({ rows, onChange, disabled = false }: {
  rows: ExchangeRow[];
  onChange: (rows: ExchangeRow[]) => void;
  disabled?: boolean;
}) {
  const [opened, setOpened] = React.useState<Set<string>>(() => new Set());
  const set = (id: string, patch: Partial<ExchangeRow>) => onChange(rows.map((r) => (r.id === id ? applyExchangeRowChange(r, patch) : r)));
  const total = exchangeRowsTotal(rows);
  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const showDetails = opened.has(r.id) || hasDetails(r);
        const computed = !r.valueTyped && (parseFloat(r.weightG) || 0) > 0 && (parseFloat(r.ratePerGram) || 0) > 0;
        return (
          <div key={r.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Input value={r.description} disabled={disabled} onChange={(e) => set(r.id, { description: e.target.value })}
                placeholder="What it is (e.g. old ring)" aria-label={`Exchange ${i + 1}, what it is`} className="min-w-0 flex-1" />
              <AmountInput value={r.value} disabled={disabled} placeholder="Amount" zeroAsEmpty className="w-28 shrink-0 text-right sm:w-36"
                onValueChange={(v) => set(r.id, { value: v === undefined ? '' : String(v) })} aria-label={`Exchange ${i + 1}, amount (PKR)`} />
              {(rows.length > 1 || r.description || r.value || hasDetails(r)) && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={disabled}
                  aria-label={`Remove exchange ${i + 1}`}
                  onClick={() => onChange(rows.length > 1 ? rows.filter((x) => x.id !== r.id) : [blankExchangeRow()])}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {showDetails ? (
              <>
                <div className={GOLD_HOUSE ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
                  {GOLD_HOUSE && (
                    <Select value={r.karat || NO_KARAT} disabled={disabled} onValueChange={(v) => set(r.id, { karat: v === NO_KARAT ? '' : v })}>
                      <SelectTrigger aria-label={`Exchange ${i + 1}, karat`}><SelectValue placeholder="Karat" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_KARAT}>Karat</SelectItem>
                        {KARATS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <AmountInput value={r.weightG} maxDecimals={3} disabled={disabled} placeholder="Grams"
                    onValueChange={(v) => set(r.id, { weightG: v === undefined ? '' : String(v) })} aria-label={`Exchange ${i + 1}, grams`} />
                  <AmountInput value={r.ratePerGram} disabled={disabled} placeholder="Rate / g"
                    onValueChange={(v) => set(r.id, { ratePerGram: v === undefined ? '' : String(v) })} aria-label={`Exchange ${i + 1}, rate per gram`} />
                </div>
                {computed && <p className="text-2xs text-muted-foreground text-right">Amount = grams × rate — type an amount to change it.</p>}
              </>
            ) : (
              <button type="button" disabled={disabled}
                className="min-h-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                onClick={() => setOpened((s) => new Set(s).add(r.id))}>
                + Weight &amp; rate
              </button>
            )}
          </div>
        );
      })}
      <Button type="button" variant="ghost" size="sm" className="w-full" disabled={disabled}
        onClick={() => onChange([...rows, blankExchangeRow()])}>
        <Plus className="mr-2 h-4 w-4" /> Add another exchange
      </Button>
      {rows.length > 1 && total > 0 && (
        <p className="flex justify-between text-sm font-medium"><span>Exchange total</span><span className="tabular-nums">PKR {total.toLocaleString()}</span></p>
      )}
    </div>
  );
}
