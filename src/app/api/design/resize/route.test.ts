import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const gate = vi.fn();
const generateJson = vi.fn();
const rateLimit = vi.fn();
let configured = true;

vi.mock('@/lib/design/gate', () => ({ designGate: (...a: unknown[]) => gate(...a), noStore: { 'Cache-Control': 'no-store' } }));
vi.mock('@/lib/social/ai', () => ({ aiConfigured: () => configured, generateJson: (...a: unknown[]) => generateJson(...a), AiError: class extends Error { constructor(m: string, public status = 502) { super(m); } } }));
vi.mock('@/lib/website/ratelimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a), callerKey: () => 'caller' }));

import { POST } from './route';

const frame = { w: 1080, h: 1920 };
const layers = [
  { id: 'head', kind: 'text', role: 'headline', box: { x: 100, y: 400, w: 800, h: 100 }, text: 'Ruby ring', size: 80, align: 'center' },
  { id: 'mark', kind: 'wordmark', role: 'mark', box: { x: 800, y: 1500, w: 200, h: 50 } },
];
const body = (over: Record<string, unknown> = {}) => ({
  source: { frame: { w: 1080, h: 1350 }, layers },
  targets: [{ frame, score: 70, layers }, { frame: { w: 1080, h: 1080 }, score: 90, layers }],
  ...over,
});
const post = (b: unknown) => POST(new NextRequest('http://x/api/design/resize', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }));
const answer = { plans: [{ index: 0, note: 'moved the headline up', layers: [{ id: 'head', y: 500 }] }, { index: 1, note: 'ok', layers: [{ id: 'head', y: 300 }] }] };

beforeEach(() => {
  gate.mockReset().mockResolvedValue('tester');
  generateJson.mockReset();
  rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 10, retryAfter: 0 });
  configured = true;
});

describe('POST /api/design/resize', () => {
  it('asks the model once for every target and answers with the cleaned plans', async () => {
    generateJson.mockResolvedValue(answer);
    const res = await post(body());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(d.ai).toBe(true);
    expect(d.plans).toHaveLength(2);
    expect(d.plans[0].layers).toEqual([{ id: 'head', y: 500 }]);
    expect(d.plans[0].frame).toEqual(frame);
  });

  it('uses text only: a JSON schema, no image model', async () => {
    generateJson.mockResolvedValue(answer);
    await post(body());
    const arg = generateJson.mock.calls[0][0];
    expect(arg.model).toBeUndefined();
    expect(arg.schema.type).toBe('OBJECT');
    expect(arg.parts.at(-1).text).toContain('TARGET 1');
  });

  it('falls back to the deterministic layouts when the model answers 429', async () => {
    generateJson.mockRejectedValue(Object.assign(new Error('Google is holding the AI to its per-minute quota'), { status: 429 }));
    const res = await post(body());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d).toMatchObject({ ai: false, plans: [null, null], reason: 'busy' });
  });

  it('falls back on junk', async () => {
    for (const junk of ['not json', null, { plans: 'x' }, { plans: [{ index: 0, layers: [{ id: 'ghost' }] }] }, { plans: [{ index: 0, layers: [{ id: 'head', text: 'Free gold!' }] }] }, { plans: [{ index: 0, layers: [{ id: 'head', x: NaN }] }] }]) {
      generateJson.mockResolvedValue(junk);
      const d = await (await post(body())).json();
      expect(d.ai, JSON.stringify(junk)).toBe(false);
      expect(d.plans).toEqual([null, null]);
    }
  });

  it('keeps the plan that is good and drops the one that is not', async () => {
    generateJson.mockResolvedValue({ plans: [answer.plans[0], { index: 1, layers: [{ id: 'head', text: 'Cheap!' }] }] });
    const d = await (await post(body())).json();
    expect(d.ai).toBe(true);
    expect(d.plans[0]).not.toBeNull();
    expect(d.plans[1]).toBeNull();
  });

  it('answers without a model call when AI is off or the caps are used', async () => {
    configured = false;
    expect((await (await post(body())).json()).reason).toBe('off');
    configured = true;
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 60 });
    expect((await (await post(body())).json()).reason).toBe('limit');
    rateLimit.mockRejectedValue(new Error('firestore down'));
    expect((await (await post(body())).json()).reason).toBe('limit');
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('turns away the signed-out and the bad request', async () => {
    gate.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await post(body())).status).toBe(401);
    gate.mockResolvedValue('tester');
    expect((await post('{nope')).status).toBe(400);
    expect((await post(body({ targets: [] }))).status).toBe(400);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('is let in as a poster, not an ads person', async () => {
    generateJson.mockResolvedValue(answer);
    await post(body());
    expect(gate.mock.calls[0][1]).toBe('post');
  });
});
