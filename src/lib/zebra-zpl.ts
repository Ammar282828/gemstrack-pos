/**
 * The tag layout (lib/label-layout.ts) as ZPL for a Zebra printer, and the numbers and words that go on it.
 * Written to be ported line for line: ERPCore's Zpl.swift makes the same string from the same layout, and the
 * two test files hold them to it.
 *
 * - A label takes `tags` pieces (2 for a double tag); a placeholder `{SKU_2}` reads piece 2 of its label, `{sku}`
 *   (no number) piece 1. A tag with no piece (the odd last one) prints blank. A key that means nothing stays as typed,
 *   so a typo shows on the tag.
 * - `{date}`, `{date:d MMM yyyy}`, `{time}`, `{counter:START:STEP:PAD}`, and after a pipe `{price|prefix:Rs |suffix:/-}`,
 *   `{name|upper}`, `{name|lower}`, `{weight|fixed:2}`, `{price|group}`, `{name|max:18}`.
 * - Text is sent with ^FH\ so a ^, ~ or \ in a name prints as itself.
 * - A field's x, y is the top-left corner of its rotated box (what ^FO means), so rotation never moves the corner.
 */

import { bitmapHex } from '@/lib/label-bitmap';
import { BASE_HEADERS } from '@/lib/label-csv';
import { LABEL_FIELDS, type LabelValues } from '@/lib/label-live';
import { printerOf, tagsOfLayout, type LabelField, type StoredLabelLayout } from '@/lib/label-layout';

export interface RenderOptions {
  /** Copies of each label (^PQ), 1 when unset. */
  copies?: number;
  /** Blank labels before the first, for a roll already part used. */
  skip?: number;
  /** Where `{counter}` starts, instead of the START the placeholder carries. */
  counterStart?: number;
  now?: Date;
}

// ── Numbers ───────────────────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clampInt = (v: unknown, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(num(v))));
/** A position or size in dots: whole, never negative (^FO takes no negative), within ZPL's 32000. */
const dots = (v: unknown): number => clampInt(v, 0, 32000);
const size = (v: unknown, dflt: number): number => (num(v) >= 0.5 ? clampInt(v, 1, 32000) : dflt);

// ── The date and the counter ──────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KARACHI_MS = 5 * 3600 * 1000;
const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * A moment in Karachi time by a pattern: yyyy yy, MMMM MMM MM M, dd d, EEEE EEE, HH H, hh h, mm m, ss s, a (AM/PM);
 * 'quoted' text and every other character as typed.
 */
export function formatLabelDate(pattern: string, at: Date): string {
  const k = new Date(at.getTime() + KARACHI_MS);
  const year = k.getUTCFullYear(), month = k.getUTCMonth(), day = k.getUTCDate(), wd = k.getUTCDay();
  const hour = k.getUTCHours(), minute = k.getUTCMinutes(), second = k.getUTCSeconds();
  let out = '';
  for (let i = 0; i < pattern.length;) {
    const c = pattern[i];
    if (c === "'") {
      // '' is one quote; otherwise everything up to the next quote is text as typed.
      if (pattern[i + 1] === "'") { out += "'"; i += 2; continue; }
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== "'") out += pattern[j++];
      i = j + 1;
      continue;
    }
    if (!'yMdEHhmsa'.includes(c)) { out += c; i++; continue; }
    let n = 1;
    while (pattern[i + n] === c) n++;
    i += n;
    switch (c) {
      case 'y': out += n === 2 ? pad(year % 100, 2) : pad(year, n); break;
      case 'M': out += n >= 4 ? MONTHS[month] : n === 3 ? MONTHS[month].slice(0, 3) : pad(month + 1, n); break;
      case 'd': out += pad(day, n >= 2 ? 2 : 1); break;
      case 'E': out += n >= 4 ? DAYS[wd] : DAYS[wd].slice(0, 3); break;
      case 'H': out += pad(hour, n >= 2 ? 2 : 1); break;
      case 'h': out += pad(hour % 12 === 0 ? 12 : hour % 12, n >= 2 ? 2 : 1); break;
      case 'm': out += pad(minute, n >= 2 ? 2 : 1); break;
      case 's': out += pad(second, n >= 2 ? 2 : 1); break;
      default: out += hour < 12 ? 'AM' : 'PM';
    }
  }
  return out;
}

/** `START:STEP:PAD` (each optional) → the number for label `labelIndex`, zero padded. */
function counterText(arg: string, labelIndex: number, override: number | undefined): string {
  const parts = arg.split(':');
  const read = (s: string | undefined, dflt: number): number => {
    const t = (s ?? '').trim();
    if (t === '') return dflt;
    const v = Number(t);
    return Number.isFinite(v) ? Math.trunc(v) : dflt;
  };
  const start = override !== undefined && Number.isFinite(override) ? Math.trunc(override) : read(parts[0], 1);
  const step = read(parts[1], 1);
  const width = clampInt(read(parts[2], 0), 0, 20);
  const value = start + labelIndex * step;
  return (value < 0 ? '-' : '') + pad(Math.abs(value), width);
}

// ── Placeholders ──────────────────────────────────────────────────────────

const PIECE_KEYS = new Set<string>(LABEL_FIELDS.map((f) => f.key));
const CSV_COLUMNS = new Set<string>(BASE_HEADERS);

interface Context { pieces: LabelValues[]; labelIndex: number; now: Date; counterStart?: number }

/** One key's value from piece n of the label ('' for a known key with no piece), or null for a key that means nothing. */
function lookup(key: string, ctx: Context): string | null {
  const known = (k: string, n: number): string | null => {
    const piece = ctx.pieces[n - 1] as Record<string, string | undefined> | undefined;
    if (piece && typeof piece[k] === 'string') return piece[k] as string;
    if (PIECE_KEYS.has(k)) return '';
    const lower = k.toLowerCase();
    if (CSV_COLUMNS.has(lower)) return piece?.[`csv:${lower}`] ?? '';
    return null;
  };
  const direct = known(key, 1);
  if (direct !== null) return direct;
  const m = /^(.*)_(\d+)$/.exec(key);
  if (m && Number(m[2]) >= 1) return known(m[1], Number(m[2]));
  return null;
}

/** 12500 → 12,500 in the first number of the text, the rest as it is. */
function group(value: string): string {
  let i = 0;
  while (i < value.length && !(value[i] >= '0' && value[i] <= '9')) i++;
  if (i === value.length) return value;
  let j = i;
  while (j < value.length && ((value[j] >= '0' && value[j] <= '9') || value[j] === ',')) j++;
  const whole = value.slice(i, j).replace(/,/g, '');
  let k = j;
  if (value[k] === '.' && value[k + 1] >= '0' && value[k + 1] <= '9') { k++; while (k < value.length && value[k] >= '0' && value[k] <= '9') k++; }
  let grouped = '';
  for (let p = 0; p < whole.length; p++) {
    if (p > 0 && (whole.length - p) % 3 === 0) grouped += ',';
    grouped += whole[p];
  }
  return value.slice(0, i) + grouped + (j < k ? value.slice(j, k) : '') + value.slice(Math.max(j, k));
}

function transform(value: string, spec: string): string {
  const colon = spec.indexOf(':');
  const name = colon < 0 ? spec : spec.slice(0, colon);
  const arg = colon < 0 ? '' : spec.slice(colon + 1);
  switch (name) {
    case 'prefix': return value === '' ? value : arg + value;
    case 'suffix': return value === '' ? value : value + arg;
    case 'upper': return value.toUpperCase();
    case 'lower': return value.toLowerCase();
    case 'fixed': {
      const n = parseFloat(value);
      const digits = Number(arg.trim());
      if (!Number.isFinite(n) || Math.abs(n) >= 1e21 || !Number.isFinite(digits) || arg.trim() === '') return value;
      return n.toFixed(clampInt(digits, 0, 20));
    }
    case 'group': return group(value);
    case 'max': {
      const n = Number(arg.trim());
      if (!Number.isFinite(n) || arg.trim() === '') return value;
      return Array.from(value).slice(0, Math.max(0, Math.trunc(n))).join('');
    }
    default: return value;
  }
}

/** The text with every `{…}` worked out. */
function fill(template: string, ctx: Context): string {
  let out = '';
  for (let i = 0; i < template.length;) {
    if (template[i] !== '{') { out += template[i++]; continue; }
    let j = i + 1;
    while (j < template.length && template[j] !== '}' && template[j] !== '{') j++;
    if (j >= template.length || template[j] !== '}') { out += template[i++]; continue; }
    const token = template.slice(i, j + 1);
    const inner = template.slice(i + 1, j);
    const bar = inner.indexOf('|');
    const head = bar < 0 ? inner : inner.slice(0, bar);
    const colon = head.indexOf(':');
    const name = (colon < 0 ? head : head.slice(0, colon)).toLowerCase();
    const arg = colon < 0 ? '' : head.slice(colon + 1);
    let value: string | null;
    if (name === 'date') value = formatLabelDate(arg === '' ? 'd MMM yyyy' : arg, ctx.now);
    else if (name === 'time') value = formatLabelDate(arg === '' ? 'HH:mm' : arg, ctx.now);
    else if (name === 'counter') value = counterText(arg, ctx.labelIndex, ctx.counterStart);
    else value = lookup(head, ctx);
    if (value === null) out += token;
    else {
      if (bar >= 0) for (const spec of inner.slice(bar + 1).split('|')) value = transform(value, spec);
      out += value;
    }
    i = j + 1;
  }
  return out;
}

/** One text with its placeholders filled (what a field's `data` becomes). */
export function resolveText(template: string, pieces: LabelValues[], labelIndex = 0, now: Date = new Date(), counterStart?: number): string {
  return fill(template, { pieces, labelIndex, now, counterStart });
}

/** Pieces to a label. */
export function labelCount(pieces: unknown[] | number, layout: Pick<StoredLabelLayout, 'tags'>): number {
  const n = typeof pieces === 'number' ? Math.max(0, Math.floor(pieces)) : pieces.length;
  return Math.ceil(n / tagsOfLayout(layout));
}

/**
 * The layout's fields for one label with their text, QR and barcode data worked out: what the designer's preview
 * draws and what is printed. A hidden field is still here (the designer shows it faintly); the printer skips it.
 */
export function resolveFields(layout: StoredLabelLayout, pieces: LabelValues[], labelIndex = 0, now: Date = new Date(), counterStart?: number): LabelField[] {
  const ctx: Context = { pieces, labelIndex, now, counterStart };
  return layout.fields.map((f) => (f.type === 'text' || f.type === 'qr' || f.type === 'barcode') && typeof f.data === 'string' ? { ...f, data: fill(f.data, ctx) } : { ...f });
}

// ── ZPL ───────────────────────────────────────────────────────────────────

/** ^FH\ sends `\5E` for a ^, `\7E` for a ~, `\5C` for a \; a new line is `\&` in a text block and `\0A` elsewhere. */
export function escapeZpl(s: string, newline: '\\&' | '\\0A'): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '^') out += '\\5E';
    else if (c === '~') out += '\\7E';
    else if (c === '\\') out += '\\5C';
    else if (c === '\n') out += newline;
    else out += c;
  }
  return out;
}

const lineBreaks = (s: string): string => s.replace(/\r\n?/g, '\n');
const orientation = (r: unknown): string => (r === 90 ? 'R' : r === 180 ? 'I' : r === 270 ? 'B' : 'N');

function textZpl(f: LabelField): string[] {
  const o = orientation(f.rotation);
  const font = f.fontFamily ? f.fontFamily : '0';
  const fs = size(f.fontSize, 20);
  const data = lineBreaks(f.data ?? '');
  const spacing = clampInt(f.lineSpacing, -9999, 9999);
  const x = dots(f.x), y = dots(f.y);
  const out: string[] = [];
  const emit = (px: number, py: number, block: string, text: string) => {
    out.push(`^FO${px},${py}^A${font}${o},${fs},${fs}${block}^FH\\^FD${text}^FS`);
    if (f.bold) out.push(`^FO${px + 1},${py}^A${font}${o},${fs},${fs}${block}^FH\\^FD${text}^FS`);
  };
  if (num(f.width) >= 0.5) {
    const newLines = data.split('\n').length - 1;
    const lines = f.lines !== undefined && num(f.lines) >= 0.5 ? clampInt(f.lines, 1, 9999) : clampInt(newLines + 1, 1, 9999);
    const align = f.align === 'C' || f.align === 'R' ? f.align : 'L';
    emit(x, y, `^FB${size(f.width, 1)},${lines},${spacing},${align}`, escapeZpl(data, '\\&'));
    return out;
  }
  const parts = data.split('\n');
  const n = parts.length, pitch = fs + spacing;
  const turn = f.rotation === 90 || f.rotation === 180 || f.rotation === 270 ? f.rotation : 0;
  parts.forEach((part, i) => {
    // Lines run down the text's own frame: down for 0°, to the left for 90°, up for 180°, to the right for 270°.
    const back = (n - 1 - i) * pitch, fwd = i * pitch;
    const px = turn === 90 ? x + back : turn === 270 ? x + fwd : x;
    const py = turn === 180 ? y + back : turn === 0 ? y + fwd : y;
    emit(dots(px), dots(py), '', escapeZpl(part, '\\0A'));
  });
  return out;
}

function barcodeZpl(f: LabelField): string[] {
  const data = lineBreaks(f.data ?? '');
  if (data === '') return [];
  const o = orientation(f.rotation);
  const h = size(f.height, 40);
  const m = clampInt(f.moduleWidth === undefined ? 2 : f.moduleWidth, 1, 10);
  const yn = f.showText ? 'Y' : 'N';
  let command: string;
  switch (f.symbology) {
    case 'code39': command = `^BY${m}^B3${o},N,${h},${yn},N`; break;
    case 'ean13': command = `^BY${m}^BE${o},${h},${yn},N`; break;
    case 'upca': command = `^BY${m}^BU${o},${h},${yn},N,Y`; break;
    case 'datamatrix': command = `^BX${o},${m},200`; break;
    case 'pdf417': command = `^BY${m}^B7${o},${h}`; break;
    default: command = `^BY${m}^BC${o},${h},${yn},N,N`;
  }
  return [`^FO${dots(f.x)},${dots(f.y)}${command}^FH\\^FD${escapeZpl(data, '\\0A')}^FS`];
}

function fieldZpl(f: LabelField): string[] {
  switch (f.type) {
    case 'text': return textZpl(f);
    case 'qr': {
      const data = lineBreaks(f.data ?? '');
      if (data === '') return [];
      const mag = f.qrMagnification === undefined ? 2 : clampInt(f.qrMagnification, 1, 10);
      const ec = f.errorCorrection === 'L' || f.errorCorrection === 'Q' || f.errorCorrection === 'H' ? f.errorCorrection : 'M';
      return [`^FO${dots(f.x)},${dots(f.y)}^BQ${orientation(f.rotation)},2,${mag},${ec}^FH\\^FD${ec}A,${escapeZpl(data, '\\0A')}^FS`];
    }
    case 'barcode': return barcodeZpl(f);
    case 'line':
    case 'box': {
      const w = size(f.width, 1), h = size(f.height, 1);
      const edge = Math.min(w, h);
      const t = f.type === 'line' || f.fill ? edge : size(f.thickness === undefined ? 2 : f.thickness, 1);
      const r = f.type === 'line' ? 0 : clampInt(f.rounding, 0, 8);
      return [`^FO${dots(f.x)},${dots(f.y)}^GB${w},${h},${t},B,${r}^FS`];
    }
    case 'ellipse': {
      const w = size(f.width, 1), h = size(f.height, 1);
      const t = f.fill ? Math.min(w, h) : size(f.thickness === undefined ? 2 : f.thickness, 1);
      return [`^FO${dots(f.x)},${dots(f.y)}^GE${w},${h},${t},B^FS`];
    }
    case 'image': {
      const w = size(f.width, 1), h = size(f.height, 1);
      const g = f.bitmap ? bitmapHex(f.bitmap, w, h, f.rotation === 180) : null;
      return g ? [`^FO${dots(f.x)},${dots(f.y)}^GFA,${g.total},${g.total},${g.bytesPerRow},${g.hex}^FS`] : [];
    }
    default: return [];
  }
}

const THERMAL: Record<string, string> = { transfer: 'T', direct: 'D' };
const MODE: Record<string, string> = { tear: 'T', peel: 'P', cutter: 'C', rewind: 'R', 'delayed-cut': 'D' };
const MEDIA: Record<string, string> = { gap: 'Y', mark: 'M', continuous: 'N' };

/** `^XA^CI28^PW…^LL…` and the printer's options, in a fixed order (^LH ^LT ^LS ^MT ^MM ^MN ^PR ~SD ~TA ^PO ^PM). */
function headerZpl(layout: StoredLabelLayout): string {
  const p = printerOf(layout);
  const set = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  let s = `^XA^CI28^PW${size(layout.widthDots, 1)}^LL${size(layout.heightDots, 1)}`;
  if (set(p.homeX) || set(p.homeY)) s += `^LH${dots(p.homeX)},${dots(p.homeY)}`;
  if (set(p.labelTop)) s += `^LT${clampInt(p.labelTop, -120, 120)}`;
  s += `^LS${set(p.labelShift) ? clampInt(p.labelShift, -9999, 9999) : 0}`;
  if (p.thermal && THERMAL[p.thermal]) s += `^MT${THERMAL[p.thermal]}`;
  if (p.mode && MODE[p.mode]) s += `^MM${MODE[p.mode]}`;
  if (p.media && MEDIA[p.media]) s += `^MN${MEDIA[p.media]}`;
  if (set(p.speed)) s += `^PR${clampInt(p.speed, 2, 14)}`;
  if (set(p.darkness)) s += `~SD${pad(clampInt(p.darkness, 0, 30), 2)}`;
  if (set(p.tearOff)) { const t = clampInt(p.tearOff, -120, 120); s += `~TA${t < 0 ? '-' : '+'}${pad(Math.abs(t), 3)}`; }
  if (p.orientation === 'normal') s += '^PON';
  else if (p.orientation === 'inverted') s += '^POI';
  if (p.mirror === true) s += '^PMY';
  else if (p.mirror === false) s += '^PMN';
  return s;
}

/**
 * The ZPL for these pieces: one label to `tags` pieces, each `^XA … ^XZ` on its own lines, `copies` of each
 * (^PQ). `skip` blank labels come first, for a roll that is part used.
 */
export function renderZpl(layout: StoredLabelLayout, pieces: LabelValues[], opts: RenderOptions = {}): string {
  const tags = tagsOfLayout(layout);
  const copies = clampInt(opts.copies === undefined ? 1 : opts.copies, 1, 9999);
  const skip = clampInt(opts.skip, 0, 999);
  const now = opts.now ?? new Date();
  const header = headerZpl(layout);
  let out = '';
  for (let i = 0; i < skip; i++) out += `${header}\n^PQ1,0,1,Y^XZ\n`;
  const total = labelCount(pieces, layout);
  for (let i = 0; i < total; i++) {
    const group = pieces.slice(i * tags, (i + 1) * tags);
    out += `${header}\n`;
    for (const f of resolveFields(layout, group, i, now, opts.counterStart)) {
      if (f.hidden) continue;
      for (const line of fieldZpl(f)) out += `${line}\n`;
    }
    out += `^PQ${copies},0,1,Y^XZ\n`;
  }
  return out;
}
