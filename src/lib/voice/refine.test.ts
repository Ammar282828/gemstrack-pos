import { describe, expect, it } from 'vitest';
import { previousFrom, refinedText } from './refine';

describe('a follow-up to a voice plan', () => {
  it('reads the previous words and reading, and ignores anything else', () => {
    expect(previousFrom({ words: ' tea 500 ', reading: { action: 'expense', amount: 500 } })).toEqual({ words: 'tea 500', reading: { action: 'expense', amount: 500 } });
    for (const bad of [undefined, null, 'x', [], {}, { words: '', reading: {} }, { words: 'a' }, { words: 'a', reading: 'text' }]) expect(previousFrom(bad)).toBeNull();
  });
  it('refuses a reading too large to be one the route returned', () => {
    expect(previousFrom({ words: 'a', reading: { note: 'x'.repeat(7000) } })).toBeNull();
  });
  it('puts the earlier reading and the change into one sentence for the model', () => {
    const text = refinedText({ words: 'tea 500', reading: { action: 'expense', amount: 500 } }, ' make it 700 ');
    expect(text).toContain('"tea 500"');
    expect(text).toContain('{"action":"expense","amount":500}');
    expect(text).toContain('What they say now: "make it 700"');
  });
});
