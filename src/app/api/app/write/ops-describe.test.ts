import { describe, expect, it, vi } from 'vitest';

const sets: unknown[] = [];
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: () => ({ doc: () => ({ set: async (d: unknown) => { sets.push(d); } }) }) },
}));

const { runDescribeOp, DESCRIBE_OPS } = await import('./ops-describe');
const { OPS } = await import('./run-op');

const ctx = { email: 'x@example.com', log: async () => {}, alert: () => {}, followUps: [] };

describe('setStoneCombos', () => {
  it('is registered for owners and staff, and in the op table', () => {
    expect(DESCRIBE_OPS.setStoneCombos).toEqual(['owner', 'staff']);
    expect(OPS.setStoneCombos).toEqual(['owner', 'staff']);
  });
  it('saves the cleaned list', async () => {
    const res = await runDescribeOp('setStoneCombos', { combos: [' Ruby & diamond ', 'ruby & diamond', 'Emerald & pearl'] }, ctx);
    expect(res!.status).toBe(200);
    expect(await res!.json()).toMatchObject({ ok: true, combos: ['Ruby & diamond', 'Emerald & pearl'] });
    expect(sets.at(-1)).toEqual({ stoneCombos: ['Ruby & diamond', 'Emerald & pearl'] });
  });
  it('refuses a too-long combination and a non-list; passes other ops on', async () => {
    expect((await runDescribeOp('setStoneCombos', { combos: ['x'.repeat(61)] }, ctx))!.status).toBe(400);
    expect((await runDescribeOp('setStoneCombos', { combos: 'Ruby' }, ctx))!.status).toBe(400);
    expect(await runDescribeOp('other', {}, ctx)).toBeNull();
  });
});
