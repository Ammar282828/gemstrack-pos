/**
 * The ledger kit's tone classes (docs/features/web-matches-app.md a.2).
 *
 * WP-A creates `src/lib/tones.ts` with the same `Tone` type; until that merges the kit carries its
 * own copy here. When merged, replace the `Tone` type with `export type { Tone } from '@/lib/tones'`.
 * Class names are written out in full so Tailwind's scanner sees them.
 */
export type Tone = 'late' | 'owed' | 'settled' | 'credit' | 'working' | 'quiet' | 'house';

export interface ToneClasses {
  /** Text and 12px icons. */
  ink: string;
  /** 13% tint behind a pill. */
  tint: string;
  /** 10% tint behind a date leaf or icon tile. */
  tint10: string;
  /** Solid fill: swipe action squares. */
  solid: string;
}

export const TONE: Record<Tone, ToneClasses> = {
  late: { ink: 'text-tone-late-ink', tint: 'bg-tone-late/[.13]', tint10: 'bg-tone-late/10', solid: 'bg-tone-late text-white' },
  owed: { ink: 'text-tone-owed-ink', tint: 'bg-tone-owed/[.13]', tint10: 'bg-tone-owed/10', solid: 'bg-tone-owed text-white' },
  settled: { ink: 'text-tone-settled-ink', tint: 'bg-tone-settled/[.13]', tint10: 'bg-tone-settled/10', solid: 'bg-tone-settled text-white' },
  credit: { ink: 'text-tone-credit-ink', tint: 'bg-tone-credit/[.13]', tint10: 'bg-tone-credit/10', solid: 'bg-tone-credit text-white' },
  working: { ink: 'text-tone-working-ink', tint: 'bg-tone-working/[.13]', tint10: 'bg-tone-working/10', solid: 'bg-tone-working text-white' },
  quiet: { ink: 'text-muted-foreground', tint: 'bg-muted-foreground/[.13]', tint10: 'bg-muted-foreground/10', solid: 'bg-muted-foreground text-white' },
  house: { ink: 'text-primary', tint: 'bg-primary/[.13]', tint10: 'bg-primary/10', solid: 'bg-primary text-primary-foreground' },
};

export function toneClasses(tone: Tone = 'quiet'): ToneClasses {
  return TONE[tone] ?? TONE.quiet;
}
