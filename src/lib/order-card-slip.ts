/**
 * Taheri's order slip in the shape of the printed card the shop hands over (the owner, 2026-11-10: "Redesign the order
 * slip to this format for a5 paper size for taheri. Keep the old one as backup if we don't like this new one").
 *
 * The card: the logo and ORDER SLIP centred at the top (the logo, never the `t` mark: the owner, same day, "Don't use the t
 * mark use the logo only"), then label and ruled line, one under the
 * other — Date, Name, Estimate, Items (and a line more), Advance, Rate, Sample (YES ☐ NO ☐ and a line), Sales Rep —
 * all in Futura Light, grey labels. Here the lines come filled in from the order, in the same face, darker.
 *
 * At the foot, everyone the customer can call, name and number (the owner: "also print everyone's name and number so that
 * they can contact whoever they want"), from the same five contacts the other documents print (NEXT_PUBLIC_STORE_CONTACT1..5).
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
import { FUTURA_LIGHT_TTF } from '@/lib/order-card-assets';
import { STORE_CONFIG, STORE_LOGO_ASPECT } from '@/lib/store-config';
import type { PdfImages } from '@/lib/pdf-inputs';

const FACE = 'FuturaLT';
const LABEL = [85, 85, 85] as const;   // the card's grey
const INK = [26, 26, 26] as const;     // what is written on the lines
const RULE = [120, 120, 120] as const;

/** The slip's currency: the shop's rupees, or another for a customer abroad at a stated rate (owner, 2026-11-24). */
export interface SlipCurrency { code: string; /** Rupees to one of it, e.g. 277 for USD. */ pkrPerUnit: number }
let cur: SlipCurrency | null = null;
const money = (n: number, perGram = false) => {
  if (!cur) return `PKR ${Math.round(n || 0).toLocaleString('en-PK')}`;
  const v = (n || 0) / cur.pkrPerUnit;
  // Whole units for amounts; a rate per gram keeps its cents, or it would read 112 for 111.91.
  return `${cur.code} ${v.toLocaleString('en-US', perGram ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
};

/** "21K · PKR 34,000/g" for each karat the order's gold is in; the silver rate for silver. Nothing when the rates are hidden. */
export function cardRates(order: Order): string {
  if (order.hideRates) return '';
  const rates = (order.ratesApplied || {}) as Record<string, number>;
  const out: string[] = [];
  for (const k of ['24k', '22k', '21k', '18k']) {
    if (order.items.some(i => i.metalType === 'gold' && i.karat === k) && rates[`goldRatePerGram${k}`]) {
      out.push(`${k.toUpperCase()} · ${money(rates[`goldRatePerGram${k}`], true)}/g`);
    }
  }
  if (order.items.some(i => i.metalType === 'silver') && rates.silverRatePerGram) out.push(`Silver · ${money(rates.silverRatePerGram, true)}/g`);
  return out.join('   ');
}

/**
 * One short line per piece: what it is (the customer's words, else its kind), its karat or metal, its estimated weight
 * — "Meena Jhumki · 21K · Est. 5.52g". The detailed slip's long spec ("Bangle · Meena Kara · Gold (21K) · Est. 15.7g")
 * wrapped every piece onto two lines, so a three-piece order ran out of room and its third piece became "and more
 * pieces" (ORD-000124's jhumki, 2026-11-24). Size and stones go on the detailed slip and the order page.
 */
export function cardItems(order: Order): string[] {
  const blocks = buildOrderItemBlocks(order);
  return order.items.map((it, i) => {
    const name = (it.description || '').trim() || blocks[i]?.name || 'Piece';
    const metal = it.metalType === 'gold' && it.karat ? it.karat.toUpperCase()
      : it.metalType ? it.metalType.charAt(0).toUpperCase() + it.metalType.slice(1) : '';
    const weight = !it.isManualPrice && it.estimatedWeightG ? `Est. ${it.estimatedWeightG}g` : '';
    return [name, metal, weight].filter(Boolean).join(' · ');
  });
}

/** What was paid ahead: the cash advances, and gold or stones taken in exchange. */
export function cardAdvance(order: Order): string {
  const cash = order.advancePayment || 0;
  const gold = order.advanceInExchangeValue || 0;
  return [cash > 0 ? money(cash) : '', gold > 0 ? `${money(gold)} in exchange` : ''].filter(Boolean).join(' + ');
}

export interface CardSlipOptions {
  dates?: PdfDates;
  /** The wordmark (the page's or the server's, pdf-inputs.ts); without one the slip goes without a logo. */
  images?: PdfImages;
  /** Amounts in another currency at a stated rate (a customer abroad); rupees when absent. */
  currency?: SlipCurrency;
}

/** Everyone the customer may call: the documents' five contacts that have both a name and a number. */
export const cardContacts = (): [string, string][] => ([
  [STORE_CONFIG.contact1Name, STORE_CONFIG.contact1Number],
  [STORE_CONFIG.contact2Name, STORE_CONFIG.contact2Number],
  [STORE_CONFIG.contact3Name, STORE_CONFIG.contact3Number],
  [STORE_CONFIG.contact4Name, STORE_CONFIG.contact4Number],
  [STORE_CONFIG.contact5Name, STORE_CONFIG.contact5Number],
] as [string, string][]).filter(([n, v]) => n && v);

export function drawCardOrderSlip(order: Order, opts: CardSlipOptions = {}): jsPDF {
  cur = opts.currency ?? null;
  try { return drawCard(order, opts); } finally { cur = null; }
}

function drawCard(order: Order, opts: CardSlipOptions): jsPDF {
  const day = opts.dates?.medium ?? ((iso: string) => format(parseISO(iso), 'd MMM yyyy'));
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  doc.addFileToVFS('FuturaLT-Light.ttf', FUTURA_LIGHT_TTF);
  doc.addFont('FuturaLT-Light.ttf', FACE, 'normal');
  doc.setProperties({ title: `Order slip ${order.id}` });

  const W = doc.internal.pageSize.getWidth();   // 148
  const H = doc.internal.pageSize.getHeight();  // 210
  const left = 16, right = W - 16;
  const lineFrom = 58;                         // where the ruled lines start, as on the card
  const step = 12;                              // label to label
  const extraStep = 10;                         // an item's further lines

  // The logo, centred, then the title and the order's number under it (small, so the slip can be found again in the ERP).
  const logo = opts.images?.logo;
  let top = 10;
  if (logo?.dataUrl) {
    const lH = 7, lW = lH * STORE_LOGO_ASPECT;
    try { doc.addImage(logo.dataUrl, logo.format || 'PNG', (W - lW) / 2, top, lW, lH); top += lH + 6; } catch { /* no logo, no harm */ }
  }
  doc.setFont(FACE, 'normal').setFontSize(13).setTextColor(...LABEL);
  doc.text('ORDER SLIP', W / 2, top + 4, { align: 'center', charSpace: 0.6 });
  doc.setFontSize(8).setTextColor(150);
  // With the day it was promised for, when one was given: what the customer was told.
  doc.text([order.id, order.promisedDate ? `Ready by ${day(order.promisedDate)}` : ''].filter(Boolean).join('   ·   '), W / 2, top + 9, { align: 'center', charSpace: 0.3 });

  // The contacts take the foot; the lines fill what is between.
  const people = cardContacts();
  const footRule = people.length ? H - 26 : H - 10;
  let y = top + 22;
  const rule = (yy: number, from = lineFrom) => {
    doc.setDrawColor(...RULE).setLineWidth(0.25).line(from, yy, right, yy);
  };
  let itemSize = 11;
  const value = (text: string, yy: number, from = lineFrom) => {
    if (!text) return;
    doc.setFont(FACE, 'normal').setFontSize(itemSize).setTextColor(...INK);
    const fitted = doc.splitTextToSize(text, right - from - 2)[0] as string;
    doc.text(fitted, from + 1.5, yy - 1.6);
  };
  const row = (label: string, text: string) => {
    doc.setFont(FACE, 'normal').setFontSize(15).setTextColor(...LABEL);
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
  // As many lines as fit above the four rows still to come (Advance, Rate, Sample, Sales Rep) and the contacts. Every
  // piece is printed if it can be: first at the card's size, then smaller and closer; only past that does the last line
  // point to the order.
  const lay = (size: number, gap: number) => {
    doc.setFont(FACE, 'normal').setFontSize(size);
    const lines = cardItems(order).flatMap(t => (doc.splitTextToSize(t, right - lineFrom - 2) as string[]).map(l => l.replace(/^\s*·\s*/, '')));
    return { size, gap, lines, max: Math.max(2, 1 + Math.floor((footRule - 8 - 3 * step - 4 - (y + step)) / gap)) };
  };
  let fit = lay(11, extraStep);
  if (fit.lines.length > fit.max) fit = lay(9.5, 7.5);
  itemSize = fit.size;
  const wrapped = fit.lines, MAX = fit.max, itemStep = fit.gap;
  const items = wrapped.length > MAX ? [...wrapped.slice(0, MAX - 1), `and more pieces — see ${order.id}`] : wrapped;
  row('Items', items[0] ?? '');
  itemSize = fit.size;
  const more = Math.max(1, items.length - 1);
  for (let i = 0; i < more; i++) {
    const yy = y - 3;
    rule(yy);
    value(items[i + 1] ?? '', yy);
    y += itemStep;
  }
  itemSize = 11;
  y += 2;

  row('Advance', cardAdvance(order));
  row('Rate', cardRates(order));

  // Sample: YES ☐ NO ☐, the right one ticked, and what was left with the shop on the line.
  const samples = order.items.filter(i => i.sampleGiven);
  doc.setFont(FACE, 'normal').setFontSize(15).setTextColor(...LABEL);
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

  // Everyone to call, at the foot: a rule, the heading, then each name over its number, side by side.
  if (people.length) {
    doc.setDrawColor(...RULE).setLineWidth(0.2).line(left, footRule, right, footRule);
    doc.setFont(FACE, 'normal').setFontSize(7.5).setTextColor(...LABEL);
    doc.text('ORDERS & ENQUIRIES', left, footRule + 5, { charSpace: 0.5 });
    const colW = (right - left) / people.length;
    people.forEach(([name, number], i) => {
      const x = left + i * colW;
      doc.setFontSize(9.5).setTextColor(...INK).text(name, x, footRule + 11);
      doc.setFontSize(7.8).setTextColor(...LABEL).text(number, x, footRule + 15.5);
    });
  }
  return doc;
}
