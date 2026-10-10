import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: { teamNote: '' }, cache: undefined as any,
  day: vi.fn(), set: vi.fn(),
}));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {
  collection: (name: string) => ({ doc: () => ({
    get: async () => ({ data: () => name === 'app_settings' ? mocks.settings : mocks.cache }),
    set: mocks.set,
  }) }),
} }));
vi.mock('@/lib/store-config', () => ({ STORE_CONFIG: { name: 'Sample shop', defaultMetal: 'silver' } }));
vi.mock('@/lib/roles', () => ({ roleForEmail: () => 'owner' }));
vi.mock('@/lib/website/config', () => ({ loadRates: async () => ({}) }));
vi.mock('@/lib/notifications/reports', () => ({ theDayRows: mocks.day, rows: async () => [] }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.settings = { teamNote: '' }; mocks.cache = undefined;
  mocks.set.mockResolvedValue(undefined);
  mocks.day.mockResolvedValue({ invoices: [], orders: [], repairs: [], extraRevenues: [], expenses: [] });
});

describe('widget cache freshness', () => {
  it('reads pin edits and clears immediately while retaining the financial cache', async () => {
    const { currentWidgetSummary } = await import('./server');
    const now = new Date('2026-10-08T10:00:00Z');
    mocks.settings.teamNote = 'First note';
    expect((await currentWidgetSummary(now)).teamNote).toBe('First note');
    mocks.settings.teamNote = 'Urgent update';
    expect((await currentWidgetSummary(now)).teamNote).toBe('Urgent update');
    mocks.settings.teamNote = '';
    expect((await currentWidgetSummary(now)).teamNote).toBe('');
    expect(mocks.day).toHaveBeenCalledTimes(1);
  });

  it('recalculates at Karachi midnight even when the cached figures are seconds old', async () => {
    const { currentWidgetSummary } = await import('./server');
    expect((await currentWidgetSummary(new Date('2026-10-31T18:59:59Z'))).asOf).toBe('2026-10-31');
    expect((await currentWidgetSummary(new Date('2026-10-31T19:00:00Z'))).asOf).toBe('2026-11-01');
    expect(mocks.day).toHaveBeenCalledTimes(2);
  });

  it('replaces a stored summary from the old widget format', async () => {
    mocks.cache = { at: new Date('2026-10-08T10:00:00Z').getTime(), summary: { house: 'Old', figures: [] } };
    const { currentWidgetSummary } = await import('./server');
    const result = await currentWidgetSummary(new Date('2026-10-08T10:00:01Z'));
    expect(result.figures[0].label).toBe('Made today');
    expect(mocks.day).toHaveBeenCalledTimes(1);
  });
});
