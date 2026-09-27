'use client';

/**
 * Ads → Setup: everything between "nothing" and "ads on the POS", in order,
 * each step checked live. The one-time Meta app steps (products, redirect
 * address, the app secret in this project's Secret Manager), the Connect
 * button (a Facebook Login), and which ad account / Instagram / Page this house
 * advertises from — chosen automatically when there's one obvious answer.
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Settings2, CheckCircle2, XCircle, Circle, Loader2, ExternalLink, Copy, Facebook, Instagram, Megaphone, RefreshCw, Check, MessageCircle, AlertTriangle, Unplug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_CONFIG, STORE_META_ADS } from '@/lib/store-config';
import { ACCOUNT_STATUS } from '@/lib/ads/shape';
import type { AccountChoice, PageChoice, InstagramChoice, AdsSettings } from '@/lib/ads/settings';
import { api, useAdsStatus, AccountAlerts, ErrorLine } from '../ads-kit';

export default function AdsSetupRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t run Meta ads from the POS.</p>;
  return <Suspense fallback={null}><AdsSetup /></Suspense>;
}

/** Both houses' POS — the Meta app they share must allow each one's return address. */
const POS_ORIGINS = ['https://pos.taheri.shop', 'https://pos.houseofmina.store'];

interface Assets { accounts: AccountChoice[]; pages: PageChoice[]; instagram: InstagramChoice[]; settings: AdsSettings; houseInstagram: string | null }

function Step({ n, done, title, children, tone }: { n: number; done: boolean | null; title: React.ReactNode; children?: React.ReactNode; tone?: 'bad' }) {
  return (
    <section className={cn('rounded-xl border p-4 space-y-3', tone === 'bad' && 'border-destructive/40')}>
      <h2 className="flex items-center gap-2 font-semibold">
        {done === null ? <Circle className="h-5 w-5 text-muted-foreground" /> : done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-destructive" />}
        <span className="text-muted-foreground font-normal tabular-nums">{n}.</span> {title}
      </h2>
      {children && <div className="text-sm space-y-2 pl-7">{children}</div>}
    </section>
  );
}

function CopyLine({ value }: { value: string }) {
  const { toast } = useToast();
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
      <code className="text-xs break-all flex-1">{value}</code>
      <Button size="sm" variant="ghost" className="h-7 px-2 min-h-0 shrink-0" onClick={() => { navigator.clipboard?.writeText(value); toast({ title: 'Copied' }); }}><Copy className="h-3.5 w-3.5" /></Button>
    </div>
  );
}

function AdsSetup() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const { status, error, loading, reload } = useAdsStatus();
  const [assets, setAssets] = useState<Assets | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [greeting, setGreeting] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  // Back from Facebook.
  useEffect(() => {
    const m = params.get('meta');
    if (!m) return;
    if (m === 'connected') toast({ title: 'Meta ads connected', description: params.get('name') ? `As ${params.get('name')}.` : undefined });
    else toast({ title: 'Meta didn’t connect', description: params.get('reason') || undefined, variant: 'destructive' });
    router.replace('/ads/setup');
  }, [params, router, toast]);

  const connected = !!status?.connection?.connected;
  const loadAssets = useCallback(async () => {
    setAssetsError(null);
    try {
      const a = await api<Assets>('/api/ads/setup');
      setAssets(a);
      setGreeting(a.settings.whatsappGreeting ?? '');
    } catch (e) { setAssetsError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (connected) loadAssets(); }, [connected, loadAssets]);

  const connect = async () => {
    setBusy('connect');
    try { const { url } = await api<{ url: string }>('/api/ads/connect', { method: 'POST' }); window.location.href = url; }
    catch (e) { toast({ title: 'Can’t connect yet', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); setBusy(null); }
  };
  const save = async (patch: Partial<AdsSettings>, what: string) => {
    setBusy(what);
    try {
      const { settings } = await api<{ settings: AdsSettings }>('/api/ads/setup', { body: patch });
      setAssets(a => (a ? { ...a, settings } : a));
      toast({ title: 'Saved' });
      reload();
    } catch (e) { toast({ title: 'Not saved', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  const disconnect = async () => {
    setBusy('off');
    try { await api('/api/ads/setup', { body: { action: 'disconnect' } }); setAssets(null); reload(); toast({ title: 'Disconnected' }); }
    catch (e) { toast({ title: 'Couldn’t disconnect', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };

  const app = status?.app;
  const conn = status?.connection;
  const settings = assets?.settings ?? status?.settings ?? null;
  const appUrl = app?.id ? `https://developers.facebook.com/apps/${app.id}` : 'https://developers.facebook.com/apps';
  const house = status?.houseInstagram;
  const chosenIg = assets?.instagram.find(i => i.id === settings?.instagramUserId) ?? null;
  const chosenPage = assets?.pages.find(p => p.id === settings?.pageId) ?? null;
  const wrongHouse = house && settings?.instagramUsername && settings.instagramUsername.toLowerCase() !== house;
  // One Meta app serves both houses, so its dashboard needs both POS addresses — this one first.
  const redirectOrigin = app?.redirectUri ? new URL(app.redirectUri).origin : POS_ORIGINS[0];
  const redirectUris = [...new Set([app?.redirectUri, ...POS_ORIGINS.map(o => `${o}/api/ads/callback`)].filter((u): u is string => !!u))];

  return (
    <PageShell title="Ads setup" icon={<Settings2 className="h-7 w-7" />} width="narrow"
      subtitle={`${STORE_CONFIG.name}’s Meta ad account, connected to this POS`}
      action={<Button variant="outline" onClick={() => { reload(); if (connected) loadAssets(); }} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Check again</Button>}>
      {error && <ErrorLine error={error} onRetry={reload} />}
      {!status && loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</div>}
      {status && <AccountAlerts status={status} />}

      {app && (
        <div className="space-y-3">
          <Step n={1} done={!!app.id} title="The Meta app">
            {app.id ? <p>The shop’s Meta app <a className="text-primary inline-flex items-center gap-1" href={appUrl} target="_blank" rel="noopener">{app.id} <ExternalLink className="h-3 w-3" /></a> — the same one Instagram stories post through. Once, in its dashboard:</p>
              : <p className="text-destructive">No Meta app is set for this shop (META_APP_ID in apphosting.yaml).</p>}
            <ol className="list-decimal pl-5 space-y-1.5 text-muted-foreground">
              <li><span className="text-foreground">Add products</span> (newer dashboard: <span className="text-foreground">Add use case</span>) → <b>Marketing API</b> (“Create &amp; manage ads”) and <b>Facebook Login for Business</b>.</li>
              <li><span className="text-foreground">App settings → Basic → App domains</span>, add both houses’ domains, then Save. If it asks for a platform: Add platform → Website, Site URL <code>{redirectOrigin}/</code>.
                {POS_ORIGINS.map(o => <CopyLine key={o} value={new URL(o).hostname.replace(/^pos\./, '')} />)}</li>
              <li><span className="text-foreground">Facebook Login for Business → Settings</span>: <b>Client OAuth login</b> and <b>Web OAuth login</b> on, and under <b>Valid OAuth redirect URIs</b> both houses’ addresses, then Save. Without them Facebook stops at “Can’t load URL — the domain of this URL isn’t included in the app’s domains”.
                {redirectUris.map(u => <CopyLine key={u} value={u} />)}</li>
              <li><span className="text-foreground">App roles</span>: whoever connects must be an admin or developer of the app (it stays in development mode — no review is needed for the shop’s own ad accounts).</li>
            </ol>
          </Step>

          <Step n={2} done={app.secret && app.tokenStore.write} tone={!app.secret || !app.tokenStore.write ? 'bad' : undefined} title="The app secret, kept by this POS">
            <p className={app.secret ? 'text-muted-foreground' : ''}>
              {app.secret ? <>Found in Secret Manager ({app.secretName}).</> : <>Copy the <b>App secret</b> from the Meta app’s <b>App settings → Basic</b> (the Meta app’s, not the Instagram one) and add it as a new version of <code>{app.secretName}</code>:</>}
            </p>
            {!app.secret && <Button asChild variant="outline" size="sm"><a href={app.secretUrl} target="_blank" rel="noopener">Open {app.secretName} in Secret Manager <ExternalLink className="h-3.5 w-3.5 ml-1.5" /></a></Button>}
            <p className={cn('text-xs', app.tokenStore.write ? 'text-muted-foreground' : 'text-destructive')}>
              {app.tokenStore.write ? <>Connection store <code>{app.tokenSecret}</code> is ready.</>
                : !app.tokenStore.exists ? <>The connection store <code>{app.tokenSecret}</code> doesn’t exist in {app.project} yet — it needs creating, with Secret Accessor and Secret Version Adder for the App Hosting account.</>
                : <>This server can’t save to <code>{app.tokenSecret}</code> — grant the App Hosting account Secret Version Adder on it.</>}
            </p>
          </Step>

          <Step n={3} done={conn ? conn.connected : null} tone={conn && !conn.connected ? 'bad' : undefined} title={<>Connect <span className="inline-flex items-center gap-1"><Facebook className="h-4 w-4" /> Facebook</span></>}>
            {conn ? (
              <>
                <p>{conn.connected ? <>Connected{conn.userName ? <> as <b>{conn.userName}</b></> : null}{conn.kind === 'system' ? ' (a system user — never expires)' : ''}.</> : <span className="text-destructive">{conn.error || 'The connection is no longer valid.'}</span>}
                  {conn.connected && conn.kind === 'user' && conn.daysLeft !== null && <span className={cn('block text-xs', conn.daysLeft <= 10 ? 'text-warning' : 'text-muted-foreground')}>Good for {conn.daysLeft} more day{conn.daysLeft === 1 ? '' : 's'} — connect again before then (running ads are never affected).</span>}
                </p>
                {conn.missingScopes.length > 0 && <p className="text-xs text-warning flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Not approved: {conn.missingScopes.join(', ')}. Connect again and leave them ticked{conn.missingScopes.some(s => s.startsWith('pages')) ? ' — without the Page permissions new ads can’t be made' : ''}.</p>}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={connect} disabled={!!busy || !app.secret} variant={conn.connected ? 'outline' : 'default'} className="h-10">{busy === 'connect' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Facebook className="h-4 w-4 mr-1.5" />} {conn.connected ? 'Connect again' : 'Reconnect'}</Button>
                  <Button variant="ghost" className="h-10 text-muted-foreground" onClick={() => setConfirmOff(true)} disabled={!!busy}><Unplug className="h-4 w-4 mr-1.5" /> Disconnect</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">Log in to Facebook as the person who runs {STORE_CONFIG.name}’s ads and approve. The login is kept in this project’s Secret Manager, never in the database.</p>
                <Button onClick={connect} disabled={!!busy || !app.secret || !app.id} className="h-11 w-full sm:w-auto">{busy === 'connect' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Facebook className="h-4 w-4 mr-1.5" />} Connect Meta ads</Button>
                {!app.secret && <p className="text-xs text-muted-foreground">Step 2 first.</p>}
                <p className="text-xs text-muted-foreground">Rather never reconnect? A <b>system user</b> token from Business Settings → Users → System users (with ads_management, ads_read, pages_manage_ads, business_management) never expires — paste it as a new version of <a className="text-primary" href={app.tokenStoreUrl} target="_blank" rel="noopener">{app.tokenSecret}</a> and press Check again.</p>
              </>
            )}
            {status?.connectionError && <p className="text-xs text-destructive">{status.connectionError}</p>}
          </Step>

          <Step n={4} done={connected ? !!settings?.adAccountId : null} title={<><Megaphone className="h-4 w-4" /> The ad account</>}>
            {!connected ? <p className="text-muted-foreground">After connecting.</p> : assetsError ? <ErrorLine error={assetsError} onRetry={loadAssets} /> : !assets ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading what the login can see…</p> : (
              assets.accounts.length ? (
                <div className="grid gap-2">
                  {assets.accounts.map(a => {
                    const on = settings?.adAccountId === a.id;
                    const st = ACCOUNT_STATUS[a.status];
                    return (
                      <button key={a.id} type="button" disabled={!!busy || status?.pinnedAccount} onClick={() => save({ adAccountId: a.id, adAccountName: a.name }, 'account')}
                        className={cn('flex items-center gap-3 rounded-lg border p-3 text-left', on ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50')}>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium truncate">{a.name}</span>
                          <span className="block text-xs text-muted-foreground">{[a.business, `act ${a.id}`, a.currency, st && st.label !== 'Active' ? st.label : ''].filter(Boolean).join(' · ')}</span>
                        </span>
                        {on && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                  {status?.pinnedAccount && <p className="text-xs text-muted-foreground">Fixed for this shop by META_AD_ACCOUNT_ID.</p>}
                </div>
              ) : <p className="text-destructive">This login can’t see any ad account. In Meta Business Settings → Accounts → Ad accounts, give this person access to {STORE_CONFIG.name}’s ad account, then Check again.</p>
            )}
          </Step>

          <Step n={5} done={connected ? !!settings?.instagramUserId && !wrongHouse : null} tone={wrongHouse ? 'bad' : undefined} title={<><Instagram className="h-4 w-4" /> Instagram{house ? <> — @{house}</> : null}</>}>
            {!connected || !assets ? <p className="text-muted-foreground">After connecting.</p> : assets.instagram.length ? (
              <div className="grid gap-2">
                {assets.instagram.map(i => {
                  const on = settings?.instagramUserId === i.id;
                  const page = i.pageId ? assets.pages.find(p => p.id === i.pageId) : null;
                  return (
                    <button key={i.id} type="button" disabled={!!busy} onClick={() => save({ instagramUserId: i.id, instagramUsername: i.username, ...(page ? { pageId: page.id, pageName: page.name } : {}) }, 'ig')}
                      className={cn('flex items-center gap-3 rounded-lg border p-3 text-left', on ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50')}>
                      {i.picture ? <img src={i.picture} alt="" className="h-9 w-9 rounded-full object-cover" /> : <Instagram className="h-9 w-9 p-2 rounded-full bg-muted" />}
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium truncate">@{i.username || i.id}</span>
                        <span className="block text-xs text-muted-foreground">{page ? `Linked to the Page “${page.name}”` : i.via === 'ad account' ? 'Added to the ad account' : 'Business account'}{house && i.username.toLowerCase() !== house ? ' · not this shop’s' : ''}</span>
                      </span>
                      {on && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                  );
                })}
                {wrongHouse && <p className="text-xs text-destructive">This shop is @{house}; ads made here would appear as @{settings?.instagramUsername}.</p>}
              </div>
            ) : (
              <p className="text-muted-foreground">No Instagram account is linked to a Page or the ad account yet. Existing ads still show here; to make new ones, link {house ? `@${house}` : 'the shop’s Instagram'} to a Facebook Page (step 6).</p>
            )}
          </Step>

          <Step n={6} done={connected && assets ? !!settings?.pageId : null} title={<><Facebook className="h-4 w-4" /> The Facebook Page behind new ads</>}>
            {!connected || !assets ? <p className="text-muted-foreground">After connecting.</p> : (
              <>
                <p className="text-muted-foreground">Meta runs every new ad through a Facebook Page, even an Instagram-only one (the Page doesn’t show on Instagram). Viewing and running existing ads needs none.</p>
                {assets.pages.length ? (
                  <div className="grid gap-2">
                    {assets.pages.map(p => {
                      const on = settings?.pageId === p.id;
                      return (
                        <button key={p.id} type="button" disabled={!!busy} onClick={() => save({ pageId: p.id, pageName: p.name }, 'page')}
                          className={cn('flex items-center gap-3 rounded-lg border p-3 text-left', on ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50')}>
                          {p.picture ? <img src={p.picture} alt="" className="h-9 w-9 rounded-md object-cover" /> : <Facebook className="h-9 w-9 p-2 rounded-md bg-muted" />}
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium truncate">{p.name}</span>
                            <span className="block text-xs text-muted-foreground">{[p.instagram ? `@${p.instagram.username}` : 'no Instagram linked', p.whatsapp ? `WhatsApp ${p.whatsapp}` : 'no WhatsApp linked', p.canAdvertise ? '' : 'can’t advertise'].filter(Boolean).join(' · ')}</span>
                          </span>
                          {on && <Check className="h-4 w-4 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 space-y-1.5">
                    <p className="font-medium">No Facebook Page yet.</p>
                    <p className="text-muted-foreground">Create one for {STORE_CONFIG.name} at <a className="text-primary" href="https://www.facebook.com/pages/create" target="_blank" rel="noopener">facebook.com/pages/create</a>, then in the Page’s <b>Settings → Linked accounts</b> link {house ? `@${house}` : 'the shop’s Instagram'} (and WhatsApp, for chat ads). Instagram stories keep posting exactly as now. Then Check again.</p>
                  </div>
                )}
                {chosenIg && chosenPage && chosenIg.pageId && chosenIg.pageId !== chosenPage.id && <p className="text-xs text-warning">@{chosenIg.username} is linked to another Page — Meta requires that same Page.</p>}
              </>
            )}
          </Step>

          <Step n={7} done={null} title={<><MessageCircle className="h-4 w-4" /> Chat ads (optional)</>}>
            {chosenPage?.whatsapp
              ? <p className="text-muted-foreground">Chat ads open WhatsApp to <b className="text-foreground">{chosenPage.whatsapp}</b> (linked to the Page). The message they start with:</p>
              : <p className="text-muted-foreground">Chat ads to WhatsApp need a WhatsApp number linked to the Page (Page settings → Linked accounts → WhatsApp). Instagram-message ads need nothing more. The message a chat starts with:</p>}
            <Textarea value={greeting} onChange={e => setGreeting(e.target.value)} rows={2} placeholder="Hi! I saw your ad — can you tell me more about this piece?" className="text-sm" />
            <Button size="sm" variant="outline" disabled={!!busy || greeting === (settings?.whatsappGreeting ?? '')} onClick={() => save({ whatsappGreeting: greeting }, 'greeting')}>Save the message</Button>
          </Step>
        </div>
      )}

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Meta ads?</AlertDialogTitle>
            <AlertDialogDescription>The POS forgets the login. Ads already running keep running; the Ads pages show nothing until it’s connected again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOff(false); disconnect(); }}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
