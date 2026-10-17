/**
 * A QR code encoder with no dependency and no network: byte and alphanumeric modes, versions 1–10 (up to 271
 * bytes at the lowest error correction), error correction levels L/M/Q/H, the eight masks scored by the
 * standard's four penalties. Enough for a wa.me link, the website, a catalogue address.
 *
 * Follows ISO/IEC 18004 (the layout of the function patterns, the Reed–Solomon code over GF(256) with 0x11D,
 * the interleaving of blocks); qr.test.ts checks the code words and format bits against the published
 * "HELLO WORLD" example and decodes what it makes.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';
export interface QrMatrix {
  size: number;
  /** modules[y][x], true = dark. */
  modules: boolean[][];
  version: number;
  mask: number;
  ecc: QrEcc;
  /** True for the finder/timing/alignment/format/version modules (everything that is not data). */
  isFunction: boolean[][];
}

const ECC_INDEX: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };
// Index = version (1…10); [0] is padding.
const ECC_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];
const BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];
export const QR_MAX_VERSION = 10;

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Modules available for data and error correction in a version (everything but the function patterns). */
function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
export const dataCodewords = (ver: number, ecc: QrEcc): number =>
  Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ECC_INDEX[ecc]][ver] * BLOCKS[ECC_INDEX[ecc]][ver];

// ── Reed–Solomon over GF(256) ──

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The generator polynomial's coefficients (highest power first, leading 1 omitted) for `degree` check words. */
function rsDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** The `ecLen` Reed–Solomon check words of a block of data words. */
export function reedSolomon(data: number[], ecLen: number): number[] {
  const divisor = rsDivisor(ecLen);
  const result: number[] = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

// ── Data ──

const utf8 = (s: string): number[] => Array.from(new TextEncoder().encode(s));
const isAlnum = (s: string) => s.length > 0 && [...s].every(c => ALNUM.includes(c));

function pushBits(bits: number[], value: number, n: number) {
  for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

/** The data words for a text at a version and level (mode indicator, count, data, terminator, padding), or null if it doesn't fit. */
export function encodeData(text: string, ver: number, ecc: QrEcc): number[] | null {
  const bits: number[] = [];
  if (isAlnum(text)) {
    pushBits(bits, 0b0010, 4);
    pushBits(bits, text.length, ver <= 9 ? 9 : 11);
    for (let i = 0; i + 1 < text.length; i += 2) pushBits(bits, ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
    if (text.length % 2) pushBits(bits, ALNUM.indexOf(text[text.length - 1]), 6);
  } else {
    const bytes = utf8(text);
    pushBits(bits, 0b0100, 4);
    pushBits(bits, bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) pushBits(bits, b, 8);
  }
  const cap = dataCodewords(ver, ecc) * 8;
  if (bits.length > cap) return null;
  pushBits(bits, 0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Data words split into blocks, each with its check words, interleaved as the standard lays them out. */
export function interleave(data: number[], ver: number, ecc: QrEcc): number[] {
  const nBlocks = BLOCKS[ECC_INDEX[ecc]][ver], ecLen = ECC_PER_BLOCK[ECC_INDEX[ecc]][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - ecLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const check = reedSolomon(dat, ecLen);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(check));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= shortBlocks) out.push(b[i]); });
  return out;
}

// ── The matrix ──

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** The 15 format bits (level and mask, BCH-coded and masked) as the standard defines them. */
export function formatBits(ecc: QrEcc, mask: number): number {
  const data = (FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function build(codewords: number[], ver: number, ecc: QrEcc, wantMask: number | null): QrMatrix {
  const size = ver * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFunction[y][x] = true; };

  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
    }
  };
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const pos = alignmentPositions(ver, size);
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask: number) => {
    const bits = formatBits(ecc, mask);
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6)); setFn(8, 8, bit(bits, 7)); setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0); // reserves the cells; redrawn with the chosen mask below
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, bit(bits, i)); setFn(b, a, bit(bits, i));
    }
  }

  // Data, in the standard's zigzag of two-column strips from the right.
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!isFunction[y][x] && k < codewords.length * 8) { modules[y][x] = bit(codewords[k >>> 3], 7 - (k & 7)); k++; }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let flip: boolean;
      switch (mask) {
        case 0: flip = (x + y) % 2 === 0; break;
        case 1: flip = y % 2 === 0; break;
        case 2: flip = x % 3 === 0; break;
        case 3: flip = (x + y) % 3 === 0; break;
        case 4: flip = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: flip = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: flip = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: flip = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (!isFunction[y][x] && flip) modules[y][x] = !modules[y][x];
    }
  };

  let mask = wantMask ?? 0;
  if (wantMask === null) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(modules);
      if (p < best) { best = p; mask = m; }
      applyMask(m); // undo
    }
  }
  applyMask(mask);
  drawFormat(mask);
  return { size, modules, version: ver, mask, ecc, isFunction };
}

/** The standard's four penalty rules, summed (lower is a better mask). */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0, dark = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1, s = 0;
    for (let i = 1; i < n; i++) {
      if (get(i) === get(i - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1;
    }
    // 1:1:3:1:1 finder-like patterns with four light modules on a side.
    const at = (i: number) => (i >= 0 && i < n ? get(i) : false);
    for (let i = 0; i + 6 < n; i++) {
      if (at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6)) {
        const before = [1, 2, 3, 4].every(d => !at(i - d)) && i - 4 >= 0, after = [7, 8, 9, 10].every(d => !at(i + d)) && i + 10 < n;
        if (before) s += 40;
        if (after) s += 40;
      }
    }
    return s;
  };
  for (let y = 0; y < n; y++) score += line(i => m[y][i]);
  for (let x = 0; x < n; x++) score += line(i => m[i][x]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

export interface QrOptions { ecc?: QrEcc; mask?: number }

/** Whether a text fits (at the lowest version that holds it), and the version that does. */
export function qrVersionFor(text: string, ecc: QrEcc = 'M'): number | null {
  for (let v = 1; v <= QR_MAX_VERSION; v++) if (encodeData(text, v, ecc)) return v;
  return null;
}

/**
 * The matrix for a text, at the smallest version that holds it. Throws when it is too long for versions 1–10
 * (271 bytes at level L, 213 at M).
 */
export function qrMatrix(text: string, opts: QrOptions = {}): QrMatrix {
  const ecc = opts.ecc ?? 'M';
  const ver = qrVersionFor(text, ecc);
  if (ver === null) throw new Error('That is too long for a QR code here (about 200 characters is the most).');
  const data = encodeData(text, ver, ecc) as number[];
  return build(interleave(data, ver, ecc), ver, ecc, opts.mask ?? null);
}

// Matrices are cheap but rendered on every frame of a drag; the last few are kept.
const cache = new Map<string, QrMatrix>();
/** `qrMatrix`, remembered; null for an empty or too-long text instead of throwing. */
export function qrFor(text: string, ecc: QrEcc = 'M'): QrMatrix | null {
  if (!text) return null;
  const key = `${ecc}|${text}`;
  let m = cache.get(key);
  if (!m) {
    try { m = qrMatrix(text, { ecc }); } catch { return null; }
    if (cache.size > 24) cache.clear();
    cache.set(key, m);
  }
  return m;
}
