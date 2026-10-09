import { describe, expect, it } from 'vitest';
import { siteNameOf } from './site-name';

describe('siteNameOf', () => {
  it('drops the scheme, www and a trailing slash', () => {
    expect(siteNameOf('https://www.example.shop/')).toBe('example.shop');
    expect(siteNameOf('https://catalogue.example.store')).toBe('catalogue.example.store');
    expect(siteNameOf('http://example.com//')).toBe('example.com');
  });

  it('says "the website" when the house has none', () => {
    expect(siteNameOf('')).toBe('the website');
    expect(siteNameOf(undefined)).toBe('the website');
  });
});
