/**
 * White or dark ink for a weight drawn onto a photograph (the owner, 2026-11-10: "make sure it's either black or white
 * based on the contrast behind it"). The same rule as taheri.shop's WeightLabel.jsx `inkFor`: the label's corner of
 * the photo — the weight and the carats under it, against the overlay tool's 3000px reference — its mean relative
 * luminance, and whichever ink has the higher contrast against it. White is the overlay tool's own; #1a1a1a its dark one.
 */

export const LABEL_AREA = { x: 80, y: 40, w: 900, h: 400 } as const;
export const WHITE_INK = '#ffffff';
export const DARK_INK = '#1a1a1a';

/** sRGB 0–255 to linear light. */
export const linear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/** The mean relative luminance of RGB(A) pixels. */
export function meanLuminance(px: Uint8Array | Uint8ClampedArray, channels = 4): number {
  let sum = 0, n = 0;
  for (let i = 0; i + 2 < px.length; i += channels) { sum += 0.2126 * linear(px[i]) + 0.7152 * linear(px[i + 1]) + 0.0722 * linear(px[i + 2]); n++; }
  return n ? sum / n : 0;
}

/** White below L ≈ 0.20, where 1.05 / (L + 0.05) beats (L + 0.05) / 0.06 (#1a1a1a). */
export const inkFor = (L: number) => (1.05 / (L + 0.05) >= (L + 0.05) / 0.06 ? WHITE_INK : DARK_INK);
