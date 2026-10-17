import { describe, expect, it } from 'vitest';
import { blankAd } from '@/lib/ads/studio/templates';
import { placementOf, type StoryDoc, type TextLayer } from '@/lib/social/editor';
import { applyLettered, letteredOf, removeLettered } from './lettered';

const text = (id: string, bind: TextLayer['bind'], hidden = false): TextLayer => ({
  id, kind: 'text', bind, x: 0, y: 0, size: 40, font: 'regular', color: '#fff', align: 'left', rotate: 0, opacity: 1, hidden,
} as unknown as TextLayer);

const doc = (): StoryDoc => ({
  ...blankAd('story'),
  bg: { photoId: 'photo', placement: { mode: 'fill', zoom: 2, focusX: 0.2, focusY: 0.7 }, dim: 0.3, gradient: 'bottom', color: '#111' },
  layers: [text('h', 'headline'), text('k', 'kicker', true), text('free', undefined)],
});
const info = { kind: 'letter' as const, verified: true, missing: [] };

describe('an AI-lettered page', () => {
  it('shows the AI picture filling the frame and hides the bound words only', () => {
    const d = applyLettered(doc(), 'ai-letter', info);
    expect(d.bg.photoId).toBe('ai-letter');
    expect(placementOf(d)).toMatchObject({ mode: 'fill', zoom: 1 });
    expect(d.bg.dim).toBe(0);
    expect(d.bg.gradient).toBe('none');
    expect(d.layers.find(l => l.id === 'h')?.hidden).toBe(true);
    expect(d.layers.find(l => l.id === 'free')?.hidden).toBeFalsy();
    expect(letteredOf(d)?.photoId).toBe('ai-letter');
  });
  it('goes back exactly: the background, and only the words it hid', () => {
    const before = doc();
    const back = removeLettered(applyLettered(before, 'ai-letter', info));
    expect(back.bg).toEqual(before.bg);
    expect(back.layers.find(l => l.id === 'h')?.hidden).toBe(false);
    expect(back.layers.find(l => l.id === 'k')?.hidden).toBe(true);
    expect(letteredOf(back)).toBeNull();
  });
  it('lettering again replaces the picture and still goes back to the original', () => {
    const before = doc();
    const twice = applyLettered(applyLettered(before, 'a', info), 'b', { ...info, verified: false, missing: ['Ring'] });
    expect(twice.bg.photoId).toBe('b');
    expect(letteredOf(twice)).toMatchObject({ photoId: 'b', verified: false, missing: ['Ring'] });
    expect(removeLettered(twice).bg).toEqual(before.bg);
  });
  it('leaves a page that is not lettered alone', () => {
    const d = doc();
    expect(removeLettered(d)).toBe(d);
  });
});
