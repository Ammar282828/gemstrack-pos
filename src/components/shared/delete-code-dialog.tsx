"use client";

/**
 * The one delete-code dialog (lib/delete-code.ts). Mounted once inside the signed-in app; every
 * delete awaits it. Four digits, checked by the server; a wrong one clears the box and says so.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ShieldAlert } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { registerDeleteCodeAsker } from '@/lib/delete-code';

export function DeleteCodeDialog() {
  const [what, setWhat] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => registerDeleteCodeAsker(w => new Promise<boolean>(resolve => {
    resolver.current = resolve;
    setWhat(w || 'Delete');
    setCode(''); setError(null); setBusy(false);
  })), []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setWhat(null);
  };

  const submit = async () => {
    if (busy || code.length < 4) return;
    setBusy(true); setError(null);
    try {
      const token = await auth?.currentUser?.getIdToken().catch(() => '');
      const res = await fetch('/api/auth/delete-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ code, what }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) { finish(true); return; }
      setError(d.error || `Couldn't check the code (${res.status}).`);
      setCode('');
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={what !== null} onOpenChange={o => { if (!o) finish(false); }}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Delete code</DialogTitle>
          <DialogDescription>{what}. This can&apos;t be undone — enter the code to go ahead.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-3">
          <Input
            autoFocus type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={8}
            value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(null); }}
            placeholder="••••" aria-label="Delete code" className="h-12 text-center text-2xl tracking-[0.5em]"
          />
          {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => finish(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy || code.length < 4}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
