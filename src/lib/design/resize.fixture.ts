/**
 * What the resize tests stand on: a stand-in for the browser's text measuring (so the engine's own `layerBox`
 * and the templates run in node), the assets, and designs to resize. Test support only.
 */

import { AD_FORMAT_ORDER, AD_FORMATS, MORE_FORMAT_ORDER, applyAdTemplate, blankAd, customFormat, type AdFormat, type AdTemplateId } from '@/lib/ads/studio/templates';
import { newLayerId, textLayer, type Assets, type Fields, type StoryDoc, type TextLayer } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';

/** A canvas that measures 0.5 em a character (capitals wider) — enough for the engine's layout to run. */
export function installFakeDom() {
  const ctx = {
    font: '', letterSpacing: '0px',
    measureText(s: string) {
      const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? '16');
      const ls = parseFloat(this.letterSpacing) || 0;
      let w = 0;
      for (const ch of s) w += size * (ch !== ch.toLowerCase() ? 0.62 : 0.48) + ls;
      return { width: w };
    },
  };
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ getContext: () => ctx }) };
}
export const removeFakeDom = () => { delete (globalThis as unknown as { document?: unknown }).document; };

const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as unknown as HTMLImageElement;

export const FIELDS: Fields = { kicker: 'New in', headline: 'Ruby Cocktail Ring', weight: '21K Yellow Gold · Ruby · 12.4g', details: 'Message us to order' };

export const assetsFor = (photo = img(1200, 1200)): Assets => ({
  photos: { photo },
  marks: { wordmark: img(400, 100), t: img(50, 100) },
  fonts: { headline: 'a', body: 'b', serif: 'c' },
});

export const ELEVEN: AdFormat[] = [...AD_FORMAT_ORDER, ...MORE_FORMAT_ORDER];
export const frameOfFormat = (f: Exclude<AdFormat, 'custom'>): Frame => AD_FORMATS[f].frame;
export const CUSTOM_RATIOS: [number, number][] = [[7, 3], [1, 2], [5, 3]];
export const customFrames = (): Frame[] => CUSTOM_RATIOS.map(([w, h]) => customFormat(w, h).frame);

/** A template laid on a frame, as the designer would hold it. */
export function templateDoc(id: AdTemplateId, frame: Frame, assets = assetsFor(), fields = FIELDS): StoryDoc {
  const base = blankAd('portrait', frame);
  const laid = applyAdTemplate(base, id, fields, assets, {
    rates: id === 'rate' ? { date: '12 October', rows: [{ label: '24K', perTola: 530_300 }, { label: '22K', perTola: 486_000 }, { label: '21K', perTola: 463_900 }] } : null,
  });
  return { ...laid, meta: { template: id } };
}

export const rateBoardFor = (id: AdTemplateId) =>
  id === 'rate' ? { date: '12 October', rows: [{ label: '24K', perTola: 530_300 }, { label: '22K', perTola: 486_000 }, { label: '21K', perTola: 463_900 }] } : null;

/** A free-hand 4:5: a full-bleed photo, a headline, a line of specs, a call to action, a badge, a mark and an inset. */
export function freeHand(frame: Frame = { w: 1080, h: 1350 }): StoryDoc {
  const t = (o: Partial<TextLayer> & Pick<TextLayer, 'x' | 'y' | 'size' | 'font' | 'color'>) => textLayer({ width: 880, ...o });
  return {
    bg: { photoId: 'photo', placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0.15, gradient: 'bottom', color: '#10181a' },
    frame,
    layers: [
      t({ text: 'Handmade in Karachi', x: 540, y: 330, size: 88, font: 'serif-italic', color: '#ffffff', align: 'center', width: 900 }),
      t({ text: '21K gold · ruby · 12.4 g', x: 540, y: 520, size: 40, font: 'regular', color: '#f3e3b8', align: 'center' }),
      t({ text: 'Message us to order', x: 540, y: 940, size: 44, font: 'regular', color: '#ffffff', align: 'center' }),
      t({ text: 'NEW', x: 90, y: 90, size: 34, font: 'bold', color: '#111111', align: 'left', width: 200, box: { color: '#E4C983', radius: 24, pad: 16 } }),
      { id: newLayerId('wordmark'), kind: 'wordmark', mark: 'wordmark', x: 780, y: 1180, width: 220, color: '#ffffff', autoColor: false, rotate: 0, opacity: 1 },
      { id: newLayerId('image'), kind: 'image', photoId: 'photo', x: 90, y: 1040, w: 200, h: 200, fx: 0.5, fy: 0.5, radius: 24, border: '#ffffff', shadow: false, rotate: 0, opacity: 1 },
    ],
    placements: {},
  };
}
