"use client";

/** Wastage as 10 / 12 / 15 / 25 % chips and Other (owner, 2026-11-03): the value stays the form's own percentage number. */

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Chip } from '@/components/order/describe-field';

export const WASTAGE_CHOICES = [10, 12, 15, 25] as const;

/** Whether a stored value is one of the chips; anything else (including blank) reads as Other. */
export const isWastageChoice = (v: unknown): boolean => WASTAGE_CHOICES.some(c => c === Number(v)) && String(v) !== '';

export function WastageChips({ value, onChange }: { value: number | string | undefined; onChange: (v: number | string) => void }) {
  // Other stays chosen while its number is being typed, even if what is typed equals a chip.
  const [other, setOther] = useState(() => value !== undefined && value !== '' && !isWastageChoice(value));
  const showOther = other || (value !== undefined && value !== '' && !isWastageChoice(value));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {WASTAGE_CHOICES.map(c => (
          <Chip key={c} active={!showOther && Number(value) === c} onClick={() => { setOther(false); onChange(c); }}>{c}%</Chip>
        ))}
        <Chip active={showOther} onClick={() => setOther(true)}>Other</Chip>
      </div>
      {showOther && (
        <Input type="number" step="0.1" min={0} inputMode="decimal" placeholder="Wastage (%)" value={value ?? ''}
          onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
}
