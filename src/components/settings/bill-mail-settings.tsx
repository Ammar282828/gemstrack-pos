'use client';

import React, { useEffect, useState } from 'react';
import { LedgerSection, Pill } from '@/components/ledger';
import { useAuth } from '@/components/auth/google-auth-gate';
import { isOwner } from '@/lib/roles';
import { authedFetch } from '@/lib/voice/authed-fetch';

type Status = { connected: boolean; user?: string; bills?: number; lastAt?: string; error?: string; yearTotal?: number };

/**
 * Settings → Integrations → Shopify bills (owners): status only. The mailbox is connected on the server (op setBillMail);
 * Shopify's bills are read from it once a day, each an expense under Software & Subscriptions (lib/shopify-bills-server.ts).
 */
export function BillMailSettings() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let live = true;
    authedFetch('/api/app/me').then(r => r.json()).then(d => { if (live) setStatus(d?.shop?.billMail ?? { connected: false }); }).catch(() => { if (live) setStatus({ connected: false }); });
    return () => { live = false; };
  }, []);

  if (!isOwner(user?.email)) return null;

  const row = (k: string, v: string) => (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>
  );

  return (
    <LedgerSection
      title="Shopify bills (from email)"
      trailing={status === null ? undefined : <Pill tone={status.connected ? 'settled' : 'quiet'}>{status.connected ? 'Connected' : 'Off'}</Pill>}
      footer="The mailbox Shopify sends its bills to. Read once a day; each bill becomes an expense under Software & Subscriptions, converted to rupees at that day's rate. The password is kept encrypted on the server."
    >
      {status && !status.connected && <p className="py-3 text-sm text-muted-foreground">Not connected yet — set up on the server.</p>}
      {status?.connected && (
        <div className="divide-y">
          {row('Mailbox', status.user ?? '')}
          {row('Bills found', String(status.bills ?? 0))}
          {row('Last run', status.lastAt ? new Date(status.lastAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not yet')}
          {row('This year', `PKR ${Math.round(status.yearTotal ?? 0).toLocaleString('en-PK')}`)}
          {status.error && <p className="my-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">{status.error}</p>}
        </div>
      )}
    </LedgerSection>
  );
}
