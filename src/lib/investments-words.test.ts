import { describe, expect, it } from 'vitest';
import { TARGET_WORDS, autoLine, hhmm } from './investments-words';

describe('hhmm', () => {
  it('writes minutes past midnight as a clock', () => {
    expect(hhmm(0)).toBe('00:00');
    expect(hhmm(690)).toBe('11:30');
    expect(hhmm(13 * 60 + 5)).toBe('13:05');
  });
});

describe('autoLine', () => {
  it('says when a part goes, in the shop’s clock', () => {
    expect(autoLine({ kind: 'later', at: 13 * 60 + 5 })).toEqual({ text: 'Goes by itself at 1:05 pm', tone: 'ok' });
    expect(autoLine({ kind: 'due' })?.tone).toBe('ok');
    expect(autoLine({ kind: 'sending' })?.text).toBe('Sending now…');
  });

  it('warns where a person has to act', () => {
    expect(autoLine({ kind: 'needs-ok' })).toEqual({ text: 'Waiting for your OK', tone: 'warn' });
    expect(autoLine({ kind: 'missing', what: 'the story card' })?.text).toBe('Won’t go by itself: there’s no story card');
    expect(autoLine({ kind: 'missing', what: 'a teaser' })?.text).toBe('Won’t go by itself: there’s no teaser');
    expect(autoLine({ kind: 'too-late' })?.tone).toBe('warn');
    expect(autoLine({ kind: 'gave-up', error: 'Not on WhatsApp' })?.text).toBe('Failed 3 times: Not on WhatsApp');
  });

  it('is quiet about what needs no word', () => {
    for (const kind of ['sent', 'off', 'paused', 'not-today'] as const) expect(autoLine({ kind })).toBeNull();
    expect(autoLine({ kind: 'held' })?.tone).toBe('muted');
    expect(autoLine({ kind: 'not-a-day' })?.tone).toBe('muted');
  });
});

describe('TARGET_WORDS', () => {
  it('names every part and where it goes', () => {
    expect(Object.keys(TARGET_WORDS)).toEqual(['group', 'channel', 'teaser', 'instagram']);
    expect(TARGET_WORDS.teaser).toEqual({ label: 'Teaser', to: 'the community’s announcements' });
  });
});
