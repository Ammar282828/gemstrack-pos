/**
 * A PNG's pixels without a browser or a library: zlib's inflate (after Mark Adler's puff.c) and the five
 * scanline filters. For the Label LIVE import (lib/label-lsc.ts), where a design's pictures are PNG data URLs and the
 * import must give the same bits on the web and in ERPCore (PNG.swift, the same steps). Every colour type and bit depth
 * of a plain (not interlaced) PNG; anything else gives null, and the caller can offer its own decoder.
 */

import { base64Decode } from '@/lib/label-bitmap';

export interface DecodedImage { width: number; height: number; rgba: Uint8Array }

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
/** The most a picture may unpack to (a design's logo is a few hundred KB at the very most). */
const MAX_OUT = 64 * 1024 * 1024;

interface Huffman { count: number[]; symbol: number[] }

function construct(lengths: number[], n: number): Huffman | null {
  const count = new Array<number>(16).fill(0);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  let left = 1;
  for (let len = 1; len < 16; len++) { left <<= 1; left -= count[len]; if (left < 0) return null; }
  const offs = new Array<number>(16).fill(0);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  const symbol = new Array<number>(n).fill(0);
  for (let s = 0; s < n; s++) if (lengths[s] !== 0) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}

let fixedLit: Huffman | null = null;
let fixedDist: Huffman | null = null;

/** The bytes inside a zlib stream (its 2-byte header skipped, its checksum not checked); null when it is damaged. */
export function inflate(src: Uint8Array): Uint8Array | null {
  if (src.length < 2 || (src[0] & 15) !== 8) return null;
  let pos = 2, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let outLen = 0;
  const ensure = (extra: number): boolean => {
    if (outLen + extra <= out.length) return true;
    if (outLen + extra > MAX_OUT) return false;
    const bigger = new Uint8Array(Math.min(MAX_OUT, Math.max(out.length * 2, outLen + extra)));
    bigger.set(out.subarray(0, outLen));
    out = bigger;
    return true;
  };
  const bits = (need: number): number => {
    let val = bitBuf;
    while (bitCnt < need) {
      if (pos >= src.length) return -1;
      val |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    bitBuf = val >>> need;
    bitCnt -= need;
    return val & ((1 << need) - 1);
  };
  const decode = (h: Huffman): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      const b = bits(1);
      if (b < 0) return -1;
      code |= b;
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    return -1;
  };
  const codes = (lit: Huffman, dist: Huffman): boolean => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 0) return false;
      if (sym < 256) { if (!ensure(1)) return false; out[outLen++] = sym; continue; }
      if (sym === 256) return true;
      sym -= 257;
      if (sym >= 29) return false;
      const eb = bits(LEXT[sym]);
      if (eb < 0) return false;
      const len = LBASE[sym] + eb;
      const ds = decode(dist);
      if (ds < 0 || ds >= 30) return false;
      const db = bits(DEXT[ds]);
      if (db < 0) return false;
      const d = DBASE[ds] + db;
      if (d > outLen || !ensure(len)) return false;
      for (let i = 0; i < len; i++) { out[outLen] = out[outLen - d]; outLen++; }
    }
  };
  for (;;) {
    const last = bits(1), type = bits(2);
    if (last < 0 || type < 0) return null;
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > src.length) return null;
      const len = src[pos] | (src[pos + 1] << 8);
      if ((len ^ 0xffff) !== (src[pos + 2] | (src[pos + 3] << 8))) return null;
      pos += 4;
      if (pos + len > src.length || !ensure(len)) return null;
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len; pos += len;
    } else if (type === 1) {
      if (!fixedLit || !fixedDist) {
        const l = new Array<number>(288);
        for (let i = 0; i < 144; i++) l[i] = 8;
        for (let i = 144; i < 256; i++) l[i] = 9;
        for (let i = 256; i < 280; i++) l[i] = 7;
        for (let i = 280; i < 288; i++) l[i] = 8;
        fixedLit = construct(l, 288);
        fixedDist = construct(new Array<number>(30).fill(5), 30);
      }
      if (!fixedLit || !fixedDist || !codes(fixedLit, fixedDist)) return null;
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlen < 257 || ndist < 1 || ncode < 4 || nlen > 286 || ndist > 30) return null;
      const lengths = new Array<number>(320).fill(0);
      for (let i = 0; i < ncode; i++) { const v = bits(3); if (v < 0) return null; lengths[CLORDER[i]] = v; }
      const lencode = construct(lengths, 19);
      if (!lencode) return null;
      let index = 0;
      lengths.fill(0);
      while (index < nlen + ndist) {
        const sym = decode(lencode);
        if (sym < 0) return null;
        if (sym < 16) lengths[index++] = sym;
        else {
          let len = 0, rep: number;
          if (sym === 16) { if (index === 0) return null; len = lengths[index - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (rep < 3 || index + rep > nlen + ndist) return null;
          while (rep--) lengths[index++] = len;
        }
      }
      if (lengths[256] === 0) return null;
      const lit = construct(lengths, nlen);
      const dist = construct(lengths.slice(nlen), ndist);
      if (!lit || !dist || !codes(lit, dist)) return null;
    } else return null;
    if (last === 1) break;
  }
  return out.slice(0, outLen);
}

const u32 = (b: Uint8Array, i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** A plain PNG as RGBA; null for anything this does not read (interlaced, damaged, not a PNG). */
export function decodePng(png: Uint8Array): DecodedImage | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((v, i) => png[i] !== v)) return null;
  let width = 0, height = 0, depth = 0, ctype = -1, interlace = 0;
  let palette: number[] = [];
  let trns: number[] = [];
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos + 8 <= png.length) {
    const len = u32(png, pos);
    const name = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const body = png.subarray(pos + 8, pos + 8 + len);
    if (body.length < len) return null;
    if (name === 'IHDR') { width = u32(body, 0); height = u32(body, 4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (name === 'PLTE') palette = Array.from(body);
    else if (name === 'tRNS') trns = Array.from(body);
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!channels || interlace !== 0 || ![1, 2, 4, 8, 16].includes(depth) || width < 1 || height < 1 || width * height > 16_000_000) return null;
  if (ctype === 3 && (depth === 16 || palette.length < 3)) return null;
  if ((ctype === 2 || ctype === 4 || ctype === 6) && depth < 8) return null;
  let total = 0;
  for (const c of idat) total += c.length;
  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of idat) { joined.set(c, at); at += c.length; }
  const raw = inflate(joined);
  const bitsPerPixel = channels * depth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (!raw || raw.length < (rowBytes + 1) * height) return null;
  // Undo the filters, row by row.
  const pix = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1, dst = y * rowBytes, up = dst - rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? pix[dst + i - bpp] : 0;
      const b = y > 0 ? pix[up + i] : 0;
      const c = y > 0 && i >= bpp ? pix[up + i - bpp] : 0;
      let v = raw[src + i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (ft !== 0) return null;
      pix[dst + i] = v & 255;
    }
  }
  // The nth sample of a row, at the PNG's depth.
  const sample = (row: number, n: number): number => {
    const base = row * rowBytes;
    if (depth === 8) return pix[base + n];
    if (depth === 16) return (pix[base + n * 2] << 8) | pix[base + n * 2 + 1];
    const per = 8 / depth, shift = 8 - depth * ((n % per) + 1);
    return (pix[base + Math.floor(n / per)] >> shift) & ((1 << depth) - 1);
  };
  const max = (1 << depth) - 1;
  const to8 = (v: number): number => (depth === 8 ? v : depth === 16 ? v >> 8 : Math.floor((v * 255) / max));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r: number, g: number, b: number, a = 255;
      if (ctype === 0) {
        const v = sample(y, x);
        r = g = b = to8(v);
        if (trns.length >= 2 && v === ((trns[0] << 8) | trns[1])) a = 0;
      } else if (ctype === 2) {
        const sr = sample(y, x * 3), sg = sample(y, x * 3 + 1), sb = sample(y, x * 3 + 2);
        r = to8(sr); g = to8(sg); b = to8(sb);
        if (trns.length >= 6 && sr === ((trns[0] << 8) | trns[1]) && sg === ((trns[2] << 8) | trns[3]) && sb === ((trns[4] << 8) | trns[5])) a = 0;
      } else if (ctype === 3) {
        const i = sample(y, x);
        r = palette[i * 3] ?? 0; g = palette[i * 3 + 1] ?? 0; b = palette[i * 3 + 2] ?? 0;
        if (i < trns.length) a = trns[i];
      } else if (ctype === 4) {
        r = g = b = to8(sample(y, x * 2));
        a = to8(sample(y, x * 2 + 1));
      } else {
        r = to8(sample(y, x * 4)); g = to8(sample(y, x * 4 + 1)); b = to8(sample(y, x * 4 + 2)); a = to8(sample(y, x * 4 + 3));
      }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }
  return { width, height, rgba };
}

/** `data:image/png;base64,…` (any image type in the header) → the PNG it holds; null when it is not one. */
export function decodePngDataUrl(url: string): DecodedImage | null {
  const m = /^data:image\/[^;,]*;base64,/i.exec(url);
  if (!m) return null;
  const bytes = base64Decode(url.slice(m[0].length));
  return bytes ? decodePng(bytes) : null;
}
