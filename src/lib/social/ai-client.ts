/**
 * The page's side of `/api/website/post/ai` (Post a Piece, Edit a piece).
 *
 * The route always answers JSON, its own errors included. A bare 503 is the ERP's server going
 * down in the middle of the request — out of memory, or a new release replacing it — and says
 * nothing about the AI: on 2026-10-01 the five-minute tick ran Taheri's instance out of memory
 * 95 times, and each time every request on it, an Enhance among them, came back "AI request
 * failed (503)" with advice to open the checks, which were all green. So such an answer is
 * asked again once, by itself (a fresh server takes it), and if it comes back the same the
 * message says it was the ERP, not the AI.
 *
 * Client-safe.
 */

const bare = (res: Response) => !/json/i.test(res.headers.get('content-type') || '');

export const DROPPED = 'The ERP’s server dropped the request';

export async function postAi<T>(form: FormData, headers: Record<string, string>, opts: { fetch?: typeof fetch; waitMs?: number } = {}): Promise<T> {
  const go = opts.fetch ?? fetch;
  const send = () => go('/api/website/post/ai', { method: 'POST', headers, body: form });
  let res = await send();
  if (res.status === 503 && bare(res)) {
    await new Promise(r => setTimeout(r, opts.waitMs ?? 1500));
    res = await send();
  }
  const d = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) {
    const message = d.error || (bare(res) && res.status >= 502 && res.status <= 504
      ? `${DROPPED} (${res.status}) — not the AI`
      : `AI request failed (${res.status})`);
    throw Object.assign(new Error(message), { status: res.status });
  }
  return d;
}
