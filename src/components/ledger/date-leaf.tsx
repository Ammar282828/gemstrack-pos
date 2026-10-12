import * as React from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from '@/lib/tones';
import { dateLeafParts } from './helpers';

export interface DateLeafProps {
  date: Date | string | number;
  tone?: Tone;
  size?: number;
  className?: string;
}

/** Weekday over day over month, on a tinted tile (radius 10). */
export function DateLeaf({ date, tone = 'quiet', size = 44, className }: DateLeafProps) {
  const p = dateLeafParts(date);
  if (!p) return null;
  const t = toneClasses(tone);
  return (
    <span
      role="img"
      aria-label={`${p.weekday} ${p.day} ${p.month}`}
      className={cn('inline-flex shrink-0 flex-col items-center justify-center rounded-leaf leading-none', t.tint10, t.ink, className)}
      style={{ width: size, height: size }}
    >
      <span aria-hidden className="font-bold" style={{ fontSize: size * 0.2 }}>{p.weekday}</span>
      <span aria-hidden className="font-serif font-semibold" style={{ fontSize: size * 0.42 }}>{p.day}</span>
      <span aria-hidden className="font-semibold" style={{ fontSize: size * 0.16 }}>{p.month}</span>
    </span>
  );
}
