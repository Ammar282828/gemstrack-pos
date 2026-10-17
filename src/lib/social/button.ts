/**
 * Buttons with their words inside (2026-10-15, owner: "also add text ability inside buttons"). A button was a
 * rounded rectangle with a separate line of text over it: two layers that had to be moved, sized and recoloured
 * together, and that a resize laid out apart (the pill left at the bottom, its "SHOP NOW" moved up). A button is
 * now one text layer whose background (`box`) is the pill, at the pill's size (`box.w`, `box.h`): the words are
 * typed into it, and it moves, sizes, resizes and links to the other sizes as one.
 *
 * - A button is placed by its pill (editor.ts asButton): `x` is the pill's left edge, middle or right edge by `align`,
 *   the words always in its middle; it grows away from that edge as the words get longer, keeping `box.pad` round
 *   them, and stays one line.
 * - newButton: a fresh one, for Add → Elements.
 * - buttonFromShape: a rectangle on the design becomes a button; the words already on it go inside (same look),
 *   else it gets words to type over.
 *
 * Pure (the measuring is passed in: the editor's layerBox). Tested.
 */

import type { Box, Layer, ShapeLayer, StoryDoc, TextLayer } from './editor';
import type { Frame } from './story';

const id = (k: string) => `${k}-${Math.random().toString(36).slice(2, 8)}`;

/** A pill button in the middle of the frame. */
export function newButton(o: { label?: string; fill: string; ink: string; frame: Frame }): TextLayer {
  const h = Math.round(o.frame.w * 0.085), w = Math.round(o.frame.w * 0.36);
  return {
    id: id('text'), kind: 'text', role: 'cta', name: 'Button', text: o.label ?? 'SHOP NOW',
    x: Math.round(o.frame.w / 2), y: Math.round(o.frame.h * 0.62 - h * 0.18), size: Math.round(h * 0.36),
    font: 'montserrat-bold', color: o.ink, align: 'center', width: Math.round(o.frame.w * 0.9), fit: false,
    spacing: 0.12, lineHeight: 1, upper: true, shadow: false,
    box: { color: o.fill, radius: Math.round(h / 2), pad: Math.round(h * 0.32), w, h },
    rotate: 0, opacity: 1,
  };
}

const closed = (l: Layer): l is ShapeLayer => l.kind === 'rect' && !l.hidden;

/** The text sitting on a shape: its middle inside the shape and filling a fair part of it. */
export function wordsOn(doc: StoryDoc, shape: ShapeLayer, boxOf: (l: Layer) => Box): TextLayer | null {
  const s = { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
  return (doc.layers.find(l => {
    if (l.kind !== 'text' || l.hidden || l.box) return false;
    const b = boxOf(l), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return cx > s.x && cx < s.x + s.w && cy > s.y && cy < s.y + s.h && area(b) > area(s) * 0.08 && area(b) < area(s) * 1.2;
  }) as TextLayer | undefined) ?? null;
}

/** Whether a layer is a shape that can become a button. */
export const canBeButton = (l: Layer | null | undefined): l is ShapeLayer => !!l && closed(l) && !l.rotate;

/**
 * Turn a rectangle into a button: one text layer with the rectangle as its background, the words on it inside
 * (centred in it, as they sat), or new words. Returns the document and the button's id; the rectangle is gone and
 * the button takes the words' place in the stack (else the rectangle's).
 */
export function buttonFromShape(doc: StoryDoc, shapeId: string, boxOf: (l: Layer) => Box, o: { ink: string; label?: string }): { doc: StoryDoc; id: string } | null {
  const shape = doc.layers.find(l => l.id === shapeId);
  if (!canBeButton(shape)) return null;
  const fill = shape.fill ?? shape.color;
  const bg = { color: fill, radius: Math.min(shape.radius, Math.round(Math.min(shape.w, shape.h) / 2)), pad: 0, w: Math.round(shape.w), h: Math.round(shape.h) };
  // The room round the words as they sit in the pill: kept when they grow, so longer words never touch its edge.
  const roomOf = (tb: Box) => Math.max(0, Math.floor(Math.min((shape.h - tb.h) / 2, (shape.w - tb.w) / 2)));
  const on = wordsOn(doc, shape, boxOf);
  let button: TextLayer;
  if (on) {
    // Centred where the shape's middle is: its own box, measured without a background, decides its top.
    const centred: TextLayer = { ...on, align: 'center', x: Math.round(shape.x + shape.w / 2) };
    const b = boxOf({ ...centred, box: null });
    // One line, however long the words get: the pill grows round them instead of wrapping them inside it.
    button = { ...centred, y: Math.round(on.y + (shape.y + shape.h / 2) - (b.y + b.h / 2)), box: { ...bg, pad: roomOf(b) }, width: Math.max(on.width, Math.round(shape.w * 3)), fit: false, role: on.role ?? 'cta' };
    delete button.flow;   // it stays where the shape was, out of any stack
    if (shape.opacity !== 1 && on.opacity === 1) button.opacity = shape.opacity;
  } else {
    const size = Math.round(shape.h * 0.36);
    button = {
      id: id('text'), kind: 'text', role: 'cta', name: 'Button', text: o.label ?? 'SHOP NOW',
      x: Math.round(shape.x + shape.w / 2), y: Math.round(shape.y + shape.h / 2 - size * 0.36), size,
      font: 'montserrat-bold', color: o.ink, align: 'center', width: Math.round(shape.w * 3), fit: false,
      spacing: 0.12, lineHeight: 1, upper: true, shadow: false, box: { ...bg, pad: Math.round(shape.h * 0.32) }, rotate: 0, opacity: shape.opacity,
    };
  }
  // Anchored by the side of the frame it sits on, so longer words grow it away from that side (editor.ts asButton).
  const fw = doc.frame?.w ?? 1080, mid = shape.x + shape.w / 2;
  if (mid < fw * 0.4) button = { ...button, align: 'left', x: Math.round(shape.x) };
  else if (mid > fw * 0.6) button = { ...button, align: 'right', x: Math.round(shape.x + shape.w) };
  const layers = doc.layers.filter(l => l.id !== shape.id).map(l => (on && l.id === on.id ? button : l));
  if (!on) layers.splice(doc.layers.findIndex(l => l.id === shape.id), 0, button);
  return { doc: { ...doc, layers }, id: button.id };
}

/** A button back to a plain line of words (its background off). */
export const unButton = (l: TextLayer): TextLayer => ({ ...l, box: null });
