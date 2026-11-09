'use client';

import React, { useEffect, useState } from 'react';
import { LedgerSection, Pill } from '@/components/ledger';
import { useAuth } from '@/components/auth/google-auth-gate';
import { isOwner } from '@/lib/roles';
import { authedFetch } from '@/lib/voice/authed-fetch';

type Status = { connected: boolean; booking?: boolean; payments?: boolean; originCity?: string; parcels?: number; paidOut?: number; lastPaidOn?: string | null; unpaidDelivered?: number; costs?: { year: number; parcels: number; total: number; tax: number; delivery: number } };
/**
 * Settings → Integrations → TCS (owners), status only: the account is set on the server (POST /api/admin/integrations,
 * op setTcsCredentials; owner, 2026-11-09: nothing entered on the front end). With the Cash on Delivery set, orders are booked with TCS from the ERP, their
 * shipping slips printed and their parcels tracked (lib/tcs-cod.ts). With OCI Connect's client secret too, saving reads TCS
 * straight away: each month's courier charges become one expense (Courier & Delivery), and the card says what TCS has paid
 * out and how many delivered parcels it has not paid for yet.
 */
export function TcsSettings() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let live = true;
    authedFetch('/api/app/me').then(r => r.json()).then(d => { if (live) setStatus(d?.shop?.tcs ?? { connected: false }); }).catch(() => { if (live) setStatus({ connected: false }); });
    return () => { live = false; };
  }, []);

  if (!isOwner(user?.email)) return null;
  const s = status;
  return (
    <LedgerSection
      title="TCS"
      trailing={s === null ? undefined : <Pill tone={s.connected ? 'settled' : 'quiet'}>{s.connected ? 'Connected' : 'Not connected'}</Pill>}
      footer="Set up on the server; nothing to enter here. Parcels are booked, their slips printed and tracked from each order; every parcel's cost and tax goes to Expenses under Courier & Delivery."
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
      {s !== null && !s.connected && <p className="py-3 text-ios-sub text-muted-foreground">Not connected yet. TCS is set up on the server once TCS opens the account to the API.</p>}
    </LedgerSection>
  );
}
