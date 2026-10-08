"use client";

/**
 * The one delete-code dialog (lib/delete-code.ts). Mounted once inside the signed-in app; every
 * delete awaits it. Four digits, checked by the server; a wrong one clears the box and says so.
 *
 * In the iPhone app the code can be kept behind Face ID on that phone (lib/native-app.ts appSecret):
 * offered once a typed code has been accepted, then asked for by face instead of typed in front of
 * a customer. The server still checks it every time; a code the shop has since changed is forgotten
 * on the phone and asked for typed.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ScanFace, ShieldAlert } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { registerDeleteCodeAsker } from '@/lib/delete-code';
import { appFeatures, appSecret } from '@/lib/native-app';

const FACE_KEY = 'delete-code';

export function DeleteCodeDialog() {
  const [what, setWhat] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  // Face ID: whether this phone can, whether it already keeps the code, and whether to keep it.
  const [face, setFace] = useState<{ can: boolean; kept: boolean }>({ can: false, kept: false });
  const [keep, setKeep] = useState(true);

  useEffect(() => {
    let live = true;
    void appFeatures().then(async (f) => {
      if (!live || !f.includes('faceID')) return;
      setFace({ can: true, kept: await appSecret.has(FACE_KEY) });
    });
    return () => { live = false; };
  }, []);

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

  const submit = async (given = code, byFace = false) => {
    if (busy || given.length < 4) return;
    setBusy(true); setError(null);
    try {
      const token = await auth?.currentUser?.getIdToken().catch(() => '');
      const res = await fetch('/api/auth/delete-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ code: given, what }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) {
        if (!byFace && face.can && !face.kept && keep && await appSecret.save(FACE_KEY, given)) setFace({ can: true, kept: true });
        finish(true);
        return;
      }
      if (byFace && res.status === 403) {
        // The shop changed the code: the phone's copy is no use any more.
        await appSecret.forget(FACE_KEY);
        setFace({ can: true, kept: false });
        setError('The delete code has changed. Type the new one.');
      } else {
        setError(d.error || `Couldn't check the code (${res.status}).`);
      }
      setCode('');
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally { setBusy(false); }
  };

  /** Face ID unlocks the kept code and sends it; a closed Face ID sheet leaves the box to type in. */
  const byFace = async () => {
    const kept = await appSecret.read(FACE_KEY, what || 'Delete');
    if (kept) await submit(kept, true);
  };

  // Asked by face as soon as the dialog opens, when this phone keeps the code.
  useEffect(() => {
    if (what !== null && face.kept) void byFace();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what]);

  return (
    <Dialog open={what !== null} onOpenChange={o => { if (!o) finish(false); }}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Delete code</DialogTitle>
          <DialogDescription>{what}. This can&apos;t be undone — enter the code to go ahead.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); void submit(); }} className="space-y-3">
          <Input
            autoFocus type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={8}
            value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(null); }}
            placeholder="••••" aria-label="Delete code" className="h-12 text-center text-2xl tracking-[0.5em]"
          />
          {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
          {face.can && face.kept && (
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void byFace()}>
              <ScanFace className="mr-1.5 h-4 w-4" /> Use Face ID
            </Button>
          )}
          {face.can && !face.kept && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} className="h-4 w-4" />
              Use Face ID next time on this phone
            </label>
          )}
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
