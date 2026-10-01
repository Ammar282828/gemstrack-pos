import { describe, it, expect, beforeEach } from 'vitest';
import { askDeleteCode, registerDeleteCodeAsker, resetDeleteCode, DELETE_CODE_GRACE_MS } from './delete-code';
import { hashDeleteCode } from './delete-code-server';

describe('askDeleteCode', () => {
  beforeEach(() => resetDeleteCode());
  it('refuses when no dialog is mounted', async () => {
    const off = registerDeleteCodeAsker(async () => true); off();
    expect(await askDeleteCode('Delete x')).toBe(false);
  });
  it('asks once, then holds for the grace period', async () => {
    let asked = 0;
    const off = registerDeleteCodeAsker(async () => { asked++; return true; });
    expect(await askDeleteCode('Delete a')).toBe(true);
    expect(await askDeleteCode('Delete b')).toBe(true);
    expect(asked).toBe(1);
    expect(await askDeleteCode('Delete c', Date.now() + DELETE_CODE_GRACE_MS + 1)).toBe(true);
    expect(asked).toBe(2);
    off();
  });
  it('a refused code grants nothing', async () => {
    let asked = 0;
    const off = registerDeleteCodeAsker(async () => { asked++; return false; });
    expect(await askDeleteCode('Delete a')).toBe(false);
    expect(await askDeleteCode('Delete b')).toBe(false);
    expect(asked).toBe(2);
    off();
  });
  it('two deletes at once share one dialog', async () => {
    let asked = 0;
    const off = registerDeleteCodeAsker(() => { asked++; return new Promise(r => setTimeout(() => r(true), 10)); });
    const [a, b] = await Promise.all([askDeleteCode('one'), askDeleteCode('two')]);
    expect([a, b, asked]).toEqual([true, true, 1]);
    off();
  });
});

describe('hashDeleteCode', () => {
  it('depends on the salt and ignores surrounding spaces', () => {
    expect(hashDeleteCode('1234', 'a')).toBe(hashDeleteCode(' 1234 ', 'a'));
    expect(hashDeleteCode('1234', 'a')).not.toBe(hashDeleteCode('1234', 'b'));
  });
});
