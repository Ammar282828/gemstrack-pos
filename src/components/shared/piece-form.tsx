"use client";

/**
 * The shared vocabulary of every form that describes a piece of jewellery: the
 * order form, the line on a bill, and the product form.
 *
 * Three forms had three layouts, and three controls for the same boolean. One
 * had two buttons for the price mode, one a plain checkbox, and one a checkbox
 * that read "use the calculation instead" — ticked meant not fixed. These two
 * pieces are what the forms now share; the order of things (the piece, then
 * its price, then whatever only that form needs) is a convention each form
 * follows on its own.
 */

import React from 'react';
import { Button } from '@/components/ui/button';

/** A sub-heading inside a piece. One style for every section of every form. */
export const FormSection: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70 pt-1 flex items-baseline gap-2">
    {title}{hint && <span className="font-normal normal-case tracking-normal text-muted-foreground/60">{hint}</span>}
  </p>
);

/**
 * Two ways to price a piece, as two buttons rather than a checkbox that has to
 * be read twice. `fixed` is the stored boolean (isManualPrice / isCustomPrice),
 * so nothing about how a piece is saved changes.
 */
export const PriceModeToggle: React.FC<{ fixed: boolean; onChange: (fixed: boolean) => void }> = ({ fixed, onChange }) => (
  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How this piece is priced">
    <Button type="button" variant={!fixed ? 'default' : 'outline'} className="h-9" role="radio" aria-checked={!fixed}
      onClick={() => onChange(false)}>
      Weight × rate
    </Button>
    <Button type="button" variant={fixed ? 'default' : 'outline'} className="h-9" role="radio" aria-checked={fixed}
      onClick={() => onChange(true)}>
      Fixed price
    </Button>
  </div>
);
