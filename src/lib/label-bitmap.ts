/**
 * Pictures on a tag, the way ZPL's ^GFA takes them: 1 bit a pixel, rows padded to whole bytes, 1 = black,
 * kept in the layout as base64. Made from a picture's pixels by `rasterToBitmap` (area average on the way
 * down, then a threshold or a dither), turned by `rotateBitmap`, printed by `bitmapHex`.
 * Plain integer and double arithmetic in a fixed order, so ERPCore's LabelBitmap.swift gives the same bits.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/** The bytes of base64 text (white space ignored, padding optional); null when anything else is in it. */
export function base64Decode(text: string): Uint8Array | null {
  const out: number[] = [];
  let acc = 0, bits = 0, pad = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
    if (ch === '=') { pad++; continue; }
    if (pad > 0) return null;
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
  }
  if (pad > 2) return null;
  return Uint8Array.from(out);
}

export const bitmapBytesPerRow = (width: number): number => Math.ceil(width / 8);

/** The bitmap's bytes, padded with white or cut to exactly the size the picture needs; null when it is not base64. */
export function bitmapBytes(bitmap: string, width: number, height: number): Uint8Array | null {
  const raw = base64Decode(bitmap);
  if (!raw) return null;
  const total = bitmapBytesPerRow(width) * height;
  const out = new Uint8Array(total);
  out.set(raw.subarray(0, total));
  return out;
}

const HEX = '0123456789ABCDEF';
export function hexOf(bytes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return s;
}

/** A pixel of a packed bitmap: true for black. */
const bit = (bytes: Uint8Array, bpr: number, x: number, y: number): boolean => ((bytes[y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1) === 1;

/** The picture turned a quarter turn clockwise `turns` times (0–3). */
export function rotateBitmap(bytes: Uint8Array, width: number, height: number, turns: number): { bytes: Uint8Array; width: number; height: number } {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return { bytes, width, height };
  const bpr = bitmapBytesPerRow(width);
  const nw = t === 2 ? width : height, nh = t === 2 ? height : width;
  const nbpr = bitmapBytesPerRow(nw);
  const out = new Uint8Array(nbpr * nh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!bit(bytes, bpr, x, y)) continue;
      // Clockwise: (x, y) → (height - 1 - y, x); twice: (width - 1 - x, height - 1 - y); three times: (y, width - 1 - x).
      const nx = t === 1 ? height - 1 - y : t === 2 ? width - 1 - x : y;
      const ny = t === 1 ? x : t === 2 ? height - 1 - y : width - 1 - x;
      out[ny * nbpr + (nx >> 3)] |= 0x80 >> (nx & 7);
    }
  }
  return { bytes: out, width: nw, height: nh };
}

/** The ^GFA hex of a field's bitmap, turned half way when the field is; null when it cannot be read. */
export function bitmapHex(bitmap: string, width: number, height: number, rotate180: boolean): { hex: string; total: number; bytesPerRow: number } | null {
  const bytes = bitmapBytes(bitmap, width, height);
  if (!bytes) return null;
  const r = rotate180 ? rotateBitmap(bytes, width, height, 2).bytes : bytes;
  return { hex: hexOf(r), total: r.length, bytesPerRow: bitmapBytesPerRow(width) };
}

export interface RasterOptions {
  dither?: 'threshold' | 'atkinson' | 'floyd';
  /** 0–1, the grey a pixel must be darker than to print: 0.5 when unset. */
  threshold?: number;
  /** Added to every grey before the threshold (Label LIVE's brightness), -1..1. */
  brightness?: number;
}

/**
 * RGBA pixels → the bitmap (base64) at width × height dots. A pixel's grey is its luminance laid on white
 * (alpha counts as white); a dot takes the average grey of the source pixels it covers.
 */
export function rasterToBitmap(rgba: ArrayLike<number>, sw: number, sh: number, width: number, height: number, opts: RasterOptions = {}): string {
  const grey = new Array<number>(width * height);
  const brightness = Number.isFinite(opts.brightness) ? (opts.brightness as number) : 0;
  for (let ty = 0; ty < height; ty++) {
    const y0 = Math.floor((ty * sh) / height), y1 = Math.floor(((ty + 1) * sh + height - 1) / height);
    for (let tx = 0; tx < width; tx++) {
      const x0 = Math.floor((tx * sw) / width), x1 = Math.floor(((tx + 1) * sw + width - 1) / width);
      let sum = 0, count = 0;
      for (let y = y0; y < y1 && y < sh; y++) {
        for (let x = x0; x < x1 && x < sw; x++) {
          const i = (y * sw + x) * 4;
          const a = rgba[i + 3];
          const r = rgba[i] * a + 255 * (255 - a), g = rgba[i + 1] * a + 255 * (255 - a), b = rgba[i + 2] * a + 255 * (255 - a);
          sum += 299 * r + 587 * g + 114 * b;
          count++;
        }
      }
      const g = count > 0 ? sum / (count * 65025000) : 1;
      grey[ty * width + tx] = Math.min(1, Math.max(0, g + brightness));
    }
  }
  const limit = Number.isFinite(opts.threshold) ? (opts.threshold as number) : 0.5;
  const bpr = bitmapBytesPerRow(width);
  const out = new Uint8Array(bpr * height);
  const kind = opts.dither ?? 'threshold';
  const spread: [number, number, number][] =
    kind === 'atkinson' ? [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]]
    : kind === 'floyd' ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
    : [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const old = grey[y * width + x];
      const black = old < limit;
      if (black) out[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
      if (spread.length) {
        const err = old - (black ? 0 : 1);
        for (const [dx, dy, w] of spread) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny < height) grey[ny * width + nx] += err * w;
        }
      }
    }
  }
  return base64Encode(out);
}
