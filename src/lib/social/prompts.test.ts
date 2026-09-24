import { describe, expect, it } from 'vitest';
import { SCENES, enhancePrompt, letteringPrompt, nearestAspect, reframePrompt, restagePrompt, sameText } from './prompts';

describe('nearestAspect', () => {
  it('keeps a photo its own shape', () => {
    expect(nearestAspect(3000, 3000)).toBe('1:1');
    expect(nearestAspect(1080, 1920)).toBe('9:16');
    expect(nearestAspect(3000, 2400)).toBe('5:4');
    expect(nearestAspect(3024, 4032)).toBe('3:4');
  });
});

describe('image prompts', () => {
  const all = [enhancePrompt({ tidy: true }), reframePrompt('9:16', true), ...SCENES.map(s => restagePrompt(s.brief, '9:16'))];
  it('never name the metal — naming it pulls the model to a generic one', () => {
    for (const p of all) expect(p).not.toMatch(/\b(gold|golden|silver|platinum|palladium)\b/i);
  });
  it('put the piece first', () => {
    for (const p of all) expect(p.startsWith('Use the attached photograph')).toBe(true);
  });
  it('leave the story room for its headline', () => {
    expect(reframePrompt('9:16', false)).toMatch(/top third/);
    expect(reframePrompt('4:5', false)).not.toMatch(/top third/);
  });
  it('only take out tags when asked', () => {
    expect(enhancePrompt({ tidy: true })).toMatch(/price tag/);
    expect(enhancePrompt({ tidy: false })).not.toMatch(/Remove any price tag/);
  });
});

describe('letteringPrompt', () => {
  it('quotes every line exactly', () => {
    const p = letteringPrompt({ kicker: '', headline: 'Bangle & Ring', weight: '18.8g', details: '21K Yellow Gold | Rubies', headlineColour: '#1F4A2C', bodyColour: '#7A5A35', align: 'left' });
    expect(p).toContain('"Bangle & Ring"');
    expect(p).toContain('"18.8g"');
    expect(p).toContain('"21K Yellow Gold | Rubies"');
    expect(p).not.toContain('""');
  });
});

describe('sameText', () => {
  it('ignores case, spacing and curly quotes', () => {
    expect(sameText('21K Yellow Gold | Rubies', '21k yellow gold|rubies')).toBe(true);
    expect(sameText('Mom’s', "mom's")).toBe(true);
    expect(sameText('18.8g', '18.9g')).toBe(false);
  });
});
