import { describe, expect, it } from 'vitest';
import { defaultSpreadEnd, queueMediaKeys, queueUnits, spreadTimes } from './queue-plan';

const everywhere = { website: { folder: 'Rings/Rings', collection: 'Rings', names: ['A.jpg', 'A 2.jpg'], featured: true }, instagram: true, whatsapp: ['announcements', 'channel'] };

describe('queueUnits', () => {
  it('goes website, set of the day, story, then each WhatsApp destination in turn', () => {
    expect(queueUnits(everywhere, { site: 2, wa: 2, story: true })).toEqual([
      'site-0', 'site-1', 'featured', 'instagram', 'wa:announcements:0', 'wa:announcements:1', 'wa:channel:0', 'wa:channel:1',
    ]);
  });
  it('leaves out what is not going', () => {
    expect(queueUnits({ website: null, instagram: false, whatsapp: ['announcements'] }, { site: 0, wa: 1, story: false })).toEqual(['wa:announcements:0']);
  });
  it('has no set of the day without a website photo', () => {
    expect(queueUnits({ ...everywhere, whatsapp: [] }, { site: 0, wa: 0, story: false })).toEqual([]);
  });
});

describe('queueMediaKeys', () => {
  it('asks for each image once, however many places it goes', () => {
    expect(queueMediaKeys(everywhere, { site: 2, wa: 1, story: true })).toEqual(['site-0', 'site-1', 'wa-0', 'story']);
  });
  it('needs no story when Instagram is off', () => {
    expect(queueMediaKeys({ ...everywhere, instagram: false }, { site: 1, wa: 1, story: true })).toEqual(['site-0', 'wa-0']);
  });
});

describe('spreadTimes', () => {
  const from = new Date('2026-09-25T11:00:00'), to = new Date('2026-09-25T20:00:00');
  it('spreads evenly, first and last at the ends', () => {
    expect(spreadTimes(4, from, to).map(d => d.toTimeString().slice(0, 5))).toEqual(['11:00', '14:00', '17:00', '20:00']);
  });
  it('rounds to the minute', () => {
    expect(spreadTimes(3, from, new Date('2026-09-25T11:01:01')).every(d => d.getSeconds() === 0)).toBe(true);
  });
  it('puts everything at the start when the window is over', () => {
    expect(spreadTimes(2, to, from).map(d => d.getTime())).toEqual([to.getTime(), to.getTime()]);
  });
  it('one piece goes at the start', () => expect(spreadTimes(1, from, to)[0].getTime()).toBe(from.getTime()));
});

describe('defaultSpreadEnd', () => {
  it('is half an hour before closing', () => {
    expect(defaultSpreadEnd(new Date('2026-09-24T12:00:00')).toTimeString().slice(0, 5)).toBe('20:30'); // Thursday
    expect(defaultSpreadEnd(new Date('2026-09-25T16:00:00')).toTimeString().slice(0, 5)).toBe('19:30'); // Friday
  });
});
