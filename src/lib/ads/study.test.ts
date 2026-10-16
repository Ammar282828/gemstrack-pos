import { describe, expect, it } from 'vitest';
import { evenSplit, studyParams, studyProblems } from './study';

const now = Date.parse('2026-10-16T10:00:00Z');
const base = { name: 'Hero vs lifestyle', adsetIds: ['1', '2'], start: '2026-10-17T00:00:00Z', end: '2026-10-24T00:00:00Z' };

describe('A/B tests', () => {
  it('splits evenly to 100', () => {
    expect(evenSplit(2)).toEqual([50, 50]);
    expect(evenSplit(3)).toEqual([34, 33, 33]);
    expect(evenSplit(5).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('builds a split test with one ad set per cell, times in seconds', () => {
    const p = studyParams({ ...base, adsetIds: ['1', '2', '2', '3'], purchases: true, pixelId: 'px' });
    expect(p.type).toBe('SPLIT_TEST');
    expect(p.start_time).toBe(Date.parse(base.start) / 1000);
    expect(p.cells).toEqual([{ name: 'A', treatment_percentage: 34, adsets: ['1'] }, { name: 'B', treatment_percentage: 33, adsets: ['2'] }, { name: 'C', treatment_percentage: 33, adsets: ['3'] }]);
    expect((p.objectives as { adspixels: { id: string }[] }[])[0].adspixels[0].id).toBe('px');
    expect(studyParams(base).objectives).toBeUndefined();
  });
  it('says what is missing', () => {
    expect(studyProblems(base, now)).toEqual([]);
    expect(studyProblems({ ...base, adsetIds: ['1'] }, now)).toContain('Choose at least two ad sets to compare.');
    expect(studyProblems({ ...base, end: '2026-10-17T05:00:00Z' }, now).join()).toMatch(/at least a day/);
    expect(studyProblems({ ...base, purchases: true }, now).join()).toMatch(/pixel/);
  });
});
