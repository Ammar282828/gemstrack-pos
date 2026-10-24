import { describe, expect, it } from 'vitest';
import { cleanSettingsPatch } from './settings';

// The Mac app saves Settings → Labels through /api/app/write (updateSettings): the same check and shape as the web card.
describe('cleanSettingsPatch labelLive', () => {
  it('stores the config as the web card does, pairings as a list', () => {
    const r = cleanSettingsPatch({
      labelLive: { design: ' minalabel ', printer: 'System-Test Printer', copies: 2.4, hideWindow: true, vars: [{ name: 'SKU_1', field: 'sku' }, { name: 'PRICE_1', field: 'nonsense' }] },
    });
    expect(r).toEqual({
      ok: true,
      patch: { labelLive: { design: 'minalabel', printer: 'System-Test Printer', copies: 2, hideWindow: true, vars: [{ name: 'SKU_1', field: 'sku' }, { name: 'PRICE_1', field: '' }] } },
    });
  });

  it('refuses a config with no design', () => {
    expect(cleanSettingsPatch({ labelLive: { design: '  ', vars: [] } })).toEqual({ ok: false, error: expect.stringContaining('design') });
    expect(cleanSettingsPatch({ labelLive: null })).toMatchObject({ ok: false });
  });

  it('caps copies and keeps the window shown only when asked', () => {
    const r = cleanSettingsPatch({ labelLive: { design: 'tag', copies: 500, hideWindow: false } });
    expect(r).toMatchObject({ ok: true, patch: { labelLive: { design: 'tag', printer: '', copies: 99, hideWindow: false, vars: [] } } });
  });
});
