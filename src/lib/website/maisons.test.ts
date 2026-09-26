import { describe, expect, it } from 'vitest';
import { isMaisonFolder, maisonFileName, maisonFullName } from './maisons';

describe('maisonFileName', () => {
  it('names the file "<House> — <Model>" the way taheri.shop reads it', () => {
    expect(maisonFileName('Cartier', 'LOVE Bracelet, Classic')).toBe('Cartier — LOVE Bracelet, Classic.jpg');
  });
  it('writes "&" as "and" and numbers a second photo of the same piece', () => {
    expect(maisonFileName('Tiffany & Co.', 'Tiffany T Wire Bracelet', 1, 'heic')).toBe('Tiffany and Co — Tiffany T Wire Bracelet 2.heic');
  });
  it('keeps path and URL characters out of the name', () => {
    expect(maisonFileName('Chanel', 'Coco Crush #3 / small?')).toBe('Chanel — Coco Crush 3 small.jpg');
  });
});

describe('maisonFullName', () => {
  it('says the house once', () => {
    expect(maisonFullName('Cartier', 'LOVE Bracelet')).toBe('Cartier LOVE Bracelet');
    expect(maisonFullName('Tiffany & Co.', 'Tiffany Knot Bangle')).toBe('Tiffany Knot Bangle');
  });
});

describe('isMaisonFolder', () => {
  it('knows the folder', () => {
    expect(isMaisonFolder('Wristwear/The Maisons')).toBe(true);
    expect(isMaisonFolder('Wristwear/Karay')).toBe(false);
  });
});
