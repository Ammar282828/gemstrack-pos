import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AD_FORMATS } from '@/lib/ads/studio/templates';
import type { TextLayer } from '@/lib/social/editor';
import { FIELDS, assetsFor, freeHand, installFakeDom, removeFakeDom } from './resize.fixture';
import { resizeOne } from './resize';
import { applyPlan, cleanPlan, cleanRequest, mergePlan, planOf, planProblem, plansFromAnswer, resizePrompt, summariseLayers, type PlanContext, type ResizePlan } from './resize-ai';
import { makeMeasure } from './score';

beforeAll(installFakeDom);
afterAll(removeFakeDom);

const assets = assetsFor();
const m = makeMeasure(FIELDS, assets);
const frame = AD_FORMATS.story.frame;
const det = () => resizeOne(freeHand(), FIELDS, assets, frame);
const ctxOf = (r = det()): PlanContext => ({ frame, layers: summariseLayers(r.doc, FIELDS, m) });
const idOf = (r: ReturnType<typeof det>, text: string) => r.doc.layers.find(l => l.kind === 'text' && l.text === text)!.id;

describe('cleanPlan', () => {
  const r = det();
  const ctx = ctxOf(r);
  const head = idOf(r, 'Handmade in Karachi');
  const good = { index: 0, note: 'ok', layers: [{ id: head, x: 540, y: 400, width: 800, size: 90, align: 'center' }] };

  it('keeps a plan that only moves and resizes', () => {
    const p = cleanPlan(good, ctx)!;
    expect(p.layers).toEqual([{ id: head, x: 540, y: 400, width: 800, size: 90, align: 'center' }]);
    expect(p.frame).toEqual(frame);
    expect(p.note).toBe('ok');
  });

  it('rejects an id that is not there', () => {
    expect(cleanPlan({ ...good, layers: [{ id: 'invented-1', x: 10, y: 10 }] }, ctx)).toBeNull();
    expect(planProblem({ ...good, layers: [{ id: 'invented-1' }] }, ctx)).toMatch(/unknown/);
  });

  it('rejects NaN, infinity and strings in place of numbers', () => {
    for (const bad of [NaN, Infinity, '540', null]) expect(cleanPlan({ ...good, layers: [{ id: head, x: bad }] }, ctx), String(bad)).toBeNull();
    expect(cleanPlan({ ...good, layers: [{ id: head, size: NaN }] }, ctx)).toBeNull();
  });

  it('rejects a place outside the frame (5% allowed)', () => {
    expect(cleanPlan({ ...good, layers: [{ id: head, x: 2000, y: 100 }] }, ctx)).toBeNull();
    expect(cleanPlan({ ...good, layers: [{ id: head, x: 100, y: -400 }] }, ctx)).toBeNull();
    expect(cleanPlan({ ...good, layers: [{ id: head, x: -40, y: 1950 }] }, ctx)).not.toBeNull();
  });

  it('rejects sizes and widths out of range', () => {
    expect(cleanPlan({ ...good, layers: [{ id: head, size: 8 }] }, ctx)).toBeNull();
    expect(cleanPlan({ ...good, layers: [{ id: head, size: 900 }] }, ctx)).toBeNull();
    expect(cleanPlan({ ...good, layers: [{ id: head, width: 30 }] }, ctx)).toBeNull();
    expect(cleanPlan({ ...good, layers: [{ id: head, width: 3000 }] }, ctx)).toBeNull();
  });

  it('rejects any edit to the words', () => {
    for (const key of ['text', 'content', 'bind', 'headline', 'caption']) {
      expect(cleanPlan({ ...good, layers: [{ id: head, [key]: 'Cheap gold!' }] }, ctx), key).toBeNull();
    }
  });

  it('lets only decor and marks be hidden', () => {
    expect(cleanPlan({ ...good, layers: [{ id: head, hidden: true }] }, ctx)).toBeNull();
    const mark = r.doc.layers.find(l => l.kind === 'wordmark')!.id;
    expect(cleanPlan({ ...good, layers: [{ id: mark, hidden: true }] }, ctx)).not.toBeNull();
  });

  it('checks the photo crop and the frame', () => {
    expect(cleanPlan({ ...good, photo: { mode: 'fill', zoom: 1.2, focusX: 0.4, focusY: 0.5 } }, ctx)?.photo).toEqual({ mode: 'fill', zoom: 1.2, focusX: 0.4, focusY: 0.5 });
    expect(cleanPlan({ ...good, photo: { mode: 'stretch', zoom: 1, focusX: 0.5, focusY: 0.5 } }, ctx)).toBeNull();
    expect(cleanPlan({ ...good, photo: { mode: 'fill', zoom: 9, focusX: 0.5, focusY: 0.5 } }, ctx)).toBeNull();
    expect(cleanPlan({ ...good, frame: { w: 500, h: 500 } }, ctx)).toBeNull();
  });

  it('rejects junk', () => {
    for (const j of [null, 'plan', 7, [], {}, { layers: 'x' }]) expect(cleanPlan(j, ctx)).toBeNull();
  });
});

describe('using a plan', () => {
  it('applies positions and sizes and changes nothing else', () => {
    const r = det();
    const head = idOf(r, 'Handmade in Karachi');
    const out = applyPlan(r.doc, { frame, layers: [{ id: head, x: 100, y: 500, size: 70, align: 'left' }], note: '' });
    const was = r.doc.layers.find(l => l.id === head) as TextLayer, now = out.layers.find(l => l.id === head) as TextLayer;
    expect(now).toMatchObject({ x: 100, y: 500, size: 70, align: 'left', text: was.text, font: was.font, color: was.color });
    expect(out.layers.filter(l => l.id !== head)).toEqual(r.doc.layers.filter(l => l.id !== head));
  });

  it('is used only when it scores at least as well', () => {
    const r = det();
    const head = idOf(r, 'Handmade in Karachi');
    const worse: ResizePlan = { frame, layers: [{ id: head, x: 540, y: 60, size: 90 }], note: 'worse' };
    const kept = mergePlan(r, worse, FIELDS, assets);
    expect(kept.strategy).toBe(r.strategy);
    expect(kept.doc).toBe(r.doc);
    expect(kept.notes.join(' ')).toMatch(/plain one stays/);
    const same = mergePlan(r, planOf(r, FIELDS, m), FIELDS, assets);
    expect(same.strategy).toBe('ai');
    expect(same.score).toBeGreaterThanOrEqual(r.score);
    expect(mergePlan(r, null, FIELDS, assets)).toBe(r);
  });

  it('turns the model’s answer into plans, target by target', () => {
    const r = det();
    const req = cleanRequest({ source: { frame: { w: 1080, h: 1350 }, layers: ctxOf(r).layers }, targets: [{ frame, score: r.score, layers: ctxOf(r).layers }, { frame, score: 50, layers: ctxOf(r).layers }] })!;
    const head = idOf(r, 'Handmade in Karachi');
    const plans = plansFromAnswer({ plans: [{ index: 0, note: 'n', layers: [{ id: head, y: 400 }] }, { index: 1, note: 'n', layers: [{ id: 'nope' }] }] }, req);
    expect(plans[0]?.layers[0]).toEqual({ id: head, y: 400 });
    expect(plans[1]).toBeNull();
    expect(plansFromAnswer('junk', req)).toEqual([null, null]);
  });
});

describe('the request', () => {
  const r = det();
  const layers = ctxOf(r).layers;
  it('is read, clipped and shown to the model', () => {
    const req = cleanRequest({ goal: 'x'.repeat(900), source: { frame: { w: 1080, h: 1350 }, layers }, targets: [{ frame, score: 71, problems: ['a'], layers }] })!;
    expect(req.goal).toHaveLength(300);
    const prompt = resizePrompt(req);
    expect(prompt).toContain('SOURCE 1080x1350');
    expect(prompt).toContain('TARGET 0: 1080x1920 (score 71/100');
    expect(prompt).toContain('Handmade in Karachi');
  });
  it('is refused when it isn’t one', () => {
    expect(cleanRequest(null)).toBeNull();
    expect(cleanRequest({ source: { frame: { w: 1080, h: 1350 }, layers }, targets: [] })).toBeNull();
    expect(cleanRequest({ source: { frame: { w: 1, h: 1 }, layers }, targets: [{ frame, score: 1, layers }] })).toBeNull();
    expect(cleanRequest({ source: { frame: { w: 1080, h: 1350 }, layers }, targets: Array.from({ length: 30 }, () => ({ frame, score: 1, layers })) })).toBeNull();
    expect(cleanRequest({ source: { frame: { w: 1080, h: 1350 }, layers: [{ id: 'x' }] }, targets: [{ frame, score: 1, layers }] })).toBeNull();
  });
});
