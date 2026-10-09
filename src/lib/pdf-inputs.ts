/**
 * What a printed document is drawn with that is not the record itself: the wordmark in its
 * header, the codes in its footer, and how it writes a day.
 *
 * Handed to the one builder of each document (lib/invoice-pdf.ts, lib/order-slip-pdf.ts) rather
 * than looked for by it, so the same builder draws in the browser and on the server — the iPhone
 * app's PDFs and the shop line's WhatsApp send (lib/app-pdf.ts). The browser's are what it always
 * used: the logo loaded once (pdf-logo.ts) and the hidden <QRCode> canvases the printing page
 * renders under these ids. The server's are in pdf-inputs-server.ts.
 */

import type { jsPDF } from 'jspdf';
import { drawDocFooter } from '@/lib/pdf-chrome';
import { loadPdfLogo } from '@/lib/pdf-logo';

/** A footer code: the page's canvas, or a PNG data URL (the server has no canvas). */
export type PdfCode = HTMLCanvasElement | string | null | undefined;

export interface PdfImages {
  /** The wordmark, ready for addImage; none and the header goes without. */
  logo?: { dataUrl: string; format: string } | null;
  /** The one code to the shop's link page; without it, WhatsApp's and Instagram's. */
  linksQr?: PdfCode;
  whatsappQr?: PdfCode;
  instagramQr?: PdfCode;
}

/**
 * How a document writes a day. Left out, each builder writes it as it always has, on the
 * device's clock and in its language; the server, whose clock is UTC, passes KARACHI_DATES so a
 * sale rung up after midnight in the shop is not printed as the day before.
 */
export interface PdfDates {
  /** The invoice's "Date:" (toLocaleDateString): 09/10/2026. */
  short: (iso: string) => string;
  /** date-fns 'PP': Oct 9, 2026. */
  medium: (iso: string) => string;
  /** date-fns 'd MMM yyyy': 9 Oct 2026 (the slip's advances). */
  dayMonthYear: (iso: string) => string;
}

/** The browser's pictures: the logo (once per session) and the printing page's hidden code canvases. */
export async function browserPdfImages(): Promise<PdfImages> {
  const logo = await loadPdfLogo();
  const canvas = (id: string) =>
    typeof document === 'undefined' ? null : (document.getElementById(id) as HTMLCanvasElement | null);
  return {
    logo: logo ? { dataUrl: logo.dataUrl, format: logo.format } : null,
    linksQr: canvas('links-qr-code'),
    whatsappQr: canvas('wa-qr-code'),
    instagramQr: canvas('insta-qr-code'),
  };
}

/**
 * drawDocFooter reads a code with canvas.toDataURL('image/png'). A data URL already is that, so
 * the server's codes are handed over in the one shape the footer asks for.
 */
const asCanvas = (c: PdfCode): HTMLCanvasElement | null =>
  typeof c === 'string' ? ({ toDataURL: () => c } as unknown as HTMLCanvasElement) : c ?? null;

/** The shared footer (pdf-chrome.ts) with these codes. */
export function drawFooter(
  doc: jsPDF,
  box: { pageWidth: number; pageHeight: number; margin: number },
  images: PdfImages,
): void {
  drawDocFooter(doc, {
    ...box,
    linksQr: asCanvas(images.linksQr),
    whatsappQr: asCanvas(images.whatsappQr),
    instagramQr: asCanvas(images.instagramQr),
  });
}

// ── days, as the shop reads them ────────────────────────────────────────────

const KARACHI = 'Asia/Karachi';

/** The instant to print; a plain day ("2026-10-12", a promised date) is that day wherever it is read. */
const instant = (iso: string): Date | null => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+05:00`) : new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

/** Day, month (Jan … Dec, as date-fns spells them) and year, in Karachi. */
const parts = (d: Date) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: KARACHI, day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return { day: get('day'), month: get('month'), year: get('year') };
};

export const KARACHI_DATES: PdfDates = {
  short: iso => {
    const d = instant(iso);
    return d ? d.toLocaleDateString('en-GB', { timeZone: KARACHI }) : '';
  },
  medium: iso => {
    const d = instant(iso);
    if (!d) return '';
    const { day, month, year } = parts(d);
    return `${month} ${day}, ${year}`;
  },
  dayMonthYear: iso => {
    const d = instant(iso);
    if (!d) return '';
    const { day, month, year } = parts(d);
    return `${day} ${month} ${year}`;
  },
};
