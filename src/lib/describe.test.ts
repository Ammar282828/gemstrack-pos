import { describe, expect, it } from 'vitest';
import { buildHistory, cleanCombos, composeCombo, suggest } from './describe';

describe('buildHistory', () => {
  const rows = [
    { text: '  Ruby   ring ', category: 'cat001', at: '2026-10-01' },
    { text: 'ruby ring', category: 'cat001', at: '2026-10-05' },
    { text: 'Ruby Ring', category: 'cat001', at: '2026-09-01' },
    { text: 'Ruby ring', category: 'cat001', at: '2026-08-01' },
    { text: 'Emerald top', category: 'cat002', at: '2026-10-09' },
    { text: 'Plain band', category: 'cat009', at: '2026-10-10' },
    { text: '', category: 'cat001' },
    { text: 42 as unknown as string, category: 'cat001' },
  ];
  it('trims, collapses spaces, de-dups case-insensitively keeping the most common casing', () => {
    const h = buildHistory(rows, 'cat001');
    const ruby = h.find(e => e.category === 'cat001')!;
    expect(ruby).toEqual({ text: 'Ruby ring', count: 4, lastAt: '2026-10-05', category: 'cat001' });
    expect(h).toHaveLength(3);
  });
  it('puts the asked category first (ids such as cat001), then most used, then newest', () => {
    expect(buildHistory(rows, 'cat001')[0].category).toBe('cat001');
    const other = buildHistory(rows, 'cat009');
    expect(other[0]).toMatchObject({ text: 'Plain band', category: 'cat009' });
    expect(other.slice(1).map(e => e.text)).toEqual(['Ruby ring', 'Emerald top']);
  });
  it('keeps the same words on two categories as two lines', () => {
    const h = buildHistory([{ text: 'Ruby', category: 'cat001' }, { text: 'ruby', category: 'cat002' }]);
    expect(h).toHaveLength(2);
  });
});

describe('cleanCombos', () => {
  it('trims and de-duplicates', () => {
    expect(cleanCombos([' Ruby & diamond ', 'ruby  &  diamond', 'Emerald & pearl', ''])).toEqual({ ok: true, combos: ['Ruby & diamond', 'Emerald & pearl'] });
  });
  it('refuses a long one, a non-list, a non-string, and more than 200', () => {
    expect(cleanCombos(['x'.repeat(61)]).ok).toBe(false);
    expect(cleanCombos('Ruby').ok).toBe(false);
    expect(cleanCombos([1]).ok).toBe(false);
    expect(cleanCombos(Array.from({ length: 201 }, (_, i) => `combo ${i}`)).ok).toBe(false);
    expect(cleanCombos(Array.from({ length: 200 }, (_, i) => `combo ${i}`)).ok).toBe(true);
    expect(cleanCombos(['x'.repeat(60)]).ok).toBe(true);
  });
});

describe('composeCombo / suggest', () => {
  it('writes a combo with the category word', () => {
    expect(composeCombo('Ruby & diamond', 'Ring')).toBe('Ruby & diamond ring');
    expect(composeCombo('Ruby ring', 'ring')).toBe('Ruby ring');
    expect(composeCombo('Ruby', '')).toBe('Ruby');
  });
  it('suggests history of the category, then combos, then others, filtered by the typed words', () => {
    const history = buildHistory([{ text: 'Ruby ring', category: 'cat001' }, { text: 'Ruby top', category: 'cat002' }]);
    expect(suggest('ruby', history, ['Ruby & diamond', 'Emerald'], 'cat001', 'ring')).toEqual(['Ruby ring', 'Ruby & diamond ring', 'Ruby top']);
    expect(suggest('', history, ['Emerald'], 'cat001', 'ring')).toContain('Emerald ring');
    expect(suggest('ruby ring', history, [], 'cat001', 'ring')).toEqual([]);
  });
});
