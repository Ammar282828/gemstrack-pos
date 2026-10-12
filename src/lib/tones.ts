/**
 * The app's `Tone` (apps/iphone/App/UI): colour means something, and nothing else picks one.
 * docs/features/web-matches-app.md a.2.
 *
 *   late     late, a missed promise, sitting too long   (red)
 *   owed     due soon, money still to come, never red    (amber)
 *   settled  paid, done, ready                          (green)
 *   credit   in credit, the shop owes                   (teal)
 *   working  with the karigars                          (blue)
 *   quiet    nothing to say                             (secondary label)
 *   house    the shop's own, chosen                     (the accent)
 *
 * The values are CSS variables in globals.css (`--tone-<name>` fill, `--tone-<name>-ink` for text
 * and small icons) and Tailwind colours `tone-<name>` / `tone-<name>-ink`. Every class below is
 * written out whole so Tailwind finds it (tailwind.config.ts scans src/lib).
 */

export type Tone = 'late' | 'owed' | 'settled' | 'credit' | 'working' | 'quiet' | 'house';

export const TONES: readonly Tone[] = ['late', 'owed', 'settled', 'credit', 'working', 'quiet', 'house'];

type ToneClassSet = {
  /** Text and 12px icons. */
  text: string;
  /** A solid fill: bars, dots, icon tiles. */
  fill: string;
  /** The pill: ink on the tone at 13%, as the app's `Pill`. */
  pill: string;
  /** A quiet wash for a tile behind an icon or date (the app's tone at 10%). */
  tint: string;
};

const CLASSES: Record<Tone, ToneClassSet> = {
  late: { text: 'text-tone-late-ink', fill: 'bg-tone-late', pill: 'text-tone-late-ink bg-tone-late/[.13]', tint: 'bg-tone-late/10' },
  owed: { text: 'text-tone-owed-ink', fill: 'bg-tone-owed', pill: 'text-tone-owed-ink bg-tone-owed/[.13]', tint: 'bg-tone-owed/10' },
  settled: { text: 'text-tone-settled-ink', fill: 'bg-tone-settled', pill: 'text-tone-settled-ink bg-tone-settled/[.13]', tint: 'bg-tone-settled/10' },
  credit: { text: 'text-tone-credit-ink', fill: 'bg-tone-credit', pill: 'text-tone-credit-ink bg-tone-credit/[.13]', tint: 'bg-tone-credit/10' },
  working: { text: 'text-tone-working-ink', fill: 'bg-tone-working', pill: 'text-tone-working-ink bg-tone-working/[.13]', tint: 'bg-tone-working/10' },
  quiet: { text: 'text-tone-quiet-ink', fill: 'bg-tone-quiet', pill: 'text-tone-quiet-ink bg-tone-quiet/[.13]', tint: 'bg-tone-quiet/10' },
  house: { text: 'text-tone-house-ink', fill: 'bg-tone-house', pill: 'text-tone-house-ink bg-tone-house/[.13]', tint: 'bg-tone-house/10' },
};

export const toneText = (tone: Tone): string => CLASSES[tone].text;
export const toneFill = (tone: Tone): string => CLASSES[tone].fill;
export const tonePill = (tone: Tone): string => CLASSES[tone].pill;
export const toneTint = (tone: Tone): string => CLASSES[tone].tint;

/**
 * The ledger kit's shape (components/ledger re-exports it): ink for text, two tints, and a solid
 * fill with its text for swipe-action squares. One source: the classes above.
 */
export interface ToneClasses {
  /** Text and 12px icons. */
  ink: string;
  /** 13% tint behind a pill. */
  tint: string;
  /** 10% tint behind a date leaf or icon tile. */
  tint10: string;
  /** Solid fill with its text: swipe action squares. */
  solid: string;
}

export const TONE: Record<Tone, ToneClasses> = {
  late: { ink: CLASSES.late.text, tint: 'bg-tone-late/[.13]', tint10: CLASSES.late.tint, solid: 'bg-tone-late text-white' },
  owed: { ink: CLASSES.owed.text, tint: 'bg-tone-owed/[.13]', tint10: CLASSES.owed.tint, solid: 'bg-tone-owed text-white' },
  settled: { ink: CLASSES.settled.text, tint: 'bg-tone-settled/[.13]', tint10: CLASSES.settled.tint, solid: 'bg-tone-settled text-white' },
  credit: { ink: CLASSES.credit.text, tint: 'bg-tone-credit/[.13]', tint10: CLASSES.credit.tint, solid: 'bg-tone-credit text-white' },
  working: { ink: CLASSES.working.text, tint: 'bg-tone-working/[.13]', tint10: CLASSES.working.tint, solid: 'bg-tone-working text-white' },
  quiet: { ink: CLASSES.quiet.text, tint: 'bg-tone-quiet/[.13]', tint10: CLASSES.quiet.tint, solid: 'bg-tone-quiet text-white' },
  house: { ink: CLASSES.house.text, tint: 'bg-tone-house/[.13]', tint10: CLASSES.house.tint, solid: 'bg-tone-house text-primary-foreground' },
};

export function toneClasses(tone: Tone = 'quiet'): ToneClasses {
  return TONE[tone] ?? TONE.quiet;
}
