import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { lookupIn, parseV4, parseV6Top, placeFromHeaders, readTable } from './geo';

const table = readTable(gunzipSync(readFileSync(path.join(__dirname, 'geo/ip-geo.bin.gz'))));

describe('the address table', () => {
  it('places Pakistani and Gulf addresses by city, others by country', () => {
    // From DB-IP Lite's own rows (5.62.35.0/24 is listed as Karachi).
    expect(lookupIn(table, '5.62.35.10')).toMatchObject({ cc: 'PK', region: 'Sindh', city: 'Karachi', via: 'table' });
    expect(lookupIn(table, '8.8.8.8').cc).toBe('US');
    expect(lookupIn(table, '8.8.8.8').city).toBe('');
    expect(lookupIn(table, '::ffff:5.62.35.10').city).toBe('Karachi');
    expect(lookupIn(table, '2001:df0:2d40::1')).toMatchObject({ cc: 'PK', city: 'Lahore' });
  });
  it('knows nothing of private or broken addresses', () => {
    expect(lookupIn(table, '10.0.0.1').cc).toBe('');
    expect(lookupIn(table, 'unknown').cc).toBe('');
  });
  it('parses addresses', () => {
    expect(parseV4('1.2.3.4')).toBe(0x01020304);
    expect(parseV4('256.1.1.1')).toBeNull();
    expect(parseV6Top('2001:db8::1')).toBe(BigInt('0x20010db800000000'));
    expect(parseV6Top('1.2.3.4')).toBeNull();
  });
});

describe('front-end headers', () => {
  it('App Engine style, and Google\'s load balancer', () => {
    expect(placeFromHeaders(new Headers({ 'x-appengine-country': 'PK', 'x-appengine-region': 'sd', 'x-appengine-city': 'karachi' }))).toEqual({ cc: 'PK', region: 'sd', city: 'Karachi', via: 'header' });
    expect(placeFromHeaders(new Headers({ 'x-client-geo-location': 'AE,Dubai' }))).toEqual({ cc: 'AE', region: '', city: 'Dubai', via: 'header' });
    expect(placeFromHeaders(new Headers({ 'x-appengine-country': 'ZZ' }))).toBeNull();
    expect(placeFromHeaders(new Headers())).toBeNull();
  });
});
