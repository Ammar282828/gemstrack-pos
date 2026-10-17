'use client';

/**
 * The studio's Plan: what to run, place by place — the plays (plays.ts) laid out as a funnel,
 * each with why (from the 2026-09-29 research), its shape and layout, who, how much and how to
 * judge it, and "Make this", which opens the maker set up for it once a photo is chosen.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MessageCircle, MessagesSquare, Rss, UserRound, MousePointerClick, ChevronDown, ChevronUp, Brush, Star, Megaphone, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLAYS, STAGES, type Play } from '@/lib/ads/studio/plays';
import { AD_TEMPLATES, formatInfo } from '@/lib/ads/studio/templates';
import type { GoalKey } from '@/lib/ads/plan';

const ICON: Partial<Record<GoalKey, React.ReactNode>> = {
  whatsapp: <MessageCircle className="h-4 w-4" />, messages: <MessagesSquare className="h-4 w-4" />, channel: <Rss className="h-4 w-4" />,
  profile: <UserRound className="h-4 w-4" />, website: <MousePointerClick className="h-4 w-4" />, sales: <ShoppingBag className="h-4 w-4" />,
};

export function PlanSection({ onMake }: { onMake: (p: Play) => void; hasPhoto?: boolean }) {
  return (
    <div className="space-y-5">
      {STAGES.filter(st => PLAYS.some(p => p.stage === st.id)).map(st => (
        <section key={st.title} className="space-y-2">
          <h2 className="text-base font-semibold" title={st.note}>{st.title}</h2>
          <div className="grid md:grid-cols-2 gap-2.5">
            {PLAYS.filter(p => p.stage === st.id).sort((a, b) => Number(!!b.core) - Number(!!a.core)).map(p => <PlayCard key={p.id} p={p} onMake={() => onMake(p)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function PlayCard({ p, onMake }: { p: Play; onMake: () => void }) {
  const [open, setOpen] = useState(false);
  const layout = AD_TEMPLATES.find(t => t.id === p.template)?.label ?? p.template;
  return (
    <div className={cn('rounded-xl border p-3 space-y-2 bg-card', p.core && 'border-primary/50')}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-primary">{ICON[p.goal] ?? <Megaphone className="h-4 w-4" />}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold flex items-center gap-1.5">{p.title}{p.core && <Star className="h-3.5 w-3.5 fill-current text-primary" aria-label="Always on" />}</p>
          <p className="text-[11px] text-muted-foreground">→ {p.where}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 text-[10px]">
        <span className="rounded-full border px-2 py-0.5">{formatInfo(p.format).label}{p.pair && p.format !== 'story' ? ' + 9:16' : ''}</span>
        <span className="rounded-full border px-2 py-0.5">{layout}</span>
        <span className="rounded-full border px-2 py-0.5">“{p.cta}”</span>
      </div>
      {open && (
        <dl className="text-[11px] space-y-1 border-t pt-2">
          <p className="text-xs">{p.why}</p>
          <div><dt className="font-semibold inline">Who: </dt><dd className="inline text-muted-foreground">{p.who}</dd></div>
          <div><dt className="font-semibold inline">How much: </dt><dd className="inline text-muted-foreground">{p.budget}</dd></div>
          <div><dt className="font-semibold inline">Judge it by: </dt><dd className="inline text-muted-foreground">{p.judge}</dd></div>
        </dl>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onMake}><Brush className="h-4 w-4 mr-1" /> Make this</Button>
        <button type="button" onClick={() => setOpen(o => !o)} className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5 min-h-0">{open ? <>Less <ChevronUp className="h-3 w-3" /></> : <>Why, who, how much <ChevronDown className="h-3 w-3" /></>}</button>
      </div>
    </div>
  );
}
