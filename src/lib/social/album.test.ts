import { describe, expect, it } from 'vitest';
import { ALBUM_MAX, IG_CAROUSEL_MAX, albumCaptions, albumFileName, carouselPlan, feedCrop, instagramText, photosLabel, placesFor } from './album';

describe('albumCaptions', () => {
  it('puts the one description under the first photo only', () => {
    expect(albumCaptions('Ruby ring', 3)).toEqual(['Ruby ring', '', '']);
  });
  it('is the caption as before for one photo', () => {
    expect(albumCaptions('Ruby ring', 1)).toEqual(['Ruby ring']);
  });
  it('never repeats the description', () => {
    expect(albumCaptions('x', ALBUM_MAX).filter(Boolean)).toHaveLength(1);
    expect(albumCaptions('x', 0)).toEqual([]);
  });
});

describe('albumFileName', () => {
  it('names the first as the piece and the rest by number, as the queue does', () => {
    expect([0, 1, 2].map(i => albumFileName('ruby-ring', i))).toEqual(['ruby-ring.jpg', 'ruby-ring-2.jpg', 'ruby-ring-3.jpg']);
    expect(albumFileName('', 0)).toBe('piece.jpg');
  });
});

describe('carouselPlan', () => {
  it('is a plain photo for one', () => {
    expect(carouselPlan(1)).toEqual({ take: 1, dropped: 0, carousel: false });
  });
  it('takes up to ten as a carousel', () => {
    expect(carouselPlan(4)).toEqual({ take: 4, dropped: 0, carousel: true });
    expect(carouselPlan(IG_CAROUSEL_MAX)).toEqual({ take: 10, dropped: 0, carousel: true });
  });
  it('sends the first ten and says how many were left out', () => {
    expect(carouselPlan(14)).toEqual({ take: 10, dropped: 4, carousel: true });
  });
  it('takes nothing from nothing', () => {
    expect(carouselPlan(0)).toEqual({ take: 0, dropped: 0, carousel: false });
  });
});

describe('feedCrop', () => {
  it('keeps a square, a 4:5 and a landscape whole', () => {
    expect(feedCrop(1000, 1000)).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
    expect(feedCrop(800, 1000)).toEqual({ left: 0, top: 0, width: 800, height: 1000 });
    expect(feedCrop(1910, 1000)).toEqual({ left: 0, top: 0, width: 1910, height: 1000 });
  });
  it('cuts a phone portrait to 4:5 from the middle', () => {
    const c = feedCrop(3024, 4032);
    expect(c.width / c.height).toBeCloseTo(0.8, 2);
    expect(c.top).toBe(Math.floor((4032 - c.height) / 2));
  });
  it('cuts a panorama to 1.91:1 from the middle', () => {
    const c = feedCrop(4000, 1000);
    expect(c).toEqual({ left: 1045, top: 0, width: 1910, height: 1000 });
  });
});

describe('instagramText', () => {
  it('takes off WhatsApp’s markers and keeps the rest', () => {
    expect(instagramText('✨ *Open Loop Bead Bracelet* — _21K_\n🌐 https://taheri.shop/p/a_b_c\n~old~ price')).toBe('✨ Open Loop Bead Bracelet — 21K\n🌐 https://taheri.shop/p/a_b_c\nold price');
  });
  it('leaves a caption without markers alone', () => {
    expect(instagramText('Ask for today’s price: 0300 1234567')).toBe('Ask for today’s price: 0300 1234567');
  });
});

describe('placesFor', () => {
  it('drops a place that failed an earlier photo, keeping the order', () => {
    expect(placesFor(['announcements', 'diamonds', 'channel'], new Set(['diamonds']))).toEqual(['announcements', 'channel']);
    expect(placesFor(['announcements'], new Set())).toEqual(['announcements']);
  });
});

describe('photosLabel', () => {
  it('counts photos', () => {
    expect(photosLabel(1)).toBe('1 photo');
    expect(photosLabel(3)).toBe('3 photos');
  });
});
