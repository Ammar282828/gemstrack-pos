'use client';

/** House of Mina's Visitors and Live have two sources: the Shopify store, and the catalogue's own counters. The pick is remembered per page on this device. */

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type View = 'shopify' | 'catalogue';

export function useView(page: string): [View, (v: View) => void] {
  const key = `erp.websiteView.${page}`;
  const [view, set] = useState<View>('shopify');
  useEffect(() => { try { if (localStorage.getItem(key) === 'catalogue') set('catalogue'); } catch { /* private mode */ } }, [key]);
  return [view, (v: View) => { set(v); try { localStorage.setItem(key, v); } catch { /* private mode */ } }];
}

export function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex rounded-full bg-muted p-0.5 w-fit" role="tablist">
      {([['shopify', 'Online store (Shopify)'], ['catalogue', 'Catalogue']] as const).map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => onChange(k)}
          className={cn('rounded-full px-3 py-1 text-xs min-h-0', view === k ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>{label}</button>
      ))}
    </div>
  );
}
