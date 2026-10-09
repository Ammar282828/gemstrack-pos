import { describe, expect, it } from 'vitest';
import { bulkPieceName, pastedWeights } from './bulk-pieces';

describe('pastedWeights', () => {
  it('reads numbers separated by spaces, commas or lines', () => {
    expect(pastedWeights('4.2, 5.1\n6.75   7')).toEqual([4.2, 5.1, 6.75, 7]);
    expect(pastedWeights('3.5g\n12.25g')).toEqual([3.5, 12.25]);
  });

  it('leaves out what is not a weight: zero, a lone dot, two dots in one number, no digits at all', () => {
    expect(pastedWeights('0 0.0 . 1.2.3 abc')).toEqual([]);
    expect(pastedWeights('2 .5 5. 0')).toEqual([2, 0.5, 5]);
    expect(pastedWeights('')).toEqual([]);
  });
});

describe('bulkPieceName', () => {
  it('is the prefix and the suffix, spaced', () => {
    expect(bulkPieceName('Gold Ring Design A', 'no. 3')).toBe('Gold Ring Design A no. 3');
    expect(bulkPieceName('  Gold Ring ', '  ')).toBe('Gold Ring');
    expect(bulkPieceName('Gold Ring', undefined)).toBe('Gold Ring');
  });

  it('is nothing when both are blank, and the suffix alone when there is no prefix', () => {
    expect(bulkPieceName('', '')).toBe('');
    expect(bulkPieceName(undefined, '   ')).toBe('');
    expect(bulkPieceName('', 'Heavy one')).toBe('Heavy one');
  });
});
