'use client';

import React, { useEffect, useState } from 'react';
import { LedgerSection, Pill } from '@/components/ledger';
import { Button } from '@/components/ui/button';
import { BusyLabel } from '@/components/ui/busy';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/google-auth-gate';
import { isOwner } from '@/lib/roles';
import { authedFetch } from '@/lib/voice/authed-fetch';

type Status = { connected: boolean; parcels?: number; paidOut?: number; lastPaidOn?: string | null; unpaidDelivered?: number };
const FIELDS = [
  { key: 'clientId', label: 'Client ID', secret: false },
  { key: 'clientSecret', label: 'Client secret', secret: true },
  { key: 'username', label: 'Username', secret: false },
  { key: 'password', label: 'Password', secret: true },
  { key: 'customerNo', label: 'Account (customer) number', secret: false },
] as const;
type Key = typeof FIELDS[number]['key'];

/**
 * Settings → Integrations → TCS (owners): the shop's own TCS API account (lib/tcs-payments.ts, op setTcsCredentials). Kept
 * encrypted on the server and never shown again; saving it reads TCS straight away. Each month's courier charges become one
 * expense (Courier & Delivery), and the card says what TCS has paid out and how many delivered parcels it has not paid for yet.
 */
export function TcsSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Record<Key, string>>({ clientId: '', clientSecret: '', username: '', password: '', customerNo: '' });
  const [busy, setBusy] = useState<null | 'save' | 'off'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    authedFetch('/api/app/me').then(r => r.json()).then(d => { if (live) setStatus(d?.shop?.tcs ?? { connected: false }); }).catch(() => { if (live) setStatus({ connected: false }); });
    return () => { live = false; };
  }, []);

  if (!isOwner(user?.email)) return null;
  const complete = FIELDS.every(f => form[f.key].trim());

  const send = async (off: boolean) => {
    if (busy) return;
    setBusy(off ? 'off' : 'save'); setError(null);
    try {
      const res = await authedFetch('/api/app/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(off ? { op: 'setTcsCredentials', off: true } : { op: 'setTcsCredentials', ...form }),
      });
      const d = await res.json().catch(() => ({})) as { tcs?: boolean; error?: string; run?: Status & { months: string[] } };
      if (!res.ok) { setError(d.error || `Could not save (${res.status}).`); return; }
      setStatus(d.tcs ? { connected: true, ...(d.run || {}) } : { connected: false });
      setForm({ clientId: '', clientSecret: '', username: '', password: '', customerNo: '' });
      toast({ title: d.tcs ? 'TCS connected' : 'TCS disconnected', description: d.run ? `${d.run.parcels} parcels read; ${d.run.months.length} month${d.run.months.length === 1 ? '' : 's'} of courier charges in Expenses.` : undefined });
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally { setBusy(null); }
  };

  const s = status;
  return (
    <LedgerSection
      title="TCS"
      trailing={s === null ? undefined : <Pill tone={s.connected ? 'settled' : 'quiet'}>{s.connected ? 'Connected' : 'Not connected'}</Pill>}
      footer="The details TCS gave for its API (OCI Connect). Kept encrypted on the server and never shown again. Each month's courier charges become one expense under Courier & Delivery."
    >
      {s?.connected && s.parcels !== undefined && (
        <p className="py-3 text-ios-sub text-muted-foreground">
          {s.parcels} parcels in the last 4 months · paid out PKR {(s.paidOut || 0).toLocaleString('en-PK')}{s.lastPaidOn ? ` (last on ${s.lastPaidOn})` : ''}
          {s.unpaidDelivered ? ` · ${s.unpaidDelivered} delivered not yet paid for` : ''}
        </p>
      )}
      <form onSubmit={e => { e.preventDefault(); void send(false); }} className="space-y-3 py-3">
        {FIELDS.map(f => (
          <Input
            key={f.key} type={f.secret ? 'password' : 'text'} value={form[f.key]} placeholder={f.label} aria-label={`TCS ${f.label}`}
            autoComplete="off" spellCheck={false} disabled={!!busy}
            onChange={e => { const v = e.target.value; setForm(p => ({ ...p, [f.key]: v })); setError(null); }}
          />
        ))}
        {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          {s?.connected && (
            <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void send(true)}>
              <BusyLabel busy={busy === 'off'}>Disconnect</BusyLabel>
            </Button>
          )}
          <Button type="submit" disabled={!!busy || !complete}>
            <BusyLabel busy={busy === 'save'}>{s?.connected ? 'Replace' : 'Connect'}</BusyLabel>
          </Button>
        </div>
      </form>
    </LedgerSection>
  );
}
