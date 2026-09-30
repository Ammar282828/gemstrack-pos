/**
 * The faces the story and the square are drawn in: the shop's three (the
 * stories' condensed headline, Figtree, a Didone) and the designer's extra
 * five. The extras aren't preloaded; the designer loads one when a layer first
 * uses it (or its panel shows it) and redraws.
 *
 * Self-hosted (src/fonts), not next/font/google: the build fetched these from
 * Google and, now and then, Google answered with a font address that has no
 * .woff2 ending, which Next's loader can't read ("Cannot read properties of
 * null (reading '1')") — House of Mina's build failed on it twice on
 * 2026-09-30. The files are Google's own latin cuts; weights and styles are
 * exactly what the Google calls asked for, and each keeps the fallback Google's
 * loader picked (Times New Roman for a serif, Arial otherwise).
 */

import localFont from 'next/font/local';
import type { FontFamilies } from '@/lib/social/editor';

export const headlineFace = localFont({
  src: [{ path: '../../../fonts/sofia-sans-extra-condensed-latin.woff2', weight: '800', style: 'normal' }],
  display: 'swap',
});
export const bodyFace = localFont({
  src: [
    { path: '../../../fonts/figtree-latin.woff2', weight: '300', style: 'normal' },
    { path: '../../../fonts/figtree-latin.woff2', weight: '400', style: 'normal' },
    { path: '../../../fonts/figtree-latin.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
});
export const serifFace = localFont({
  src: [
    { path: '../../../fonts/bodoni-moda-normal-latin.woff2', weight: '400', style: 'normal' },
    { path: '../../../fonts/bodoni-moda-normal-latin.woff2', weight: '500', style: 'normal' },
    { path: '../../../fonts/bodoni-moda-italic-latin.woff2', weight: '400', style: 'italic' },
    { path: '../../../fonts/bodoni-moda-italic-latin.woff2', weight: '500', style: 'italic' },
  ],
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});
const cormorant = localFont({
  src: [
    { path: '../../../fonts/cormorant-garamond-normal-latin.woff2', weight: '500', style: 'normal' },
    { path: '../../../fonts/cormorant-garamond-italic-latin.woff2', weight: '500', style: 'italic' },
  ],
  display: 'swap', preload: false, adjustFontFallback: 'Times New Roman',
});
const playfair = localFont({
  src: [{ path: '../../../fonts/playfair-display-latin.woff2', weight: '700', style: 'normal' }],
  display: 'swap', preload: false, adjustFontFallback: 'Times New Roman',
});
const script = localFont({
  src: [{ path: '../../../fonts/great-vibes-latin.woff2', weight: '400', style: 'normal' }],
  display: 'swap', preload: false,
});
const montserrat = localFont({
  src: [
    { path: '../../../fonts/montserrat-latin.woff2', weight: '400', style: 'normal' },
    { path: '../../../fonts/montserrat-latin.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap', preload: false,
});
const cinzel = localFont({
  src: [{ path: '../../../fonts/cinzel-latin.woff2', weight: '500', style: 'normal' }],
  display: 'swap', preload: false, adjustFontFallback: 'Times New Roman',
});

export const FONTS: FontFamilies = {
  headline: headlineFace.style.fontFamily,
  body: bodyFace.style.fontFamily,
  serif: serifFace.style.fontFamily,
  extra: {
    cormorant: cormorant.style.fontFamily,
    playfair: playfair.style.fontFamily,
    script: script.style.fontFamily,
    montserrat: montserrat.style.fontFamily,
    cinzel: cinzel.style.fontFamily,
  },
};
