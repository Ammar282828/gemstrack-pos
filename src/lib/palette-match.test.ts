import { describe, expect, it } from 'vitest';
import { scorePlace } from './palette-match';

describe('scorePlace', () => {
  it('ranks a name that starts with the word above one that contains it above a keyword', () => {
    expect(scorePlace('Orders', ['custom order'], 'ord')).toBe(4);
    expect(scorePlace('Online orders', [], 'ord')).toBe(3);
    expect(scorePlace('Repairs', ['fix'], 'fi')).toBe(3);
    expect(scorePlace('Repairs', ['quick fix'], 'fix')).toBe(2.5);
    expect(scorePlace('Repairs', ['fix'], 'zzz')).toBe(-1);
    expect(scorePlace('Repairs', [], '')).toBe(-1);
  });
});
