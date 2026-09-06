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
        setReason(d?.reason ?? null);
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
            One key does all of it — listening, understanding and answering.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {ready === false && (
            <Alert>
              <AlertTitle>
                {reason === 'bad_key' ? 'The Gemini key was rejected'
                  : reason === 'unreachable' ? 'Could not reach Google'
                  : 'No Gemini key on the server'}
              </AlertTitle>
              <AlertDescription>
                {reason === 'bad_key' ? (
                  <>
                    There is a key in <code className="rounded bg-muted px-1">GOOGLE_GENAI_API_KEY</code>,
                    but Google will not accept it — usually expired, revoked, or copied short.
                    Issue a fresh one from Google AI Studio and restart.
                  </>
                ) : reason === 'unreachable' ? (
                  <>The key could not be checked because Google did not answer. This is usually
                  the connection rather than the key; it will be rechecked shortly.</>
                ) : (
                  <>
                    Set <code className="rounded bg-muted px-1">GOOGLE_GENAI_API_KEY</code> in the
                    environment and restart.
                  </>
                )}{' '}
                Voice is the only thing that key affects — without it the microphone is
                unavailable and every entry it could make can still be made from the ordinary
                forms.
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
