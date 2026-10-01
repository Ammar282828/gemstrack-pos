import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai-key', () => ({
  envVertexKey: () => 'k',
  vertexKey: async () => 'k',
  vertexKeySecret: () => 'vertex-ai-key',
  keyedModelUrl: (model: string) => `https://vertex.test/${model}:generateContent`,
}));

import { forgetCooling } from '@/lib/ai-fallback';
import { generateJson, TEXT_FALLBACK, TEXT_MODEL } from './ai';

const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const exhausted = () => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' } }), { status: 429 });
const modelOf = (call: unknown[]) => String(call[0]).match(/test\/(.+):generateContent/)?.[1];
const ask = () => generateJson<{ a: number }>({ system: 's', parts: [{ text: 'q' }], schema: { type: 'OBJECT' } });

describe('a text model Google calls exhausted', () => {
  beforeEach(() => forgetCooling());
  afterEach(() => vi.unstubAllGlobals());

  it('hands over to the fallback at once, without waiting', async () => {
    const f = vi.fn().mockResolvedValueOnce(exhausted()).mockResolvedValueOnce(ok('{"a":1}'));
    vi.stubGlobal('fetch', f);
    const t = Date.now();
    await expect(ask()).resolves.toEqual({ a: 1 });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(f.mock.calls.map(modelOf)).toEqual([TEXT_MODEL, TEXT_FALLBACK]);
  });

  it('goes straight to the fallback while the model cools', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(exhausted()).mockResolvedValueOnce(ok('{"a":1}')));
    await ask();
    const f = vi.fn().mockResolvedValue(ok('{"a":2}'));
    vi.stubGlobal('fetch', f);
    await expect(ask()).resolves.toEqual({ a: 2 });
    expect(f.mock.calls.map(modelOf)).toEqual([TEXT_FALLBACK]);
  });

  it('keeps the model when it answers', async () => {
    const f = vi.fn().mockResolvedValue(ok('{"a":3}'));
    vi.stubGlobal('fetch', f);
    await expect(ask()).resolves.toEqual({ a: 3 });
    expect(f.mock.calls.map(modelOf)).toEqual([TEXT_MODEL]);
  });
});
