import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DEFAULT_SCHEDULE, type Schedule } from '@/lib/investments-schedule';

// A made-up day's post and schedule; no real chat ids.
let schedule: Schedule = DEFAULT_SCHEDULE;
let post: Record<string, unknown> | null = null;
const reachable = new Set(['group', 'teaser']);

vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : 'none') }));
vi.mock('@/lib/investments', () => ({
  getSchedule: async () => schedule,
  getInvestmentPost: async (id: string) => (post && post.id === id ? post : null),
}));
vi.mock('@/lib/investments-send', () => ({ destinationOf: (t: string) => (reachable.has(t) ? `chat-${t}` : null) }));

const { GET } = await import('./route');

const call = async (email: string | null = 'owner@example.com') => {
  const res = await GET(new NextRequest('https://erp.example.com/api/investments/status', { headers: email ? { 'x-test-email': email } : {} }));
  return { status: res.status, json: await res.json() };
};

// Wednesday 7 October 2026, 10:00 in Karachi.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-07T05:00:00Z'));
afterAll(() => { vi.useRealTimers(); });

beforeEach(() => {
  schedule = { ...DEFAULT_SCHEDULE, enabled: true };
  post = { id: '2026-10-07', date: '2026-10-07', post: 'Gold today', teaser: '', cards: ['square'], receivedAt: '2026-10-07T04:30:00Z', source: 'routine', sent: {} };
});

describe('/api/investments/status', () => {
  it('today’s parts this shop can send, each with what the schedule will do', async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.json.today).toBe('2026-10-07');
    expect(r.json.targets).toEqual([
      { id: 'group', label: 'Post + square card', to: 'the Investments by Taheri group' },
      { id: 'teaser', label: 'Teaser', to: 'the community’s announcements' },
    ]);
    expect(r.json.day.parts.group).toEqual({ kind: 'later', line: { text: 'Goes by itself at 11:30 am', tone: 'ok' } });
    expect(r.json.day.parts.teaser.kind).toBe('missing');
  });

  it('no lines while automatic sending is off; no day before the post arrives', async () => {
    schedule = { ...DEFAULT_SCHEDULE, enabled: false };
    expect((await call()).json.day.parts.group).toEqual({ kind: 'paused', line: null });
    post = null;
    expect((await call()).json.day).toBeNull();
  });

  it('signed-in shop accounts only', async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call('someone@example.com')).status).toBe(403);
  });
});
