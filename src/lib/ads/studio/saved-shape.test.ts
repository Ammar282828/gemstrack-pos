import { describe, expect, it } from 'vitest';
import { folderCounts, inFolder, savedInput } from './saved-shape';

describe('what a save may carry', () => {
  it('keeps the words and settings, cleaned', () => {
    const s = savedInput({
      folder: 'f1', name: '  Ruby ring — Eid  ', format: 'portrait', template: 'band', goal: 'messages', link: 'https://x',
      fields: { headline: 'Ruby', kicker: 'For him', weight: '925 Sterling Silver · 8.2g', extra: 5 },
      text: 'Natural ruby.', headline: 'DM to order', price: 'Rs 14,000',
      asset: { id: 'source:ruby-ring', name: 'Ruby ring' }, thumb: 'data:image/jpeg;base64,AAAA',
    });
    expect(s).toMatchObject({ folder: 'f1', name: 'Ruby ring — Eid', format: 'portrait', goal: 'messages', asset: { id: 'source:ruby-ring' }, thumb: 'data:image/jpeg;base64,AAAA' });
    expect(s!.fields).toEqual({ headline: 'Ruby', kicker: 'For him', weight: '925 Sterling Silver · 8.2g' });
  });
  it('refuses what isn’t an ad, and never trusts a folder, asset, goal or picture it can’t read', () => {
    expect(savedInput(null)).toBeNull();
    expect(savedInput({ format: 'poster' })).toBeNull();
    const s = savedInput({ format: 'square', folder: '../x', goal: 'free-money', asset: { id: 'http://evil' }, thumb: 'javascript:alert(1)' })!;
    expect(s).toMatchObject({ folder: null, goal: 'whatsapp', asset: null, thumb: '', name: 'Untitled ad' });
  });
});

describe('the Saved tab', () => {
  const items = [
    { folder: 'eid', name: 'Ruby ring', headline: 'For him', text: 'Natural ruby in silver' },
    { folder: null, name: 'Bangle set', headline: 'Made to match', text: 'For the mehndi' },
    { folder: 'eid', name: 'Jhumkas', headline: '', text: '' },
  ];
  it('counts each folder', () => {
    expect(folderCounts(items)).toEqual({ eid: 2, '': 1 });
  });
  it('shows a folder, the unfiled, or all, and finds by any word', () => {
    expect(inFolder(items, 'eid').map(i => i.name)).toEqual(['Ruby ring', 'Jhumkas']);
    expect(inFolder(items, 'unfiled').map(i => i.name)).toEqual(['Bangle set']);
    expect(inFolder(items, 'all', 'mehndi').map(i => i.name)).toEqual(['Bangle set']);
    expect(inFolder(items, 'all', 'ruby silver').map(i => i.name)).toEqual(['Ruby ring']);
  });
});
