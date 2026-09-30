import { describe, expect, it } from 'vitest';
import { resolveRecipientId } from './given';

const karigars = [{ id: 'k1', name: 'Aslam Bhai' }, { id: 'k2', name: 'Rafiq', deletedAt: '2026-09-01' }];
const customers = [{ id: 'c1', name: 'Sakina' }, { id: 'c2', name: 'Fatema' }, { id: 'c3', name: 'Fatema' }];

describe('who a given item went to', () => {
  it('links a name picked from the karigars or customers, however it was spaced or cased', () => {
    expect(resolveRecipientId('karigar', ' aslam  bhai ', karigars, customers)).toBe('k1');
    expect(resolveRecipientId('customer', 'Sakina', karigars, customers)).toBe('c1');
  });
  it('never guesses: two of one name, a removed record, a typed stranger, or "other" stay unlinked', () => {
    expect(resolveRecipientId('customer', 'Fatema', karigars, customers)).toBeUndefined();
    expect(resolveRecipientId('karigar', 'Rafiq', karigars, customers)).toBeUndefined();
    expect(resolveRecipientId('karigar', 'Someone new', karigars, customers)).toBeUndefined();
    expect(resolveRecipientId('other', 'Sakina', karigars, customers)).toBeUndefined();
    expect(resolveRecipientId('customer', 'Aslam Bhai', karigars, customers)).toBeUndefined();
  });
});
