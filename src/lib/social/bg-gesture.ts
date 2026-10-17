/**
 * Moving a design's background photo by hand (2026-10-15, owner: "moving the background around, or adding a
 * new background its all buggy. make everything very free, i shouldnt have to deal with sliders for basic
 * things"; "the gradient on photo is buggy if you change the background").
 *
 * - Drag pans the photo by exactly the distance dragged. On an axis where the photo has no room to move (it
 *   just covers the frame) the focus is left alone: it used to jump to an edge, and the next zoom threw the
 *   photo into a corner.
 * - Zoom (scroll, pinch) keeps the point under the pointer still, up to 6×.
 * - A new background photo starts centred and unzoomed: the crop chosen for the old photo meant nothing to it.
 * - The shade over the photo is one gradient (bg.shade): the quick choices write it, the old preset
 *   (bg.gradient) is cleared when they do, so the two never stack.
 *
 * Pure; story.ts's drawStoryPhoto is the geometry it follows. Tested.
 */

import type { Placement } from './story';
import { SHADE_DEFAULT, type Shade, type StoryDoc } from './editor';

export const MAX_ZOOM = 6;
interface Size { w: number; h: number }

/** The photo's drawn size and its spare room on each axis, as drawStoryPhoto lays it out. */
export function photoBox(img: Size, frame: Size, p: Placement) {
  const cover = Math.max(frame.w / img.w, frame.h / img.h), contain = Math.min(frame.w / img.w, frame.h / img.h);
  const s = (p.mode === 'fill' ? cover : contain) * Math.max(1, p.zoom);
  const dw = img.w * s, dh = img.h * s;
  return { dw, dh, spareX: dw - frame.w, spareY: dh - frame.h };
}

const cl = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 10000) / 10000;

/** Pan by (dx, dy) frame pixels from the focus the drag started at. */
export function panPhoto(img: Size, frame: Size, p: Placement, start: { focusX: number; focusY: number }, dx: number, dy: number): Placement {
  const { spareX, spareY } = photoBox(img, frame, p);
  // A photo bigger than the frame moves with the finger (focus goes the other way); a smaller one ("whole photo") moves with it too.
  const axis = (spare: number, f0: number, d: number, f: number) => (Math.abs(spare) < 0.5 ? f : round(cl(f0 + (spare > 0 ? -d / spare : d / -spare))));
  return { ...p, focusX: axis(spareX, start.focusX, dx, p.focusX), focusY: axis(spareY, start.focusY, dy, p.focusY) };
}

/** Zoom to `zoom`, keeping the frame point (px, py) over the same spot of the photo. */
export function zoomPhotoAt(img: Size, frame: Size, p: Placement, zoom: number, px: number, py: number): Placement {
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const a = photoBox(img, frame, p), b = photoBox(img, frame, { ...p, zoom: z });
  // Where the point sits on the photo (0–1), before.
  const left = -a.spareX * p.focusX, top = -a.spareY * p.focusY;   // drawStoryPhoto's offset, whichever is bigger
  const u = (px - left) / a.dw, v = (py - top) / a.dh;
  // The focus that puts that spot back under the point at the new size.
  const fx = b.spareX > 0.5 ? cl((u * b.dw - px) / b.spareX) : 0.5;
  const fy = b.spareY > 0.5 ? cl((v * b.dh - py) / b.spareY) : 0.5;
  return { ...p, zoom: round(z), focusX: round(fx), focusY: round(fy) };
}

/** A fresh crop for a new background photo. */
export const freshPlacement = (p: Placement): Placement => ({ ...p, focusX: 0.5, focusY: 0.5, zoom: 1 });

/** The shade, in one tap: what each quick choice puts over the photo. */
export const SHADE_PRESETS: { id: string; label: string; shade: Shade | null }[] = [
  { id: 'none', label: 'None', shade: null },
  { id: 'bottom', label: 'Bottom', shade: { ...SHADE_DEFAULT, angle: 180, start: 0.5, end: 1, toAlpha: 0.75 } },
  { id: 'top', label: 'Top', shade: { ...SHADE_DEFAULT, angle: 0, start: 0.55, end: 1, toAlpha: 0.7 } },
  { id: 'left', label: 'Left', shade: { ...SHADE_DEFAULT, angle: 270, start: 0.4, end: 1, toAlpha: 0.7 } },
  { id: 'all', label: 'Darken', shade: { ...SHADE_DEFAULT, angle: 180, start: 0, end: 1, fromAlpha: 0.35, toAlpha: 0.55 } },
];

/** The quick choice a shade matches (for lighting the pill), or null when it has been tuned by hand. */
export function shadePresetOf(bg: Pick<StoryDoc['bg'], 'shade' | 'gradient'>): string | null {
  if (!bg.shade) return bg.gradient && bg.gradient !== 'none' ? null : 'none';
  const hit = SHADE_PRESETS.find(p => p.shade && JSON.stringify(p.shade) === JSON.stringify(bg.shade));
  return hit?.id ?? null;
}

/** Put a quick shade on: it replaces the old preset gradient as well, so only one shade is ever drawn. */
export const withShade = (bg: StoryDoc['bg'], shade: Shade | null): StoryDoc['bg'] => ({ ...bg, shade, gradient: 'none' });

/** Where the fade starts and ends on the frame, for the two handles drawn over the photo. */
export function shadeEnds(g: Shade, frame: Size) {
  const a = (g.angle * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(frame.w * dx) + Math.abs(frame.h * dy)) / 2, cx = frame.w / 2, cy = frame.h / 2;
  const at = (t: number) => ({ x: cx - dx * half + 2 * dx * half * t, y: cy - dy * half + 2 * dy * half * t });
  return { start: at(g.start), end: at(g.end), dx, dy, half };
}

/** A handle dragged to (x, y): the fade's start or end moves along the shade's line to that point. */
export function dragShadeEnd(g: Shade, frame: Size, which: 'start' | 'end', x: number, y: number): Shade {
  const { dx, dy, half } = shadeEnds(g, frame);
  const cx = frame.w / 2, cy = frame.h / 2;
  const t = round(cl(((x - (cx - dx * half)) * dx + (y - (cy - dy * half)) * dy) / (2 * half)));
  return which === 'start' ? { ...g, start: Math.min(t, g.end) } : { ...g, end: Math.max(t, g.start) };
}
