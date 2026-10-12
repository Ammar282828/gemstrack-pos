import { describe, expect, it } from 'vitest';
import { publicUrl, sharedImage } from './outside-image';

describe('publicUrl', () => {
  it('takes a public web address and refuses local or private ones', () => {
    expect(publicUrl('https://www.instagram.com/p/abc/')?.hostname).toBe('www.instagram.com');
    for (const bad of ['ftp://x.com/a', 'http://localhost/a', 'http://127.0.0.1/a', 'http://10.0.0.5/a', 'http://192.168.1.2/a', 'http://169.254.169.254/latest', 'http://metadata.google.internal/x', 'not a url', 'http://[::1]/']) {
      expect(publicUrl(bad)).toBeNull();
    }
  });
});

describe('sharedImage', () => {
  it('reads the picture a page shares', () => {
    const html = '<head><meta property="og:image" content="https://cdn.example.com/p.jpg?a=1&amp;b=2" /></head>';
    expect(sharedImage(html, new URL('https://www.instagram.com/p/abc/'))).toBe('https://cdn.example.com/p.jpg?a=1&b=2');
    expect(sharedImage('<meta name="twitter:image" content="/x.png">', new URL('https://shop.example.com/a'))).toBe('https://shop.example.com/x.png');
    expect(sharedImage('<p>none</p>', new URL('https://a.com'))).toBeNull();
  });
});
