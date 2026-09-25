/**
 * When Investments by Taheri goes out by itself — the rules, kept apart from
 * Firestore and WhatsApp so the page and the server read them the same way and
 * they can be tested.
 *
 * The owner sets (Website → Investments → Automatic sending): whether it runs
 * at all, which days of the week, and for each place a day's post goes — the
 * Investments group, the WhatsApp channel, the community's teaser, the
 * Instagram story — whether it goes and when: a Karachi time, or as soon as the
 * routine files it. A post that arrives after its time still goes, up to a
 * "late" cut-off; after that it waits for a person. The owner can also ask for
 * each day to wait for their OK.
 *
 * A check runs every five minutes (/api/investments/tick, Cloud Scheduler) and
 * sends whatever statusOf() calls due. Only today's post is ever sent by
 * itself; each part goes once (the same `sent` markers as the Send buttons);
 * a failure is tried again at the next check, three times in all.
 */

export type Target = 'group' | 'channel' | 'teaser' | 'instagram';
/** The order parts go in when several are due at once: the group first, Instagram last. */
export const TARGET_ORDER: Target[] = ['group', 'channel', 'teaser', 'instagram'];

/** "HH:MM" in Karachi time, or "arrival" — as soon as the day's post is filed. */
export interface TargetPlan { on: boolean; at: string }
export interface Schedule {
  enabled: boolean;
  /** Days it posts: 0 = Sunday … 6 = Saturday, Karachi. */
  days: number[];
  /** 'auto' sends by itself; 'approve' sends only days the owner has OK'd. */
  mode: 'auto' | 'approve';
  targets: Record<Target, TargetPlan>;
  /** A post that arrives after its time still goes until this ("HH:MM"). */
  lateUntil: string;
  updatedAt?: string;
  updatedBy?: string;
  /** Written by every check: proof the scheduler is running. */
  lastTick?: string;
}

export const DEFAULT_SCHEDULE: Schedule = {
  enabled: false,
  days: [1, 2, 3, 4, 5, 6],
  mode: 'auto',
  targets: {
    group: { on: true, at: '11:30' },
    channel: { on: false, at: '11:30' },
    teaser: { on: true, at: '12:00' },
    instagram: { on: false, at: '13:00' },
  },
  lateUntil: '20:00',
};

export const MAX_TRIES = 3;
/** A part being sent is left alone by other checks for this long. */
export const CLAIM_MS = 10 * 60 * 1000;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (s: unknown): s is string => typeof s === 'string' && TIME.test(s);
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** "13:05" → "1:05 pm". */
export function clock(hhmm: string): string {
  if (!isTime(hhmm)) return hhmm;
  const h = Number(hhmm.slice(0, 2)), m = hhmm.slice(3);
  return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon–Sat", "Every day", "Mon, Wed, Fri". */
export function daysLabel(days: number[]): string {
  const d = [...new Set(days)].filter(x => x >= 0 && x <= 6).sort();
  if (d.length === 7) return 'Every day';
  if (!d.length) return 'No days';
  const key = d.join();
  if (key === '1,2,3,4,5,6') return 'Mon–Sat';
  if (key === '1,2,3,4,5') return 'Mon–Fri';
  return d.map(x => DAY_NAMES[x]).join(', ');
}

/** Whatever was stored (or sent from the page), made into a whole, valid schedule. */
export function normalizeSchedule(raw: unknown): Schedule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Schedule> & Record<string, unknown>;
  const targets = {} as Record<Target, TargetPlan>;
  for (const t of TARGET_ORDER) {
    const given = (r.targets as Partial<Record<Target, Partial<TargetPlan>>> | undefined)?.[t];
    const d = DEFAULT_SCHEDULE.targets[t];
    targets[t] = {
      on: typeof given?.on === 'boolean' ? given.on : d.on,
      at: given?.at === 'arrival' || isTime(given?.at) ? given!.at! : d.at,
    };
  }
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : DEFAULT_SCHEDULE.days;
  return {
    enabled: r.enabled === true,
    days,
    mode: r.mode === 'approve' ? 'approve' : 'auto',
    targets,
    lateUntil: isTime(r.lateUntil) ? r.lateUntil : DEFAULT_SCHEDULE.lateUntil,
    ...(typeof r.updatedAt === 'string' ? { updatedAt: r.updatedAt } : {}),
    ...(typeof r.updatedBy === 'string' ? { updatedBy: r.updatedBy } : {}),
    ...(typeof r.lastTick === 'string' ? { lastTick: r.lastTick } : {}),
  };
}

export interface KarachiNow { date: string; minutes: number; weekday: number; ms: number }
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The date, time of day and weekday in Karachi (UTC+5, no daylight saving). */
export function karachiNow(d = new Date()): KarachiNow {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(d).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: WEEKDAY[parts.weekday] ?? 0, ms: d.getTime() };
}

/** What the rules need to know about a day's post. */
export interface DayState {
  date: string;
  receivedAt: string;
  post: string;
  teaser: string;
  cards: string[];
  sent: Partial<Record<Target, unknown>>;
  /** The owner held this day back from the schedule. */
  hold?: boolean;
  /** The owner's OK, for a schedule that waits for one. */
  approved?: { at: string; by: string } | null;
  /** The schedule's own bookkeeping per part: a send in progress, and failures. */
  auto?: Partial<Record<Target, { tries?: number; error?: string; lastTry?: string; claimedAt?: string }>>;
}

export type Status =
  | { kind: 'sent' }
  | { kind: 'off' }             // this part isn't sent by the schedule
  | { kind: 'paused' }          // the schedule is switched off
  | { kind: 'not-today' }       // an earlier (or later) day: never sent by itself
  | { kind: 'not-a-day' }       // today isn't one of the schedule's days
  | { kind: 'held' }
  | { kind: 'needs-ok' }
  | { kind: 'missing'; what: string }
  | { kind: 'gave-up'; error: string }
  | { kind: 'sending' }
  | { kind: 'later'; at: number } // minutes past midnight
  | { kind: 'too-late' }
  | { kind: 'due' };

/** When a part is meant to go today, in minutes past midnight. */
function dueAt(plan: TargetPlan, day: DayState): number {
  if (plan.at !== 'arrival') return toMinutes(plan.at);
  const got = day.receivedAt ? karachiNow(new Date(day.receivedAt)) : null;
  return got && got.date === day.date ? got.minutes : 0;
}

export function statusOf(s: Schedule, day: DayState, target: Target, now: KarachiNow): Status {
  if (day.sent[target]) return { kind: 'sent' };
  const plan = s.targets[target];
  if (!plan.on) return { kind: 'off' };
  if (!s.enabled) return { kind: 'paused' };
  if (day.date !== now.date) return { kind: 'not-today' };
  if (!s.days.includes(now.weekday)) return { kind: 'not-a-day' };
  if (day.hold) return { kind: 'held' };
  if (s.mode === 'approve' && !day.approved) return { kind: 'needs-ok' };
  if ((target === 'group' || target === 'channel') && !day.post.trim()) return { kind: 'missing', what: 'the post' };
  if (target === 'teaser' && !day.teaser.trim()) return { kind: 'missing', what: 'a teaser' };
  if (target === 'instagram' && !day.cards.includes('story')) return { kind: 'missing', what: 'the story card' };
  const a = day.auto?.[target];
  if ((a?.tries ?? 0) >= MAX_TRIES) return { kind: 'gave-up', error: a?.error || 'it failed' };
  if (a?.claimedAt && now.ms - Date.parse(a.claimedAt) < CLAIM_MS) return { kind: 'sending' };
  const at = dueAt(plan, day);
  if (now.minutes < at) return { kind: 'later', at };
  // However late the cut-off is set, a part always gets half an hour after its own time.
  if (now.minutes > Math.max(toMinutes(s.lateUntil), at + 30)) return { kind: 'too-late' };
  return { kind: 'due' };
}

/** The parts to send at this check, in order. */
export const dueTargets = (s: Schedule, day: DayState | null, now: KarachiNow): Target[] =>
  day ? TARGET_ORDER.filter(t => statusOf(s, day, t, now).kind === 'due') : [];
