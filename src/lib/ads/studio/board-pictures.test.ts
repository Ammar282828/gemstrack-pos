import { describe, expect, it } from 'vitest';
import type { ImageLayer, StoryDoc } from '@/lib/social/editor';
import { cleanDoc } from './board-shape';
import { assetOfRef, extraIds, libRef, pictureSlots, replacePicture, rewriteUploads, uploadSrcs } from './board-pictures';

const img = (id: string, photoId: string, more: Partial<ImageLayer> = {}): ImageLayer =>
  ({ id, kind: 'image', photoId, x: 100, y: 200, w: 300, h: 400, fx: 0.3, fy: 0.7, radius: 0, border: null, shadow: false, mask: 'arch', rotate: 5, opacity: 1, ...more });
const doc = (layers: StoryDoc['layers'], bg: Partial<StoryDoc['bg']> = {}): StoryDoc => ({
  bg: { photoId: 'photo', placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#fff', ...bg },
  layers, frame: { w: 1080, h: 1350 }, placements: { photo: { mode: 'fill', zoom: 1.6, focusX: 0.2, focusY: 0.8 } },
});

describe('refs', () => {
  it('round-trips a library id', () => {
    expect(libRef('up:abc')).toBe('lib:up:abc');
    expect(assetOfRef('lib:up:abc')).toBe('up:abc');
    expect(assetOfRef('photo')).toBeNull();
    expect(assetOfRef('lib:')).toBeNull();
  });
});

describe('extraIds', () => {
  it('lists lib insets once, a lib background, and skips uploads and the main photo', () => {
    const d = doc([img('a', 'lib:site:1'), img('b', 'lib:site:1'), img('c', 'photo'), img('d', '', { src: 'data:image/png;base64,AA' })], { photoId: 'lib:drive:9' });
    expect(extraIds(d)).toEqual(['lib:drive:9', 'lib:site:1']);
    expect(extraIds(null)).toEqual([]);
  });
});

describe('rewriteUploads', () => {
  it('turns each uploaded picture into its library picture, keeping its place and frame', () => {
    const src = 'data:image/png;base64,AAAA';
    const d = doc([img('u1', '', { src }), img('u2', '', { src }), img('k', 'lib:site:2')]);
    expect(uploadSrcs(d)).toEqual([src]);
    const out = rewriteUploads(d, { [src]: 'up:xyz' });
    const [u1, u2, k] = out.layers as ImageLayer[];
    expect(u1).toMatchObject({ photoId: 'lib:up:xyz', x: 100, y: 200, w: 300, h: 400, mask: 'arch', rotate: 5, fx: 0.3 });
    expect('src' in u1).toBe(false);
    expect(u2.photoId).toBe('lib:up:xyz');
    expect(k).toBe(d.layers[2]);
    // What the board keeps is the same document: cleanDoc has nothing left to drop.
    expect(cleanDoc(out).layers).toEqual(out.layers);
    expect(extraIds(out)).toEqual(['lib:up:xyz', 'lib:site:2']);
  });
  it('refuses to leave an upload behind', () => {
    expect(() => rewriteUploads(doc([img('u', '', { src: 'data:x' })]), {})).toThrow(/not saved/);
  });
  it('returns the same document when there is nothing to upload', () => {
    const d = doc([img('k', 'lib:site:2')]);
    expect(rewriteUploads(d, {})).toBe(d);
  });
});

describe('replacePicture', () => {
  const base = { doc: doc([img('i', 'photo'), img('u', '', { src: 'data:x' })]), assetId: 'site:1', marked: true };
  it('changes the design’s own photo, its crops starting again centred and unzoomed', () => {
    const out = replacePicture(base, 'photo', { assetId: 'up:new' });
    expect(out).toMatchObject({ assetId: 'up:new', marked: false });
    expect(out.doc.placements!.photo).toEqual({ mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 });
    expect(out.doc.layers[0]).toMatchObject({ photoId: 'photo', x: 100, w: 300, mask: 'arch', fx: 0.5, fy: 0.5 });
    expect(out.doc.layers[1]).toBe(base.doc.layers[1]);
  });
  it('replaces an inset of the photo, or an upload, with a library picture in the same place', () => {
    const a = replacePicture(base, 'i', { assetId: 'drive:5' });
    expect(a.doc.layers[0]).toMatchObject({ photoId: 'lib:drive:5', x: 100, w: 300, mask: 'arch', fx: 0.5, fy: 0.5 });
    expect(a.assetId).toBe('site:1');
    const b = replacePicture(base, 'u', { assetId: 'up:z' });
    expect(b.doc.layers[1]).toMatchObject({ photoId: 'lib:up:z' });
    expect('src' in b.doc.layers[1]).toBe(false);
  });
  it('gives a new lib background a fresh crop (its mode kept), and drops the old picture’s', () => {
    const d = { ...doc([], { photoId: 'lib:site:1', placement: { mode: 'fit' as const, zoom: 2, focusX: 0, focusY: 1 } }), placements: { 'lib:site:1': { mode: 'fit' as const, zoom: 2, focusX: 0, focusY: 1 } } };
    const out = replacePicture({ doc: d, assetId: null, marked: false }, 'bg', { assetId: 'up:q' });
    expect(out.doc.bg.photoId).toBe('lib:up:q');
    expect(out.doc.placements!['lib:site:1']).toBeUndefined();
    expect(out.doc.bg.placement).toEqual({ mode: 'fit', zoom: 1, focusX: 0.5, focusY: 0.5 });
  });
  it('says so when the layer is gone', () => {
    expect(() => replacePicture(base, 'nope', { assetId: 'x' })).toThrow();
  });
});

describe('pictureSlots', () => {
  it('lists the photo, then the pictures top first', () => {
    const slots = pictureSlots(doc([img('a', 'photo'), img('b', 'lib:site:3', { mask: null })]), true);
    expect(slots.map(s => s.target)).toEqual(['photo', 'b', 'a']);
    expect(slots[1].label).toBe('Picture 2');
    expect(slots[2].label).toBe('Inset of the photo 1');
  });
});
