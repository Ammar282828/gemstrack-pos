/**
 * Taheri's order slip in the shape of the printed card the shop hands over (the owner, 2026-11-10: "Redesign the order
 * slip to this format for a5 paper size for taheri. Keep the old one as backup if we don't like this new one").
 *
 * The card: ORDER SLIP centred at the top, the `t` monogram in the corner, then label and ruled line, one under the
 * other — Date, Name, Estimate, Items (and a line more), Advance, Rate, Sample (YES ☐ NO ☐ and a line), Sales Rep —
 * all in Futura Light, grey labels. Here the lines come filled in from the order, in the same face, darker.
 *
 * Which slip a house prints is NEXT_PUBLIC_STORE_ORDER_SLIP (lib/order-slip-pdf.ts): `card` for Taheri; anything else,
 * Mina included, keeps the detailed slip, which stays as it was — the backup the owner asked for.
 */

import jsPDF from 'jspdf';
import { format, parseISO } from 'date-fns';
import type { Order } from '@/lib/store';
import type { PdfDates } from '@/lib/pdf-inputs';
import { buildOrderItemBlocks } from '@/lib/order-slip';
import { orderFullTotal } from '@/lib/order-payment';
import { FUTURA_LIGHT_TTF, T_MONOGRAM_PNG, T_MONOGRAM_ASPECT } from '@/lib/order-card-assets';

const FACE = 'FuturaLT';
const LABEL = [85, 85, 85] as const;   // the card's grey
const INK = [26, 26, 26] as const;     // what is written on the lines
const RULE = [120, 120, 120] as const;

const money = (n: number) => `PKR ${Math.round(n || 0).toLocaleString('en-PK')}`;

/** "21K · PKR 34,000/g" for each karat the order's gold is in; the silver rate for silver. Nothing when the rates are hidden. */
export function cardRates(order: Order): string {
  if (order.hideRates) return '';
  const rates = (order.ratesApplied || {}) as Record<string, number>;
  const out: string[] = [];
  for (const k of ['24k', '22k', '21k', '18k']) {
    if (order.items.some(i => i.metalType === 'gold' && i.karat === k) && rates[`goldRatePerGram${k}`]) {
      out.push(`${k.toUpperCase()} · ${money(rates[`goldRatePerGram${k}`])}/g`);
    }
  }
  if (order.items.some(i => i.metalType === 'silver') && rates.silverRatePerGram) out.push(`Silver · ${money(rates.silverRatePerGram)}/g`);
  return out.join('   ');
}

/** One line per piece: what it is, then its metal, weight and size (the detailed slip's spec, shortened to fit a line). */
export function cardItems(order: Order): string[] {
  return buildOrderItemBlocks(order).map(b => [b.name, b.spec].filter(Boolean).join(' · ').replace(/\s+·\s+/g, ' · '));
}

/** What was paid ahead: the cash advances, and gold or stones taken in exchange. */
export function cardAdvance(order: Order): string {
  const cash = order.advancePayment || 0;
  const gold = order.advanceInExchangeValue || 0;
  return [cash > 0 ? money(cash) : '', gold > 0 ? `${money(gold)} in exchange` : ''].filter(Boolean).join(' + ');
}

export interface CardSlipOptions { dates?: PdfDates }

export function drawCardOrderSlip(order: Order, opts: CardSlipOptions = {}): jsPDF {
  const day = opts.dates?.medium ?? ((iso: string) => format(parseISO(iso), 'd MMM yyyy'));
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  doc.addFileToVFS('FuturaLT-Light.ttf', FUTURA_LIGHT_TTF);
  doc.addFont('FuturaLT-Light.ttf', FACE, 'normal');
  doc.setProperties({ title: `Order slip ${order.id}` });

  const W = doc.internal.pageSize.getWidth();   // 148
  const H = doc.internal.pageSize.getHeight();  // 210
  const left = 16, right = W - 16;
  const lineFrom = 58;                         // where the ruled lines start, as on the card
  const step = 15;                              // label to label

  // The monogram, top right, and the title centred.
  const mH = 13, mW = mH * T_MONOGRAM_ASPECT;
  doc.addImage(T_MONOGRAM_PNG, 'PNG', right - mW, 12, mW, mH);
  doc.setFont(FACE, 'normal').setFontSize(14).setTextColor(...LABEL);
  doc.text('ORDER SLIP', W / 2, 23, { align: 'center', charSpace: 0.6 });
  // The order's number, small, so the slip can be found again in the ERP.
  doc.setFontSize(8).setTextColor(150);
  doc.text(order.id, W / 2, 28.5, { align: 'center', charSpace: 0.3 });

  let y = 46;
  const rule = (yy: number, from = lineFrom) => {
    doc.setDrawColor(...RULE).setLineWidth(0.25).line(from, yy, right, yy);
  };
  const value = (text: string, yy: number, from = lineFrom) => {
    if (!text) return;
    doc.setFont(FACE, 'normal').setFontSize(11).setTextColor(...INK);
    const fitted = doc.splitTextToSize(text, right - from - 2)[0] as string;
    doc.text(fitted, from + 1.5, yy - 1.6);
  };
  const row = (label: string, text: string) => {
    doc.setFont(FACE, 'normal').setFontSize(16).setTextColor(...LABEL);
    doc.text(`${label}:`, left, y);
    rule(y + 0.8);
    value(text, y + 0.8);
    y += step;
  };

  row('Date', day(order.createdAt));
  row('Name', order.customerName || 'Walk-in');
  row('Estimate', money(orderFullTotal(order)));

  // Items: the first piece on its own line, each further piece on a line below; at least the card's one spare line.
  // A long piece runs on to the next line rather than being cut.
  doc.setFont(FACE, 'normal').setFontSize(11);
  // At most seven lines, so the page holds everything below them; more than that, the last says how many more.
  const wrapped = cardItems(order).flatMap(t => (doc.splitTextToSize(t, right - lineFrom - 2) as string[]).map(l => l.replace(/^\s*·\s*/, '')));
  const MAX = 7;
  const items = wrapped.length > MAX ? [...wrapped.slice(0, MAX - 1), `and more — see ${order.id}`] : wrapped;
  row('Items', items[0] ?? '');
  const more = Math.max(1, items.length - 1);
  for (let i = 0; i < more; i++) {
    const yy = y - 3;
    rule(yy);
    value(items[i + 1] ?? '', yy);
    y += 11;
  }
  y += 4;

  row('Advance', cardAdvance(order));
  row('Rate', cardRates(order));

  // Sample: YES ☐ NO ☐, the right one ticked, and what was left with the shop on the line.
  const samples = order.items.filter(i => i.sampleGiven);
  doc.setFont(FACE, 'normal').setFontSize(16).setTextColor(...LABEL);
  doc.text('Sample:', left, y);
  const box = 5.2, by = y - box + 0.6;
  doc.setFontSize(8).text('YES', 52, y - 0.6);
  doc.setDrawColor(...LABEL).setLineWidth(0.4).rect(59, by, box, box);
  doc.text('NO', 70, y - 0.6);
  doc.rect(76, by, box, box);
  const tick = (x: number) => {
    doc.setDrawColor(...INK).setLineWidth(0.6);
    doc.line(x + 1.1, by + box * 0.55, x + box * 0.42, by + box - 1.1);
    doc.line(x + box * 0.42, by + box - 1.1, x + box - 0.9, by + 1);
  };
  tick(samples.length ? 59 : 76);
  rule(y + 0.8, 86);
  value(samples.map(s => buildOrderItemBlocks({ ...order, items: [s] })[0]?.name).filter(Boolean).join(', '), y + 0.8, 86);
  y += step;

  row('Sales Rep', order.takenBy || '');

  // Promised by, small at the foot, when one was given: what the customer was told.
  if (order.promisedDate) {
    doc.setFont(FACE, 'normal').setFontSize(9).setTextColor(130);
    doc.text(`Ready by ${day(order.promisedDate)}`, left, Math.min(y + 4, H - 14));
  }
  return doc;
}
