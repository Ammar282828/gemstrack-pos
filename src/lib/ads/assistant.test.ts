import { describe, expect, it } from 'vitest';
import { systemPrompt, TOOLS } from './assistant';

describe('the Ads helper', () => {
  const snap = { account: { name: 'Taheri Collections', currency: 'PKR' }, totals: { spend: 1234 } };
  const p = systemPrompt(snap, 'Ads → Campaigns', 'Saturday 27 September 2026');

  it('knows the day, the page and the account it is looking at', () => {
    expect(p).toContain('Saturday 27 September 2026');
    expect(p).toContain('Ads → Campaigns');
    expect(p).toContain(JSON.stringify(snap));
  });
  it('is held to the numbers it was given, in rupees, and says where in the ERP to act', () => {
    expect(p).toMatch(/Never invent/);
    expect(p).toContain('Rs 1,500');
    expect(p).toMatch(/Ads → Campaigns \(pause, budget/);
    expect(p).toMatch(/cannot see sales/);
  });
  it('has two read-only tools, with every required field declared', () => {
    const fns = TOOLS[0].functionDeclarations;
    expect(fns.map(f => f.name)).toEqual(['get_insights', 'get_details']);
    for (const f of fns) for (const r of f.parameters.required) expect(Object.keys(f.parameters.properties)).toContain(r);
    const props = fns[0]?.parameters.properties as unknown as Record<string, { enum?: string[] }> | undefined;
    expect(props?.date_preset?.enum).toContain('last_30d');
  });
});
