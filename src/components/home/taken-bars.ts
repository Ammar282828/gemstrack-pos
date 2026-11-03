import type { MethodSplit, TakenDay } from '@/lib/taken-by-day';

/** Kept apart from the chart module so the dialog can use them without loading recharts. */
export const METHOD_COLOR: Record<keyof MethodSplit, string> = {
  cash: 'hsl(var(--chart-1))', bank: 'hsl(var(--chart-2))', card: 'hsl(var(--chart-3))', other: 'hsl(var(--chart-4))', unpaid: 'hsl(var(--muted-foreground) / .35)',
};

export interface DayBar { day: string; label: string; total: number; cash: number; bank: number; card: number; other: number; unpaid: number }

export function barsOf(days: TakenDay[], label: (day: string) => string): DayBar[] {
  return days.map(d => ({ day: d.day, label: label(d.day), total: d.total, ...d.methods }));
}
