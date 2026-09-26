import { describe, it, expect } from 'vitest';
import { quotePiece, deliveryChargeFor, collectionOfKey } from './pricing';
import { DEFAULT_WEBSITE_CONFIG, type WebsiteConfig } from './types';

const rates = {
  goldRatePerGram24k: 30000, goldRatePerGram22k: 27500, goldRatePerGram21k: 26250, goldRatePerGram18k: 22500,
  palladiumRatePerGram: 9000, palladiumRatePerGram18k: 9000, palladiumRatePerGram12k: 6000,
  platinumRatePerGram: 10000, silverRatePerGram: 300,
};

const config: WebsiteConfig = {
  ...DEFAULT_WEBSITE_CONFIG,
  enabled: true,
  posCategoryId: 'cat001',
  defaultPricing: { karat: '21k', wastagePercentage: 10, makingChargesPerGram: 1500, stoneChargesDefault: 4000 },
  categoryPricing: { 'Bands': { wastagePercentage: 5, makingChargesPerGram: 800 } },
  deliveryCharge: 500,
  freeDeliveryOver: 200000,
};

describe('quotePiece', () => {
  it('prices plain gold the way an invoice does: rate × weight, wastage on the metal, making per gram', () => {
    const q = quotePiece('Rings & Bands/Rings/Ring 1.webp', { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Traditional', weightGrams: 4 }, config, rates);
    expect(q.priceable).toBe(true);
    // 4g × 26,250 = 105,000 metal; +10% wastage = 10,500; making 4 × 1,500 = 6,000 → 121,500
    expect(q.price).toBe(121500);
    expect(q.breakdown).toMatchObject({ karat: '21k', metalCost: 105000, wastageCost: 10500, makingCharges: 6000, stoneCharges: 0 });
  });

  it('uses the collection\'s own making and wastage when the shop has set them', () => {
    const q = quotePiece('Rings & Bands/Bands/Band 3.webp', { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Minimal', weightGrams: 10 }, config, rates);
    // 262,500 metal; +5% = 13,125; making 10 × 800 = 8,000 → 283,625
    expect(q.price).toBe(283625);
  });

  it('never prices a great house\'s piece by the gram (The Maisons): by its house, or by its folder', () => {
    const love = quotePiece('Wristwear/Karay/Karay 88.webp', { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Contemporary', weightGrams: 27, house: 'Cartier' }, config, rates);
    expect(love).toMatchObject({ priceable: false, reason: 'maison_enquire' });
    const dropped = quotePiece('Wristwear/The Maisons/Cartier — LOVE Bracelet, Classic.jpg', { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Contemporary', weightGrams: 27 }, config, rates);
    expect(dropped).toMatchObject({ priceable: false, reason: 'maison_enquire' });
  });

  it('adds the stone default for coloured stones and pearls, not for plain gold', () => {
    const plain = quotePiece('Earrings/Jhumki/J 1.webp', { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Traditional', weightGrams: 2 }, config, rates);
    const ruby  = quotePiece('Earrings/Jhumki/J 2.webp', { metal: 'Yellow Gold', stone: 'Ruby', cut: 'Oval', style: 'Traditional', weightGrams: 2 }, config, rates);
    expect(ruby.price! - plain.price!).toBe(4000);
  });

  it('refuses a piece with no readable weight', () => {
    const q = quotePiece('Rings & Bands/Rings/Ring 9.webp', { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Traditional' }, config, rates);
    expect(q).toMatchObject({ priceable: false, reason: 'no_weight' });
  });

  it('keeps diamond pieces as enquiries by default, and prices the gold when told to', () => {
    const attrs = { metal: 'White Gold', stone: 'Diamond', cut: 'Round', style: 'Contemporary', weightGrams: 3 };
    expect(quotePiece('Rings & Bands/Diamond Rings/D 1.webp', attrs, config, rates)).toMatchObject({ priceable: false, reason: 'diamond_enquire' });
    const goldOnly = quotePiece('Rings & Bands/Diamond Rings/D 1.webp', attrs, { ...config, diamondPolicy: 'gold_only', diamondChargesDefault: 25000 }, config ? rates : rates);
    expect(goldOnly.priceable).toBe(true);
    expect(goldOnly.breakdown?.diamondCharges).toBe(25000);
  });

  it('prices palladium at the palladium karat the shop chose', () => {
    const q = quotePiece('Rings & Bands/Palladium Bands for Him/P 1.webp', { metal: 'Palladium', stone: 'None', cut: 'None', style: 'Minimal', weightGrams: 5 }, { ...config, palladiumKarat: '12k' }, rates);
    expect(q.priceable).toBe(true);
    expect(q.breakdown).toMatchObject({ metalType: 'palladium', karat: '12k', ratePerGram: 6000 });
  });

  it('says why when the piece is unknown or selling is switched off', () => {
    expect(quotePiece('Nope/Nope/x.webp', undefined, config, rates)).toMatchObject({ priceable: false, reason: 'unknown_piece' });
    expect(quotePiece('Rings & Bands/Rings/Ring 1.webp', { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'X', weightGrams: 4 }, { ...config, enabled: false }, rates)).toMatchObject({ priceable: false, reason: 'not_configured' });
  });
});

describe('deliveryChargeFor', () => {
  it('charges the flat rate below the threshold and nothing above it', () => {
    expect(deliveryChargeFor(config, 50000)).toBe(500);
    expect(deliveryChargeFor(config, 200000)).toBe(0);
  });
});

describe('collectionOfKey', () => {
  it('reads the collection folder out of a piece key', () => {
    expect(collectionOfKey('Rings & Bands/Diamond Rings/Diamond Ring 12.webp')).toBe('Diamond Rings');
  });
});
