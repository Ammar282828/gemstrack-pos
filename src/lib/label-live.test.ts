import { describe, expect, it } from 'vitest';
import { batchUrl, cleanLabelLive, toStoredLabelLive, configFromIntegrate, guessField, parseIntegrateUrl, printUrl, rjsonPairs, rjsonValue, variablesFor, type LabelLiveConfig } from './label-live';

// The shape Label LIVE's guide shows for its Integrate link.
const SAMPLE = "labellive://print?design=sample-address-label&variables=NAME:'Jane Doe',ADDRESS:'1 Main St',CITY:Springfield&printer=Preview&window=show&copies=2";

describe('reading the Integrate link', () => {
  it('takes the design, printer, copies and every variable name', () => {
    expect(parseIntegrateUrl(SAMPLE)).toEqual({ design: 'sample-address-label', printer: 'Preview', copies: 2, variables: ['NAME', 'ADDRESS', 'CITY'] });
  });
  it('reads a percent-encoded ("browser") link and quotes with commas in them', () => {
    const url = `labellive://print?design=minalabel&variables=${encodeURIComponent("SKU:'A,1',Price:'Rs 1',{W}:x")}`;
    expect(parseIntegrateUrl(url)?.variables).toEqual(['SKU', 'Price', 'W']);
    expect(rjsonPairs("A:'it\\'s',B:'x\\&y'")).toEqual([{ key: 'A', value: "it's" }, { key: 'B', value: 'x&y' }]);
  });
  it('refuses anything that is not a print link', () => {
    expect(parseIntegrateUrl('https://label.live')).toBeNull();
    expect(parseIntegrateUrl('labellive://print?copies=1')).toBeNull();
  });
});

describe('pairing variables with fields', () => {
  it('guesses by name', () => {
    expect(['SKU', 'Item Code', 'QR', 'Price', 'PRICE_NUM', 'Weight', 'WT', 'Karat', 'Metal', 'Name', 'Shop', 'StoneWt', 'Diamonds', 'Date', 'xyz'].map(guessField))
      .toEqual(['sku', 'sku', 'qr', 'price', 'priceNumber', 'weight', 'weight', 'karat', 'metal', 'name', 'shop', 'stoneWeight', 'diamonds', 'date', '']);
  });
  it('keeps the owner’s earlier choices when the link is pasted again', () => {
    const prev: LabelLiveConfig = { design: 'old', printer: '', copies: 1, map: { NAME: 'sku' }, hideWindow: false };
    const c = configFromIntegrate(parseIntegrateUrl(SAMPLE)!, prev);
    expect(c.map).toEqual({ NAME: 'sku', ADDRESS: '', CITY: '' });
    expect(c.hideWindow).toBe(false);
  });
});

describe('the print link', () => {
  const config: LabelLiveConfig = { design: 'minalabel', printer: 'zebra_1', copies: 1, map: { SKU: 'sku', NAME: 'name', PRICE: 'price', NOTE: '' }, hideWindow: true };
  const piece = { sku: 'HM-102', name: "Ayla's Ring & Band", price: 'Rs 12,500' };
  it('fills each paired variable, quoted, with no "&" to break the link', () => {
    expect(variablesFor(config, piece)).toBe("SKU:'HM-102',NAME:'Ayla\\'s Ring and Band',PRICE:'Rs 12,500'");
    expect(rjsonValue('a\nb')).toBe("'a b'");
    const url = printUrl(config, piece);
    expect(url.startsWith('labellive://print?design=minalabel&variables=')).toBe(true);
    expect(url).toContain('&printer=zebra_1&copies=1&window=hide&ignoreWarnings=true');
    // Read back the way Label LIVE does: the variables survive the round trip.
    expect(parseIntegrateUrl(url)?.variables).toEqual(['SKU', 'NAME', 'PRICE']);
  });
  it('puts several pieces in one batch', () => {
    const url = batchUrl(config, [piece, { sku: 'HM-103', name: 'Bangle', price: 'Rs 9,000' }], 2);
    const jobs = JSON.parse(Buffer.from(decodeURIComponent(url.split('payload=')[1]), 'base64').toString('utf8'));
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({ design: 'minalabel', printer: 'zebra_1', copies: '2', variables: "SKU:'HM-103',NAME:'Bangle',PRICE:'Rs 9,000'" });
  });
  it('checks a saved config', () => {
    expect(cleanLabelLive({ design: ' minalabel ', copies: 500, map: { SKU: 'sku', X: 'nonsense' } })).toEqual({ design: 'minalabel', printer: '', copies: 99, map: { SKU: 'sku', X: '' }, hideWindow: true });
    expect(cleanLabelLive({ design: '' })).toBeNull();
  });
});

describe('as the settings keep it', () => {
  it('stores the pairings as a list and reads them back', () => {
    const c: LabelLiveConfig = { design: 'minalabel', printer: '', copies: 1, map: { SKU: 'sku', NOTE: '' }, hideWindow: true };
    const stored = toStoredLabelLive(c);
    expect(stored.vars).toEqual([{ name: 'SKU', field: 'sku' }, { name: 'NOTE', field: '' }]);
    expect(cleanLabelLive(stored)).toEqual(c);
  });
});
