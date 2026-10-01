import { beforeEach, describe, expect, it } from 'vitest';
import { COOL_MS, forgetCooling, isCooling, markExhausted, modelOrder } from './ai-fallback';

describe('ai fallback', () => {
  beforeEach(() => forgetCooling());

  it('keeps the chain as given while nothing is exhausted', () => {
    expect(modelOrder(['gemini-3.1-pro-preview', 'gemini-3.6-flash'])).toEqual(['gemini-3.1-pro-preview', 'gemini-3.6-flash']);
  });

  it('drops blanks and duplicates (a fallback equal to the model is no fallback)', () => {
    expect(modelOrder(['gemini-2.5-flash', undefined, ' ', 'gemini-2.5-flash'])).toEqual(['gemini-2.5-flash']);
  });

  it('moves an exhausted model to the back for five minutes, then brings it back', () => {
    const now = 1_000_000;
    markExhausted('gemini-3.1-pro-preview', now);
    expect(isCooling('gemini-3.1-pro-preview', now + 1)).toBe(true);
    expect(modelOrder(['gemini-3.1-pro-preview', 'gemini-3.6-flash'], now + 1)).toEqual(['gemini-3.6-flash', 'gemini-3.1-pro-preview']);
    expect(modelOrder(['gemini-3.1-pro-preview', 'gemini-3.6-flash'], now + COOL_MS + 1)).toEqual(['gemini-3.1-pro-preview', 'gemini-3.6-flash']);
  });

  it('still tries a lone exhausted model', () => {
    markExhausted('gemini-3-pro-image');
    expect(modelOrder(['gemini-3-pro-image'])).toEqual(['gemini-3-pro-image']);
  });
});
