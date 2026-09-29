import { describe, it, expect } from 'vitest';
import { adScore, normalizeAssessment, rankForAds, type AssetAssessment } from './assessment';

const good: AssetAssessment = {
  score: 80, placements: { square: 85, portrait: 75, story: 50 }, subject: 'Emerald halo ring on cream velvet',
  category: 'ring', shot: 'packshot', background: 'clean',
  quality: { sharpness: 8, lighting: 8, composition: 7, colour: 8 },
  burnedText: false, brandRisks: [], strengths: ['Stone sparkles'], issues: [], fixes: [], headline: 'Green, set in light',
};

describe('normalizeAssessment', () => {
  it('keeps a well-formed answer as it is', () => {
    expect(normalizeAssessment(good)).toEqual(good);
  });
  it('clamps scores and numbers given as strings', () => {
    const a = normalizeAssessment({ ...good, score: '140', placements: { square: -5, portrait: '66.6', story: 200 } })!;
    expect(a.score).toBe(100);
    expect(a.placements).toEqual({ square: 0, portrait: 67, story: 100 });
  });
  it('a missing placement falls back to the overall score', () => {
    expect(normalizeAssessment({ ...good, placements: { square: 90 } })!.placements).toEqual({ square: 90, portrait: 80, story: 80 });
  });
  it('drops fixes the ERP has no button for, and duplicates', () => {
    expect(normalizeAssessment({ ...good, fixes: ['retouch', 'Retouch', 'make-it-pop', 'extend-story'] })!.fixes).toEqual(['retouch', 'extend-story']);
  });
  it('unknown shot and background words become the defaults', () => {
    const a = normalizeAssessment({ ...good, shot: 'selfie', background: 'purple' })!;
    expect(a.shot).toBe('other');
    expect(a.background).toBe('textured');
  });
  it('no score, or not an object: nothing usable', () => {
    expect(normalizeAssessment({ ...good, score: 'great' })).toBeNull();
    expect(normalizeAssessment('score: 80')).toBeNull();
    expect(normalizeAssessment(null)).toBeNull();
  });
  it('trims long text and long lists', () => {
    const a = normalizeAssessment({ ...good, subject: 'x'.repeat(500), strengths: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })!;
    expect(a.subject).toHaveLength(160);
    expect(a.strengths).toHaveLength(5);
  });
});

describe('adScore', () => {
  it('weighs the placement fit over the overall score', () => {
    expect(adScore(good, 'square')).toBeGreaterThan(adScore(good, 'story'));
  });
  it('a brand risk costs more than burned-in text', () => {
    expect(adScore({ ...good, brandRisks: ['shows a price'] }, 'square')).toBeLessThan(adScore({ ...good, burnedText: true }, 'square'));
  });
  it('never below 0', () => {
    expect(adScore({ ...good, score: 5, placements: { square: 5, portrait: 5, story: 5 }, brandRisks: ['a', 'b', 'c'] }, 'square')).toBe(0);
  });
});

describe('rankForAds', () => {
  const at = (id: string, collection: string, score: number, extra: Partial<AssetAssessment> = {}, usedInAds = false) =>
    ({ id, collection, usedInAds, assessment: { ...good, score, placements: { square: score, portrait: score, story: score }, ...extra } });

  it('best first, unassessed photos left out', () => {
    const list = [at('a', 'Rings', 60), at('b', 'Sets', 90), { id: 'c', collection: 'Rings', assessment: null }];
    expect(rankForAds(list, { placement: 'square' }).map(a => a.id)).toEqual(['b', 'a']);
  });
  it('a piece already in an ad comes after the rest', () => {
    const list = [at('used', 'Rings', 95, {}, true), at('fresh', 'Sets', 70)];
    expect(rankForAds(list, { placement: 'square' }).map(a => a.id)).toEqual(['fresh', 'used']);
  });
  it('one collection cannot fill the row while others wait', () => {
    const list = [at('s1', 'Sets', 99), at('s2', 'Sets', 98), at('s3', 'Sets', 97), at('r1', 'Rings', 60)];
    expect(rankForAds(list, { placement: 'square', count: 3, perCollection: 2 }).map(a => a.id)).toEqual(['s1', 's2', 'r1']);
  });
  it('only one collection: the row still fills', () => {
    const list = [at('s1', 'Sets', 99), at('s2', 'Sets', 98), at('s3', 'Sets', 97)];
    expect(rankForAds(list, { placement: 'square', count: 3, perCollection: 1 }).map(a => a.id)).toEqual(['s1', 's2', 's3']);
  });
  it('a floor leaves weak photos out', () => {
    expect(rankForAds([at('a', 'Rings', 30), at('b', 'Rings', 80)], { placement: 'square', minScore: 50 }).map(a => a.id)).toEqual(['b']);
  });
});
