import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The real text-model call (lib/social/ai.ts, with lib/ai-fallback.ts), over a stubbed network.
vi.mock('@/lib/ai-key', () => ({
  envVertexKey: () => 'k',
  vertexKey: async () => 'k',
  vertexKeySecret: () => 'vertex-ai-key',
  keyedModelUrl: (model: string) => `https://vertex.test/${model}:generateContent`,
}));
vi.mock('@/lib/design/gate', () => ({ designGate: async () => 'tester', noStore: {} }));
vi.mock('@/lib/website/ratelimit', () => ({ rateLimit: async () => ({ ok: true, remaining: 9, retryAfter: 0 }), callerKey: () => 'caller' }));

import { forgetCooling } from '@/lib/ai-fallback';
import { TEXT_FALLBACK, TEXT_MODEL } from '@/lib/social/ai';
import { POST } from './route';

const ok = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const exhausted = () => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' } }), { status: 429 });
const modelOf = (call: unknown[]) => String(call[0]).match(/test\/(.+):generateContent/)?.[1];

const layers = [{ id: 'head', kind: 'text', role: 'headline', box: { x: 100, y: 400, w: 800, h: 100 }, text: 'Ruby ring', size: 80, align: 'center' }];
const req = () => new NextRequest('http://x/api/design/resize', {
  method: 'POST',
  body: JSON.stringify({ source: { frame: { w: 1080, h: 1350 }, layers }, targets: [{ frame: { w: 1080, h: 1920 }, score: 70, layers }] }),
});

describe('the resize route and a model Google calls exhausted', () => {
  beforeEach(() => forgetCooling());
  afterEach(() => vi.unstubAllGlobals());

  it('is answered by the stand-in model at once, never by the image model', async () => {
    const f = vi.fn().mockResolvedValueOnce(exhausted()).mockResolvedValueOnce(ok({ plans: [{ index: 0, note: 'n', layers: [{ id: 'head', y: 450 }] }] }));
    vi.stubGlobal('fetch', f);
    const d = await (await POST(req())).json();
    expect(f.mock.calls.map(modelOf)).toEqual([TEXT_MODEL, TEXT_FALLBACK]);
    expect(f.mock.calls.map(modelOf).join()).not.toMatch(/image|3\.8-flash/);
    expect(d.ai).toBe(true);
    expect(d.plans[0].layers).toEqual([{ id: 'head', y: 450 }]);
  });

  it('keeps the deterministic layouts when what came back is junk', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(exhausted()).mockResolvedValueOnce(ok({ plans: [{ index: 0, layers: [{ id: 'head', text: 'Rewritten' }] }] })));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ai: false, plans: [null], reason: 'junk' });
  });
});
