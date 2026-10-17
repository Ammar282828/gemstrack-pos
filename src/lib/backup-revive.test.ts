import { describe, expect, it } from 'vitest';
import { backupReplacer, reviveTimestamps } from './backup-collections';

describe('reviveTimestamps', () => {
  const make = (s: number, n: number) => ({ ts: s * 1000 + n / 1e6 });
  it('turns the backup file’s dates back into dates, deep, and leaves everything else', () => {
    const doc = { createdAt: { seconds: 10, nanoseconds: 5e6 }, name: 'Test', items: [{ at: { seconds: 2, nanoseconds: 0 } }], other: { seconds: 1, nanoseconds: 0, note: 'x' }, n: 3 };
    expect(reviveTimestamps(doc, make)).toEqual({ createdAt: { ts: 10005 }, name: 'Test', items: [{ at: { ts: 2000 } }], other: { seconds: 1, nanoseconds: 0, note: 'x' }, n: 3 });
  });
  it('undoes backupReplacer', () => {
    const fake = { seconds: 7, nanoseconds: 0, toDate: () => new Date(7000) };
    const json = JSON.parse(JSON.stringify({ at: fake }, backupReplacer));
    expect(reviveTimestamps(json, make)).toEqual({ at: { ts: 7000 } });
  });
});
