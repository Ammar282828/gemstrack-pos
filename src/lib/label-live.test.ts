import { describe, expect, it } from 'vitest';
import { batchUrl, cleanLabelLive, labelLiveUrl, toStoredLabelLive, configFromIntegrate, guessField, parseIntegrateUrl, labelsOf, printUrl, rjsonPairs, tagsOf, variablesFor, type LabelLiveConfig } from './label-live';

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
  it('fills each paired variable as the JSON Label LIVE carries, with no "&" to break the link', () => {
    expect(variablesFor(config, piece)).toBe('{"SKU":"HM-102","NAME":"Ayla\'s Ring and Band","PRICE":"Rs 12,500"}');
    expect(variablesFor(config, { ...piece, name: 'a\nb' })).toContain('"NAME":"a b"');
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
    expect(jobs[1]).toMatchObject({ design: 'minalabel', printer: 'zebra_1', copies: '2' });
    expect(JSON.parse(jobs[1].variables)).toEqual({ SKU: 'HM-103', NAME: 'Bangle', PRICE: 'Rs 9,000' });
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

describe('a design with two tags to a label (minalabel)', () => {
  // The shape of the owner's Integrate link, 2026-10-23: the double-tag CSV's columns, each _1 and _2, as JSON.
  const LINK = 'labellive://print?design=minalabel&variables=' + encodeURIComponent(JSON.stringify({
    SKU_1: 'TOP-000001', SKU_2: 'TOP-000002', TOTAL_PRICE_PKR_1: '20650.00', TOTAL_PRICE_PKR_2: '32900.00',
    METAL_WEIGHT_G_1: '5.900', METAL_WEIGHT_G_2: '9.400', QR_CONTENT_1: 'TOP-000001', QR_CONTENT_2: 'TOP-000002',
  })) + '&printer=System-Zebra_Technologies_ZTC_ZD220-203dpi_ZPL&window=show&copies=1';
  const config = configFromIntegrate(parseIntegrateUrl(LINK)!);
  const a = { 'csv:sku': 'RIN-000069', 'csv:total_price_pkr': '4628', 'csv:metal_weight_g': '1.780', 'csv:qr_content': 'RIN-000069' } as const;
  const b = { 'csv:sku': 'RIN-000070', 'csv:total_price_pkr': '8398', 'csv:metal_weight_g': '3.230', 'csv:qr_content': 'RIN-000070' } as const;

  it('reads the JSON link and pairs each variable with its CSV column', () => {
    expect(config.printer).toBe('System-Zebra_Technologies_ZTC_ZD220-203dpi_ZPL');
    expect(config.map).toMatchObject({ SKU_1: 'csv:sku', SKU_2: 'csv:sku', TOTAL_PRICE_PKR_2: 'csv:total_price_pkr', QR_CONTENT_1: 'csv:qr_content' });
    expect(tagsOf(config).count).toBe(2);
  });
  it('fills the left tag from one piece and the right from the next', () => {
    expect(JSON.parse(variablesFor(config, [a, b]))).toMatchObject({ SKU_1: 'RIN-000069', SKU_2: 'RIN-000070', TOTAL_PRICE_PKR_2: '8398', METAL_WEIGHT_G_1: '1.780' });
  });
  it('prints a lone piece with the right tag blank, never the sample', () => {
    const v = JSON.parse(variablesFor(config, [a]));
    expect(v.SKU_1).toBe('RIN-000069');
    expect([v.SKU_2, v.TOTAL_PRICE_PKR_2, v.QR_CONTENT_2]).toEqual(['', '', '']);
  });
  it('makes one label of two pieces and a batch of two labels of three', () => {
    expect(labelsOf(config, [a, b, a]).map(l => l.length)).toEqual([2, 1]);
    const url = batchUrl(config, [a, b, a]);
    const jobs = JSON.parse(Buffer.from(decodeURIComponent(url.split('payload=')[1]), 'base64').toString('utf8'));
    expect(jobs).toHaveLength(2);
    expect(JSON.parse(jobs[1].variables).SKU_2).toBe('');
  });
  it('keeps one-tag designs as they were', () => {
    expect(tagsOf({ design: 'x', printer: '', copies: 1, map: { SKU: 'sku', SIZE_2: 'size' }, hideWindow: true }).count).toBe(1);
  });
});

describe('many labels in one print link', () => {
  const config: LabelLiveConfig = { design: 'minalabel', printer: '', copies: 1, map: { SKU_1: 'sku', SKU_2: 'sku' }, hideWindow: true };
  it('sends a list of labels as the variables, never the batch link Label LIVE misreads', () => {
    const url = labelLiveUrl(config, [{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }]);
    expect(url.startsWith('labellive://print?design=minalabel&variables=')).toBe(true);
    const v = JSON.parse(decodeURIComponent(/variables=([^&]*)/.exec(url)![1]));
    expect(v).toEqual([{ SKU_1: 'A', SKU_2: 'B' }, { SKU_1: 'C', SKU_2: '' }]);
  });
  it('keeps one label as a single object', () => {
    const v = JSON.parse(decodeURIComponent(/variables=([^&]*)/.exec(labelLiveUrl(config, [{ sku: 'A' }]))![1]));
    expect(v).toEqual({ SKU_1: 'A', SKU_2: '' });
  });
});
