import * as React from 'react';
import { cn } from '@/lib/utils';
import { lacCrore } from '@/lib/money';
import { toneClasses, type Tone } from '@/lib/tones';
import { moneySplit } from './helpers';

/** Whole rupees with grouping, or lac/crore when `lac` is set (lib/money.ts rules). */
export function formatAmount(n: number, lac = false): string {
  return lac ? lacCrore(n) : Math.round(Number(n) || 0).toLocaleString('en-US');
}

export interface MoneyTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  amount: number;
  lac?: boolean;
  /** Prefix "PKR ". Default true. */
  currency?: boolean;
  tone?: Tone;
}

export function MoneyText({ amount, lac, currency = true, tone, className, ...rest }: MoneyTextProps) {
  return (
    <span className={cn('tabular-nums', tone && toneClasses(tone).ink, className)} {...rest}>
      {currency ? 'PKR ' : ''}{formatAmount(amount, lac)}
    </span>
  );
}

export interface HeroAmountProps {
  amount: number;
  lac?: boolean;
  tone?: Tone;
  className?: string;
}

/** The big sum: small PKR, then the figure in serif. */
export function HeroAmount({ amount, lac, tone, className }: HeroAmountProps) {
  const text = formatAmount(amount, lac);
  return (
    <div className={cn('flex min-w-0 items-baseline gap-1.5', className)} aria-label={`PKR ${text}`}>
      <span aria-hidden className="text-ios-title3 font-medium text-muted-foreground">PKR</span>
      <span aria-hidden className={cn('truncate font-serif text-ios-large font-semibold tabular-nums', tone ? toneClasses(tone).ink : 'text-foreground')}>
        {text}
      </span>
    </div>
  );
}

export interface RowAmountProps {
  amount: number;
  lac?: boolean;
  tone?: Tone;
  className?: string;
}

export function RowAmount({ amount, lac, tone, className }: RowAmountProps) {
  return (
    <span className={cn('whitespace-nowrap text-ios-sub font-semibold tabular-nums', tone ? toneClasses(tone).ink : 'text-foreground', className)}>
      PKR {formatAmount(amount, lac)}
    </span>
  );
}

export interface FigureTileProps {
  label: string;
  /** Pre-formatted node, or a number (shown as PKR in lac/crore). */
  value: React.ReactNode;
  detail?: React.ReactNode;
  tint?: Tone;
  className?: string;
}

export function FigureTile({ label, value, detail, tint, className }: FigureTileProps) {
  return (
    <div className={cn('min-w-0 rounded-card bg-card p-4', className)}>
      <div className="text-ios-sub text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate font-serif text-ios-title2 font-semibold tabular-nums', tint ? toneClasses(tint).ink : 'text-foreground')}>
        {typeof value === 'number' ? `PKR ${lacCrore(value)}` : value}
      </div>
      {detail ? <div className="mt-0.5 text-ios-foot text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

export interface PaidBarProps {
  /** 0..1 */
  fraction: number;
  paid?: boolean;
  className?: string;
}

/** 4px bar: accent while owing, settled green once paid. */
export function PaidBar({ fraction, paid, className }: PaidBarProps) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(f * 100)}
      aria-label="Paid"
      className={cn('h-1 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-200 ease-exit motion-reduce:transition-none', paid ? 'bg-tone-settled' : 'bg-primary')}
        style={{ width: `${f * 100}%` }}
      />
    </div>
  );
}

export interface MoneySplitProps {
  total: number;
  paid: number;
  due?: number;
  totalLabel?: string;
  paidLabel?: string;
  lac?: boolean;
  className?: string;
}

/** Total / Paid / Due (or In credit, or Nil), with the bar below. */
export function MoneySplit({ total, paid, due, totalLabel = 'Total', paidLabel = 'Paid', lac, className }: MoneySplitProps) {
  const s = moneySplit(total, paid, due);
  const third =
    s.state === 'due'
      ? { label: 'Due', text: formatAmount(s.amount, lac), tone: 'owed' as Tone }
      : s.state === 'credit'
        ? { label: 'In credit', text: formatAmount(s.amount, lac), tone: 'credit' as Tone }
        : { label: 'Due', text: 'Nil', tone: 'settled' as Tone };
  const cell = (label: string, text: string, tone?: Tone) => (
    <div className="min-w-0 flex-1">
      <div className="text-2xs font-semibold uppercase tracking-[.6px] text-muted-foreground">{label}</div>
      <div className={cn('truncate text-ios-sub font-semibold tabular-nums', tone ? toneClasses(tone).ink : 'text-foreground')}>{text}</div>
    </div>
  );
  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex gap-3">
        {cell(totalLabel, formatAmount(total, lac))}
        {cell(paidLabel, formatAmount(paid, lac))}
        {cell(third.label, third.text, third.tone)}
      </div>
      <PaidBar fraction={s.fraction} paid={s.paidInFull} />
    </div>
  );
}
