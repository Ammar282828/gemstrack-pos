import { describe, expect, it } from 'vitest';
import { cleanSettingsPatch } from './writes/settings';
import { staffSettingsView } from './staff-view';

describe('the pinned team note', () => {
  it('accepts a trimmed note and an explicit blank to clear it', () => {
    expect(cleanSettingsPatch({ teamNote: '  Urgent: close early today.  ' })).toEqual({ ok: true, patch: { teamNote: 'Urgent: close early today.' } });
    expect(cleanSettingsPatch({ teamNote: '  ' })).toEqual({ ok: true, patch: { teamNote: '' } });
  });
  it('refuses malformed or oversized notes as a whole patch', () => {
    for (const teamNote of [null, 3, {}, ['note'], 'a'.repeat(601)]) {
      expect(cleanSettingsPatch({ shopName: 'Example', teamNote }).ok).toBe(false);
    }
  });
  it('shares the note with the shop floor while keeping private settings hidden', () => {
    expect(staffSettingsView({ teamNote: 'Urgent note', shopName: 'Example', shopifyToken: 'private', deleteCodeHash: 'private' }))
      .toEqual({ teamNote: 'Urgent note', shopName: 'Example' });
  });
});
