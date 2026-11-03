import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
const { takenAt } = await import('./run-op');

describe('an offline phone dates its sale by the tap', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  it('keeps a time in the last 30 days', () => {
    expect(takenAt('2026-11-01T09:30:00Z', now)).toBe('2026-11-01T09:30:00.000Z');
  });
  it('refuses the future, the too old and junk', () => {
    expect(takenAt('2026-11-04T00:00:00Z', now)).toBeNull();
    expect(takenAt('2026-09-01T00:00:00Z', now)).toBeNull();
    expect(takenAt('soon', now)).toBeNull();
    expect(takenAt(undefined, now)).toBeNull();
  });
  it('a minute of clock skew is now', () => {
    expect(takenAt('2026-11-03T12:00:30Z', now)).toBe('2026-11-03T12:00:00.000Z');
  });
});
