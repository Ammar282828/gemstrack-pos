/**
 * What each layer is for (docs/features/design-studio-plan.md §3.2, step 1), so a resize can move a headline
 * as a headline and a mark as a mark. Evidence, in order: the layer's own `role`; its `bind`; the template's
 * name and kind; the kind itself. Pure.
 */

import type { LayerRole, Layer, StoryDoc, Box } from '@/lib/social/editor';
import { frameOf } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';

/** The name the ad templates give the layers they lay (templates.ts `TPL`). */
export const TEMPLATE_LAYER = 'template';
/** The photo id the ad templates use for the piece's photograph (templates.ts `PHOTO`). */
export const TEMPLATE_PHOTO = 'photo';

const BIND_ROLE = { headline: 'headline', kicker: 'kicker', weight: 'specs', details: 'cta' } as const;
/** A short line in a box is a badge. */
const BADGE_MAX = 30;

export function roleOf(l: Layer, doc: StoryDoc): LayerRole {
  if (l.role) return l.role;
  const f = frameOf(doc);
  if (l.kind === 'text') {
    if (l.bind) return BIND_ROLE[l.bind];
    if (l.box && (l.text || '').trim().length <= BADGE_MAX) return 'badge';
    return 'text';
  }
  // A QR code is a badge that is never text: it keeps its square and its corner like a mark.
  if (l.kind === 'wordmark' || l.kind === 'qr') return 'mark';
  if (l.kind === 'image') {
    if (l.photoId === TEMPLATE_PHOTO && !l.src) return 'photo';
    return 'image';
  }
  // Shapes: a rect spanning the frame is its ground frame; a template's rect spanning its width is a band.
  if (l.kind === 'rect' || l.kind === 'shape') {
    const wide = Math.abs(l.w) >= f.w * 0.9, tall = Math.abs(l.h) >= f.h * 0.9;
    if (wide && tall) return 'frame';
    if (wide && l.name === TEMPLATE_LAYER) return 'band';
  }
  return 'decor';
}

export function rolesOf(doc: StoryDoc): Map<string, LayerRole> {
  return new Map(doc.layers.map(l => [l.id, roleOf(l, doc)]));
}

export const isTextRole = (r: LayerRole) => r === 'headline' || r === 'kicker' || r === 'specs' || r === 'cta' || r === 'text' || r === 'badge';

export type Anchor = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';
export type AnchorX = 'l' | 'c' | 'r';
export type AnchorY = 't' | 'c' | 'b';

/** Which third of the frame a box's centre is in, each way. */
export function anchorAxes(b: Box, f: Frame): { x: AnchorX; y: AnchorY } {
  const cx = (b.x + b.w / 2) / f.w, cy = (b.y + b.h / 2) / f.h;
  return { x: cx < 1 / 3 ? 'l' : cx > 2 / 3 ? 'r' : 'c', y: cy < 1 / 3 ? 't' : cy > 2 / 3 ? 'b' : 'c' };
}

export function anchorOf(b: Box, f: Frame): Anchor {
  const { x, y } = anchorAxes(b, f);
  if (x === 'c' && y === 'c') return 'c';
  if (x === 'c') return y as Anchor;
  if (y === 'c') return x as Anchor;
  return `${y}${x}` as Anchor;
}
