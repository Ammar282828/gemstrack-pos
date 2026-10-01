/**
 * What every WhatsApp alert and report to the shop's own numbers is: a document, sent as a PDF
 * (owner, 2026-10-01: "send all whatsapp messages/alerts/reports as proper structured pdfs only").
 *
 * A builder (alerts.ts for a sale, a payment, an order; reports.ts for the scheduled reports)
 * returns one of these; doc-pdf.ts draws it on a phone-shaped page; send-doc.ts sends it. The
 * file name is the headline, because there is no caption: it is what the phone's notification
 * and the chat list show, and what WhatsApp's search finds.
 *
 * Pure, so the builders can be tested without a PDF.
 */

import { POS_LABEL } from '@/lib/notify-label';

/** The one colour is the brand's: 'flag' marks what needs the owner (late, unpaid, a loss); 'muted' what doesn't count. */
export type Tone = 'flag' | 'muted';

export interface Figure { label: string; value: string; note?: string; tone?: Tone }

export interface Column { label: string; align?: 'left' | 'right'; /** mm; omitted is the rest of the width. */ width?: number }

export interface Table {
  columns: Column[];
  rows: string[][];
  /** Per row, by index. */
  tones?: (Tone | undefined)[];
  /** Under each row, smaller and muted (an order's summary, a payment's reference). */
  details?: (string | undefined)[];
  foot?: string[];
}

export interface Section {
  title: string;
  /** Right of the title, small: what the list is, how it counts. */
  note?: string;
  figures?: Figure[];
  /** Label left, value right. */
  pairs?: { label: string; value: string; tone?: Tone; strong?: boolean }[];
  table?: Table;
  text?: string[];
  /** Said when the section has nothing in it, instead of leaving it out. */
  empty?: string;
}

export interface AlertDoc {
  /** 'sale', 'payment', 'daily-report' … for the log. */
  kind: string;
  /** The document's name, top right and in the file name: "New sale", "Daily report". */
  title: string;
  /** The big line: an invoice number, a date. */
  heading: string;
  /** Under it: the customer, the period. */
  subheading?: string;
  /** What the file is called after the house and the title: "INV-000083 · Rashida Modi · PKR 321,700". */
  headline: string;
  figures?: Figure[];
  sections: Section[];
  footnote?: string;
  /** When it was made. */
  at: Date;
}

const KARACHI = 'Asia/Karachi';

/** Whole rupees, grouped: 321,700. */
export const rs = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('en-PK');
export const pkr = (n: unknown) => `PKR ${rs(n)}`;
export const grams = (g: number) => `${Math.abs(g).toFixed(2)} g`;

/** "1 Oct" in Karachi; a bare yyyy-mm-dd is that day. */
export function shortDay(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00+05:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { timeZone: KARACHI, day: 'numeric', month: 'short' }).format(d);
}

/** "Wednesday 1 October 2026". */
export const longDay = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: KARACHI, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d).replace(',', '');

/** "1 Oct 2026, 9:05 pm". */
export const stamp = (d: Date | string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: KARACHI, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(typeof d === 'string' ? new Date(d) : d).replace(/\b(am|pm)\b/i, m => m.toLowerCase());

/** "9:05 pm". */
export const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: KARACHI, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).toLowerCase();

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Characters a file name can't carry on a phone or a desktop, and the emoji the old texts wore. */
const UNSAFE = /[\\/:*?"<>|\r\n\t]|[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

/**
 * "Taheri ERP · New sale · INV-000083 · Rashida Modi · PKR 321,700.pdf". The house first, since
 * the owner gets both houses' documents on one phone (lib/notify-label.ts).
 */
export function docFileName(d: Pick<AlertDoc, 'title' | 'headline'>, label = POS_LABEL): string {
  const name = [label, d.title, d.headline].map(s => String(s ?? '').replace(/(\d):(\d)/g, '$1.$2').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
  return `${name.length > 150 ? `${name.slice(0, 149).trimEnd()}…` : name}.pdf`;
}

/** The document as a few lines of text, for Settings' "last sent" and the log. */
export function docPreview(d: AlertDoc): string {
  const figs = (d.figures ?? []).map(f => `${f.label}: ${f.value}`).join(' · ');
  return [docFileName(d), figs].filter(Boolean).join('\n').slice(0, 300);
}
