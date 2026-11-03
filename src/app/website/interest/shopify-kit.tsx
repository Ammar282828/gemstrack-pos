'use client';

/**
 * What the Shopify views of Website → Visitors and Live share: the signed-in fetch, the card a section shows where its
 * scope isn't granted, and the money and name helpers. A section is `{ data }`, `{ missingScope }` or `{ error }`
 * (lib/website/shopify-analytics.ts).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { KeyRound } from 'lucide-react';
import { Card } from './site-kit';
import { ChartSkeleton, ListRowsSkeleton } from '@/components/shared/skeletons';

export type Section<T> = { data: T } | { missingScope: string; note?: string } | { error: string };

export function useShopify<T>(url: string, everyMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const t = await firebaseAuth?.currentUser?.getIdToken().catch(() => null);
      const r = await fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 403 ? 'Shopify analytics are for the owners.' : d.error || 'Could not load');
      setData(d); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { busy.current = false; setLoading(false); }
  }, [url]);
  useEffect(() => {
    setLoading(true); load();
    if (!everyMs) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, everyMs);
    return () => clearInterval(id);
  }, [load, everyMs]);
  return { data, error, loading, reload: load };
}

/** The card a section shows when Shopify hasn't given the app the scope (or the query failed). */
export function Needs({ title, section }: { title: string; section: { missingScope: string; note?: string } | { error: string } }) {
  if ('missingScope' in section) {
    return (
      <Card title={title}>
        <div className="flex gap-3 text-sm">
          <KeyRound className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            Grant <code className="rounded bg-muted px-1 py-0.5 text-foreground">{section.missingScope}</code> in Shopify to see this.
            In the Shopify admin: Settings → Apps and sales channels → Develop apps (or the app in the Dev Dashboard) → Configuration → Admin API access scopes → tick it,
            save, then install the app again so it hands the ERP the new token.{section.note ? ` ${section.note}` : ''}
          </p>
        </div>
      </Card>
    );
  }
  return <Card title={title}><p className="text-sm text-muted-foreground">Shopify did not answer this one: {section.error}</p></Card>;
}

/** A section's card: its content when there is data, the scope card when there isn't. */
export function Gate<T>({ title, section, children, skeleton }: { title: string; section: Section<T> | undefined; children: (d: T) => React.ReactNode; skeleton?: 'chart' | 'list' }) {
  if (!section) return skeleton === 'chart' ? <ChartSkeleton height={200} /> : <ListRowsSkeleton rows={4} card />;
  if ('data' in section) return <>{children(section.data)}</>;
  return <Needs title={title} section={section} />;
}

export function moneyFormatter(currency: string | undefined) {
  const f = (n: number) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'PKR', maximumFractionDigits: 0 }).format(n); }
    catch { return Math.round(n).toLocaleString('en-US'); }
  };
  return f;
}
export const int = (n: number) => Math.round(n).toLocaleString('en-US');
export const rate = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;
export const secondsLabel = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
export const agoLabel = (ms: number) => (ms < 60_000 ? 'just now' : `${Math.round(ms / 60_000)} min ago`);
