import { describe, expect, it } from 'vitest';
import { CAPTION_ASK_MAX, siteCaptionUser } from './site-caption';

const piece = { name: 'Purple Pear Halo Set', collection: 'Stone Sets', facts: ['Colored Stones', 'Pear'], about: '' };

describe('the caption writer told what to do', () => {
  it('asks for nothing more when the person says nothing', () => {
    const u = siteCaptionUser(piece);
    expect(u).not.toContain('The owner asks');
    expect(u).toContain('Answer with the line and the facts.');
  });
  it('carries the words now and the request, and still asks only for the line and the facts', () => {
    const u = siteCaptionUser({ ...piece, current: { line: 'Old line.', facts: 'Colored Stones · Pear' }, ask: 'call them amethysts, make it bridal' });
    expect(u).toContain('- line: Old line.');
    expect(u).toContain('The owner asks: "call them amethysts, make it bridal"');
    expect(u.trim().endsWith('Answer with the line and the facts.')).toBe(true);
  });
  it('keeps a long request to its limit', () => {
    const u = siteCaptionUser({ ...piece, ask: 'x'.repeat(CAPTION_ASK_MAX + 50) });
    expect(u).toContain('x'.repeat(CAPTION_ASK_MAX) + '"');
    expect(u).not.toContain('x'.repeat(CAPTION_ASK_MAX + 1));
  });
});
