/**
 * Charts for the monthly report, drawn with jsPDF's own primitives (lines, rectangles, text):
 * no image, no chart library, so they stay sharp at any zoom and run in Node as in the browser.
 * Bars for a month's days, lines for twelve months' trend, ranked bars for the rest.
 *
 * Coloured by the house: the document's maroon first, the house's own accent second (Taheri's
 * gold; Mina's accent is the maroon itself, so a tint of it stands in).
 */

import type jsPDF from 'jspdf';
import { axisLac } from '@/lib/money';
import { STORE_PALETTE } from '@/lib/store-config';
import { BRAND, INK, MUTED, RULE } from '@/lib/pdf-chrome';

type RGB = readonly [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as unknown as RGB;
const distance = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The two series colours of this house's charts. */
export function chartColours(): { primary: RGB; second: RGB; soft: RGB; up: RGB; down: RGB } {
  const accent = hex(STORE_PALETTE.light.accent);
  const second = distance(accent, BRAND) < 70 ? mix(BRAND, [255, 255, 255], 0.5) : accent;
  return { primary: BRAND, second, soft: mix(BRAND, [255, 255, 255], 0.82), up: [38, 112, 62], down: [170, 40, 40] };
}

const fill = (doc: jsPDF, c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
const stroke = (doc: jsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
const ink = (doc: jsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

/** A step for an axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceStep(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** An axis that holds [min, max] (and zero) on whole steps, about three of them. */
export function niceScale(min: number, max: number): { lo: number; hi: number; step: number } {
  const lo0 = Math.min(0, min), hi0 = Math.max(0, max);
  const step = niceStep((hi0 - lo0) / 3);
  return { lo: Math.floor(lo0 / step) * step, hi: Math.max(step, Math.ceil(hi0 / step) * step), step };
}

interface Box { x: number; y: number; w: number; h: number }

/** Light grid lines with the value at each, over the plot's left gutter. Returns the plot area and its scale. */
function axes(doc: jsPDF, box: Box, lo: number, hi: number, step: number, gutter = 11) {
  const px = box.x + gutter, pw = box.w - gutter;
  const py = box.y, ph = box.h;
  const at = (v: number) => py + ph - ((v - lo) / (hi - lo || 1)) * ph;
  doc.setFont('helvetica', 'normal').setFontSize(6);
  for (let v = lo; v <= hi + step / 1000; v += step) {
    const yy = at(v);
    stroke(doc, RULE);
    doc.setLineWidth(v === 0 ? 0.25 : 0.1);
    doc.line(px, yy, px + pw, yy);
    ink(doc, MUTED);
    doc.text(axisLac(v), px - 1.5, yy + 1, { align: 'right' });
  }
  doc.setLineWidth(0.2);
  return { px, pw, py, ph, at };
}

/** Bars, one per value, labelled at the given indexes underneath. */
export function barChart(doc: jsPDF, box: Box, values: number[], labels: (i: number) => string, colour: RGB, opts: { highlight?: RGB } = {}): void {
  const sc = niceScale(0, Math.max(...values, 0));
  const a = axes(doc, { ...box, h: box.h - 5 }, sc.lo, sc.hi, sc.step);
  const slot = a.pw / Math.max(1, values.length);
  const bw = Math.max(0.6, slot * 0.68);
  const best = values.indexOf(Math.max(...values));
  values.forEach((v, i) => {
    const x = a.px + i * slot + (slot - bw) / 2;
    if (v > 0) {
      fill(doc, i === best && opts.highlight ? opts.highlight : colour);
      doc.rect(x, a.at(v), bw, a.py + a.ph - a.at(v), 'F');
    }
    const l = labels(i);
    if (l) {
      doc.setFont('helvetica', 'normal').setFontSize(6);
      ink(doc, MUTED);
      doc.text(l, x + bw / 2, a.py + a.ph + 3.4, { align: 'center' });
    }
  });
  ink(doc, INK);
}

export interface Line { name: string; values: number[]; colour: RGB }

/** Lines over shared labels; the last point is hollow when that month is still running. */
export function lineChart(doc: jsPDF, box: Box, lines: Line[], labels: string[], opts: { lastIsPartial?: boolean } = {}): void {
  const all = lines.flatMap(l => l.values);
  const sc = niceScale(Math.min(...all, 0), Math.max(...all, 0));
  const a = axes(doc, { ...box, h: box.h - 5 }, sc.lo, sc.hi, sc.step);
  const inset = 2;
  const xAt = (i: number) => a.px + inset + (i * (a.pw - 2 * inset)) / Math.max(1, labels.length - 1);
  labels.forEach((l, i) => {
    doc.setFont('helvetica', 'normal').setFontSize(6);
    ink(doc, MUTED);
    doc.text(l, xAt(i), a.py + a.ph + 3.4, { align: 'center' });
  });
  for (const line of lines) {
    stroke(doc, line.colour);
    doc.setLineWidth(0.55);
    for (let i = 1; i < line.values.length; i++) doc.line(xAt(i - 1), a.at(line.values[i - 1]), xAt(i), a.at(line.values[i]));
    line.values.forEach((v, i) => {
      const hollow = opts.lastIsPartial && i === line.values.length - 1;
      fill(doc, hollow ? [255, 255, 255] : line.colour);
      doc.setLineWidth(0.4);
      doc.circle(xAt(i), a.at(v), 0.9, hollow ? 'FD' : 'F');
    });
  }
  doc.setLineWidth(0.2);
  ink(doc, INK);
}

/** A legend of swatches, left to right, on one line. */
export function legend(doc: jsPDF, x: number, y: number, items: { name: string; colour: RGB }[]): void {
  let xx = x;
  doc.setFont('helvetica', 'normal').setFontSize(6.5);
  for (const it of items) {
    fill(doc, it.colour);
    doc.rect(xx, y - 2, 3, 2, 'F');
    ink(doc, MUTED);
    doc.text(it.name, xx + 4.2, y);
    xx += 4.2 + doc.getTextWidth(it.name) + 5;
  }
  ink(doc, INK);
}

export interface HBar { label: string; value: number; note?: string }

/**
 * Ranked bars: the name over a bar sized to the biggest, the amount at its end. Returns the y
 * below the last row.
 */
export function hBars(doc: jsPDF, x: number, y: number, w: number, rows: HBar[], colour: RGB, fmt: (v: number) => string, empty = 'Nothing this month.'): number {
  if (!rows.length) {
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    ink(doc, MUTED);
    doc.text(empty, x, y + 3);
    ink(doc, INK);
    return y + 6;
  }
  const max = Math.max(...rows.map(r => r.value), 1);
  const valueW = 24;
  let yy = y;
  for (const r of rows) {
    doc.setFont('helvetica', 'normal').setFontSize(7.2);
    ink(doc, INK);
    const name = doc.splitTextToSize(r.label, w - valueW)[0] as string;
    doc.text(name, x, yy + 2.4);
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(r.value), x + w, yy + 2.4, { align: 'right' });
    const vw = doc.getTextWidth(fmt(r.value));
    fill(doc, [240, 236, 236]);
    doc.rect(x, yy + 3.6, w, 1.6, 'F');
    fill(doc, colour);
    doc.rect(x, yy + 3.6, Math.max(0.4, (w * Math.max(0, r.value)) / max), 1.6, 'F');
    if (r.note) {
      doc.setFont('helvetica', 'normal').setFontSize(6);
      ink(doc, MUTED);
      doc.text(r.note, x + w - vw - 2, yy + 2.4, { align: 'right' });
    }
    yy += 7.6;
  }
  ink(doc, INK);
  return yy;
}
