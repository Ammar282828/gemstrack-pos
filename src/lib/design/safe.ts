/**
 * Where each place draws over a picture, so what must be read stays clear of it (plan §3.3). The story's band is
 * the ad studio's own `safeZone`; the others generalise today's shading. Pure.
 */

import { metaFeedFit, safeZone } from '@/lib/ads/studio/templates';
import type { Box } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';

export interface SafeBands { top: number; bottom: number; left: number; right: number }
/** The smallest a QR code may be drawn, in px on its frame (quiet zone included), so a phone can still scan it. */
export const QR_MIN = 120;
export type SafeKind = 'story' | 'reel' | 'feed-grid' | 'link';

export const SAFE_KINDS: { id: SafeKind; label: string }[] = [
  { id: 'story', label: 'Story' },
  { id: 'reel', label: 'Reel' },
  { id: 'feed-grid', label: 'Profile grid' },
  { id: 'link', label: 'Link ad' },
];

/**
 * The bands that keep words clear in this frame: on a 9:16 Story, the top 14% (the profile and the bar) and the
 * bottom fifth (the reply bar); none elsewhere. A Reel's bottom 35% is the 'reel' kind: holding a Story to it put
 * the words up over the piece when a design was resized to 9:16 (the owner, 2026-10-14: "the 9 by 16s all look
 * off"; docs/features/ad-studio.md#house-of-mina-ad-style keeps only the bottom fifth clear).
 */
export function safeBands(f: Frame, kind: SafeKind = 'story'): SafeBands {
  if (kind === 'story') { const z = safeZone(f); return { top: z.top, bottom: z.bottom ? Math.round(f.h * 0.2) : 0, left: 0, right: 0 }; }
  if (kind === 'reel') return { top: Math.round(f.h * 0.14), bottom: Math.round(f.h * 0.35), left: 0, right: Math.round(f.w * 0.15) };
  if (kind === 'feed-grid') {
    // A tall post shows as its centre 1:1 on the profile grid.
    const side = Math.max(0, f.h - f.w) / 2;
    return { top: Math.round(side), bottom: Math.round(side), left: 0, right: 0 };
  }
  // Link ads: Facebook trims the sides of a 1.91:1 a little.
  return { top: 0, bottom: 0, left: Math.round(f.w * 0.04), right: Math.round(f.w * 0.04) };
}

/** The part of the frame inside the bands. */
export function safeRect(f: Frame, kind: SafeKind = 'story'): Box {
  const b = safeBands(f, kind);
  return { x: b.left, y: b.top, w: Math.max(0, f.w - b.left - b.right), h: Math.max(0, f.h - b.top - b.bottom) };
}

/** What Meta shows of a feed picture in this shape: the rect kept when it crops to 4:5 or 1.91:1. */
export function metaCrop(f: Frame): { fit: ReturnType<typeof metaFeedFit>; rect: Box } {
  const fit = metaFeedFit(f);
  // Taller than 4:5: the middle 4:5 of it. Wider than 1.91:1: the middle 1.91:1.
  if (fit === '4:5') { const h = Math.round(f.w / 0.8); return { fit, rect: { x: 0, y: Math.round((f.h - h) / 2), w: f.w, h } }; }
  if (fit === '1.91:1') { const w = Math.round(f.h * 1.91); return { fit, rect: { x: Math.round((f.w - w) / 2), y: 0, w, h: f.h } }; }
  return { fit, rect: { x: 0, y: 0, w: f.w, h: f.h } };
}

/** The shaded rectangles to draw for the "Show safe zones" toggle: the bands as boxes. */
export function overlayRects(f: Frame, kind: SafeKind = 'story'): Box[] {
  const b = safeBands(f, kind);
  const out: Box[] = [];
  if (b.top) out.push({ x: 0, y: 0, w: f.w, h: b.top });
  if (b.bottom) out.push({ x: 0, y: f.h - b.bottom, w: f.w, h: b.bottom });
  if (b.left) out.push({ x: 0, y: b.top, w: b.left, h: f.h - b.top - b.bottom });
  if (b.right) out.push({ x: f.w - b.right, y: b.top, w: b.right, h: f.h - b.top - b.bottom });
  return out;
}

/** Which kinds make sense to offer for a frame. */
export function safeKindsFor(f: Frame): SafeKind[] {
  if (f.h >= 1800) return ['story', 'reel'];
  if (f.h > f.w) return ['feed-grid'];
  if (f.w / f.h > 1.5) return ['link'];
  return [];
}
