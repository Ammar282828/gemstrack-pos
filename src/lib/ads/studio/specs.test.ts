import { describe, it, expect } from 'vitest';
import { pieceSpecs } from './specs';

describe('pieceSpecs', () => {
  it('writes metal, stone and weight the way the shop does', () => {
    expect(pieceSpecs({ karat: '21k', metal: 'Yellow Gold', stone: 'Ruby', weightGrams: 45.35 })).toBe('21K Yellow Gold · Ruby · 45.35g');
  });
  it('uses only what is known', () => {
    expect(pieceSpecs({ stone: 'Emerald', weightGrams: null })).toBe('Emerald');
    expect(pieceSpecs({ karat: '18 kt', weightGrams: 12 })).toBe('18K Gold · 12g');
    expect(pieceSpecs({ weightGrams: null })).toBe('');
  });
  it('does not repeat a karat the metal already names, or print "None" as a stone', () => {
    expect(pieceSpecs({ karat: '21k', metal: '21K Yellow Gold', stone: 'None', weightGrams: 0 })).toBe('21K Yellow Gold');
  });
});
