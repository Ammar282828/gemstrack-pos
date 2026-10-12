import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AD_FORMATS } from '@/lib/ads/studio/templates';
import { textLayer, type ShapeLayer, type StoryDoc } from '@/lib/social/editor';
import { anchorOf, roleOf, rolesOf } from './roles';
import { freeHand, installFakeDom, removeFakeDom, templateDoc } from './resize.fixture';

beforeAll(installFakeDom);
afterAll(removeFakeDom);

describe('roleOf', () => {
  it('reads the roles of a laid template', () => {
    const doc = templateDoc('headline', AD_FORMATS.portrait.frame);
    const roles = [...rolesOf(doc).values()];
    expect(roles).toEqual(expect.arrayContaining(['headline', 'kicker', 'specs', 'cta', 'mark']));
  });

  it('puts an explicit role first', () => {
    const doc = freeHand();
    const l = { ...doc.layers[0], role: 'cta' as const };
    expect(roleOf(l, doc)).toBe('cta');
  });

  it('knows the photo, an inset, a badge, plain text and decor', () => {
    const doc = freeHand();
    const by = (pred: (l: StoryDoc['layers'][number]) => boolean) => doc.layers.find(pred)!;
    expect(roleOf(by(l => l.kind === 'image'), doc)).toBe('photo');
    expect(roleOf({ ...(by(l => l.kind === 'image') as object), photoId: 'lib:abc' } as never, doc)).toBe('image');
    expect(roleOf(by(l => l.kind === 'text' && l.text === 'NEW'), doc)).toBe('badge');
    expect(roleOf(by(l => l.kind === 'text' && l.text === 'Message us to order'), doc)).toBe('text');
    expect(roleOf(by(l => l.kind === 'wordmark'), doc)).toBe('mark');
    expect(roleOf(textLayer({ bind: 'weight', x: 0, y: 0, size: 30, font: 'regular', color: '#fff' }), doc)).toBe('specs');
    const line: ShapeLayer = { id: 'l', kind: 'line', x: 0, y: 0, w: 60, h: 0, color: '#fff', stroke: 2, fill: null, curve: 0, radius: 0, rotate: 0, opacity: 1 };
    expect(roleOf(line, doc)).toBe('decor');
  });

  it('calls a rect across the frame a band, and one over all of it a frame', () => {
    const doc = freeHand();
    const rect = (w: number, h: number): ShapeLayer => ({ id: 'r', kind: 'rect', x: 0, y: 900, w, h, color: '#000', stroke: 0, fill: '#000', curve: 0, radius: 0, rotate: 0, opacity: 1, name: 'template' });
    expect(roleOf(rect(1080, 300), doc)).toBe('band');
    expect(roleOf(rect(1080, 1350), doc)).toBe('frame');
  });
});

describe('anchorOf', () => {
  const f = { w: 900, h: 900 };
  it('names the corner or the middle', () => {
    expect(anchorOf({ x: 10, y: 10, w: 100, h: 50 }, f)).toBe('tl');
    expect(anchorOf({ x: 790, y: 840, w: 100, h: 50 }, f)).toBe('br');
    expect(anchorOf({ x: 400, y: 10, w: 100, h: 50 }, f)).toBe('t');
    expect(anchorOf({ x: 10, y: 400, w: 100, h: 50 }, f)).toBe('l');
    expect(anchorOf({ x: 400, y: 400, w: 100, h: 50 }, f)).toBe('c');
  });
});
