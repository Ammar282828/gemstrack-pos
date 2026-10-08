"use client";

/**
 * Settings → Alerts: the Apple push key, which lets the ERP send notifications to the shop's
 * iPhone app (lib/push). One key serves both houses' apps; each house's ERP keeps its own copy.
 */

import React from 'react';
import { Bell, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { authedFetch } from '@/lib/voice/authed-fetch';

type Status = { set: boolean; readable: boolean; keyId?: string; setAt?: string; setBy?: string; error?: string };

export function IphonePushCard() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pasting, setPasting] = React.useState(false);
  const [text, setText] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    const res = await authedFetch('/api/push/key').catch(() => null);
    setStatus(res?.ok ? await res.json() : { set: false, readable: false, error: res ? `(${res.status})` : 'no connection' });
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const save = async (p8: string, fileName = '') => {
    setBusy(true);
    try {
      const res = await authedFetch('/api/push/key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p8, fileName }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Not saved (${res.status})`);
      setStatus(d);
      setPasting(false);
      setText('');
      toast({ title: 'Push key saved', description: 'The iPhone app can be sent notifications now.' });
    } catch (e) {
      toast({ title: 'Push key not saved', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) await save(await f.text(), f.name);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4" /> iPhone notifications</CardTitle>
        <CardDescription>
          Sales, payments, new orders and finished pieces, on the iPhone app. Each phone chooses which in the app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!status ? (
          <p className="text-muted-foreground"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Checking…</p>
        ) : status.set && status.readable ? (
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>Apple push key {status.keyId} is set{status.setBy ? `, by ${status.setBy}` : ''}{status.setAt ? ` on ${new Date(status.setAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}.</span>
          </p>
        ) : (
          <div className="space-y-1.5">
            <p>{status.set ? 'The saved push key can no longer be read here. Upload it again.' : 'No Apple push key yet.'}</p>
            <p className="text-muted-foreground">
              At developer.apple.com go to Certificates, Identifiers &amp; Profiles → Keys → +. Name it “ERP push”, tick
              Apple Push Notifications service (APNs), choose Sandbox &amp; Production, then Register and Download.
              Upload that AuthKey file here.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".p8,text/plain,application/octet-stream,application/x-pem-file" className="hidden" onChange={onFile} />
          <Button size="sm" variant={status?.set && status.readable ? 'outline' : 'default'} disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
            {status?.set && status.readable ? 'Replace the key' : 'Upload the AuthKey file'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPasting((p) => !p)}>Paste it instead</Button>
        </div>
        {pasting && (
          <div className="space-y-2">
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="The AuthKey file's text, and its key ID if the file name is not pasted" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">Add the file's name (AuthKey_XXXXXXXXXX.p8) on the first line so the key ID is known.</p>
            <Button size="sm" disabled={busy || !text.trim()} onClick={() => {
              const name = /AuthKey_[A-Z0-9]{10}/i.exec(text)?.[0] || '';
              void save(text.replace(/AuthKey_[A-Z0-9]{10}(\.p8)?/gi, ''), name);
            }}>Save</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
