/**
 * Investments by Taheri in words: what each part is and where it goes, and what the schedule
 * will do with a part today, in a line. These were the Investments page's own
 * (src/app/website/investments/page.tsx `TARGETS`, `autoLine`); here they are one copy that the
 * page and the iPhone app (through /api/investments/status) can both read.
 */

import { clock, type Status, type Target } from '@/lib/investments-schedule';

export const TARGET_WORDS: Record<Target, { label: string; to: string }> = {
  group: { label: 'Post + square card', to: 'the Investments by Taheri group' },
  channel: { label: 'Post + square card', to: 'the WhatsApp channel' },
  teaser: { label: 'Teaser', to: 'the community’s announcements' },
  instagram: { label: 'Story card', to: 'the Instagram story' },
};

/** 690 → "11:30". */
export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export type LineTone = 'muted' | 'ok' | 'warn';

/** What the schedule will do with one part today, in a line; null where there is nothing to say. */
export function autoLine(st: Status): { text: string; tone: LineTone } | null {
  switch (st.kind) {
    case 'later': return { text: `Goes by itself at ${clock(hhmm(st.at))}`, tone: 'ok' };
    case 'due': return { text: 'Going out at the next check (within 5 minutes)', tone: 'ok' };
    case 'sending': return { text: 'Sending now…', tone: 'ok' };
    case 'held': return { text: 'Held — won’t go by itself today', tone: 'muted' };
    case 'needs-ok': return { text: 'Waiting for your OK', tone: 'warn' };
    case 'not-a-day': return { text: 'Not a posting day — send it by hand if you want', tone: 'muted' };
    case 'missing': return { text: `Won’t go by itself: there’s no ${st.what.replace(/^(the|a) /, '')}`, tone: 'warn' };
    case 'too-late': return { text: 'Its time passed — send it by hand', tone: 'warn' };
    case 'gave-up': return { text: `Failed 3 times: ${st.error}`, tone: 'warn' };
    default: return null; // sent, off, paused, another day
  }
}
