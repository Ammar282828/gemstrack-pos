import { describe, it, expect } from 'vitest';
import { originalsByShot, pickOriginal, shotKey } from './originals';

describe('shotKey', () => {
  it('reads the camera name from the site and from Drive alike', () => {
    expect(shotKey('Sets/Stone Sets/DSC09342.webp')).toBe('DSC09342');
    expect(shotKey('DSC09342.JPG')).toBe('DSC09342');
    expect(shotKey('DSC09342-retouched 2.png')).toBe('DSC09342');
    expect(shotKey('DSC09349_retouched.png')).toBe('DSC09349');
    expect(shotKey('IMG_1234.HEIC')).toBe('IMG1234');
  });
  it('is null for a named photo', () => {
    expect(shotKey('Emerald Square Halo Set.jpg')).toBeNull();
    expect(shotKey('taheri-logo.svg')).toBeNull();
  });
  it('does not take a longer number for a shorter one', () => {
    expect(shotKey('DSC093421.jpg')).toBe('DSC093421');
  });
});

describe('originals', () => {
  const f = (id: string, name: string, created: string | null = null) => ({ id, name, created });
  it('prefers the retouched frame, then the newest', () => {
    expect(pickOriginal([f('raw', 'DSC09342.JPG', '2026-09-28T15:00:00Z'), f('ret', 'DSC09342-retouched 2.png', '2026-09-28T17:00:00Z')])?.id).toBe('ret');
    expect(pickOriginal([f('a', 'DSC1.JPG', '2026-01-01T00:00:00Z'), f('b', 'DSC1 copy.JPG', '2026-02-01T00:00:00Z')])?.id).toBe('b');
  });
  it('groups a folder by frame', () => {
    const m = originalsByShot([f('1', 'DSC09342.JPG'), f('2', 'DSC09342_retouched.png'), f('3', 'DSC09343.JPG'), f('4', 'logo.png')]);
    expect([...m.entries()].map(([k, v]) => [k, v.id])).toEqual([['DSC09342', '2'], ['DSC09343', '3']]);
  });
});
