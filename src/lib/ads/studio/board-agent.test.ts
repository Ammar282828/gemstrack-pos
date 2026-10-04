import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('./assets', () => ({ listAssets: vi.fn(), loadAssessments: vi.fn(), assetJpeg: vi.fn() }));

const { wordProblems, TOOLS } = await import('./board-agent');

const f = (fields: Partial<Record<'kicker' | 'headline' | 'weight' | 'details', string>>) => ({ fields: { kicker: '', headline: '', weight: '', details: '', ...fields }, doc: null });

describe('an agent’s words', () => {
  it('passes words with only the ERP’s figures', () => {
    expect(wordProblems(f({ headline: 'An emerald for Eid', weight: '21K Yellow Gold · 4.2g', details: 'Message us' }))).toEqual([]);
    expect(wordProblems(f({ headline: 'Only 4.2g of 21K gold', weight: '21K Yellow Gold · 4.2g' }))).toEqual([]);
  });

  it('refuses a figure the ERP didn’t give, sale words and hashtags', () => {
    expect(wordProblems(f({ headline: '22K, just 5g', weight: '21K Yellow Gold · 4.2g' })).join(' ')).toMatch(/didn't give/);
    expect(wordProblems(f({ headline: 'Eid sale on now' })).join(' ')).toMatch(/sale\/discount/);
    expect(wordProblems(f({ details: 'Shop now #eid' })).join(' ')).toMatch(/hashtag/);
  });

  it('offers every tool with an object schema', () => {
    expect(TOOLS.map(t => t.name)).toContain('view_design');
    for (const t of TOOLS) expect(t.inputSchema.type).toBe('object');
  });
});
