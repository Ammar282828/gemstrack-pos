import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('./assets', () => ({ listAssets: vi.fn(), loadAssessments: vi.fn(), usedAssetIds: vi.fn(), assetJpeg: vi.fn() }));
vi.mock('./art-direct', () => ({ artDirect: vi.fn() }));

const { weekOf, weeklyDue, choosePieces } = await import('./weekly');

describe('this week’s board: when', () => {
  it('names a week by its Monday in Karachi', () => {
    expect(weekOf(new Date('2026-10-05T04:30:00Z'))).toBe('2026-10-05');   // Monday 9:30 Karachi
    expect(weekOf(new Date('2026-10-11T18:00:00Z'))).toBe('2026-10-05');   // Sunday 23:00 Karachi
    expect(weekOf(new Date('2026-10-04T19:30:00Z'))).toBe('2026-10-05');   // Monday 00:30 Karachi (still Sunday in UTC)
  });

  it('is due from Monday 9:00 Karachi, once a week', () => {
    expect(weeklyDue({ week: '2026-09-28' }, new Date('2026-10-05T03:30:00Z'))).toBe(false); // Monday 8:30
    expect(weeklyDue({ week: '2026-09-28' }, new Date('2026-10-05T04:00:00Z'))).toBe(true);  // Monday 9:00
    expect(weeklyDue({ week: '2026-10-05' }, new Date('2026-10-07T10:00:00Z'))).toBe(false); // made already
    expect(weeklyDue({ week: null }, new Date('2026-10-08T10:00:00Z'))).toBe(true);          // missed Monday: later in the week
  });
});

describe('this week’s board: which pieces', () => {
  const now = new Date('2026-10-05T05:00:00Z');
  const day = 86_400;
  const a = (id: string, o: Partial<{ source: 'site' | 'drive'; added: number | null; score: number | null; used: boolean }> = {}) => ({
    id, source: o.source ?? 'site', key: id, name: id, collection: 'Rings', thumb: '', page: null, specs: '', original: null,
    added: o.added ?? null, score: o.score ?? null, used: o.used ?? false,
  } as const);

  it('takes the week’s new website pieces first, newest first', () => {
    const t = now.getTime() / 1000;
    const out = choosePieces([a('old', { added: t - 30 * day, score: 99 }), a('new1', { added: t - 2 * day }), a('new2', { added: t - 1 * day })], now, 2);
    expect(out.map(x => x.id)).toEqual(['new2', 'new1']);
  });

  it('takes a piece once, however many photographs it has', () => {
    const t = now.getTime() / 1000;
    const same = (id: string, added: number) => ({ ...a(id, { added }), name: 'Pavé Link Necklace and Earrings' });
    const out = choosePieces([same('lead', t - day), same('angle1', t - day), same('angle2', t - day), a('ring', { added: t - 2 * day })], now, 6);
    expect(out.map(x => x.name)).toEqual(['Pavé Link Necklace and Earrings', 'ring']);
  });

  it('tops up with the best photos not yet in an ad, never Drive ones or weak ones', () => {
    const t = now.getTime();   // milliseconds too
    const out = choosePieces([
      a('new', { added: t - day * 1000 }), a('best', { score: 90 }), a('used', { score: 95, used: true }),
      a('weak', { score: 40 }), a('drive', { source: 'drive', added: t, score: 99 }), a('good', { score: 70 }),
    ], now, 4);
    expect(out.map(x => x.id)).toEqual(['new', 'best', 'good']);
  });
});
