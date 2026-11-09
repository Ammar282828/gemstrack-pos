/**
 * The shipping slip for a TCS booking made from the ERP (op bookTcs; lib/tcs-booking.ts): a 4 × 6 inch label (fits A6 too)
 * to tape on the parcel. The house's name and address as sender, the receiver's block, the consignment number as a
 * Code 128 barcode with its digits, the cash to collect large, weight and pieces, the order's reference and the day.
 * Nothing on it says what is inside.
 *
 * drawShippingSlipPdf is pure (takes what it prints, touches no page); saveShippingSlip is the browser's, through savePDF.
 */

import jsPDF from 'jspdf';
import { code128Widths } from '@/lib/code128';
import type { TcsBooking } from '@/lib/tcs-booking';

export interface ShippingSlipShop { name: string; address?: string; phone?: string }

export const shippingSlipFileName = (b: Pick<TcsBooking, 'cn'>) => `TCS-${b.cn}.pdf`;

const W = 101.6, H = 152.4, M = 5;

function karachiDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** Bars for `text` across `width` mm at (x, y), `height` tall. */
function drawCode128(pdf: jsPDF, text: string, x: number, y: number, width: number, height: number) {
  const widths = code128Widths(text);
  const modules = widths.reduce((a, b) => a + b, 0);
  const unit = width / modules;
  let at = x;
  pdf.setFillColor(0, 0, 0);
  widths.forEach((w, i) => {
    if (i % 2 === 0) pdf.rect(at, y, w * unit, height, 'F');
    at += w * unit;
  });
}

export function drawShippingSlipPdf(b: TcsBooking, shop: ShippingSlipShop): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, H] });
  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.4);
  let y = M + 4;

  // Carrier and day.
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
  pdf.text('TCS', M, y);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  pdf.text(`Overnight · ${karachiDay(b.bookedAt)}`, W - M, y, { align: 'right' });
  y += 3;
  pdf.line(M, y, W - M, y);

  // Barcode and the number.
  y += 3;
  const bw = W - 2 * M - 8;
  drawCode128(pdf, b.cn, M + 4, y, bw, 16);
  y += 21;
  pdf.setFont('courier', 'bold'); pdf.setFontSize(15);
  pdf.text(b.cn, W / 2, y, { align: 'center' });
  y += 3;
  pdf.line(M, y, W - M, y);

  // To.
  y += 5;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
  pdf.text('TO', M, y);
  y += 5;
  pdf.setFontSize(13);
  pdf.text(pdf.splitTextToSize(b.consignee.name, W - 2 * M) as string[], M, y);
  y += 5.5;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  const addr = (pdf.splitTextToSize(b.consignee.address, W - 2 * M) as string[]).slice(0, 4);
  pdf.text(addr, M, y);
  y += addr.length * 4.4 + 1.5;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
  pdf.text(b.destinationCity.toUpperCase(), M, y + 1);
  pdf.setFontSize(11);
  pdf.text(b.consignee.mobile, W - M, y + 1, { align: 'right' });
  y += 5;
  pdf.line(M, y, W - M, y);

  // Cash to collect.
  y += 2;
  const boxH = 17;
  pdf.setLineWidth(0.8);
  pdf.rect(M, y, W - 2 * M, boxH);
  pdf.setLineWidth(0.4);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
  pdf.text(b.codAmount > 0 ? 'COLLECT CASH (COD)' : 'PAID', M + 3, y + 4.5);
  pdf.setFontSize(b.codAmount > 0 ? 22 : 16);
  pdf.text(b.codAmount > 0 ? `PKR ${b.codAmount.toLocaleString('en-PK')}` : 'Nothing to collect', W / 2, y + 13, { align: 'center' });
  y += boxH + 5;

  // Weight, pieces, reference.
  const cells: [string, string][] = [['WEIGHT', `${b.weight} kg`], ['PIECES', String(b.pieces)], ['ORDER', b.reference]];
  const cw = (W - 2 * M) / cells.length;
  cells.forEach(([k, v], i) => {
    const x = M + i * cw;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5);
    pdf.text(k, x, y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    pdf.text(pdf.splitTextToSize(v, cw - 2)[0] as string, x, y + 4.5);
  });
  y += 8;
  pdf.line(M, y, W - M, y);

  // From.
  y += 4.5;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
  pdf.text(`FROM · ${b.originCity.toUpperCase()}`, M, y);
  y += 4.5;
  pdf.setFontSize(10);
  pdf.text(shop.name, M, y);
  y += 4;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  const from = (pdf.splitTextToSize([shop.address, shop.phone].filter(Boolean).join(' · '), W - 2 * M) as string[]).slice(0, 3);
  if (from.length) pdf.text(from, M, y);

  // The number again at the foot, for the counter's own copy torn off.
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5);
  pdf.text(`CN ${b.cn} · ${b.reference}`, W / 2, H - M + 1, { align: 'center' });
  return pdf;
}

/** The browser's: draw it and hand it to the share sheet or a download (lib/utils.ts savePDF). */
export async function saveShippingSlip(b: TcsBooking, shop: ShippingSlipShop, iOSWin: Window | null): Promise<void> {
  const { savePDF } = await import('@/lib/utils');
  await savePDF(drawShippingSlipPdf(b, shop), shippingSlipFileName(b), iOSWin, { title: `TCS ${b.cn}` });
}
