/**
 * A flat ad rebuilt as a design (plan §4.3): what /api/design/layers found (the lettering as text layers, the
 * subject box, and a cut-out of the piece when Magnific could make one) as the first document of a design.
 *
 *   with a cut-out   the house's ground (the picture's own edge colour) + the cut-out piece + the lettering layers
 *   without          the photograph whole as the background + the lettering layers kept (usually none: it is printed on)
 *
 * No pixel of the piece is generated, so no same-piece check is needed. Client only.
 */

import { newImageLayer, type Layer, type StoryDoc, type TextLayer } from '@/lib/social/editor';
import { PHOTO, blankAd } from '@/lib/ads/studio/templates';
import type { SmartPhoto, LayersResult } from './smart-input';
import type { StartRequest } from './use-design';

export interface PlanReview { plan: LayersResult; photo: SmartPhoto }

/** The average colour round the picture's edge, as #RRGGBB: the ground the cut-out piece stands on. */
export async function edgeColour(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('no image')); i.src = url; });
    const n = 48;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const g = c.getContext('2d');
    if (!g) return '#1B1B1B';
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data;
    let r = 0, gg = 0, b = 0, k = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (x > 1 && y > 1 && x < n - 2 && y < n - 2) continue;
      const i = (y * n + x) * 4;
      r += d[i]; gg += d[i + 1]; b += d[i + 2]; k++;
    }
    const hex = (v: number) => Math.round(v / k).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(gg)}${hex(b)}`.toUpperCase();
  } catch { return '#1B1B1B'; } finally { URL.revokeObjectURL(url); }
}

/** The text layers scaled from the picture's pixels to the page's frame. */
const scaled = (l: TextLayer, k: number): TextLayer => ({ ...l, x: Math.round(l.x * k), y: Math.round(l.y * k), size: Math.max(12, Math.round(l.size * k)), width: l.width ? Math.round(l.width * k) : l.width });

export async function flatAdRequest({ plan, photo }: PlanReview, keepIds: string[]): Promise<StartRequest> {
  const ratio = plan.width / Math.max(1, plan.height);
  // A custom W:H of whole numbers up to 100 (the frame is that ratio, 1080 wide).
  const h = Math.max(1, Math.min(100, Math.round(100 / ratio)));
  const keep = (plan.layers as TextLayer[]).filter(l => keepIds.includes(l.id));
  const cutout = plan.cutout ? `data:${plan.cutout.mimeType};base64,${plan.cutout.data}` : null;
  const ground = cutout ? await edgeColour(photo.blob) : null;
  const headline = keep.find(l => l.role === 'headline')?.text ?? '';
  return {
    kind: 'custom',
    sizes: [{ id: 'custom', custom: { w: 100, h } }],
    name: photo.name.replace(/\.[a-z0-9]+$/i, ''),
    fields: headline ? { headline } : {},
    photo: { label: photo.name, load: async () => photo.blob },
    compose: ({ format, frame }) => {
      const base = blankAd(format, frame);
      const k = frame.w / plan.width;
      const layers: Layer[] = [];
      if (cutout) {
        layers.push({ ...newImageLayer('cutout'), src: cutout, x: 0, y: 0, w: frame.w, h: frame.h, radius: 0, border: null, shadow: false, cutout: true, name: 'Piece' });
      }
      layers.push(...keep.map(l => scaled(l, k)));
      const doc: StoryDoc = {
        ...base,
        bg: cutout ? { ...base.bg, photoId: null, color: ground ?? base.bg.color } : { ...base.bg, photoId: PHOTO },
        layers,
        meta: { ...(plan.subject ? { subject: plan.subject } : {}) },
      };
      return doc;
    },
  };
}
