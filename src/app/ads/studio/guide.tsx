'use client';

/**
 * The studio's Guide: the days ads must stay off (from the Hijri calendar), what the
 * account's own best ads share (read by the model from their pictures and numbers),
 * how Meta works for this house (playbook.ts), and the house's rules from the vault
 * (brand.ts) — the same rules the model checks every ad against.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { CalendarClock, Loader2, Sparkles, Trophy, TrendingDown, ChevronDown, ChevronUp, ShieldCheck, Quote, Palette, Users, Landmark, Compass } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLAYBOOK } from '@/lib/ads/studio/playbook';
import { GAPS, HOUSES, MARKET_AT, META_NOTES, PATTERNS } from '@/lib/ads/studio/market';
import { AUDIENCE, DECISION_RULES, HARD_RULES, IDENTITY, MARKET, MARK_RULES, VISUAL, VOICE } from '@/lib/ads/studio/brand';
import type { WinnersState } from '@/lib/ads/studio/research';
import { api } from '../ads-kit';

interface GuideData {
  calendar: {
    today: { date: string; level: string; hijri: string; name: string; rule: string };
    upcoming: { date: string; hijri: string; id: string; name: string; rule: string; before: number; to: number }[];
    next14: { date: string; level: string; hijri: string; name: string }[];
  };
  winners: WinnersState | null;
}

const day = (ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${ymd}T12:00:00+05:00`).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', ...opts });
const minusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00+05:00`) - n * 86_400_000).toISOString().slice(0, 10);

export function GuideSection({ connected }: { connected: boolean }) {
  const { toast } = useToast();
  const [data, setData] = useState<GuideData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api<GuideData>('/api/ads/studio/guide')); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const readWinners = async () => {
    setReading(true);
    try { const { winners } = await api<{ winners: WinnersState }>('/api/ads/studio/guide', { method: 'POST' }); setData(d => (d ? { ...d, winners } : d)); }
    catch (e) { toast({ title: 'Couldn’t read the ads', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setReading(false); }
  };

  const c = data?.calendar;
  const w = data?.winners;
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <div className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <section className="rounded-xl border p-4 space-y-3">
          <h2 className="text-base font-semibold flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Ad days</h2>
          {!c ? <p className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Working out the calendar…</p> : (
            <>
              <div className={cn('rounded-lg p-3 text-sm', c.today.level === 'clear' ? 'bg-emerald-500/10' : c.today.level === 'quiet' ? 'bg-amber-500/10' : 'bg-rose-500/10')}>
                <p className="font-medium">Today, {day(c.today.date)} · {c.today.hijri}</p>
                <p className="text-xs">{c.today.level === 'clear' ? 'Ads may run.' : c.today.level === 'quiet' ? `${c.today.name}: ${c.today.rule}` : `${c.today.name}${c.today.level === 'near' ? ' is close' : ''} — no product ads, no calls to action.`}</p>
              </div>
              {c.next14.length > 0 ? (
                <div className="text-xs space-y-0.5">
                  <p className="font-medium">In the next two weeks, keep ads off:</p>
                  {c.next14.map(d => <p key={d.date} className="text-muted-foreground">{day(d.date)} · {d.hijri} — {d.name}{d.level === 'near' ? ' (the days before)' : d.level === 'quiet' ? ' (a cultural post only)' : ''}</p>)}
                </div>
              ) : <p className="text-xs text-muted-foreground">Nothing sacred in the next two weeks.</p>}
              <div className="space-y-2">
                <p className="text-xs font-medium">Coming up</p>
                {c.upcoming.map(u => (
                  <div key={u.date + u.id} className="rounded-lg border p-2.5 text-xs">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-muted-foreground">{day(u.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}{u.to > 1 ? ` for ${u.to} days` : ''} · {u.hijri}</p>
                    <p className="mt-1"><b>End ads by {day(minusDays(u.date, u.before + 1))}</b> — {u.rule}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Worked out from the tabular Hijri calendar the Dawoodi Bohras keep, checked against the vault’s 2025 dates. Urs and Dawat dates aren’t in the vault — confirm those against the Dawat calendar; if unsure whether a day is sacred, treat it as sacred.</p>
            </>
          )}
        </section>

        <section className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold flex items-center gap-2"><Trophy className="h-4 w-4" /> What your own ads say</h2>
            <Button size="sm" disabled={reading || !connected} onClick={readWinners}>{reading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />} {w ? 'Read again' : 'Read my ads'}</Button>
          </div>
          {!connected && <p className="text-xs text-muted-foreground">Connect Meta on Ads → Setup first.</p>}
          {reading && <p className="text-[11px] text-muted-foreground">Six months of ads, the cheapest results against the dearest, pictures and words to the model — a minute or two.</p>}
          {!w && !reading && connected && <p className="text-xs text-muted-foreground">Reads the account’s ads over the last six months: what the ones with the cheapest chats share in the picture and the words, and what the dearest have in common.</p>}
          {w && (
            <>
              {w.error && <p className="text-xs text-amber-700 dark:text-amber-400">{w.error}</p>}
              {w.reading && (
                <div className="space-y-2 text-xs">
                  <p className="text-sm font-medium">{w.reading.headline}</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div><p className="font-semibold text-emerald-700 dark:text-emerald-400">The winners share</p><ul className="list-disc pl-4">{w.reading.winnersShare.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                    <div><p className="font-semibold text-rose-700 dark:text-rose-400">The losers share</p><ul className="list-disc pl-4">{w.reading.losersShare.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                  </div>
                  <div className="rounded-lg border border-primary/30 p-2"><p className="font-semibold text-primary">Make the next ads like this</p><ul className="list-disc pl-4">{w.reading.nextAds.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                  {w.reading.stop.length > 0 && <div><p className="font-semibold">Stop</p><ul className="list-disc pl-4">{w.reading.stop.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                  <p className="text-[10px] text-muted-foreground">{w.reading.confidence}</p>
                </div>
              )}
              <AdStrip title="Cheapest results" icon={<Trophy className="h-3.5 w-3.5" />} ads={w.winners} />
              <AdStrip title="Dearest results" icon={<TrendingDown className="h-3.5 w-3.5" />} ads={w.losers} />
              <p className="text-[10px] text-muted-foreground">{w.considered} ads spent enough to compare, {w.since} to {w.until}. Read {w.at ? new Date(w.at).toLocaleString() : ''}.</p>
            </>
          )}
        </section>

        <BrandCard />
      </div>

      <div className="space-y-2">
        <MarketCard />
        <h2 className="text-base font-semibold flex items-center gap-2 px-1 pt-2"><Compass className="h-4 w-4" /> Meta ads for this house</h2>
        {PLAYBOOK.map((s, i) => <PlaybookCard key={s.id} s={s} defaultOpen={i < 2} />)}
      </div>
    </div>
  );
}

function AdStrip({ title, icon, ads }: { title: string; icon: React.ReactNode; ads: WinnersState['winners'] }) {
  if (!ads.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium flex items-center gap-1">{icon} {title}</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ads.map(a => (
          <div key={a.id} className="w-28 shrink-0">
            <div className="aspect-square rounded-md bg-muted overflow-hidden">{a.image && <img src={a.image} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
            <p className="text-[10px] truncate mt-0.5" title={a.name}>{a.name}</p>
            <p className="text-[10px] text-muted-foreground">{a.costPerResult !== null ? `${Math.round(a.costPerResult).toLocaleString('en-US')} a ${a.resultLabel.toLowerCase().replace(/s$/, '')}` : `nothing for ${Math.round(a.spend).toLocaleString('en-US')}`}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaybookCard({ s, defaultOpen }: { s: typeof PLAYBOOK[number]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-2 p-3 text-left">
        <div className="flex-1">
          <p className="text-sm font-semibold">{s.title}</p>
          <p className="text-xs text-muted-foreground">{s.lead}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" />}
      </button>
      {open && (
        <ul className="border-t p-3 space-y-2">
          {s.points.map(p => <li key={p.head} className="text-xs"><p className="font-medium">{p.head}</p><p className="text-muted-foreground">{p.body}</p></li>)}
        </ul>
      )}
    </section>
  );
}

function BrandCard() {
  const [open, setOpen] = useState(false);
  const List = ({ xs }: { xs: readonly string[] }) => <ul className="list-disc pl-4 space-y-0.5">{xs.map(x => <li key={x}>{x}</li>)}</ul>;
  return (
    <section className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> The house’s rules for ads</h2>
        <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)}>{open ? 'Less' : 'All of them'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">From the Taheri Vault. Every ad the studio writes or checks is held to these.</p>
      <div className="text-xs"><p className="font-semibold mb-0.5">Never in an ad</p><List xs={HARD_RULES} /></div>
      <div className="flex items-center gap-2">
        {[VISUAL.ground, VISUAL.gold, VISUAL.lightGold, VISUAL.bone].map(c => <span key={c} className="h-7 w-7 rounded-full border" style={{ background: c }} title={c} />)}
        <span className="text-[11px] text-muted-foreground">the ground, gold, light gold, bone</span>
      </div>
      {open && (
        <div className="space-y-3 text-xs">
          <div><p className="font-semibold flex items-center gap-1"><Quote className="h-3 w-3" /> Voice</p><p className="italic">{VOICE.oneLine}</p><List xs={VOICE.rules} />
            <p className="mt-1"><b>Calls to action:</b> {VOICE.ctas.join(' · ')}</p><p><b>Closers:</b> {VOICE.closers.join(' · ')}</p><p><b>Never:</b> {VOICE.avoid.join(' · ')}</p></div>
          <div><p className="font-semibold flex items-center gap-1"><Palette className="h-3 w-3" /> Look and marks</p><List xs={[...VISUAL.rules, ...MARK_RULES]} /></div>
          <div><p className="font-semibold flex items-center gap-1"><Users className="h-3 w-3" /> Who it’s for</p><p>{AUDIENCE.primary} {AUDIENCE.secondary.join(', ')}.</p><List xs={AUDIENCE.notes} /></div>
          <div><p className="font-semibold flex items-center gap-1"><Landmark className="h-3 w-3" /> The market</p><List xs={MARKET} /></div>
          <div><p className="font-semibold">When in doubt</p><List xs={DECISION_RULES} /></div>
          <p className="text-muted-foreground">{IDENTITY.line}</p>
        </div>
      )}
    </section>
  );
}

function MarketCard() {
  const [open, setOpen] = useState<'gaps' | 'patterns' | 'houses' | 'meta'>('gaps');
  const tabs = [['gaps', 'What nobody does'], ['patterns', 'What they all run'], ['houses', 'The houses'], ['meta', 'How Meta works here']] as const;
  const list = (xs: { head: string; body: string; who?: string; source?: string }[]) => (
    <ul className="space-y-2">{xs.map(x => (
      <li key={x.head} className="text-xs"><p className="font-medium">{x.head}{x.who && <span className="text-muted-foreground font-normal"> — {x.who}</span>}</p><p className="text-muted-foreground">{x.body}{x.source && <> <a href={x.source} target="_blank" rel="noreferrer" className="text-primary">source</a></>}</p></li>
    ))}</ul>
  );
  return (
    <section className="rounded-xl border p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold">What the market runs</h2>
        <p className="text-[11px] text-muted-foreground">Research of {MARKET_AT}: the Pakistani houses’ own sites, their Google ads, TikTok, and Meta’s documentation. Their Meta ads aren’t readable without signing in — the Competitors tab looks them up through the shop’s account.</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {tabs.map(([k, label]) => <button key={k} type="button" onClick={() => setOpen(k)} className={cn('rounded-full border px-2.5 py-1 text-[11px] min-h-0', open === k ? 'bg-foreground text-background' : 'text-muted-foreground')}>{label}</button>)}
      </div>
      {open === 'gaps' && list(GAPS)}
      {open === 'patterns' && list(PATTERNS)}
      {open === 'meta' && list(META_NOTES)}
      {open === 'houses' && (
        <ul className="space-y-2">{HOUSES.map(h => (
          <li key={h.name} className="text-xs">
            <p className="font-medium">{h.name} <span className="text-muted-foreground font-normal">· {h.city}</span></p>
            <p className="text-muted-foreground">{h.line}{' '}
              {h.ig && <a href={`https://www.instagram.com/${h.ig}/`} target="_blank" rel="noreferrer" className="text-primary">Instagram</a>}
              {h.url && <> · <a href={h.url} target="_blank" rel="noreferrer" className="text-primary">site</a></>}
              {' · '}<a href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=PK&q=${encodeURIComponent(h.name)}&search_type=keyword_unordered`} target="_blank" rel="noreferrer" className="text-primary">their ads</a>
            </p>
          </li>
        ))}</ul>
      )}
    </section>
  );
}
