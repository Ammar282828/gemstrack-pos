import { describe, it, expect } from 'vitest';
import { adDayStatus, hijriOf, hijriLabel, quietDaysBetween, upcomingObservances } from './calendar';

const noon = (d: string) => new Date(`${d}T12:00:00+05:00`);

describe('hijriOf', () => {
  it('matches the vault’s own 2025 anchors', () => {
    expect(hijriOf(noon('2025-05-16'))).toEqual({ year: 1446, month: 11, day: 19 }); // the Mazoon's birthday
    expect(hijriOf(noon('2025-06-06'))).toEqual({ year: 1446, month: 12, day: 10 }); // Eid
    expect(hijriOf(noon('2025-06-26'))).toEqual({ year: 1447, month: 1, day: 1 });   // Moharram begins
  });
  it('reads as the Bohra calendar names it', () => {
    expect(hijriLabel(hijriOf(noon('2026-06-16')))).toBe('1 Moharram 1448');
  });
});

describe('adDayStatus', () => {
  it('Ashara is sacred, all ten days', () => {
    expect(adDayStatus('2026-06-16')).toMatchObject({ level: 'sacred', observance: { id: 'ashara' } });
    expect(adDayStatus('2026-06-25')).toMatchObject({ level: 'sacred', observance: { id: 'ashara' } });
  });
  it('the days just before Ashara are kept quiet', () => {
    expect(adDayStatus('2026-06-12')).toMatchObject({ level: 'near', observance: { id: 'ashara' } });
  });
  it('the day after Ashara is clear', () => {
    expect(adDayStatus('2026-06-26').level).toBe('clear');
  });
  it('Eid, and the day before it', () => {
    expect(adDayStatus('2026-05-26')).toMatchObject({ level: 'sacred', observance: { id: 'eid-adha' } });
    expect(adDayStatus('2026-05-25')).toMatchObject({ level: 'near', observance: { id: 'eid-adha' } });
    expect(adDayStatus('2026-05-27').level).toBe('clear');
  });
  it('an ordinary day is clear', () => {
    expect(adDayStatus('2026-09-29')).toMatchObject({ level: 'clear', observance: null });
  });
  it('the first of a lunar month is a quiet day', () => {
    // 17 Rabi al-Aakhar on 29 Sep 2026; the tabular month has 29 days, so the 1st of Jumada al-Ula is 13 days on.
    const first = new Date(noon('2026-09-29').getTime() + 13 * 86_400_000);
    expect(hijriOf(first).day).toBe(1);
    expect(adDayStatus(first).level).toBe('quiet');
  });
});

describe('quietDaysBetween', () => {
  it('lists the quiet days an ad would run through', () => {
    const days = quietDaysBetween('2026-06-10', '2026-06-27');
    expect(days.filter(d => d.level === 'sacred')).toHaveLength(10);
    expect(days.filter(d => d.level === 'near').length).toBeGreaterThan(0);
    expect(days.every(d => d.observance?.id === 'ashara' || d.observance?.id === 'lunar-first')).toBe(true);
  });
  it('a clear week has none', () => {
    expect(quietDaysBetween('2026-09-29', '2026-10-05')).toEqual([]);
  });
});

describe('upcomingObservances', () => {
  it('names each sacred observance once, on its first day', () => {
    const next = upcomingObservances(noon('2026-05-20'), 40);
    expect(next.map(n => [n.date, n.observance.id])).toEqual([['2026-05-26', 'eid-adha'], ['2026-06-03', 'ghadeer'], ['2026-06-16', 'ashara']]);
  });
});
