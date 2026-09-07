"use client";

/**
 * Settings → Voice.
 *
 * Two things belong here and nothing else: whether voice is switched on at all, and every
 * name the assistant has been taught. The second is the point — a household's nicknames
 * are private, occasionally wrong, and the shop must be able to see the list and take one
 * back without being told how any of it works.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Mic, MicOff, Trash2 } from 'lucide-react';
import { PageShell } from '@/components/shared/page-shell';
import { PageBack } from '@/components/shared/page-back';
import { format } from 'date-fns';
import { authedFetch } from '@/lib/voice/authed-fetch';

export default function VoiceSettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [ready, setReady] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const voiceAliases = useAppStore((s) => s.voiceAliases);
  const loadVoiceAliases = useAppStore((s) => s.loadVoiceAliases);
  const forgetVoiceAlias = useAppStore((s) => s.forgetVoiceAlias);

  useEffect(() => { loadVoiceAliases(); }, [loadVoiceAliases]);

  // The key lives on the server. Asking the route is the only honest way to know.
  useEffect(() => {
    let cancelled = false;
    authedFetch('/api/voice/status')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setReady(Boolean(d?.ready));
        /**
         * A reply with neither `ready` nor `reason` is not Google failing to answer — it
         * is this app refusing the request, almost always a 401 with no signed-in user.
         * Reporting that as an outage sent me looking at Vertex for a sign-in problem.
         */
        setReason(d?.reason ?? (d?.error ? 'refused' : 'unreachable'));
      })
      .catch(() => { if (!cancelled) { setReady(false); setReason('unreachable'); } });
    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell
      title="Voice"
      subtitle="Talk to the book, and correct it when it hears a name wrong."
      icon={<Mic className="h-6 w-6" />}
      width="narrow"
      action={<PageBack fallback="/settings" />}
    >

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {ready ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            {ready === null ? 'Checking…' : ready ? 'Voice is ready' : 'Voice is not set up'}
          </CardTitle>
          <CardDescription>
            Billed to this shop's own Google Cloud account. There is no API key to keep.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {ready === false && (
            <Alert>
              <AlertTitle>
                {reason === 'no_credit' ? 'The Google Cloud account is out of credit'
                  : reason === 'no_permission' ? 'This deployment cannot reach Gemini'
                  : reason === 'not_configured' ? 'Voice is not set up on this deployment'
                  : reason === 'refused' ? 'This app would not let the request through'
                  : 'Could not reach Gemini'}
              </AlertTitle>
              <AlertDescription>
                {reason === 'no_credit' ? (
                  <>Voice and the scanner bill to this shop&apos;s Google Cloud account, and it
                  has nothing left. Top it up and both start working again with no change
                  here — there is no key to replace.</>
                ) : reason === 'no_permission' ? (
                  <>The app&apos;s own service account is not allowed to call Vertex AI on this
                  project. It needs the Vertex AI User role.</>
                ) : reason === 'not_configured' ? (
                  <>No Google Cloud project is configured for this build.</>
                ) : reason === 'refused' ? (
                  <>The voice routes asked for a signed-in owner and got nobody. Google was
                  never contacted, so this is not an outage — it is the gate in front of it.</>
                ) : (
                  <>Google did not answer. This is usually the connection rather than the
                  setup; it will be rechecked shortly.</>
                )}{' '}
                Everything else works meanwhile — every entry voice could make can still be
                made from the ordinary forms.
              </AlertDescription>
            </Alert>
          )}
          <p className="text-muted-foreground">
            The microphone needs <strong>https</strong>, or the shop computer itself. On a phone
            over plain WiFi the browser will not open it — use the forms there.
          </p>
          <p className="text-muted-foreground">
            Nothing spoken is written down until it has been read back and confirmed. When two
            people sound alike, it asks which rather than choosing.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Names it has learned</CardTitle>
          <CardDescription>
            Each one is a time it picked the wrong person and was told which was meant. It gets
            that name right from then on.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {voiceAliases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing learned yet.
            </p>
          ) : (
            voiceAliases.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    <span className="italic text-muted-foreground">“{a.heard}”</span>
                    <span className="mx-2 text-muted-foreground">→</span>
                    <span className="font-medium">{a.refName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.kind === 'customer' ? 'Customer' : 'Karigar'}
                    {a.uses > 1 && ` · corrected ${a.uses} times`}
                    {a.createdAt && ` · ${format(new Date(a.createdAt), 'd MMM yyyy')}`}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(a.id);
                    try {
                      await forgetVoiceAlias(a.id);
                      toast({ title: 'Forgotten', description: `“${a.heard}” no longer means ${a.refName}.` });
                    } catch {
                      toast({ title: 'Could not forget that', variant: 'destructive' });
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  <span className="sr-only">Forget</span>
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
