'use client';

import React, { useEffect, useState } from 'react';
import { LedgerSection, Pill } from '@/components/ledger';
import { useAuth } from '@/components/auth/google-auth-gate';
import { isOwner } from '@/lib/roles';
import { authedFetch } from '@/lib/voice/authed-fetch';

/**
 * Settings → Integrations → Safepay (owners), status only. Both keys are set on the server (POST /api/admin/integrations,
 * ops setSafepayKey / setSafepaySecret; owner, 2026-11-09: nothing entered on the front end): the public key turns on
 * "Payment link", the secret key records each month's fees and the tax on them as an expense.
 */
export function SafepaySettings() {
  const { user } = useAuth();
  const [links, setLinks] = useState<boolean | null>(null);
  const [fees, setFees] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/app/business').then(r => r.json()).then(d => { if (live) setLinks(!!d?.flags?.paymentLinks); }).catch(() => { if (live) setLinks(false); });
    authedFetch('/api/app/me').then(r => r.json()).then(d => { if (live) setFees(!!d?.shop?.safepayFees); }).catch(() => { if (live) setFees(false); });
    return () => { live = false; };
  }, []);

  if (!isOwner(user?.email)) return null;
  const on = links && fees;
  return (
    <LedgerSection
      title="Safepay"
      trailing={links === null || fees === null ? undefined : <Pill tone={on ? 'settled' : links || fees ? 'working' : 'quiet'}>{on ? 'Connected' : links || fees ? 'Partly connected' : 'Not connected'}</Pill>}
      footer="Set up on the server; nothing to enter here."
    >
      <p className="py-3 text-ios-sub text-muted-foreground">
        Payment links {links ? 'on' : links === null ? '…' : 'off'} · fees and tax to Expenses (Payment Fees) {fees ? 'on' : fees === null ? '…' : 'off'}
      </p>
    </LedgerSection>
  );
}
