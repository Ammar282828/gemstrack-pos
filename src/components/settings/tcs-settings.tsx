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

type Status = { connected: boolean; booking?: boolean; payments?: boolean; originCity?: string; parcels?: number; paidOut?: number; lastPaidOn?: string | null; unpaidDelivered?: number; costs?: { year: number; parcels: number; total: number; tax: number; delivery: number } };
/** The Cash on Delivery API's set first (booking, slips, tracking); the city and OCI's secret are optional. */
const FIELDS = [
  { key: 'clientId', label: 'Client ID (from the TCS developer portal)', secret: true, optional: false },
  { key: 'username', label: 'Username', secret: false, optional: false },
  { key: 'password', label: 'Password', secret: true, optional: false },
  { key: 'costCenterCode', label: 'Cost centre code', secret: false, optional: false },
  { key: 'accountNo', label: 'Account number', secret: false, optional: false },
  { key: 'originCity', label: 'Sending city (Karachi if blank)', secret: false, optional: true },
  { key: 'clientSecret', label: 'Client secret, for payment reports (optional)', secret: true, optional: true },
] as const;
type Key = typeof FIELDS[number]['key'];
const EMPTY: Record<Key, string> = { clientId: '', username: '', password: '', costCenterCode: '', accountNo: '', originCity: '', clientSecret: '' };

/**
 * Settings → Integrations → TCS (owners): the shop's own TCS API account (lib/tcs-payments.ts, op setTcsCredentials). Kept
 * encrypted on the server and never shown again. With the Cash on Delivery set, orders are booked with TCS from the ERP, their
 * shipping slips printed and their parcels tracked (lib/tcs-cod.ts). With OCI Connect's client secret too, saving reads TCS
 * straight away: each month's courier charges become one expense (Courier & Delivery), and the card says what TCS has paid
 * out and how many delivered parcels it has not paid for yet.
 */
export function TcsSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Record<Key, string>>(EMPTY);
  const [busy, setBusy] = useState<null | 'save' | 'off'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    authedFetch('/api/app/me').then(r => r.json()).then(d => { if (live) setStatus(d?.shop?.tcs ?? { connected: false }); }).catch(() => { if (live) setStatus({ connected: false }); });
    return () => { live = false; };
  }, []);

  if (!isOwner(user?.email)) return null;
  const complete = FIELDS.every(f => f.optional || form[f.key].trim());

  const send = async (off: boolean) => {
    if (busy) return;
    setBusy(off ? 'off' : 'save'); setError(null);
    try {
      const res = await authedFetch('/api/app/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(off ? { op: 'setTcsCredentials', off: true } : { op: 'setTcsCredentials', ...form }),
      });
      const d = await res.json().catch(() => ({})) as { tcs?: boolean; booking?: boolean; payments?: boolean; error?: string; run?: Status & { months: string[] } };
      if (!res.ok) { setError(d.error || `Could not save (${res.status}).`); return; }
      setStatus(d.tcs ? { connected: true, booking: d.booking, payments: d.payments, originCity: form.originCity.trim() || 'Karachi', ...(d.run || {}) } : { connected: false });
      setForm(EMPTY);
      toast({
        title: d.tcs ? 'TCS connected' : 'TCS disconnected',
        description: d.run ? `Booking on. ${d.run.parcels} parcels read; ${d.run.months.length} month${d.run.months.length === 1 ? '' : 's'} of courier charges in Expenses.`
          : d.tcs ? 'Orders can be booked with TCS from their page. Until TCS opens the account, booking says so and tracking reads Shopify.' : undefined,
      });
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally { setBusy(null); }
  };

  const s = status;
  return (
    <LedgerSection
      title="TCS"
      trailing={s === null ? undefined : <Pill tone={s.connected ? 'settled' : 'quiet'}>{s.connected ? 'Connected' : 'Not connected'}</Pill>}
      footer="The details TCS gave for its API. The first five book parcels, print shipping slips and track them from each order. The client secret (OCI Connect) adds each month's courier charges as one expense under Courier & Delivery. Kept encrypted on the server and never shown again."
    >
      {s?.connected && (
        <p className="pt-3 text-ios-sub text-muted-foreground">
          {s.booking ? `Booking from ${s.originCity || 'Karachi'}` : 'Booking off: the cost centre code or account number is missing'}
          {' · '}{s.payments ? 'payment reports on' : 'payment reports off (no client secret)'}
        </p>
      )}
      {s?.connected && s.parcels !== undefined && (
        <p className="py-3 text-ios-sub text-muted-foreground">
          {s.parcels} parcels in the last 4 months · paid out PKR {(s.paidOut || 0).toLocaleString('en-PK')}{s.lastPaidOn ? ` (last on ${s.lastPaidOn})` : ''}
          {s.unpaidDelivered ? ` · ${s.unpaidDelivered} delivered not yet paid for` : ''}
        </p>
      )}
      {s?.connected && s.costs && s.costs.parcels > 0 && (
        <p className="pb-3 text-ios-sub text-muted-foreground">
          {s.costs.year}: {s.costs.parcels} parcels costed · courier cost PKR {s.costs.total.toLocaleString('en-PK')} (tax PKR {s.costs.tax.toLocaleString('en-PK')})
        </p>
      )}
      <form onSubmit={e => { e.preventDefault(); void send(false); }} className="space-y-3 py-3">
        {FIELDS.map(f => (
          <Input
            key={f.key} type={f.secret ? 'password' : 'text'} value={form[f.key]} placeholder={f.label} aria-label={`TCS ${f.label}`}
            required={!f.optional}
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
