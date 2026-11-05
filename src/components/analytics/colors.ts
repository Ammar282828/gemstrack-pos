/**
 * Analytics' series colours, fixed by entity (no chart library in here, so any page can import them).
 * `--ana-1…6` are defined in globals.css for light and dark; colour follows the entity, never its rank.
 */

import { UNCLASSIFIED_KEY, type ExpenseKind } from '@/lib/analytics/books';

/** The nth series colour (1…6) as a CSS value; light and dark come from globals.css. */
export const ana = (n: number): string => `var(--ana-${((n - 1) % 6) + 1})`;

/** A karat is always the same colour: 24k gold, 22k blue, 21k orange, 18k green, 12k violet, anything else pink. */
export const KARAT_COLORS: Record<string, string> = { '24k': ana(1), '22k': ana(2), '21k': ana(3), '18k': ana(4), '12k': ana(5) };
export const karatColor = (karat: string): string => KARAT_COLORS[String(karat).toLowerCase()] ?? ana(6);

/** An acquisition source is always the same colour; Unclassified is the neutral. */
export const SOURCE_COLORS: Record<string, string> = {
  taheri_spillover: ana(1), referral: ana(2), walkin: ana(3), social_media: ana(4), website: ana(5), other: ana(6),
  [UNCLASSIFIED_KEY]: 'hsl(var(--muted-foreground))',
};

/** Running costs, the goods, the partners' drawings. */
export const KIND_COLORS: Record<ExpenseKind, string> = { running: ana(1), goods: ana(2), drawings: ana(3) };
export const KIND_LABELS: Record<ExpenseKind, string> = { running: 'Running cost', goods: 'Goods', drawings: 'Drawings' };

