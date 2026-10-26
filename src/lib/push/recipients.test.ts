import { describe, expect, it } from 'vitest';
import { actorEmail, pushDoc, recipientsFor } from './send';
import type { PushKind } from './store';

const dev = (token: string, email: string, off: PushKind[] = []) => ({ token, email, off });
const all = [dev('a1', 'amma@taheri.shop'), dev('a2', 'Amma@Taheri.shop'), dev('b1', 'bilal@taheri.shop'), dev('u1', ''), dev('c1', 'carol@taheri.shop', ['payments'])];
const owner = () => true;
const tokens = (l: { token: string }[]) => l.map((d) => d.token);

describe('Not your own action: who a push goes to', () => {
  it('leaves out every phone of the person who did it, in any letter case', () => {
    expect(tokens(recipientsFor(all, { kind: 'orders', actor: 'AMMA@taheri.shop' }, undefined, owner))).toEqual(['b1', 'u1', 'c1']);
  });
  it('keeps everyone else, and phones with no email recorded', () => {
    const r = tokens(recipientsFor(all, { kind: 'sales', actor: 'bilal@taheri.shop' }, undefined, owner));
    expect(r).toContain('a1'); expect(r).toContain('u1'); expect(r).not.toContain('b1');
  });
  it('still honours a phone that switched the kind off', () => {
    expect(tokens(recipientsFor(all, { kind: 'payments', actor: 'bilal@taheri.shop' }, undefined, owner))).not.toContain('c1');
  });
  it('sends to all when nobody acted (a customer, Shopify, the clock, a report)', () => {
    for (const actor of [undefined, '', 'scheduler', 'ai:Claude']) {
      expect(tokens(recipientsFor(all, { kind: 'orders', actor }, undefined, owner))).toEqual(['a1', 'a2', 'b1', 'u1', 'c1']);
    }
  });
  it('a test to one named phone is unaffected by an actor', () => {
    expect(tokens(recipientsFor(all, { kind: 'orders', actor: 'amma@taheri.shop' }, { token: 'a1' }, owner))).toEqual(['a1']);
  });
  it('reads only emails as actors', () => {
    expect(actorEmail('scheduler')).toBeUndefined();
    expect(actorEmail(' A@B.com ')).toBe('a@b.com');
  });
  it('an alert that names no kind sends nothing', async () => {
    expect((await pushDoc({ kind: 'weekly-report' } as never, { actor: 'a@b.com' })).status).toBe('none');
  });
});
