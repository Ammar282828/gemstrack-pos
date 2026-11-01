import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { gzipJson, gzipJsonText } from './gzip-json';

const req = (enc?: string) => ({ headers: new Headers(enc ? { 'accept-encoding': enc } : {}) });
const big = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `piece ${i}` })) };

describe('gzipJson', () => {
  it('gzips a large body for a caller that accepts it', async () => {
    const res = gzipJson(req('br, gzip, deflate'), big, { headers: { 'Cache-Control': 'no-store' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString();
    expect(JSON.parse(text)).toEqual(big);
  });

  it('sends plain JSON when gzip is not accepted', async () => {
    const res = gzipJson(req(), big);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
    expect(await res.json()).toEqual(big);
  });

  it('leaves a small body alone even when gzip is accepted', async () => {
    const res = gzipJson(req('gzip'), { ok: true }, { status: 201 });
    expect(res.status).toBe(201);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it('keeps a Vary the route set and a Content-Type it chose', () => {
    const res = gzipJsonText(req('gzip'), JSON.stringify(big), { headers: { Vary: 'Origin', 'Content-Type': 'application/json; charset=utf-8' } });
    expect(res.headers.get('vary')).toBe('Origin, Accept-Encoding');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });
});
