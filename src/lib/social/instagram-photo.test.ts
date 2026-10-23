import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('google-auth-library', () => ({
  GoogleAuth: class { async getClient() { return { getAccessToken: async () => ({ token: 't' }) }; } },
}));

const CONN = { token: 'tok', userId: '178', username: 'shop', expiresAt: new Date(Date.now() + 40 * 86_400_000).toISOString(), connectedAt: new Date().toISOString() };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Seen { url: string; body: URLSearchParams | null }
let seen: Seen[];
let statuses: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  process.env.INSTAGRAM_APP_ID = 'a'; process.env.INSTAGRAM_APP_SECRET = 's';
  seen = []; statuses = [{ status_code: 'FINISHED' }];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: init?.body instanceof URLSearchParams ? init.body : null });
    if (url.includes('secretmanager')) return json({ payload: { data: Buffer.from(JSON.stringify(CONN)).toString('base64') } });
    if (url.endsWith('/178/media')) return json({ id: 'c1' });
    if (url.includes('/c1?')) return json(statuses.length > 1 ? statuses.shift()! : statuses[0]);
    if (url.endsWith('/178/media_publish')) return json({ id: 'post-9' });
    return json({ error: { message: 'unexpected ' + url } }, 500);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('publishPhoto', () => {
  it('makes an image container with the picture and caption (no media_type), waits, publishes', async () => {
    const { publishPhoto } = await import('./instagram');
    expect(await publishPhoto('https://x/api/public/social/abc', '  A ruby ring  ')).toBe('post-9');
    const create = seen.find(s => s.url.endsWith('/178/media'))!;
    expect(create.body?.get('image_url')).toBe('https://x/api/public/social/abc');
    expect(create.body?.get('caption')).toBe('A ruby ring');
    expect(create.body?.get('media_type')).toBeNull();
    expect(create.body?.get('access_token')).toBe('tok');
    const publish = seen.find(s => s.url.endsWith('/media_publish'))!;
    expect(publish.body?.get('creation_id')).toBe('c1');
    expect(seen.map(s => s.url.replace(/\?.*/, '').split('/').slice(-1)[0])).toEqual(['latest:access', 'media', 'c1', 'media_publish']);
  });

  it('sends no caption field when there is none, and a story still says STORIES', async () => {
    const { publishPhoto, publishStory } = await import('./instagram');
    await publishPhoto('https://x/a');
    expect(seen.find(s => s.url.endsWith('/178/media'))!.body?.has('caption')).toBe(false);
    seen.length = 0;
    await publishStory('https://x/b');
    expect(seen.find(s => s.url.endsWith('/178/media'))!.body?.get('media_type')).toBe('STORIES');
  });

  it('polls until Instagram has it', async () => {
    statuses = [{ status_code: 'IN_PROGRESS' }, { status_code: 'FINISHED' }];
    const { publishPhoto } = await import('./instagram');
    const p = publishPhoto('https://x/a', 'hi');
    await vi.advanceTimersByTimeAsync(2500);
    expect(await p).toBe('post-9');
    expect(seen.filter(s => s.url.includes('/c1?'))).toHaveLength(2);
  });

  it('says why when Instagram refuses the image, and never publishes', async () => {
    statuses = [{ status_code: 'ERROR', status: 'Aspect ratio not supported' }];
    const { publishPhoto, InstagramError } = await import('./instagram');
    await expect(publishPhoto('https://x/a')).rejects.toMatchObject({ name: 'InstagramError', status: 422, message: expect.stringContaining('Aspect ratio not supported') });
    expect(seen.some(s => s.url.endsWith('/media_publish'))).toBe(false);
    expect(InstagramError).toBeTypeOf('function');
  });

  it('refuses a caption over 2,200 characters before calling Instagram', async () => {
    const { publishPhoto } = await import('./instagram');
    await expect(publishPhoto('https://x/a', 'x'.repeat(2201))).rejects.toMatchObject({ status: 400 });
    expect(seen).toEqual([]);
  });

  it('passes Instagram’s own error on (a daily limit, a bad token)', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('secretmanager')) return json({ payload: { data: Buffer.from(JSON.stringify(CONN)).toString('base64') } });
      return json({ error: { message: 'The daily publishing limit was reached' } }, 400);
    });
    const { publishPhoto } = await import('./instagram');
    await expect(publishPhoto('https://x/a')).rejects.toMatchObject({ status: 400, message: 'The daily publishing limit was reached' });
  });
});

describe('publishCarousel (2026-10-23)', () => {
  beforeEach(() => {
    let n = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body instanceof URLSearchParams ? init.body : null });
      if (url.includes('secretmanager')) return json({ payload: { data: Buffer.from(JSON.stringify(CONN)).toString('base64') } });
      if (url.endsWith('/178/media')) return json({ id: `k${++n}` });
      if (/\/k\d+\?/.test(url)) return json({ status_code: 'FINISHED' });
      if (url.endsWith('/178/media_publish')) return json({ id: 'post-9' });
      return json({ error: { message: 'unexpected ' + url } }, 500);
    });
  });

  it('makes a child per photo in order, then one CAROUSEL with the caption once, then publishes it', async () => {
    const { publishCarousel } = await import('./instagram');
    expect(await publishCarousel(['https://x/1', 'https://x/2', 'https://x/3'], ' A ruby ring ')).toBe('post-9');
    const creates = seen.filter(s => s.url.endsWith('/178/media'));
    expect(creates.slice(0, 3).map(c => [c.body?.get('image_url'), c.body?.get('is_carousel_item'), c.body?.has('caption')])).toEqual([
      ['https://x/1', 'true', false], ['https://x/2', 'true', false], ['https://x/3', 'true', false],
    ]);
    const parent = creates[3].body!;
    expect(parent.get('media_type')).toBe('CAROUSEL');
    expect(parent.get('children')).toBe('k1,k2,k3');
    expect(parent.get('caption')).toBe('A ruby ring');
    expect(seen.find(s => s.url.endsWith('/media_publish'))!.body?.get('creation_id')).toBe('k4');
  });

  it('is a plain photo for one picture, exactly as before', async () => {
    const { publishCarousel } = await import('./instagram');
    await publishCarousel(['https://x/1'], 'hi');
    const creates = seen.filter(s => s.url.endsWith('/178/media'));
    expect(creates).toHaveLength(1);
    expect(creates[0].body?.get('media_type')).toBeNull();
    expect(creates[0].body?.has('is_carousel_item')).toBe(false);
    expect(creates[0].body?.get('caption')).toBe('hi');
  });

  it('refuses more than ten before calling Instagram', async () => {
    const { publishCarousel } = await import('./instagram');
    await expect(publishCarousel(Array.from({ length: 11 }, (_, i) => `https://x/${i}`))).rejects.toMatchObject({ status: 400 });
    expect(seen).toEqual([]);
  });
});
