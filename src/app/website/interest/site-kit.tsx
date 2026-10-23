'use client';

/**
 * What Website → Interest and Live share: names for places, sources, devices and pages; a ranked list with thin
 * bars (the location list stands in for a map: on a phone a ranked list reads, a world map doesn't).
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import type { Channel } from '@/lib/website/site-analytics';

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export function countryName(cc: string): string {
  if (!cc || cc === '??') return 'Unknown';
  try { return regionNames?.of(cc) || cc; } catch { return cc; }
}
/** The country's flag from its two letters (regional indicator symbols). */
export const flag = (cc: string) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(c => 0x1f1a5 + c.charCodeAt(0))) : '🌐');

export const CHANNEL: Record<Channel, string> = { direct: 'Direct', search: 'Search', social: 'Social', paid: 'Ads', referral: 'Other sites', email: 'Email' };
export function sourceLabel(key: string): string {
  if (key === 'direct') return 'Direct';
  const i = key.indexOf(':');
  const ch = key.slice(0, i) as Channel, name = key.slice(i + 1);
  return ch === 'paid' ? `${name} ads` : ch === 'search' ? `${name} search` : name;
}
export const DEVICE: Record<string, string> = { mobile: 'Phone', tablet: 'Tablet', desktop: 'Computer' };

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(x > 0 && x < 0.1 && digits === 0 ? 1 : digits)}%`;
export function duration(ms: number): string {
  if (!ms) return '0s';
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
/** A page's address as people read it: "/rings-bands/band-147" → "rings-bands › band-147"; the front page by name. */
export const pageLabel = (p: string) => (p === '/' ? 'Front page' : p.replace(/^\//, '').split('/').join(' › '));

export function Card({ title, note, children, className }: { title: React.ReactNode; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[22px] bg-card p-4 space-y-2.5 min-w-0', className)}>
      <h2 className="text-sm font-semibold">{title}{note && <span className="font-normal text-muted-foreground text-xs"> — {note}</span>}</h2>
      {children}
    </section>
  );
}

export interface RankRow { key: string; label: React.ReactNode; value: number; sub?: React.ReactNode; href?: string; children?: RankRow[] }

/** A ranked list: the label, the count and its share, one thin bar; the first `show`, then "Show all". Rows with children open in place. */
export function Ranked({ rows, total, empty = 'Nothing yet.', show = 8, unit }: { rows: RankRow[]; total?: number; empty?: string; show?: number; unit?: string }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  const max = Math.max(1, ...rows.map(r => r.value));
  const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
  const shown = all ? rows : rows.slice(0, show);
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5">
        {shown.map(r => {
          const isOpen = open === r.key && !!r.children?.length;
          const label = r.href ? <a href={r.href} target="_blank" rel="noopener" className="hover:underline">{r.label}</a> : r.label;
          return (
            <li key={r.key} className="space-y-1">
              <button type="button" disabled={!r.children?.length} onClick={() => setOpen(isOpen ? null : r.key)}
                className="w-full text-left space-y-0.5 min-h-0 disabled:cursor-default" aria-expanded={r.children?.length ? isOpen : undefined}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="truncate min-w-0">{label}{r.sub && <span className="text-xs text-muted-foreground"> · {r.sub}</span>}{r.children?.length ? <span className="text-xs text-muted-foreground"> {isOpen ? '▾' : '▸'}</span> : null}</span>
                  <span className="tabular-nums shrink-0">{r.value.toLocaleString('en-US')}{unit ? ` ${unit}` : ''}<span className="text-xs text-muted-foreground ml-1.5">{sum ? pct(r.value / sum) : ''}</span></span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.value / max) * 100}%` }} /></div>
              </button>
              {isOpen && <div className="pl-4 pt-1"><Ranked rows={r.children!} total={r.value} show={12} /></div>}
            </li>
          );
        })}
      </ul>
      {rows.length > show && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs text-primary min-h-0">{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
      )}
    </div>
  );
}

/** Places as a ranked list: countries, each opening into its cities when the site knows them. */
export function placeRows(countries: { key: string; value: number }[], cities: { cc: string; region: string; city: string; sessions: number }[]): RankRow[] {
  return countries.map(c => ({
    key: c.key, value: c.value, label: <>{flag(c.key)} {countryName(c.key)}</>,
    children: cities.filter(x => x.cc === c.key).map(x => ({ key: `${x.region}|${x.city}`, value: x.sessions, label: x.city, sub: x.region || undefined })),
  }));
}
