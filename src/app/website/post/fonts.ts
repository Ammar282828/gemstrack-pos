/**
 * The faces the story and the square are drawn in: the shop's three (the
 * stories' condensed headline, Figtree, a Didone) and the designer's extra
 * five. The extras aren't preloaded; the designer loads one when a layer first
 * uses it (or its panel shows it) and redraws.
 */

import { Sofia_Sans_Extra_Condensed, Figtree, Bodoni_Moda, Cormorant_Garamond, Playfair_Display, Great_Vibes, Montserrat, Cinzel } from 'next/font/google';
import type { FontFamilies } from '@/lib/social/editor';

export const headlineFace = Sofia_Sans_Extra_Condensed({ subsets: ['latin'], weight: ['800'], display: 'swap' });
export const bodyFace = Figtree({ subsets: ['latin'], weight: ['300', '400', '700'], display: 'swap' });
export const serifFace = Bodoni_Moda({ subsets: ['latin'], weight: ['400', '500'], style: ['normal', 'italic'], display: 'swap' });
const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['500'], style: ['normal', 'italic'], display: 'swap', preload: false });
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['700'], display: 'swap', preload: false });
const script = Great_Vibes({ subsets: ['latin'], weight: ['400'], display: 'swap', preload: false });
const montserrat = Montserrat({ subsets: ['latin'], weight: ['400', '700'], display: 'swap', preload: false });
const cinzel = Cinzel({ subsets: ['latin'], weight: ['500'], display: 'swap', preload: false });

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
