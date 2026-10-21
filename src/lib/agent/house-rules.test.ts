import { describe, expect, it } from 'vitest';
import { copyProblems, houseBrief } from './house-rules';

describe('the house rules on an AI’s words', () => {
  const facts = '21K Yellow Gold · Emerald · 4.2g';
  it('passes words with only the ERP’s figures', () => {
    expect(copyProblems('An emerald for Eid — 21K, 4.2g', facts)).toEqual([]);
  });
  it('refuses sale words, hashtags, the market’s name and invented figures', () => {
    expect(copyProblems('Eid sale now', facts).join()).toMatch(/sale or discount/);
    expect(copyProblems('New in #gold', facts).join()).toMatch(/hashtag/);
    expect(copyProblems('Visit us in Saddar', facts).join()).toMatch(/market or area \(Najmi Market, Saddar\)/);
    expect(copyProblems('Hurry, only a few left', facts).join()).toMatch(/urgency/);
    expect(copyProblems('Hurry, only a few left', facts).join()).not.toMatch(/market or area/);
    expect(copyProblems('Only 22K and 3g', facts).join()).toMatch(/didn't give/);
  });
  it('never prices a Maisons piece by the gram', () => {
    expect(copyProblems('Ask for today’s price', '', { name: 'Cartier — LOVE Bracelet', collection: 'Wristwear/The Maisons' }).join()).toMatch(/Maisons/);
    expect(copyProblems('Ask for today’s price', '', { name: 'Emerald Ring' })).toEqual([]);
  });
  it('briefs from the brand book and the caption rules', () => {
    const b = houseBrief();
    expect(b).toMatch(/VOICE:/);
    expect(b).toMatch(/Najmi Market/);
    expect(b).toMatch(/Maisons/);
  });
});
