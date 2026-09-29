/**
 * Which days an ad must stay quiet, from the Bohra calendar.
 *
 * The vault's rule: "On any sacred date: no products, no CTAs, no promotional language
 * however soft", and not "in the days immediately before a sacred date either" —
 * "if unsure whether a date is sacred, treat it as sacred". It records its dates for 2025
 * only; the observances recur on Hijri dates, so they are worked out here for any day
 * from the tabular Islamic calendar (Intl `islamic-tbla`, the family of the Fatimid
 * calendar the Dawoodi Bohras keep). Checked against the vault's own anchors: 16 May 2025
 * is 19 Zilqad (the Mazoon's birthday), 6 Jun 2025 is 10 Zilhaj (Eid), 26 Jun 2025 is
 * 1 Muharram. Urs and Dawat dates are not in the vault and are not guessed here; the
 * Guide says to confirm every date against the Dawat calendar.
 *
 * Pure (tested). Days are Karachi days.
 */

export interface HijriDate { year: number; month: number; day: number }

const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-tbla', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Karachi' });

export function hijriOf(date: Date): HijriDate {
  const p = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day };
}

export const HIJRI_MONTHS = ['Moharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Aakhar', 'Jumada al-Ula', 'Jumada al-Ukhra', 'Rajab', 'Shabaan', 'Ramadan', 'Shawwal', 'Zilqad', 'Zilhaj'];
export const hijriLabel = (h: HijriDate) => `${h.day} ${HIJRI_MONTHS[h.month - 1]} ${h.year}`;

export interface Observance {
  id: string;
  name: string;
  /** Hijri month (1–12), or 0 for every month. */
  month: number;
  from: number;
  to: number;
  /** sacred: no product ads, no calls to action. quiet: the lunar 1st — a cultural post, not a product ad. */
  level: 'sacred' | 'quiet';
  /** Days before it that are kept quiet too ("proximity reads as opportunism"). */
  before: number;
  rule: string;
}

export const OBSERVANCES: readonly Observance[] = [
  { id: 'ashara', name: 'Ashara Mubaraka — the first ten days of Moharram', month: 1, from: 1, to: 10, level: 'sacred', before: 5,
    rule: 'No product mentions of any kind, no jewellery or gold imagery, no black styling. Only cultural posts run.' },
  { id: 'eid-fitr', name: 'Eid al-Fitr', month: 10, from: 1, to: 1, level: 'sacred', before: 1, rule: 'Presence and respect only: no products, no calls to action.' },
  { id: 'mazoon', name: 'The Mazoon ud Dawat’s birthday', month: 11, from: 19, to: 19, level: 'sacred', before: 1, rule: 'A story of respect; no products.' },
  { id: 'eid-adha', name: 'Eid al-Adha', month: 12, from: 10, to: 10, level: 'sacred', before: 1, rule: 'Presence and respect only: no products, no calls to action.' },
  { id: 'ghadeer', name: 'Eid-e-Ghadeer-e-Khum', month: 12, from: 18, to: 18, level: 'sacred', before: 1, rule: 'A story of respect; no products.' },
  { id: 'lunar-first', name: 'The first of the lunar month', month: 0, from: 1, to: 1, level: 'quiet', before: 0,
    rule: 'The day of the fixed cultural post: keep product ads off it.' },
];

export interface DayStatus {
  date: string;
  hijri: HijriDate;
  /** clear: ads may run. near: in the quiet days before a sacred one. */
  level: 'sacred' | 'near' | 'quiet' | 'clear';
  observance: Observance | null;
}

const DAY = 86_400_000;
/** A Karachi calendar day as YYYY-MM-DD. */
export const karachiDay = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
const atNoon = (ymd: string) => new Date(`${ymd}T12:00:00+05:00`);

function onDay(h: HijriDate): Observance | null {
  return OBSERVANCES.find(o => o.level === 'sacred' && o.month === h.month && h.day >= o.from && h.day <= o.to)
    ?? OBSERVANCES.find(o => o.level === 'quiet' && (o.month === 0 || o.month === h.month) && h.day >= o.from && h.day <= o.to)
    ?? null;
}

/** Whether an ad may run on this Karachi day, and why not. */
export function adDayStatus(date: Date | string): DayStatus {
  const day = typeof date === 'string' ? date : karachiDay(date);
  const noon = atNoon(day);
  const hijri = hijriOf(noon);
  const here = onDay(hijri);
  if (here) return { date: day, hijri, level: here.level, observance: here };
  const maxBefore = Math.max(...OBSERVANCES.map(o => o.before));
  for (let k = 1; k <= maxBefore; k++) {
    const ahead = onDay(hijriOf(new Date(noon.getTime() + k * DAY)));
    if (ahead && ahead.level === 'sacred' && k <= ahead.before) return { date: day, hijri, level: 'near', observance: ahead };
  }
  return { date: day, hijri, level: 'clear', observance: null };
}

/** Every day from `from` to `to` (inclusive, Karachi days) that is not clear. */
export function quietDaysBetween(from: string, to: string): DayStatus[] {
  const out: DayStatus[] = [];
  const end = atNoon(to).getTime();
  for (let t = atNoon(from).getTime(); t <= end && out.length < 400; t += DAY) {
    const s = adDayStatus(karachiDay(new Date(t)));
    if (s.level !== 'clear') out.push(s);
  }
  return out;
}

/** The next sacred observances (their first day), for the Guide. */
export function upcomingObservances(from: Date, days = 120): { date: string; hijri: HijriDate; observance: Observance }[] {
  const out: { date: string; hijri: HijriDate; observance: Observance }[] = [];
  const start = atNoon(karachiDay(from)).getTime();
  for (let k = 0; k <= days; k++) {
    const day = karachiDay(new Date(start + k * DAY));
    const h = hijriOf(atNoon(day));
    const o = onDay(h);
    if (o && o.level === 'sacred' && h.day === o.from) out.push({ date: day, hijri: h, observance: o });
  }
  return out;
}
