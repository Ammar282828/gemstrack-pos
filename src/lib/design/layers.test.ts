import { describe, expect, it } from 'vitest';
import { cleanBox, fontFor, normalizeAnalysis, planSplit, textLayerOf } from './layers';

describe('the vision answer, made safe', () => {
  it('clamps boxes and drops what is not usable', () => {
    expect(cleanBox({ x: 0.9, y: 0.1, w: 0.5, h: 0.2 })).toEqual({ x: 0.9, y: 0.1, w: expect.closeTo(0.1, 5), h: 0.2 });
    expect(cleanBox({ x: 'a' })).toBeNull();
    expect(cleanBox({ x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });
  it('keeps known roles, font classes and colours, defaults the rest', () => {
    const a = normalizeAnalysis({
      text: [
        { text: ' RUBY  RING ', box: { x: 0.1, y: 0.05, w: 0.8, h: 0.08 }, role: 'headline', fontClass: 'serif', weight: 'bold', colour: '#c9a24a' },
        { text: 'x', box: { x: 0, y: 0, w: 0.2, h: 0.1 }, role: 'weird', fontClass: 'comic', colour: 'red' },
        { text: 'no box' }, { text: '', box: { x: 0, y: 0, w: 0.2, h: 0.1 } },
      ],
      subject: { x: 0.2, y: 0.3, w: 0.6, h: 0.5 }, background: 'nope',
    });
    expect(a?.text).toHaveLength(2);
    expect(a?.text[0]).toMatchObject({ text: 'RUBY RING', role: 'headline', fontClass: 'serif', weight: 'bold', colour: '#C9A24A' });
    expect(a?.text[1]).toMatchObject({ role: 'text', fontClass: 'sans', colour: null });
    expect(a?.background).toBe('busy');
    expect(normalizeAnalysis({})).toBeNull();
    expect(normalizeAnalysis(null)).toBeNull();
  });
});

describe('lettering to text layers', () => {
  it('maps font classes to the designer\'s faces', () => {
    expect(fontFor('condensed')).toBe('condensed');
    expect(fontFor('serif', 'bold')).toBe('playfair');
    expect(fontFor('serif-italic')).toBe('serif-italic');
    expect(fontFor('script')).toBe('script');
    expect(fontFor('display')).toBe('cinzel');
    expect(fontFor('sans', 'light')).toBe('light');
    expect(fontFor('sans', 'bold')).toBe('bold');
  });
  it('places a layer by its box and keeps its role, with auto colour off', () => {
    const l = textLayerOf({ text: '21K | 12.35g', box: { x: 0.25, y: 0.8, w: 0.5, h: 0.05 }, role: 'specs', fontClass: 'futura', weight: 'regular', colour: '#FFFFFF' }, { w: 1080, h: 1080 });
    expect(l).toMatchObject({ kind: 'text', text: '21K | 12.35g', x: 540, y: 864, font: 'futura', role: 'specs', autoColor: false, align: 'center', fit: true });
    expect(l.size).toBeGreaterThan(30);
    expect(l.size).toBeLessThan(60);
    expect(l.width).toBe(567);
  });
  it('sizes a two-line block by the line, not the block', () => {
    const one = textLayerOf({ text: 'A', box: { x: 0, y: 0, w: 0.5, h: 0.1 }, role: 'text', fontClass: 'sans', weight: 'regular', colour: null }, { w: 1000, h: 1000 });
    const two = textLayerOf({ text: 'A\nB', box: { x: 0, y: 0, w: 0.5, h: 0.1 }, role: 'text', fontClass: 'sans', weight: 'regular', colour: null }, { w: 1000, h: 1000 });
    expect(two.size).toBeLessThan(one.size);
  });
  it('plans the split: the original stays the plate, with the subject box for the resize', () => {
    const a = normalizeAnalysis({ text: [{ text: 'Ruby', box: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 }, role: 'headline' }], subject: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, background: 'busy' })!;
    const p = planSplit(a, { w: 1080, h: 1920 });
    expect(p.layers).toHaveLength(1);
    expect(p.plate).toBe('original');
    expect(p.subject).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
    expect(p.notes.join(' ')).toMatch(/busy/);
  });
});
