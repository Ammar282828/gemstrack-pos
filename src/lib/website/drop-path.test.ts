import { describe, expect, it } from 'vitest';
import { dropPath } from './drop-path';

describe('dropPath — a drop\'s address, by taheri.shop\'s own rules', () => {
  it('the collection and the file name, lowercased with dashes', () => {
    expect(dropPath('Sets/Stone Sets/DSC09295.webp')).toBe('/stone-sets/dsc09295');
    expect(dropPath('Rings & Bands/Gents Ruby Rings/DSC09192.webp')).toBe('/gents-ruby-rings/dsc09192');
    expect(dropPath('Sets/Stone Sets/DSC09184-retouched-4k_overlay.webp')).toBe('/stone-sets/dsc09184-retouched-4k-overlay');
  });
  it('a bare number is prefixed with its collection, as the app does (never a page number)', () => {
    expect(dropPath('Earrings/Baali/5.webp')).toBe('/baali/baali-5');
  });
  it('a key without a collection has no address', () => {
    expect(dropPath('loose.webp')).toBeNull();
  });
});
