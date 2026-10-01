import { describe, expect, it, vi } from 'vitest';
import { DROPPED, postAi } from './ai-client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const html = (status: number) => new Response('<html>Service Unavailable</html>', { status, headers: { 'Content-Type': 'text/html' } });

describe('postAi', () => {
  it('asks again once when the server dropped the request', async () => {
    const f = vi.fn().mockResolvedValueOnce(html(503)).mockResolvedValueOnce(json(200, { ok: true, n: 1 }));
    await expect(postAi(new FormData(), {}, { fetch: f, waitMs: 0 })).resolves.toEqual({ ok: true, n: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('says it was the ERP, not the AI, when it drops twice', async () => {
    const f = vi.fn().mockResolvedValue(html(503));
    await expect(postAi(new FormData(), {}, { fetch: f, waitMs: 0 })).rejects.toMatchObject({ status: 503, message: expect.stringContaining(DROPPED) });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('never repeats an answer from the route itself', async () => {
    const f = vi.fn().mockResolvedValue(json(503, { error: 'No Google Cloud project is set for AI (IMAGE_AI_PROJECT).' }));
    await expect(postAi(new FormData(), {}, { fetch: f, waitMs: 0 })).rejects.toThrow('IMAGE_AI_PROJECT');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a timeout (the op already ran for minutes)', async () => {
    const f = vi.fn().mockResolvedValue(html(504));
    await expect(postAi(new FormData(), {}, { fetch: f, waitMs: 0 })).rejects.toThrow(DROPPED);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
