/**
 * A website piece as a full-bleed Instagram story (Posts › Stories, story-drafts.ts; the owner, 2026-10-27: "make
 * them 9:16 and add text overlays with their weights, and type to make them stand out").
 *
 * The square photograph keeps its place in the middle and its own ground runs on above and below it, blurred and
 * darker, so the story is the photograph rather than a card holding one. The house's wordmark and what the piece is
 * sit above it; its name, the weight large in gold, and "Reply for today's price" below, all inside Instagram's safe
 * area (its own bars cover the top ~220 px and the bottom ~200 px).
 *
 * taheri.shop's photographs carry the house's mark (top right) and older ones their weight (top left). The story has
 * its own of both, so `planCornerPatches` covers each with the cloth beside it, but only where it finds lettering and
 * no gold: a corner the piece reaches into keeps its label.
 *
 * No canvas `filter` anywhere (WebKit, which the iPhone app runs on, draws none): the blur is a small copy scaled up.
 * Browser-only, except the patch planner, which reads plain pixels.
 */

export const STORY_W = 1080;
export const STORY_H = 1920;
/** Where the square photograph sits. */
const PHOTO_TOP = 345;
const GOLD = '#E2BE74';
const GOLD_DEEP = '#B8893F';
const GOLD_LIGHT = '#F7DFA3';
const CREAM = '#F5EFE3';

export interface WeekStoryText {
  /** "Ruby bangles · 21K gold". */
  kind: string;
  name: string;
  /** "62.9": grams; the "g" is added. Empty draws no weight. */
  weight: string;
}

export interface WeekStoryFonts {
  /** The weight's numerals (Bodoni Moda). */
  serif: string;
  /** The name (Cormorant Garamond, italic). */
  italic: string;
  /** The small capitals (Tenor Sans). */
  caps: string;
}

// ── The marks on the photograph ────────────────────────────────────────────────────────────────────────────────────

export interface Pixels { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface Box { x: number; y: number; w: number; h: number }
/**
 * How a corner is cleaned: covered with the cloth at `from` (mirrored left to right when `mirror`, softened on the
 * sides that face in), or, with no clean cloth nearby (`from` null), its lettering filled from the cloth around it.
 */
export interface CornerPlan { corner: Corner; area: Box; from: Box | null; mirror: boolean; /** Light lettering on a dark ground, or dark on light. */ ink: 'light' | 'dark' }
/** Top left (a printed weight), top right and bottom right (the wordmark, set either place). */
export type Corner = 'tl' | 'tr' | 'br';

/** Light, colourless pixels: a mark or a printed weight (velvet, wood and gold all carry colour). */
const isLetter = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b) < 42 && Math.max(r, g, b) > 140;
/** Dark, colourless pixels: the weight printed on a light ground. */
// (Greyer than the light test: dark velvet in shadow is nearly colourless too.)
const isDarkLetter = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b) < 22 && Math.max(r, g, b) < 130;
const letterTest = (ink: 'light' | 'dark') => (ink === 'light' ? isLetter : isDarkLetter);

/** Gold catching the light: the piece itself (bright and yellow; a wooden stand is darker and browner). */
const isGold = (r: number, g: number, b: number) => r > 175 && g > 125 && r - b > 85;

function count(px: Pixels, b: Box, test: (r: number, g: number, b: number) => boolean): number {
  let n = 0;
  const x1 = Math.min(px.width, b.x + b.w), y1 = Math.min(px.height, b.y + b.h);
  for (let y = Math.max(0, b.y); y < y1; y++) {
    for (let x = Math.max(0, b.x); x < x1; x++) {
      const i = (y * px.width + x) * 4;
      if (test(px.data[i], px.data[i + 1], px.data[i + 2])) n++;
    }
  }
  return n;
}

const inside = (px: Pixels, b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= px.width && b.y + b.h <= px.height;

/** The soft edge of a patch, as a share of the photograph's width (the patch covers it solidly inside that). */
export const PATCH_FEATHER = 0.016;

/**
 * The lettering in `box`: pixels of the ink's kind that are strokes, not part of a light area behind the piece (a
 * bust, a wall). A light area fills nearly all of any window around a point inside it; even bold lettering fills
 * about half of one. Ink that close to such an area is its edge, not lettering. Returns a mask over `box` and the
 * lettering's bounds.
 */
function lettering(px: Pixels, box: Box, isInk: (r: number, g: number, b: number) => boolean) {
  const W = px.width, H = px.height;
  const R = Math.round(W / 40), r = Math.round(W / 70);
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const j = (y * W + x) * 4;
    return isInk(px.data[j], px.data[j + 1], px.data[j + 2]);
  };
  // Summed tables over the box and R + r around it: of ink, then of "inside a light area".
  const ox = box.x - R - r, oy = box.y - R - r, ow = box.w + 2 * (R + r), oh = box.h + 2 * (R + r);
  const table = (v: (x: number, y: number) => number) => {
    const T = new Int32Array((ow + 1) * (oh + 1));
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) T[(y + 1) * (ow + 1) + x + 1] = v(x, y) + T[y * (ow + 1) + x + 1] + T[(y + 1) * (ow + 1) + x] - T[y * (ow + 1) + x];
    return T;
  };
  const sum = (T: Int32Array, lx: number, ly: number, k: number) => {
    const x0 = Math.max(0, lx - k), x1 = Math.min(ow, lx + k + 1), y0 = Math.max(0, ly - k), y1 = Math.min(oh, ly + k + 1);
    return [T[y1 * (ow + 1) + x1] - T[y0 * (ow + 1) + x1] - T[y1 * (ow + 1) + x0] + T[y0 * (ow + 1) + x0], (x1 - x0) * (y1 - y0)];
  };
  const I = table((x, y) => (ink(ox + x, oy + y) ? 1 : 0));
  // Only what is in the photograph counts: at its edge a window is partly outside it.
  const In = table((x, y) => (ox + x >= 0 && oy + y >= 0 && ox + x < W && oy + y < H ? 1 : 0));
  const area = table((x, y) => { const n = sum(I, x, y, R)[0], of = sum(In, x, y, R)[0]; return of > 0 && n > of * 0.8 ? 1 : 0; });
  const nearSolid = (x: number, y: number) => sum(area, x - ox, y - oy, r)[0] > 0;
  const mask = new Uint8Array(box.w * box.h);
  let n = 0, x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (!ink(x, y)) continue;
      if (nearSolid(x, y)) continue;
      mask[(y - box.y) * box.w + x - box.x] = 1;
      n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return { mask, n, x0, x1, y0, y1 };
}

/**
 * Which corners to clean and how. taheri.shop printed a weight top left (and a diamond piece's carats under it) and
 * set its wordmark top right. In each corner the lettering is found (light, colourless pixels); the area is its box
 * with a margin and a soft edge beyond, so any softening falls on bare cloth. A corner is left as it is when there is
 * no lettering, when its ground is itself light (most of it reads as "lettering"), or when gold reaches into it.
 *
 * It is covered from the nearest box of the same size that holds only cloth of the corner's own colour (no
 * lettering, no gold, no stand). Failing one, only the lettering is filled, from the cloth around each stroke: the
 * strokes are thin, and nothing from elsewhere in the photograph is carried in.
 */
export function planCorners(px: Pixels): CornerPlan[] {
  const W = px.width, H = px.height;
  const f = W / 100;
  const feather = Math.round(W * PATCH_FEATHER);
  const pad = Math.round(f);
  const searches: { corner: Corner; box: Box }[] = [
    { corner: 'tl', box: { x: 0, y: 0, w: Math.round(30 * f), h: Math.round(15 * f) } },
    { corner: 'tr', box: { x: Math.round(68 * f), y: 0, w: W - Math.round(68 * f), h: Math.round(16 * f) } },
    { corner: 'br', box: { x: Math.round(68 * f), y: H - Math.round(14 * f), w: W - Math.round(68 * f), h: Math.round(14 * f) } },
  ];
  const out: CornerPlan[] = [];
  for (const { corner, box } of searches) {
    // A light ground (most of the corner light and colourless) carries its lettering dark.
    const ink: 'light' | 'dark' = count(px, box, isLetter) > box.w * box.h * 0.5 ? 'dark' : 'light';
    const isInk = letterTest(ink);
    const { n, x0, x1, y0, y1 } = lettering(px, box, isInk);
    const searched = box.w * box.h;
    if (n < searched * 0.0015 || n > searched * 0.25) continue;
    // Anchored to its corner's edges, reaching just past the lettering.
    const left = corner === 'tl' ? 0 : Math.max(0, x0 - pad - 2 * feather);
    const right = corner === 'tl' ? Math.min(W, x1 + pad + 2 * feather) : W;
    const top = corner === 'br' ? Math.max(0, y0 - pad - 2 * feather) : 0;
    const bottom = corner === 'br' ? H : Math.min(H, y1 + pad + 2 * feather);
    const area: Box = { x: left, y: top, w: right - left, h: bottom - top };
    const h = area.h;
    const size = area.w * area.h;
    // Gold reaching into the corner: no cloth is laid over it, only the lettering's own pixels are filled.
    if (count(px, area, isGold) > size * 0.003) { out.push({ corner, area, from: null, mirror: false, ink }); continue; }
    // The corner's own ground: the mean of what is not lettering.
    let sr = 0, sg = 0, sb = 0, m = 0;
    for (let y = area.y; y < area.y + area.h; y++) {
      for (let x = area.x; x < area.x + area.w; x++) {
        const i = (y * W + x) * 4;
        const r = px.data[i], g = px.data[i + 1], b = px.data[i + 2];
        if (isInk(r, g, b)) continue;
        sr += r; sg += g; sb += b; m++;
      }
    }
    if (!m) continue;
    // By hue more than by light: lit velvet brightens across a photograph, a stand or a piece is another colour.
    // (A near-black pixel's hue is noise: only a lit one is judged by it.)
    const [rr, rg, rb] = [sr / m, sg / m, sb / m];
    const foreign = (r: number, g: number, b: number) =>
      isInk(r, g, b) || isGold(r, g, b)
      || (r + g + b > 150 && Math.abs((r - g) - (rr - rg)) + Math.abs((b - g) - (rb - rg)) > 50)
      || Math.abs((r + g + b) - (rr + rg + rb)) / 3 > 60;
    // The area holds more than cloth and lettering (a bust's edge, a stand): laying cloth over it would cover that too.
    const { mask } = lettering(px, area, isInk);
    let other = 0;
    for (let y = 0; y < area.h; y++) {
      for (let x = 0; x < area.w; x++) {
        if (mask[y * area.w + x]) continue;
        const i = ((area.y + y) * W + area.x + x) * 4;
        if (foreign(px.data[i], px.data[i + 1], px.data[i + 2])) other++;
      }
    }
    if (other > size * 0.01) {
      out.push({ corner, area, from: null, mirror: false, ink });
      continue;
    }
    // Boxes of the same size that do not overlap it: beside it (mirrored, so the folds run on), below it, and half a
    // box either way of those.
    const w = area.w;
    const away = corner === 'br' ? -1 : 1;
    let best: { from: Box; mirror: boolean; score: number } | null = null;
    for (const dy of [0, h / 2, h, 1.5 * h, 2 * h]) {
      for (const dx of [-2 * w, -1.5 * w, -w, -w / 2, 0, w / 2, w, 1.5 * w, 2 * w]) {
        if (Math.abs(dx) < w && dy < h) continue;
        const from = { x: Math.round(area.x + dx), y: Math.round(area.y + away * dy), w, h };
        if (!inside(px, from)) continue;
        const score = count(px, from, foreign);
        if (!best || score < best.score) best = { from, mirror: dy < h, score };
      }
    }
    out.push(best && best.score <= size * 0.004
      ? { corner, area, from: best.from, mirror: best.mirror, ink }
      : { corner, area, from: null, mirror: false, ink });
  }
  return out;
}

/** Lay `from` over `area`, solid except a ramp on the sides that face into the photograph. */
function patch(px: Pixels, p: CornerPlan & { from: Box }) {
  const W = px.width, ramp = 2 * Math.round(W * PATCH_FEATHER);
  const src = new Uint8ClampedArray(px.data);
  for (let y = 0; y < p.area.h; y++) {
    const ay = Math.min(1, (p.corner === 'br' ? y : p.area.h - y) / ramp);
    for (let x = 0; x < p.area.w; x++) {
      const ax = Math.min(1, (p.corner === 'tl' ? p.area.w - x : x) / ramp);
      const a = Math.min(ax, ay);
      const sx = p.from.x + (p.mirror ? p.area.w - 1 - x : x), sy = p.from.y + y;
      const di = ((p.area.y + y) * W + p.area.x + x) * 4, si = (sy * W + sx) * 4;
      for (let k = 0; k < 3; k++) px.data[di + k] = src[si + k] * a + src[di + k] * (1 - a);
    }
  }
}

/** Fill the lettering in `area` (each stroke a little widened) with the mean of the ground around it. */
function fillLetters(px: Pixels, area: Box, ink: 'light' | 'dark') {
  const isInk = letterTest(ink);
  const W = px.width, H = px.height;
  // Widened past the soft edge each letter has where it meets the ground.
  const grow = Math.max(3, Math.round(W / 240));
  const reach = Math.max(6, Math.round(W / 120));
  // The working window: the area and `reach` beyond it, so every stroke sees cloth on all sides.
  const wx = Math.max(0, area.x - reach), wy = Math.max(0, area.y - reach);
  const ww = Math.min(W, area.x + area.w + reach) - wx, wh = Math.min(H, area.y + area.h + reach) - wy;
  const hole = new Uint8Array(ww * wh);
  const { mask } = lettering(px, area, isInk);
  for (let y = 0; y < area.h; y++) {
    for (let x = 0; x < area.w; x++) {
      if (!mask[y * area.w + x]) continue;
      const lx = area.x + x - wx, ly = area.y + y - wy;
      for (let dy = -grow; dy <= grow; dy++) {
        for (let dx = -grow; dx <= grow; dx++) {
          const yy = ly + dy, xx = lx + dx;
          if (yy >= 0 && yy < wh && xx >= 0 && xx < ww) hole[yy * ww + xx] = 1;
        }
      }
    }
  }
  // A few passes of a box mean over what is not a hole (summed-area tables); each pass fills what it reaches.
  for (let pass = 0; pass < 4; pass++) {
    const S = new Float64Array((ww + 1) * (wh + 1) * 4);
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const o = ((y + 1) * (ww + 1) + x + 1) * 4, up = (y * (ww + 1) + x + 1) * 4, lf = ((y + 1) * (ww + 1) + x) * 4, ul = (y * (ww + 1) + x) * 4;
        const i = ((wy + y) * W + wx + x) * 4;
        const v = hole[y * ww + x] ? 0 : 1;
        for (let k = 0; k < 3; k++) S[o + k] = px.data[i + k] * v + S[up + k] + S[lf + k] - S[ul + k];
        S[o + 3] = v + S[up + 3] + S[lf + 3] - S[ul + 3];
      }
    }
    let left = 0;
    const filled: number[] = [];
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        if (!hole[y * ww + x]) continue;
        const x0 = Math.max(0, x - reach), x1 = Math.min(ww, x + reach + 1), y0 = Math.max(0, y - reach), y1 = Math.min(wh, y + reach + 1);
        const a = (y1 * (ww + 1) + x1) * 4, b = (y0 * (ww + 1) + x1) * 4, c = (y1 * (ww + 1) + x0) * 4, d = (y0 * (ww + 1) + x0) * 4;
        const nv = S[a + 3] - S[b + 3] - S[c + 3] + S[d + 3];
        if (nv < 1) { left++; continue; }
        const i = ((wy + y) * W + wx + x) * 4;
        for (let k = 0; k < 3; k++) px.data[i + k] = (S[a + k] - S[b + k] - S[c + k] + S[d + k]) / nv;
        filled.push(y * ww + x);
      }
    }
    for (const j of filled) hole[j] = 0;
    if (!left) break;
  }
}

/** Clean the corners in place (planCorners says which and how). */
export function cleanCorners(px: Pixels): CornerPlan[] {
  const plans = planCorners(px);
  for (const p of plans) {
    if (p.from) patch(px, p as CornerPlan & { from: Box });
    else fillLetters(px, p.area, p.ink);
  }
  return plans;
}

// ── Drawing ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;
type Source = CanvasImageSource & { width: number; height: number };

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw a story.');
  return [c, ctx];
}

/** The photograph as a `size` square (centre crop, scaled smoothly and never sharpened), its corner marks cleaned. */
export function cleanSquare(photo: Source, size = STORY_W): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const s = Math.min(photo.width, photo.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, (photo.width - s) / 2, (photo.height - s) / 2, s, s, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size);
  if (cleanCorners(px).length) ctx.putImageData(px, 0, 0);
  return c;
}

/** Text with CSS-style letter spacing (WebKit's canvas has no letterSpacing), centred on x; `y` is its middle. */
function spaced(ctx: Ctx, text: string, x: number, y: number, spacing: number) {
  const chars = [...text];
  const widths = chars.map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let at = x - total / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  chars.forEach((ch, i) => { ctx.fillText(ch, at, y); at += widths[i] + spacing; });
}

/** The name in one line, or two of nearly even length; smaller until it fits. */
function nameLines(ctx: Ctx, name: string, font: (px: number) => string, maxW: number): { lines: string[]; size: number } {
  const words = name.split(/\s+/).filter(Boolean);
  for (let size = 64; size >= 44; size -= 4) {
    ctx.font = font(size);
    if (ctx.measureText(name).width <= maxW) return { lines: [name], size };
    let best: string[] | null = null, bestW = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (w <= maxW && w < bestW) { best = [a, b]; bestW = w; }
    }
    if (best) return { lines: best, size };
  }
  ctx.font = font(44);
  return { lines: [name], size: 44 };
}

/**
 * The story, laid out at 1080 × 1920 and drawn at `scale` times that: 2 (2160 × 3840) unless asked otherwise (the
 * owner, 2026-10-27: "just give them all in 2x 1080p resolution for 9:16", and no sharpening). `wordmark` is drawn
 * in cream whatever its own colour.
 */
export function drawWeekStory(photo: Source, t: WeekStoryText, fonts: WeekStoryFonts, wordmark: Source | null, scale = 2): HTMLCanvasElement {
  const square = cleanSquare(photo, STORY_W * scale);
  const [c, ctx] = canvas(STORY_W * scale, STORY_H * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // The ground: the photograph itself, very soft (a 48-px copy scaled up), larger than the frame, and darker.
  const [tiny, tctx] = canvas(48, 48);
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(square, 0, 0, 48, 48);
  const g = 2268;
  ctx.drawImage(tiny, (STORY_W - g) / 2, (STORY_H - g) / 2, g, g);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // The photograph, its top and bottom fading into the ground.
  const side = square.width;
  const [pc, pctx] = canvas(side, side);
  pctx.drawImage(square, 0, 0);
  pctx.globalCompositeOperation = 'destination-in';
  const fade = pctx.createLinearGradient(0, 0, 0, side);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.11, 'rgba(0,0,0,1)');
  fade.addColorStop(0.91, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  pctx.fillStyle = fade; pctx.fillRect(0, 0, side, side);
  ctx.drawImage(pc, 0, PHOTO_TOP, STORY_W, STORY_W);

  // Shade for the words: deep at the top and bottom, clear across the piece.
  const shade = ctx.createLinearGradient(0, 0, 0, STORY_H);
  [[0, 0.78], [0.22, 0.25], [0.32, 0], [0.62, 0], [0.74, 0.55], [1, 0.9]].forEach(([at, a]) => shade.addColorStop(at, `rgba(4,18,14,${a})`));
  ctx.fillStyle = shade; ctx.fillRect(0, 0, STORY_W, STORY_H);

  // The wordmark, in cream.
  if (wordmark && wordmark.width > 0 && wordmark.height > 0) {
    const w = 236, h = w * (wordmark.height / wordmark.width);
    const [mc, mctx] = canvas(Math.round(w * scale), Math.round(h * scale));
    mctx.drawImage(wordmark, 0, 0, mc.width, mc.height);
    mctx.globalCompositeOperation = 'source-in';
    mctx.fillStyle = CREAM; mctx.fillRect(0, 0, mc.width, mc.height);
    ctx.drawImage(mc, (STORY_W - w) / 2, 258 - h / 2, w, h);
  }

  // What it is.
  ctx.fillStyle = GOLD;
  ctx.font = `400 28px ${fonts.caps}`;
  spaced(ctx, t.kind.toUpperCase(), STORY_W / 2, 330, 28 * 0.32);

  // The name.
  let y = 1405;
  const italic = (px: number) => `italic 500 ${px}px ${fonts.italic}`;
  const { lines, size } = nameLines(ctx, t.name, italic, 940);
  ctx.font = italic(size);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = CREAM;
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 2;
  const lh = size * 1.02;
  lines.forEach((line, i) => ctx.fillText(line, STORY_W / 2, y + lh * (i + 0.5)));
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  y += lh * lines.length;

  if (t.weight) {
    // "— WEIGHT —"
    y += 30;
    ctx.font = `400 21px ${fonts.caps}`;
    ctx.fillStyle = GOLD;
    const label = 'WEIGHT', sp = 21 * 0.42;
    const labelW = [...label].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + sp * (label.length - 1);
    spaced(ctx, label, STORY_W / 2, y + 10.5, sp);
    for (const side of [-1, 1] as const) {
      const x0 = STORY_W / 2 + side * (labelW / 2 + 22);
      const x1 = x0 + side * 120;
      const rule = ctx.createLinearGradient(x1, 0, x0, 0);
      rule.addColorStop(0, 'rgba(226,190,116,0)'); rule.addColorStop(1, GOLD);
      ctx.fillStyle = rule;
      ctx.fillRect(Math.min(x0, x1), Math.round(y + 10), 120, 1);
    }
    y += 21 + 4;

    // The weight, large, in gold.
    const big = `500 168px ${fonts.serif}`, small = `500 76px ${fonts.serif}`;
    ctx.font = big;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(t.weight);
    const numW = m.width;
    // From the figures' own height, so the line above never touches them whatever the face's metrics say.
    const capH = m.actualBoundingBoxAscent || 168 * 0.7;
    const baseline = y + 22 + capH;
    ctx.font = small;
    const gW = ctx.measureText('g').width;
    const left = (STORY_W - (numW + 10 + gW)) / 2;
    const fill = ctx.createLinearGradient(0, y, 0, y + 168);
    fill.addColorStop(0, GOLD_LIGHT); fill.addColorStop(0.45, GOLD); fill.addColorStop(1, GOLD_DEEP);
    ctx.fillStyle = fill;
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = big; ctx.fillText(t.weight, left, baseline);
    ctx.font = small; ctx.fillText('g', left + numW + 10, baseline);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    y = baseline + 14;
  }

  y += 20;
  ctx.fillStyle = 'rgba(245,239,227,0.78)';
  ctx.font = `400 22px ${fonts.caps}`;
  spaced(ctx, 'REPLY FOR TODAY’S PRICE', STORY_W / 2, y + 11, 22 * 0.24);
  return c;
}

/** The story as a JPEG (2160 × 3840 by default). */
export function weekStoryJpeg(photo: Source, t: WeekStoryText, fonts: WeekStoryFonts, wordmark: Source | null, scale = 2, quality = 0.92): Promise<Blob> {
  const c = drawWeekStory(photo, t, fonts, wordmark, scale);
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not make the JPEG.'))), 'image/jpeg', quality));
}

/**
 * The faces loaded before drawing (a canvas draws a fallback for a face the page has not used yet). Settled, not
 * all-or-nothing: next/font's fallback faces name a local "Times New Roman", which a device without it (Android,
 * Linux) fails to load, and that failure says nothing about the real face.
 */
export async function loadWeekStoryFonts(fonts: WeekStoryFonts): Promise<void> {
  await Promise.allSettled([
    document.fonts.load(`500 168px ${fonts.serif}`),
    document.fonts.load(`italic 500 64px ${fonts.italic}`),
    document.fonts.load(`400 28px ${fonts.caps}`),
  ]);
}
