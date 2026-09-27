import { describe, expect, it } from 'vitest';
import { imagePathOf, originalUrl } from './site-edits';

describe('imagePathOf', () => {
  it('reads a taheri.shop photograph’s path under catalog-full/', () => {
    expect(imagePathOf('https://taheri.shop/catalog-full/Rings%20&%20Bands/Rings/Ring%2012.webp', 'https://taheri.shop')).toBe('Rings & Bands/Rings/Ring 12.webp');
    expect(imagePathOf('https://taheri.shop/catalog-full/Wristwear/The%20Maisons/Maison%201.webp?e=2026', 'https://taheri.shop')).toBe('Wristwear/The Maisons/Maison 1.webp');
  });
  it('reads the catalogue’s, version and all', () => {
    expect(imagePathOf('https://catalogue.houseofmina.store/catalog-full/local/ring-07.webp?v=1.4', 'https://catalogue.houseofmina.store')).toBe('local/ring-07.webp');
  });
  it('refuses anything that is not a site photograph', () => {
    expect(imagePathOf('https://taheri.shop/catalog-thumb/Rings/Ring 1.webp', 'https://taheri.shop')).toBeNull();
    expect(imagePathOf('https://taheri.shop/api/img.php/full/x.webp', 'https://taheri.shop')).toBeNull();
    expect(imagePathOf('https://taheri.shop/catalog-full/../secret.webp', 'https://taheri.shop')).toBeNull();
    expect(imagePathOf('https://taheri.shop/catalog-full/Rings/Ring 1.jpg', 'https://taheri.shop')).toBeNull();
  });
});

describe('originalUrl', () => {
  it('addresses the kept original, each part escaped', () => {
    expect(originalUrl('https://taheri.shop', 'Rings & Bands/Rings/Ring 12.webp')).toBe('https://taheri.shop/catalog-edit/originals/full/Rings%20%26%20Bands/Rings/Ring%2012.webp');
  });
});
