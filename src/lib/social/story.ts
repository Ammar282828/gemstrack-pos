/**
 * Drawing a piece's Instagram story, and stamping a website photo with its
 * weight — in the browser, on a canvas, so what the counter previews is the
 * file that goes out.
 *
 * The story follows the shop's own stories (Sept 2026): the photograph full
 * bleed, a heavy condensed headline in the top third ("Bangle & Ring",
 * "Set of the Day"), the weight in a light face beneath it or in the small
 * pipe-separated details line ("21K Yellow Gold | Simulated Sapphires |
 * 45.350g"), and the wordmark top-right. Those stories were typeset in
 * Instagram; the faces here are the nearest open ones (Sofia Sans Extra
 * Condensed 800 for the headline, Figtree for the rest), passed in by the page
 * because next/font owns their names.
 *
 * The stamp is the overlay tool's (taheri-overlay.netlify.app), the same
 * numbers the site's WeightLabel draws with: Futura LT Light at 143/3000 of the
 * width, 120 in, baseline at 100 + 143 × 1.1, tracking 2 — so a photo stamped
 * here reads exactly like the 1,215 the tool stamped, and the site's tagger can
 * read it back.
 */

export const STORY_W = 1080;
export const STORY_H = 1920;

export interface StoryFonts {
  /** CSS font-family list for the headline face (next/font's generated name). */
  headline: string;
  /** CSS font-family list for the light face. */
  body: string;
}

import { PALETTES, type Palette } from './palettes';

export { PALETTES, type Palette };

export interface Placement {
  /** 'fill' crops the photo to the story; 'fit' shows all of it on a soft backdrop. */
  mode: 'fill' | 'fit';
  /** 1 = just covers (fill) or just fits (fit); up to 2.5. */
  zoom: number;
  /** Where the crop sits, 0–1 each way. 0.5 is centred. */
  focusX: number;
  focusY: number;
}

export interface StoryText {
  kicker: string;
  headline: string;
  /** Already formatted: "18.8g" / "10g each". Drawn on its own line when `weightOwnLine`. */
  weight: string;
  weightOwnLine: boolean;
  /** Already joined: "21K Yellow Gold | Simulated Sapphires". */
  details: string;
  align: 'left' | 'center';
}

export interface StoryOptions {
  photo: CanvasImageSource & { width: number; height: number };
  placement: Placement;
  text: StoryText;
  palette: Palette;
  fonts: StoryFonts;
  /** The dark and light wordmarks, drawn top-right; null leaves it off. */
  wordmark: { dark: HTMLImageElement; light: HTMLImageElement } | null;
}

// ── Loading ────────────────────────────────────────────────────────────────

/** A photo the canvas can draw, EXIF orientation applied. */
export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The decoded bitmap stays with the element; the URL is no longer needed.
    if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

let stampFontReady: Promise<void> | null = null;
/** Futura LT Light, from /fonts, registered once under a name of our own. */
export function loadStampFont(): Promise<void> {
  if (!stampFontReady) {
    stampFontReady = (async () => {
      const face = new FontFace('Taheri Stamp', 'url(/fonts/futura-lt-light.woff2)', { weight: '300' });
      await face.load();
      document.fonts.add(face);
    })().catch(() => { stampFontReady = null; });
  }
  return stampFontReady;
}

export async function loadStoryFonts(fonts: StoryFonts): Promise<void> {
  await Promise.all([
    document.fonts.load(`800 100px ${fonts.headline}`),
    document.fonts.load(`300 40px ${fonts.body}`),
    document.fonts.load(`400 40px ${fonts.body}`),
  ]).catch(() => undefined);
}

// ── Measuring ──────────────────────────────────────────────────────────────

/**
 * Average brightness (0–255) of a region of what has been drawn so far. Used
 * to choose light or dark lettering for whatever sits behind the text.
 */
export function regionLuminance(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): number {
  try {
    const data = ctx.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
    let sum = 0, n = 0;
    // Every 16th pixel is plenty for an average.
    for (let i = 0; i < data.length; i += 64) { sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; }
    return n ? sum / n : 128;
  } catch {
    return 128;
  }
}

/** The palette that reads best over the headline area of this photo as placed. */
export function suggestPalette(photo: StoryOptions['photo'], placement: Placement): Palette {
  const c = document.createElement('canvas');
  c.width = STORY_W / 4; c.height = STORY_H / 4;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(0.25, 0.25);
  drawStoryPhoto(ctx, photo, placement);
  const lum = regionLuminance(ctx, 0, (STORY_H * 0.1) / 4, c.width, (STORY_H * 0.25) / 4);
  return lum > 150 ? PALETTES[0] : lum > 95 ? PALETTES[3] : PALETTES[4];
}

// ── Drawing ────────────────────────────────────────────────────────────────

export interface Frame { w: number; h: number }
export const STORY_FRAME: Frame = { w: STORY_W, h: STORY_H };

/** The background photo, placed in a frame: filled and cropped, or shown whole on its own blurred light. */
export function drawStoryPhoto(ctx: CanvasRenderingContext2D, photo: StoryOptions['photo'], p: Placement, frame: Frame = STORY_FRAME) {
  const iw = photo.width, ih = photo.height;
  if (!iw || !ih) return;
  const W = frame.w, H = frame.h;
  const cover = Math.max(W / iw, H / ih);
  const contain = Math.min(W / iw, H / ih);

  if (p.mode === 'fit') drawBackdrop(ctx, photo, cover, frame);

  const scale = (p.mode === 'fill' ? cover : contain) * Math.max(1, p.zoom);
  const dw = iw * scale, dh = ih * scale;
  // Focus 0 puts the photo's left/top edge at the frame's; 1 its right/bottom.
  const dx = dw > W ? -(dw - W) * p.focusX : (W - dw) * p.focusX;
  const dy = dh > H ? -(dh - H) * p.focusY : (H - dh) * p.focusY;
  ctx.drawImage(photo, dx, dy, dw, dh);
}

/**
 * Behind a photo shown whole: the same photo filling the frame, heavily
 * blurred, so the empty bands read as the photo's own light rather than as
 * bars. ctx.filter does it properly where the browser has it; elsewhere
 * (older Safari) the photo is shrunk and grown back in steps, which blurs
 * without the blockiness a single tiny-to-full jump leaves.
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, photo: StoryOptions['photo'], cover: number, frame: Frame) {
  const iw = photo.width, ih = photo.height;
  const W = frame.w, H = frame.h;
  const dw = iw * cover, dh = ih * cover;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'blur(48px)';
  if (ctx.filter === 'blur(48px)') {
    // Drawn a little larger than the frame so the blur has no soft edge.
    ctx.drawImage(photo, dx - 120, dy - 120, dw + 240, dh + 240);
  } else {
    let src: CanvasImageSource = photo, sw = iw, sh = ih;
    for (const k of [8, 32, 8, 2]) {
      const w = Math.max(4, Math.round(W / k)), h = Math.max(4, Math.round(H / k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const t = c.getContext('2d')!;
      t.imageSmoothingEnabled = true;
      t.imageSmoothingQuality = 'high';
      if (src === photo) { const f = Math.max(w / sw, h / sh); t.drawImage(photo, (w - sw * f) / 2, (h - sh * f) / 2, sw * f, sh * f); }
      else t.drawImage(src, 0, 0, w, h);
      src = c; sw = w; sh = h;
    }
    ctx.drawImage(src, 0, 0, W, H);
  }
  ctx.restore();
}

/** Largest size (≤ max) at which `text` fits `width`, in this font. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, width: number, max: number): number {
  ctx.font = font(100);
  const w100 = ctx.measureText(text).width || 1;
  return Math.min(max, Math.floor((width / w100) * 100));
}

/** Break a headline in two at the space nearest its middle. */
function splitInTwo(text: string): [string, string] | null {
  const words = text.split(/\s+/);
  if (words.length < 2) return null;
  let best: [string, string] | null = null, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) { bestDiff = diff; best = [a, b]; }
  }
  return best;
}

export function drawStory(ctx: CanvasRenderingContext2D, o: StoryOptions): void {
  ctx.save();
  ctx.clearRect(0, 0, STORY_W, STORY_H);
  ctx.fillStyle = '#EDE6DA';
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  drawStoryPhoto(ctx, o.photo, o.placement);

  const { text, palette, fonts } = o;
  const left = text.align === 'left';
  const margin = 96;
  const maxW = STORY_W - margin * 2;
  const x = left ? margin : STORY_W / 2;
  ctx.textAlign = left ? 'left' : 'center';
  ctx.textBaseline = 'alphabetic';

  // Wordmark first, top-right, clear of Instagram's own header row.
  if (o.wordmark) {
    const mark = palette.dark ? o.wordmark.light : o.wordmark.dark;
    const w = 300, h = w * (mark.naturalHeight / mark.naturalWidth || 0.25);
    ctx.drawImage(mark, STORY_W - margin + 24 - w, 150, w, h);
  }

  let y = o.wordmark ? 330 : 300;
  const headlineFont = (px: number) => `800 ${px}px ${fonts.headline}`;
  const bodyFont = (weight: number, px: number) => `${weight} ${px}px ${fonts.body}`;

  if (text.kicker.trim()) {
    ctx.font = bodyFont(400, 54);
    ctx.fillStyle = palette.body;
    y += 54;
    ctx.fillText(text.kicker.trim(), x, y);
    y += 10;
  }

  const headline = text.headline.trim();
  if (headline) {
    // One line when it fits at a size that still shouts; two otherwise.
    let lines = [headline];
    let size = fitSize(ctx, headline, headlineFont, maxW, 210);
    if (size < 150) {
      const two = splitInTwo(headline);
      if (two) {
        const s2 = Math.min(fitSize(ctx, two[0], headlineFont, maxW, 210), fitSize(ctx, two[1], headlineFont, maxW, 210));
        if (s2 > size) { lines = two; size = s2; }
      }
    }
    ctx.font = headlineFont(size);
    ctx.fillStyle = palette.headline;
    for (const line of lines) {
      y += size * 0.86;
      ctx.fillText(line, x, y);
      y += size * 0.06;
    }
  }

  if (text.weightOwnLine && text.weight) {
    ctx.font = bodyFont(300, 92);
    ctx.fillStyle = palette.body;
    y += 100;
    ctx.fillText(text.weight, x, y);
  }

  const details = text.details.trim();
  if (details) {
    let size = 40;
    ctx.font = bodyFont(400, size);
    const w = ctx.measureText(details).width;
    if (w > maxW) size = Math.max(28, Math.floor(size * (maxW / w)));
    ctx.font = bodyFont(400, size);
    ctx.fillStyle = palette.body;
    y += size + 28;
    ctx.fillText(details, x, y);
  }
  ctx.restore();
}

// ── The weight stamp ───────────────────────────────────────────────────────

const REF = 3000, LEFT = 120, TOP = 100, SIZE = 143, TRACKING = 2;

export interface StampOptions {
  /** "18.8g" — empty draws nothing and just re-encodes. */
  text: string;
  /** 'auto' reads the corner and picks white or the tool's dark #1a1a1a. */
  colour: 'auto' | 'white' | 'dark';
  /** Longest edge of the output. Keeps a 48 MP original from becoming a 20 MB upload. */
  maxEdge: number;
}

/** The photo, scaled to `maxEdge`, with the weight in its top-left corner, as a JPEG. */
export async function stampPhoto(photo: HTMLImageElement, o: StampOptions): Promise<Blob> {
  const s = Math.min(1, o.maxEdge / Math.max(photo.naturalWidth, photo.naturalHeight));
  const W = Math.round(photo.naturalWidth * s), H = Math.round(photo.naturalHeight * s);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, 0, 0, W, H);

  if (o.text) {
    await loadStampFont();
    const k = W / REF;
    const size = SIZE * k;
    const x = LEFT * k, baseline = (TOP + SIZE * 1.1) * k;
    let fill = o.colour === 'dark' ? '#1a1a1a' : '#ffffff';
    if (o.colour === 'auto') fill = regionLuminance(ctx, x, TOP * k, W * 0.3, size * 1.2) > 170 ? '#1a1a1a' : '#ffffff';
    ctx.font = `300 ${size}px "Taheri Stamp", Futura, "Century Gothic", sans-serif`;
    // Canvas letterSpacing is recent; where it is missing, 2/3000 of the width is not missed.
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${TRACKING * k}px`;
    ctx.fillStyle = fill;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(o.text, x, baseline);
  }
  return canvasToJpeg(c, 0.92);
}

export function canvasToJpeg(c: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/jpeg', quality));
}

/** The story as a JPEG, rendered at full size off-screen. */
export async function renderStoryJpeg(o: StoryOptions): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = STORY_W; c.height = STORY_H;
  drawStory(c.getContext('2d')!, o);
  return canvasToJpeg(c, 0.93);
}
