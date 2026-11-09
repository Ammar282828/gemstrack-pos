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
import { forgetPaymentLinks } from '@/hooks/use-payment-links';
import { isSafepayKey } from '@/lib/payment-link-message';

/** Settings → Integrations → Safepay (owners): the house's PUBLIC key, which turns on "Payment link" (op setSafepayKey). */
export function SafepaySettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'disconnect'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/app/business').then(r => r.json()).then(d => { if (live) setConnected(!!d?.flags?.paymentLinks); }).catch(() => { if (live) setConnected(false); });
    return () => { live = false; };
  }, []);

  if (!isOwner(user?.email)) return null;

  const send = async (publicKey: string, what: 'save' | 'disconnect') => {
    if (busy) return;
    if (what === 'save' && !isSafepayKey(publicKey)) { setError('That is not a Safepay public key (it starts with sec_). Use the Public key, not the Secret key.'); return; }
    setBusy(what); setError(null);
    try {
      const res = await authedFetch('/api/app/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'setSafepayKey', publicKey: publicKey.trim() }),
      });
      const d = await res.json().catch(() => ({})) as { paymentLinks?: boolean; error?: string };
      if (!res.ok) { setError(d.error || `Could not save (${res.status}).`); return; }
      forgetPaymentLinks();
      setConnected(!!d.paymentLinks); setKey('');
      toast({ title: d.paymentLinks ? 'Safepay connected' : 'Safepay disconnected' });
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally { setBusy(null); }
  };

  return (
    <LedgerSection
      title="Safepay"
      trailing={connected === null ? undefined : <Pill tone={connected ? 'settled' : 'quiet'}>{connected ? 'Connected' : 'Not connected'}</Pill>}
      footer="Safepay dashboard → Developer → API → Public key (starts with sec_). Never the Secret key."
    >
      <form onSubmit={e => { e.preventDefault(); void send(key, 'save'); }} className="space-y-3 py-3">
        <Input
          value={key} onChange={e => { setKey(e.target.value); setError(null); }} placeholder="Public key (sec_…)"
          aria-label="Safepay public key" autoComplete="off" spellCheck={false} disabled={!!busy}
        />
        {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          {connected && (
            <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void send('', 'disconnect')}>
              <BusyLabel busy={busy === 'disconnect'}>Disconnect</BusyLabel>
            </Button>
          )}
          <Button type="submit" disabled={!!busy || !key.trim()}>
            <BusyLabel busy={busy === 'save'}>Save</BusyLabel>
          </Button>
        </div>
      </form>
    </LedgerSection>
  );
}
