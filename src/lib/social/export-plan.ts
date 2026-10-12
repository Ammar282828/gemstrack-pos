/**
 * Designer v2's Export dialog, the parts that are only arithmetic (plan §6 WP2): the pixel size of an export at 1×,
 * 2× or 3× (held inside what a phone's canvas can draw), a PDF page's size at 300 dpi, file names, what a choice of
 * pages and format turns into (one file, a PDF, a zip, a run of downloads), and a zip writer (stored, no
 * compression: PNG, JPG and WebP are compressed already, and the repo carries no zip library).
 * Pure: no DOM, so it is tested in node.
 */

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'pdf';
export const EXPORT_FORMATS: { id: ExportFormat; label: string; hint: string; mime: string; ext: string; lossy: boolean; alpha: boolean }[] = [
  { id: 'png', label: 'PNG', hint: 'Sharpest; keeps transparency', mime: 'image/png', ext: 'png', lossy: false, alpha: true },
  { id: 'jpg', label: 'JPG', hint: 'Smaller file; photos and posting', mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false },
  { id: 'webp', label: 'WebP', hint: 'Small and sharp; most sites and apps', mime: 'image/webp', ext: 'webp', lossy: true, alpha: true },
  { id: 'pdf', label: 'PDF', hint: 'For print; one page per design', mime: 'application/pdf', ext: 'pdf', lossy: false, alpha: false },
];
export const EXPORT_SCALES = [1, 2, 3] as const;
export type ExportScale = (typeof EXPORT_SCALES)[number];
export const PRINT_DPI = 300;
/** The most a canvas is trusted to draw: iOS Safari caps one near 16.7 million pixels, and any side near 8192. */
export const MAX_EXPORT_AREA = 16_000_000;
export const MAX_EXPORT_SIDE = 8192;

type Frame = { w: number; h: number };

export const formatOf = (f: ExportFormat) => EXPORT_FORMATS.find(x => x.id === f)!;
/** Whether the format can hold a see-through background (PNG and WebP). */
export const canBeTransparent = (f: ExportFormat) => formatOf(f).alpha;
/** JPEG/WebP quality as the canvas wants it (0.5…1); PNG and PDF take none. */
export const qualityFor = (f: ExportFormat, percent: number) => (formatOf(f).lossy ? Math.min(1, Math.max(0.5, percent / 100)) : undefined);

/**
 * The pixel size of a page exported at a scale (1 = the frame's own 1080 wide), brought down to fit the canvas limit
 * if it would not. `capped` says it was, and `scale` is the scale actually used.
 */
export function exportSize(frame: Frame, scale: number): { w: number; h: number; scale: number; capped: boolean } {
  const want = Math.max(0.1, scale);
  const byArea = Math.sqrt(MAX_EXPORT_AREA / (frame.w * frame.h));
  const bySide = MAX_EXPORT_SIDE / Math.max(frame.w, frame.h);
  const k = Math.min(want, byArea, bySide);
  return { w: Math.round(frame.w * k), h: Math.round(frame.h * k), scale: Math.round(k * 1000) / 1000, capped: k < want - 1e-9 };
}

/** A PDF page for an image `w` × `h` pixels at `dpi`: millimetres (what jsPDF is given) and points. */
export function pdfPageSize(w: number, h: number, dpi = PRINT_DPI): { mm: [number, number]; pt: [number, number]; landscape: boolean } {
  const mm = (px: number) => Math.round((px / dpi) * 25.4 * 100) / 100;
  const pt = (px: number) => Math.round((px / dpi) * 72 * 100) / 100;
  return { mm: [mm(w), mm(h)], pt: [pt(w), pt(h)], landscape: w > h };
}

const slug = (s: string) => s.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60);

export interface ExportPageInfo { key: string; label: string; frame: Frame }
export interface ExportChoice {
  format: ExportFormat; scale: number; quality: number; transparent: boolean;
  /** Keys of the pages to export. */
  pages: string[];
  /** With several image files: one zip, or a download for each. */
  bundle: 'zip' | 'each';
}
export interface ExportItem { name: string; pageKey: string; w: number; h: number; capped: boolean }
export interface ExportPlan {
  kind: 'single' | 'pdf' | 'zip' | 'sequence' | 'none';
  /** What is drawn, one per page. */
  items: ExportItem[];
  /** The file(s) the person gets, by name. */
  files: string[];
  transparent: boolean;
  quality: number | undefined;
  note?: string;
}

/** A file name for a page: `base-page@2x.png`, made unique among the names already taken. */
export function exportName(base: string, page: string, scale: number, ext: string, taken: Set<string> = new Set()): string {
  const stem = [slug(base) || 'design', slug(page)].filter(Boolean).join('-') + (scale !== 1 ? `@${scale}x` : '');
  let name = `${stem}.${ext}`, n = 2;
  while (taken.has(name)) name = `${stem}-${n++}.${ext}`;
  taken.add(name);
  return name;
}

/** What a choice in the dialog comes to: the pages drawn, the files delivered, and how. */
export function planExport(base: string, pages: ExportPageInfo[], c: ExportChoice): ExportPlan {
  const chosen = pages.filter(p => c.pages.includes(p.key));
  const fmt = formatOf(c.format);
  const transparent = c.transparent && canBeTransparent(c.format);
  const quality = qualityFor(c.format, c.quality);
  if (!chosen.length) return { kind: 'none', items: [], files: [], transparent, quality };
  const taken = new Set<string>();
  const items = chosen.map(p => {
    const s = exportSize(p.frame, c.scale);
    return { name: exportName(base, chosen.length > 1 ? p.label : '', s.scale, fmt.ext, taken), pageKey: p.key, w: s.w, h: s.h, capped: s.capped };
  });
  const capped = items.some(i => i.capped);
  const note = capped ? 'Brought down a little: a phone’s canvas can’t draw a picture that large.' : undefined;
  if (c.format === 'pdf') {
    const name = exportName(base, '', 1, 'pdf');
    return { kind: 'pdf', items, files: [name], transparent, quality, note };
  }
  if (items.length === 1) return { kind: 'single', items, files: [items[0].name], transparent, quality, note };
  if (c.bundle === 'zip') return { kind: 'zip', items, files: [exportName(base, 'pages', 1, 'zip')], transparent, quality, note };
  return { kind: 'sequence', items, files: items.map(i => i.name), transparent, quality, note };
}

// ── A zip, stored ──────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null;
/** CRC-32 (the zip one) of some bytes. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The time and date a zip header holds (2-second resolution, from 1980). */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** Files in one zip, each stored as it is (no compression). Names are UTF-8. */
export function zipStore(files: { name: string; data: Uint8Array }[], when: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, f.data);
    central.push(cen);
    offset += local.length + size;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
