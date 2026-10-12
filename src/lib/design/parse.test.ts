import { describe, expect, it } from 'vitest';
import { inventedFigures } from '@/lib/ads/studio/prompts';
import { acceptAiFields, classifyInput, cleanForward, looksLikeSku, parseMany, parseSnippet, splitPieces } from './parse';

interface Fx { text: string; g?: number; karat?: string; price?: number; name?: string }

// Messages in the shapes the send log and the counter produce: captions, forwards, Roman-Urdu, tola.
const FIXTURES: Fx[] = [
  { text: '21K | Ruby | 12.35 g', g: 12.35, karat: '21K' },
  { text: 'Ruby Ring\n21K gold\n12.35 grams\nRs 125,000', g: 12.35, karat: '21K', price: 125000, name: 'Ruby Ring' },
  { text: 'Emerald Pendant Set 22kt 2 tola 3 masha', g: 26.244, karat: '22K', name: 'Emerald Pendant Set' },
  { text: 'Diamond Solitaire Ring 18k 3.2gm price 1.2 lac', g: 3.2, karat: '18K', price: 120000, name: 'Diamond Solitaire Ring' },
  { text: '[12/10/26, 3:45 PM] Ali: Polki Necklace\n21 karat\n45.350 g\nRs 4.5 lac', g: 45.35, karat: '21K', price: 450000, name: 'Polki Necklace' },
  { text: '12/10/2026, 15:45 - Bilal: Kundan Jhumka 22k 9.8g 85k', g: 9.8, karat: '22K', price: 85000, name: 'Kundan Jhumka' },
  { text: '~ Sana: Gold bangles\nwazan 2 tola\nqeemat Rs 350000', g: 23.328, price: 350000 },
  { text: 'Forwarded\nPearl Earrings\n925 silver\n6.4 gm\nRs 18,500', g: 6.4, price: 18500, name: 'Pearl Earrings' },
  { text: 'Sapphire ring 21k wazan 5 masha', g: 4.86, karat: '21K', name: 'Sapphire ring' },
  { text: 'Bridal Set - 22K\n1.5 tola 2 ratti\nPrice: 9.5 lac', g: 1.5 * 11.664 + 2 * 0.1215, karat: '22K', price: 950000, name: 'Bridal Set' },
  { text: 'Gold chain 24k 10g 95k', g: 10, karat: '24K', price: 95000, name: 'Gold chain' },
  { text: 'Moissanite Tennis Bracelet\n925 sterling\n14.2 g\nPKR 32,000', g: 14.2, price: 32000, name: 'Moissanite Tennis Bracelet' },
  { text: 'New Arrival!!\nTurquoise Pendant\n18K\n4.15gms', g: 4.15, karat: '18K', name: 'Turquoise Pendant' },
  { text: 'adha tola gold ring 21k', g: 5.832, karat: '21K' },
  { text: 'Heera ring 18 kt 2.9 g Rs 2 lakh', g: 2.9, karat: '18K', price: 200000 },
  { text: '*Diamond Studs*\n_18K white gold_\n1.8 g\n1 crore', g: 1.8, karat: '18K', price: 10000000, name: 'Diamond Studs' },
  { text: 'Ruby Kada 22k 20 gram Rs 3,10,000', g: 20, karat: '22K', price: 310000, name: 'Ruby Kada' },
  { text: '[1/2/26, 9:01 am] Ammar: Zircon Studs 925 2.1g Rs 4,500', g: 2.1, price: 4500, name: 'Zircon Studs' },
  { text: 'Panna set\nsawa tola\n22K\nqeemat 4 lac', g: 14.58, karat: '22K', price: 400000 },
  { text: 'Gold coin 24K 1 tola Rs 5.2 lac', g: 11.664, karat: '24K', price: 520000 },
  { text: 'Gold Nose Pin 22K 0.85 g', g: 0.85, karat: '22K', name: 'Gold Nose Pin' },
  { text: 'Opal ring\n14k rose gold\n3.4 g\n65k', g: 3.4, karat: '14K', price: 65000, name: 'Opal ring' },
  { text: 'Kundan Haar\n5 tola 4 masha\n21K\nRs 22 lac', g: 5 * 11.664 + 4 * 0.972, karat: '21K', price: 2200000 },
  { text: 'Neelam ring 21k 6.5g qeemat: 145000', g: 6.5, karat: '21K', price: 145000 },
  { text: 'Initial Pendant "M" 18K 2.2 gm', g: 2.2, karat: '18K' },
  { text: 'Cuban chain\n925 silver\n38.5 g\nRs 14,000/-', g: 38.5, price: 14000, name: 'Cuban chain' },
  { text: 'Dhai tola gold bangle 22k dhai lakh', g: 29.16, karat: '22K' },
  { text: 'Amethyst Ring 925 5.6 grams', g: 5.6, name: 'Amethyst Ring' },
  { text: '‎[21/09/26, 6:12 PM] Zain: ‎Jade Bracelet\n18K\n12 g\nPrice 78,000', g: 12, karat: '18K', price: 78000, name: 'Jade Bracelet' },
  { text: 'Garnet Earrings 21K 7.75g 1.1 lac', g: 7.75, karat: '21K', price: 110000, name: 'Garnet Earrings' },
];

describe('parseSnippet on real-shaped messages', () => {
  it('reads weight, karat and price correctly at least 90% of the time', () => {
    let right = 0, total = 0;
    const misses: string[] = [];
    for (const fx of FIXTURES) {
      const r = parseSnippet(fx.text);
      const checks: [string, boolean][] = [];
      if (fx.g !== undefined) checks.push(['weight', r.specs.weightG !== undefined && Math.abs(r.specs.weightG - fx.g) < 0.01]);
      if (fx.karat) checks.push(['karat', r.specs.karat === fx.karat]);
      if (fx.price !== undefined) checks.push(['price', r.price?.amount === fx.price]);
      if (fx.name) checks.push(['name', r.name === fx.name]);
      for (const [what, ok] of checks) { total++; if (ok) right++; else misses.push(`${what}: ${fx.text.replace(/\n/g, ' / ')} -> ${JSON.stringify({ g: r.specs.weightG, k: r.specs.karat, p: r.price?.amount, n: r.name })}`); }
    }
    if (misses.length) console.log(`parse accuracy ${right}/${total}\n${misses.join('\n')}`);
    expect(right / total).toBeGreaterThanOrEqual(0.9);
  });

  it('never puts a figure on the design that the input does not contain', () => {
    for (const fx of FIXTURES) {
      const r = parseSnippet(fx.text);
      const shown = Object.values(r.fields).join(' ');
      expect(inventedFigures(shown, cleanForward(fx.text).text), fx.text).toEqual([]);
    }
  });

  it('keeps a tola weight in its own words and gives grams separately', () => {
    const r = parseSnippet('Pendant Set 22kt 2 tola 3 masha');
    expect(r.fields.weight).toBe('22K Gold · 2 tola 3 masha');
    expect(r.specs.weightG).toBeCloseTo(26.244, 3);
  });

  it('builds the specs line from grams as written', () => {
    expect(parseSnippet('21K | Ruby | 12.35 g').fields.weight).toBe('21K Gold · Ruby · 12.35g');
  });

  it('does not take 21K for a price or 125k for a karat', () => {
    expect(parseSnippet('Ring 21K 8g').price).toBeUndefined();
    const r = parseSnippet('Ring 8g 125k');
    expect(r.price?.amount).toBe(125000);
    expect(r.specs.karat).toBeUndefined();
  });

  it('strips WhatsApp headers and forward notes', () => {
    const { text } = cleanForward('Forwarded many times\n[12/10/26, 3:45 PM] Ali: Ruby Ring\n~ Bilal: 12g');
    expect(text).not.toMatch(/Ali|Bilal|Forwarded|3:45/);
    expect(text).toContain('Ruby Ring');
  });

  it('leaves an unlabelled number out of the design but says so', () => {
    const r = parseSnippet('Ruby ring wazan 12.5');
    expect(r.fields.weight ?? '').not.toMatch(/\d/);
    expect(r.specs.weightG).toBe(12.5);
    expect(r.warnings.join(' ')).toMatch(/no unit/);
  });

  it('refuses sale words and hashtags as a headline', () => {
    const r = parseSnippet('Big sale on Ruby Ring 21K 12g');
    expect(r.fields.headline).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/house/);
    expect(parseSnippet('Ruby Ring #gold 21K 12g').name).toBe('Ruby Ring');
  });

  it('suggests a kind from the words', () => {
    expect(parseSnippet('make me a story for this ruby ring 21k 12g').suggestedKind).toBe('story');
  });
});

describe('several pieces in one paste', () => {
  it('splits a numbered list and a run of forwarded messages', () => {
    const list = parseMany('1. Ruby Ring 21K 12g Rs 1.2 lac\n2. Emerald Set 22K 2 tola\n3. Pearl Studs 925 3g 9k');
    expect(list).toHaveLength(3);
    expect(list.map(p => p.specs.karat)).toEqual(['21K', '22K', undefined]);
    expect(list[1].specs.weightG).toBeCloseTo(23.328, 3);
    const fwd = parseMany('[12/10/26, 3:45 PM] Ali: Ruby Ring 21K 12g\n[12/10/26, 3:46 PM] Ali: Pearl Set 18K 8g');
    expect(fwd).toHaveLength(2);
    expect(fwd[1].name).toBe('Pearl Set');
  });
  it('is one piece when only one block has facts', () => {
    expect(splitPieces('Ruby Ring\n\n21K 12g\n\nDM to order')).toHaveLength(1);
  });
});

describe('what was pasted', () => {
  it('tells a link, a code and words apart', () => {
    expect(classifyInput('https://www.instagram.com/p/Cabc123/')).toEqual({ kind: 'url', urls: ['https://www.instagram.com/p/Cabc123/'] });
    expect(classifyInput('Ruby ring https://taheri.shop/rings/ruby 21k').kind).toBe('text');
    expect(classifyInput('RNG-0012').kind).toBe('sku');
    expect(classifyInput('Ruby ring 21k').kind).toBe('text');
    expect(looksLikeSku('DSC09342')).toBe(false);
    expect(looksLikeSku('21K')).toBe(false);
    expect(looksLikeSku('12.35g')).toBe(false);
  });
});

describe('the AI is held to the same rules', () => {
  const input = 'beautiful ruby ring in 21K, weighs 12.35 g, lovely for weddings';
  it('keeps a value the text supports and drops an invented one', () => {
    const base = parseSnippet(input);
    const r = acceptAiFields(base, { headline: 'Ruby Ring', details: 'Order 24 hours ahead, 5% off', kicker: 'Weighs 99g', weightG: 99 }, input);
    expect(r.fields.headline).toBe(base.fields.headline ?? 'Ruby Ring');
    expect(r.fields.details).toBeUndefined();
    expect(r.fields.kicker).toBeUndefined();
    expect(r.specs.weightG).toBe(12.35);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('accepts a price only if the text writes that number', () => {
    const none = acceptAiFields(parseSnippet(input), { priceAmount: 150000 }, input);
    expect(none.price).toBeUndefined();
    const t = 'ruby ring 1.5 lac please';
    expect(acceptAiFields(parseSnippet('nice ring'), { priceAmount: 150000 }, t).price?.amount).toBe(150000);
  });
});

import { groupByPiece } from './parse';
describe('dropped files', () => {
  it('groups a camera sequence by closeness and time, and named files by stem', () => {
    const t = 1_700_000_000_000;
    const files = [
      { name: 'DSC09342.JPG', lastModified: t }, { name: 'DSC09343.JPG', lastModified: t + 20_000 }, { name: 'DSC09344.JPG', lastModified: t + 40_000 },
      { name: 'DSC09350.JPG', lastModified: t + 600_000 },
      { name: 'ruby-1.jpg' }, { name: 'ruby-2.jpg' }, { name: 'pearl.png' },
    ];
    expect(groupByPiece(files)).toEqual([[0, 1, 2], [3], [4, 5], [6]]);
  });
  it('splits a sequence when the shutter paused', () => {
    expect(groupByPiece([{ name: 'IMG_0001.jpg', lastModified: 0 }, { name: 'IMG_0002.jpg', lastModified: 300_000 }])).toEqual([[0], [1]]);
  });
});
