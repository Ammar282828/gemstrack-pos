import { describe, expect, it } from 'vitest';
import { classifyUrl, instagramCaption, matchSitePiece, parseOg, parseShopifyProduct, pieceFields } from './parse-url';

const SITE = 'https://taheri.shop';

describe('the address router', () => {
  it.each([
    ['https://taheri.shop/rings/ruby-ring', 'house-site'],
    ['www.taheri.shop/rings/ruby-ring', 'house-site'],
    ['https://catalogue.houseofmina.store/rings/aurora', 'mina-catalogue'],
    ['https://houseofmina.store/products/aurora-band', 'shopify-product'],
    ['https://houseofmina.store/collections/rings/products/aurora-band?variant=1', 'shopify-product'],
    ['https://www.instagram.com/p/Cabc123/', 'instagram'],
    ['https://instagram.com/reel/Cabc123/?igsh=1', 'instagram'],
    ['https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQr', 'drive'],
    ['https://example.com/some/page', 'generic'],
  ])('%s -> %s', (raw, kind) => expect(classifyUrl(raw, SITE).kind).toBe(kind));

  it('reads the Shopify handle and the Drive folder', () => {
    expect(classifyUrl('https://houseofmina.store/products/aurora-band.json', SITE).handle).toBe('aurora-band');
    expect(classifyUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQr', SITE).folderId).toBe('1AbCdEfGhIjKlMnOpQr');
  });

  it('refuses private and local addresses (the server is not a way into its own network)', () => {
    for (const raw of ['http://localhost:3000/x', 'http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/a', 'http://192.168.1.1', 'file:///etc/passwd', 'ftp://example.com/x', 'http://metadata.internal/x', 'http://[::1]/x', 'not a url']) {
      expect(classifyUrl(raw, SITE).kind, raw).toBe('invalid');
    }
  });
});

describe('what a page says', () => {
  const base = new URL('https://example.com/p');
  it('reads the og tags in either attribute order', () => {
    const html = `<head><title>Fallback</title><meta content="Ruby &amp; Gold Ring" property="og:title"><meta property="og:description" content="21K | 12.35 g"><meta property="og:image" content="/img/a.jpg"></head>`;
    expect(parseOg(html, base)).toEqual({ title: 'Ruby & Gold Ring', description: '21K | 12.35 g', image: 'https://example.com/img/a.jpg' });
  });
  it('takes the caption out of an Instagram description', () => {
    expect(instagramCaption('120 likes, 4 comments - taheri.shop on October 12, 2026: "Ruby Ring\n21K 12.35 g".')).toBe('Ruby Ring\n21K 12.35 g');
    expect(instagramCaption('Just words')).toBe('Just words');
  });
  it('reads a Shopify product', () => {
    const f = parseShopifyProduct({ product: { title: 'Aurora Band', body_html: '<p>925 silver.</p><p>Handmade</p>', variants: [{ price: '12500.00' }, { price: '9800.00' }], images: [{ src: 'https://cdn.shopify.com/a.jpg' }], tags: 'ring, silver' } });
    expect(f).toMatchObject({ title: 'Aurora Band', price: 9800, images: ['https://cdn.shopify.com/a.jpg'], tags: ['ring', 'silver'] });
    expect(f?.description).toContain('925 silver.');
    expect(parseShopifyProduct({})).toBeNull();
  });
});

describe('the house site', () => {
  const pieces = [
    { id: '/catalog-full/rings/1.jpg', url: 'https://taheri.shop/rings/ruby-ring', image: 'https://taheri.shop/catalog-full/rings/1.jpg' },
    { id: 'mina/piece/aurora', url: 'https://catalogue.houseofmina.store/rings/aurora', image: '' },
  ];
  it('matches a page address, with or without a query or slash', () => {
    expect(matchSitePiece(pieces, 'https://taheri.shop/rings/ruby-ring/?utm=1')?.id).toBe('/catalog-full/rings/1.jpg');
    expect(matchSitePiece(pieces, 'https://catalogue.houseofmina.store/rings/aurora')?.id).toBe('mina/piece/aurora');
    expect(matchSitePiece(pieces, 'https://taheri.shop/rings/other')).toBeNull();
    expect(matchSitePiece(pieces, 'https://taheri.shop/')).toBeNull();
  });
  it('builds fields from the site\'s own facts', () => {
    expect(pieceFields({ name: 'Ruby Ring', collection: 'Rings', weightGrams: 12.35, words: { karat: '21K', metal: 'Yellow Gold', stone: 'Ruby' } }))
      .toEqual({ headline: 'Ruby Ring', weight: '21K Yellow Gold · Ruby · 12.35g', kicker: 'Rings' });
    expect(pieceFields({ name: 'DSC09213', weightGrams: null })).toEqual({});
  });
});
