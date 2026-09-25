import { describe, expect, it } from 'vitest';
import { detailsLine, sitePieceCaption, waNumberFromUrl, websiteFileName, weightLabel, whatsappCaption } from './caption';

describe('weightLabel', () => {
  it('keeps the weight exactly as typed', () => {
    expect(weightLabel({ weight: '45.350' })).toBe('45.350g');
    expect(weightLabel({ weight: '18.8' })).toBe('18.8g');
  });
  it('says each when the weight is per piece', () => {
    expect(weightLabel({ weight: '10', weightEach: true })).toBe('10g each');
  });
  it('is empty for nothing, nonsense or zero', () => {
    expect(weightLabel({ weight: '' })).toBe('');
    expect(weightLabel({ weight: 'abc' })).toBe('');
    expect(weightLabel({ weight: '0' })).toBe('');
  });
  it('does not double a typed g', () => {
    expect(weightLabel({ weight: '9.2g' })).toBe('9.2g');
  });
});

describe('detailsLine', () => {
  const p = { headline: 'Set of the Day', metal: '21K Yellow Gold', stones: 'Simulated Sapphires', weight: '45.350' };
  it('joins the parts the way the stories write them', () => {
    expect(detailsLine(p, true)).toBe('21K Yellow Gold | Simulated Sapphires | 45.350g');
  });
  it('leaves the weight out when it has its own line', () => {
    expect(detailsLine(p, false)).toBe('21K Yellow Gold | Simulated Sapphires');
  });
  it('skips what is blank', () => {
    expect(detailsLine({ headline: 'x', metal: '21K Yellow Gold', stones: '  ' }, true)).toBe('21K Yellow Gold');
  });
});

describe('whatsappCaption', () => {
  const ctx = { whatsappNumbers: ['+923352275553', '+923262275554'], link: 'https://taheri.shop/bangles' };
  it('has the header, the stones line and where to ask', () => {
    const c = whatsappCaption({ headline: 'Bangle & Ring', metal: '21K Yellow Gold', weight: '18.8', stones: 'Rubies & Pearls' }, ctx);
    expect(c.split('\n')[0]).toBe('✨ *Bangle & Ring* — _21K Yellow Gold | 18.8g_');
    expect(c).toContain('_Rubies & Pearls_');
    expect(c).toContain('💬 WhatsApp: +923352275553, +923262275554');
    expect(c).toContain('https://taheri.shop/bangles');
  });
  it('never names the market', () => {
    const c = whatsappCaption({ headline: 'Jhumki' }, ctx);
    expect(c).not.toMatch(/Najmi|Saddar|Shop #/i);
  });
  it('puts the hook under the header', () => {
    const c = whatsappCaption({ headline: 'Rubies', hook: 'For the evening.' }, { whatsappNumbers: [] });
    expect(c).toBe('✨ *Rubies*\n\nFor the evening.');
  });
});

describe('waNumberFromUrl', () => {
  it('reads a wa.me link', () => expect(waNumberFromUrl('https://wa.me/923352275553')).toBe('+923352275553'));
  it('is empty for anything else', () => expect(waNumberFromUrl('https://instagram.com/x')).toBe(''));
});

describe('websiteFileName', () => {
  it('numbers the second photo on', () => {
    expect(websiteFileName('Rubies', 0)).toBe('Rubies.jpg');
    expect(websiteFileName('Rubies', 1)).toBe('Rubies 2.jpg');
  });
  it('keeps URL-breaking characters out', () => {
    expect(websiteFileName('Bangle & Ring #1?', 0)).toBe('Bangle and Ring 1.jpg');
    expect(websiteFileName('a/b', 0)).toBe('a b.jpg');
  });
});

describe('sitePieceCaption', () => {
  it('writes a Taheri piece with its weight, facts and link, and asks for the price', () => {
    const c = sitePieceCaption({ name: 'Turquoise Floral Cluster Tops', url: 'https://taheri.shop/tops/turquoise-floral-cluster-tops', weightGrams: 3.84, facts: ['Turquoise', 'None', 'Floral'] },
      { metal: '21K Gold', whatsappNumbers: ['+923352275553', '+923262275554'] });
    expect(c.split('\n')[0]).toBe('✨ *Turquoise Floral Cluster Tops* — _21K Gold | 3.84g_');
    expect(c).toContain('_Turquoise · Floral_');
    expect(c).toContain('🌐 See it: *https://taheri.shop/tops/turquoise-floral-cluster-tops*');
    expect(c).toContain('💬 WhatsApp: +923352275553, +923262275554');
    expect(c).not.toMatch(/najmi|saddar/i);
  });
  it('writes a Mina piece in its own voice, with no weight and its own closing lines', () => {
    const c = sitePieceCaption({ name: 'Aurora Eternity Band', url: 'https://catalogue.houseofmina.store/rings-and-bands/aurora-eternity-band', about: 'Round stones run unbroken around the band.', facts: ['American Diamond', 'rhodium plated'] },
      { metal: '925 Sterling Silver', tagline: 'Bespoke, designed in-house.', footer: '📩 DM to order — *+923161930960*\n💳 Card / Bank Transfer\n🌍 Worldwide Shipping', whatsappNumbers: [] });
    expect(c.split('\n')[0]).toBe('✨ *Aurora Eternity Band*');
    expect(c).toContain('Round stones run unbroken around the band.');
    expect(c).toContain('_American Diamond · rhodium plated_ Bespoke, designed in-house.');
    expect(c.trim().endsWith('🌍 Worldwide Shipping')).toBe(true);
    expect(c).not.toContain('today’s price');
  });
});
