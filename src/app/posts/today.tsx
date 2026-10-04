'use client';

/**
 * The Posts hub's "Today": what has gone out (every path — the hub, Post a Piece, the queue, the
 * Instagram story — from the send log, lib/social/sent-log.ts) and, in Taheri, where the day's
 * Investments post is: each part sent, due at its time, or waiting on someone. One look answers
 * "did that go?" before anything is sent twice.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Clock, Globe, Instagram, MessageCircle, Radio, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Sent } from '@/lib/social/sent-log';
import { TARGET_ORDER, statusOf, type DayState, type KarachiNow, type Schedule, type Target } from '@/lib/investments-schedule';

export interface InvestmentsToday {
  /** Today's post, once the routine has filed it. */
  post: (DayState & { sent: Partial<Record<Target, { at: string }>> }) | null;
  schedule: Schedule | null;
  /** The parts this house sends (the channel only on WAHA). */
  targets: Target[];
}

const PART: Record<Target, string> = { group: 'Group', channel: 'Channel', teaser: 'Teaser', instagram: 'Story' };
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hhmm = (m: number) => { const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const sameDay = (iso: string, d = new Date()) => new Date(iso).toDateString() === d.toDateString();

/** One part of the day's gold post, in a word or two and a tone. */
function partLine(inv: InvestmentsToday, t: Target, now: KarachiNow): { text: string; tone: 'ok' | 'muted' | 'warn' | 'bad' | 'live' } {
  const p = inv.post!;
  const sent = p.sent[t];
  if (sent) return { text: clock(sent.at), tone: 'ok' };
  if (!inv.schedule) return { text: 'by hand', tone: 'muted' };
  const st = statusOf(inv.schedule, p, t, now);
  switch (st.kind) {
    case 'later': return { text: hhmm(st.at), tone: 'muted' };
    case 'due': case 'sending': return { text: 'going now', tone: 'live' };
    case 'needs-ok': return { text: 'needs your OK', tone: 'warn' };
    case 'held': return { text: 'held', tone: 'warn' };
    case 'gave-up': return { text: 'failed', tone: 'bad' };
    case 'too-late': return { text: 'missed', tone: 'warn' };
    case 'missing': return { text: 'nothing to send', tone: 'muted' };
    default: return { text: 'by hand', tone: 'muted' };
  }
}

const TONE = { ok: 'text-emerald-700 dark:text-emerald-400', muted: 'text-muted-foreground', warn: 'text-amber-600', bad: 'text-destructive', live: 'text-primary' };

export function TodayCard({ sent, investments, now, thumbOf, placeName }: {
  sent: Sent[] | null;
  investments: InvestmentsToday | null;
  now: KarachiNow;
  /** A website piece's small photo, when the hub has the website's list. */
  thumbOf: (sitePiece: string) => string | undefined;
  /** A log name ("whatsapp-community") in the counter's words ("Announcements"). */
  placeName: (logName: string) => string;
}) {
  const [all, setAll] = useState(false);
  const today = (sent ?? []).filter(s => sameDay(s.at));
  const earlier = (sent ?? []).find(s => !sameDay(s.at));
  const shown = all ? today : today.slice(0, 4);

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-3.5 sm:p-4 space-y-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Today</h2>
        {sent && <span className="text-xs text-muted-foreground">{today.length ? `${today.length} out · last ${clock(today[0].at)}` : 'Nothing out yet'}</span>}
      </div>

      {investments && (
        <Link href="/website/investments" className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2 hover:bg-muted/70">
          <TrendingUp className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-tight">Gold post</p>
            {investments.post ? (
              <p className="text-xs flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5">
                {TARGET_ORDER.filter(t => investments.targets.includes(t)).map(t => {
                  const l = partLine(investments, t, now);
                  return <span key={t} className={cn('whitespace-nowrap inline-flex items-center gap-0.5', TONE[l.tone])}>{l.tone === 'ok' && <Check className="h-3 w-3" />}{PART[t]} {l.text}</span>;
                })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">Not here yet — the routine files it after 11:00.</p>
            )}
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {sent === null ? (
        <p className="text-xs text-muted-foreground">Reading what went out…</p>
      ) : today.length ? (
        <ul className="divide-y">
          {shown.map(s => {
            const thumb = s.sitePiece ? thumbOf(s.sitePiece) : undefined;
            const wa = s.destinations.filter(d => d.startsWith('whatsapp'));
            return (
              <li key={s.key + s.at} className="flex items-center gap-2.5 py-1.5">
                {thumb ? <img src={thumb} alt="" className="h-9 w-9 rounded-md object-cover shrink-0" /> : <span className="h-9 w-9 rounded-md bg-muted shrink-0 flex items-center justify-center">{s.destinations.includes('instagram-story') && !wa.length ? <Instagram className="h-4 w-4 text-muted-foreground" /> : <MessageCircle className="h-4 w-4 text-muted-foreground" />}</span>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate leading-tight">{s.title || (s.destinations.includes('instagram-story') ? 'A story' : 'A post')}</p>
                  <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                    {s.sitePiece && <Globe className="h-3 w-3 shrink-0" />}
                    {wa.some(d => d !== 'whatsapp-channel') && <MessageCircle className="h-3 w-3 shrink-0" />}
                    {wa.includes('whatsapp-channel') && <Radio className="h-3 w-3 shrink-0" />}
                    {s.destinations.includes('instagram-story') && <Instagram className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{s.destinations.map(placeName).join(', ')}</span>
                  </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground shrink-0">{clock(s.at)}</span>
              </li>
            );
          })}
          {today.length > 4 && (
            <li className="pt-1.5"><button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setAll(a => !a)}>{all ? 'Fewer' : `${today.length - 4} more today`}</button></li>
          )}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {earlier ? <span>The last was {earlier.title ? <b className="font-medium text-foreground">{earlier.title}</b> : 'a post'}, {new Date(earlier.at).toLocaleDateString([], { weekday: 'long' })} at {clock(earlier.at)}.</span> : 'Nothing in the last two days.'}
        </p>
      )}
    </section>
  );
}
