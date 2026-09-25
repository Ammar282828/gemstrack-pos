"use client";

/**
 * The exchange block, the same in the order form and the cart (the owner, 2026-09-25: "make
 * the exchange gold field uniform and add the ability to add another"). Each row is one thing
 * handed over: what it is, karat, grams, the rate it was taken at, and the value that comes
 * off the bill. The value is grams × rate until someone types their own. Rows are kept as
 * typed (strings) and become ExchangeEntry (lib/exchange.ts) when the document is written.
 */

import React from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/amount-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type ExchangeRow, blankExchangeRow, exchangeRowsTotal, applyExchangeRowChange } from '@/lib/exchange';

// The rows as typed, and turning them into ExchangeEntry and back, live in lib/exchange.ts
// (pure, so they are tested); re-exported here for the forms that use this component.
export { type ExchangeRow, blankExchangeRow, rowsFromExchanges, exchangesFromRows, exchangeRowsTotal } from '@/lib/exchange';

const KARATS = ['24k', '22k', '21k', '18k'];
const NO_KARAT = 'none';

export function ExchangeRows({ rows, onChange, disabled = false }: {
  rows: ExchangeRow[];
  onChange: (rows: ExchangeRow[]) => void;
  disabled?: boolean;
}) {
  const set = (id: string, patch: Partial<ExchangeRow>) => onChange(rows.map((r) => (r.id === id ? applyExchangeRowChange(r, patch) : r)));
  const total = exchangeRowsTotal(rows);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const computed = !r.valueTyped && (parseFloat(r.weightG) || 0) > 0 && (parseFloat(r.ratePerGram) || 0) > 0;
        return (
          <div key={r.id} className="space-y-2 rounded-md border bg-background p-2.5">
            <div className="flex items-center gap-2">
              <Input value={r.description} disabled={disabled} onChange={(e) => set(r.id, { description: e.target.value })}
                placeholder="What it is (e.g. old ring)" aria-label={`Exchange ${i + 1}, what it is`} className="flex-1" />
              {(rows.length > 1 || r.description || r.value || r.weightG) && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={disabled}
                  aria-label={`Remove exchange ${i + 1}`}
                  onClick={() => onChange(rows.length > 1 ? rows.filter((x) => x.id !== r.id) : [blankExchangeRow()])}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select value={r.karat || NO_KARAT} disabled={disabled} onValueChange={(v) => set(r.id, { karat: v === NO_KARAT ? '' : v })}>
                <SelectTrigger aria-label={`Exchange ${i + 1}, karat`}><SelectValue placeholder="Karat" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_KARAT}>Karat</SelectItem>
                  {KARATS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
              <AmountInput value={r.weightG} maxDecimals={3} disabled={disabled} placeholder="Grams"
                onValueChange={(v) => set(r.id, { weightG: v === undefined ? '' : String(v) })} aria-label={`Exchange ${i + 1}, grams`} />
              <AmountInput value={r.ratePerGram} disabled={disabled} placeholder="Rate / g"
                onValueChange={(v) => set(r.id, { ratePerGram: v === undefined ? '' : String(v) })} aria-label={`Exchange ${i + 1}, rate per gram`} />
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">Value (PKR)</span>
              <AmountInput value={r.value} disabled={disabled} placeholder="0" className="flex-1 text-right"
                onValueChange={(v) => set(r.id, { value: v === undefined ? '' : String(v) })} aria-label={`Exchange ${i + 1}, value`} />
            </div>
            {computed && <p className="text-2xs text-muted-foreground text-right">Grams × rate — type a value to change it.</p>}
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
