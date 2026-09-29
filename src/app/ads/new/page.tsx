'use client';

/**
 * Ads → New ad: from a phone, in the order a shop thinks of it —
 *
 *   1  What to promote   an Instagram post as it is, new photos (one, or a
 *                        carousel of up to ten), or a piece from the website
 *   2  What for          WhatsApp chats, Instagram messages, website visits,
 *                        profile visits, engagement, reach
 *   3  The words         (new photos) what it says, headline, link, button
 *   4  Who               src/app/ads/audience-editor.tsx
 *   5  Budget and dates
 *   6  Preview           Meta's own rendering, feed / story / reels
 *   7  Make it           paused to look over, or live once Meta approves
 *
 * `?piece=<id>` starts from a website piece (Posts → From the website links
 * here); `?studio=<key>` from an ad made in Ads → Studio. The last audience and
 * budget are remembered on this device.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { HANDOFF_PREFIX, type StudioHandoff } from '@/lib/ads/studio/handoff';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AmountInput } from '@/components/ui/amount-input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Rocket, Instagram, ImagePlus, Images, Globe, Loader2, Check, X, ArrowUp, ArrowDown, Eye, MessageCircle, MousePointerClick, UserRound, Heart, Radio, Search, CheckCircle2, AlertTriangle, Film, MessagesSquare, Rss, CalendarX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS, STORE_LINKS, STORE_SITE_POSTS, STORE_AD_STUDIO } from '@/lib/store-config';
import { quietDaysBetween, hijriLabel, karachiDay } from '@/lib/ads/studio/calendar';
import { money } from '@/lib/ads/shape';
import { defaultDraft, type AudienceDraft } from '@/lib/ads/targeting';
import { GOALS, goalOf, isChannelLink, planProblems, planSummary, defaultName, type AdPlan, type GoalKey, type PlanPhoto } from '@/lib/ads/plan';
import { api, useAdsStatus, NotReady, AccountAlerts, ErrorLine } from '../ads-kit';
import { AudienceEditor } from '../audience-editor';

export default function NewAdRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t run Meta ads from the ERP.</p>;
  return <Suspense fallback={null}><NewAd /></Suspense>;
}

interface Media { id: string; caption: string; type: string; thumb: string | null; permalink: string | null; at: string | null; boostable: boolean | null; why: string | null }
interface SitePiece { id: string; name: string; url: string; thumb: string; image: string; collection: string; weightGrams: number | null; facts: string[]; about: string; newArrival: boolean }
interface Photo extends PlanPhoto { local?: string; uploading?: boolean; error?: string; key: string }

const GOAL_ICON: Record<GoalKey, React.ReactNode> = {
  whatsapp: <MessageCircle className="h-5 w-5" />, messages: <MessagesSquare className="h-5 w-5" />, instagram_dm: <Instagram className="h-5 w-5" />, website: <MousePointerClick className="h-5 w-5" />,
  channel: <Rss className="h-5 w-5" />, profile: <UserRound className="h-5 w-5" />, engagement: <Heart className="h-5 w-5" />, reach: <Radio className="h-5 w-5" />,
};
const BUTTONS: { key: AdPlan['button']; label: string }[] = [
  { key: 'SHOP_NOW', label: 'Shop now' }, { key: 'LEARN_MORE', label: 'Learn more' }, { key: 'SEE_MORE', label: 'See more' }, { key: 'ORDER_NOW', label: 'Order now' }, { key: 'CONTACT_US', label: 'Contact us' },
];
const LAST_KEY = 'taheri_ads_last';

function Card({ n, title, children, hint }: { n: number; title: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4 space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground text-xs">{n}</span>{title}</h2>
      {hint && <p className="text-xs text-muted-foreground -mt-2">{hint}</p>}
      {children}
    </section>
  );
}

const localInput = (t: number) => {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const pieceText = (p: SitePiece, goal: GoalKey) =>
  [`${p.name}${p.weightGrams ? ` — ${p.weightGrams}g` : ''}`, p.facts.length ? p.facts.join(' · ') : '', '',
    goal === 'whatsapp' || goal === 'instagram_dm' ? 'Message us for today’s price.' : goal === 'website' ? 'See it on the website.' : ''].filter((l, i) => l || i === 2).join('\n').trim();

function NewAd() {
  const { toast } = useToast();
  const params = useSearchParams();
  const { status, error: statusError, loading: statusLoading, reload, ready } = useAdsStatus();
  const currency = status?.account?.currency ?? 'PKR';

  const [kind, setKind] = useState<'post' | 'photos' | 'site'>('post');
  const [goal, setGoal] = useState<GoalKey>('whatsapp');
  const [post, setPost] = useState<Media | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  /** A 9:16 version of the one photo (from the studio): one ad, each place its own size. */
  const [vertical, setVertical] = useState<PlanPhoto | null>(null);
  const [text, setText] = useState('');
  const [headline, setHeadline] = useState('');
  const [link, setLink] = useState(STORE_LINKS.website || '');
  const [button, setButton] = useState<AdPlan['button']>('SHOP_NOW');
  const [audience, setAudience] = useState<AudienceDraft>(defaultDraft());
  const [budgetKind, setBudgetKind] = useState<'daily' | 'total'>('daily');
  const [amount, setAmount] = useState<number | undefined>(1000);
  const [startLater, setStartLater] = useState(false);
  const [start, setStart] = useState(localInput(Date.now() + 3_600_000));
  const [days, setDays] = useState<number | null>(7);
  const [launch, setLaunch] = useState<'paused' | 'live'>('paused');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [previews, setPreviews] = useState<{ format: string; src: string }[] | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [made, setMade] = useState<{ adId: string; live: boolean; warnings: string[] } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // The last audience and budget, on this device.
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null') as { audience?: AudienceDraft; amount?: number; budgetKind?: 'daily' | 'total'; days?: number | null; goal?: GoalKey } | null;
      if (last?.audience?.places) setAudience({ ...defaultDraft(), ...last.audience });
      if (last?.amount) setAmount(last.amount);
      if (last?.budgetKind) setBudgetKind(last.budgetKind);
      if (last?.days !== undefined) setDays(last.days);
      if (last?.goal && GOALS.some(g => g.key === last.goal)) setGoal(last.goal);
    } catch { /* first time, or private mode */ }
  }, []);

  // ── Source: Instagram posts ──
  const [media, setMedia] = useState<Media[] | null>(null);
  const [mediaAfter, setMediaAfter] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const loadMedia = useCallback(async (after?: string) => {
    setMediaBusy(true); setMediaError(null);
    try {
      const d = await api<{ media: Media[]; after: string | null }>(`/api/ads/media${after ? `?after=${encodeURIComponent(after)}` : ''}`);
      setMedia(m => (after ? [...(m ?? []), ...d.media] : d.media)); setMediaAfter(d.after);
    } catch (e) { setMediaError(e instanceof Error ? e.message : String(e)); }
    finally { setMediaBusy(false); }
  }, []);
  useEffect(() => { if (ready && kind === 'post' && !media && !mediaBusy && !mediaError) loadMedia(); }, [ready, kind, media, mediaBusy, mediaError, loadMedia]);

  // ── Source: new photos ──
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, 10 - photos.length);
    const added: Photo[] = list.map((f, i) => ({ key: `${Date.now()}${i}`, hash: '', local: URL.createObjectURL(f), uploading: true }));
    setPhotos(p => [...p, ...added]);
    await Promise.all(list.map(async (f, i) => {
      const form = new FormData(); form.append('file', f);
      try {
        const d = await api<{ hash: string; url: string | null }>('/api/ads/images', { form });
        setPhotos(p => p.map(x => (x.key === added[i].key ? { ...x, hash: d.hash, url: d.url, uploading: false } : x)));
      } catch (e) {
        setPhotos(p => p.map(x => (x.key === added[i].key ? { ...x, uploading: false, error: e instanceof Error ? e.message : String(e) } : x)));
      }
    }));
  };
  // The ad account's own picture library (Ads Manager's media), to reuse without uploading.
  const [libOpen, setLibOpen] = useState(false);
  const [library, setLibrary] = useState<{ hash: string; url: string; thumb: string; name: string }[] | null>(null);
  const [libAfter, setLibAfter] = useState<string | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const loadLibrary = useCallback(async (after?: string) => {
    setLibError(null);
    try {
      const d = await api<{ images: { hash: string; url: string; thumb: string; name: string }[]; after: string | null }>(`/api/ads/library${after ? `?after=${encodeURIComponent(after)}` : ''}`);
      setLibrary(l => (after ? [...(l ?? []), ...d.images] : d.images)); setLibAfter(d.after);
    } catch (e) { setLibError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (libOpen && !library && !libError) loadLibrary(); }, [libOpen, library, libError, loadLibrary]);
  const move = (i: number, by: number) => setPhotos(p => { const a = [...p]; const [x] = a.splice(i, 1); a.splice(Math.max(0, Math.min(a.length, i + by)), 0, x); return a; });

  // ── Source: a website piece ──
  const hasSite = !!STORE_LINKS.website && STORE_SITE_POSTS;
  const [pieces, setPieces] = useState<SitePiece[] | null>(null);
  const [pieceQ, setPieceQ] = useState('');
  const [piecesError, setPiecesError] = useState<string | null>(null);
  useEffect(() => {
    if (!hasSite || kind !== 'site' || pieces || piecesError) return;
    api<{ pieces: SitePiece[] }>('/api/website/site-pieces').then(d => setPieces(d.pieces)).catch(e => setPiecesError(e instanceof Error ? e.message : String(e)));
  }, [hasSite, kind, pieces, piecesError]);
  const addPiece = async (p: SitePiece) => {
    if (photos.length >= 10) return;
    const key = `piece${p.id}${Date.now()}`;
    setPhotos(ph => [...ph, { key, hash: '', local: p.thumb, uploading: true, headline: p.name, link: p.url }]);
    if (!text.trim()) setText(pieceText(p, goal));
    if (!headline.trim()) setHeadline(p.name);
    if (photos.length === 0) setLink(p.url);
    try {
      const d = await api<{ hash: string; url: string | null }>('/api/ads/images', { body: { pieceId: p.id } });
      setPhotos(ph => ph.map(x => (x.key === key ? { ...x, hash: d.hash, url: d.url, uploading: false } : x)));
    } catch (e) {
      setPhotos(ph => ph.map(x => (x.key === key ? { ...x, uploading: false, error: e instanceof Error ? e.message : String(e) } : x)));
    }
  };
  // ?piece= — start from that piece.
  const pieceParam = params.get('piece');
  const startedFrom = useRef(false);
  // ?from=<ad> — "Make one like this": the same photos or post, words, audience and budget, all still changeable.
  const fromParam = params.get('from');
  useEffect(() => {
    if (!fromParam || startedFrom.current || !ready) return;
    startedFrom.current = true;
    api<{ template: { goal: GoalKey; source: AdPlan['source']; text: string; headline: string; link: string; button: AdPlan['button']; audience: AudienceDraft; budget: { kind: 'daily' | 'total'; amount: number }; name: string } }>(`/api/ads/template?ad=${encodeURIComponent(fromParam)}`)
      .then(({ template: t }) => {
        setGoal(t.goal); setText(t.text); setHeadline(t.headline); if (t.link) setLink(t.link); setButton(t.button);
        setAudience({ ...defaultDraft(), ...t.audience });
        if (t.budget.amount > 0) { setBudgetKind(t.budget.kind); setAmount(t.budget.amount); }
        if (t.source.kind === 'post') {
          setKind('post');
          setPost({ id: t.source.mediaId, caption: t.source.caption ?? '', type: 'IMAGE', thumb: t.source.thumb ?? null, permalink: t.source.permalink ?? null, at: null, boostable: true, why: null });
        } else {
          setKind('photos');
          setPhotos(t.source.photos.map((ph, i) => ({ key: `from${i}${ph.hash}`, hash: ph.hash, url: ph.url ?? null, local: ph.url ?? undefined, headline: ph.headline, link: ph.link })));
        }
        toast({ title: `Started from “${t.name}”`, description: 'Change anything, then make it.' });
      })
      .catch(e => toast({ title: 'Couldn’t copy that ad', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromParam, ready]);
  // ?studio=<key> — an ad made in Ads → Studio: its picture (already in the account's library) and its words.
  const studioParam = params.get('studio');
  useEffect(() => {
    if (!studioParam || startedFrom.current) return;
    startedFrom.current = true;
    try {
      const h = JSON.parse(sessionStorage.getItem(HANDOFF_PREFIX + studioParam) || 'null') as StudioHandoff | null;
      if (!h?.photos?.length) return;
      setKind('photos'); setGoal(GOALS.some(g => g.key === h.goal) ? h.goal : 'whatsapp');
      setPhotos(h.photos.map((ph, i) => ({ key: `studio${i}${ph.hash}`, hash: ph.hash, url: ph.url ?? null, local: ph.url ?? undefined, headline: ph.headline, link: ph.link })));
      if (h.vertical?.hash) setVertical({ hash: h.vertical.hash, url: h.vertical.url });
      if (h.link) setLink(h.link);
      if (h.text) setText(h.text);
      if (h.headline) setHeadline(h.headline);
      if (h.name) { setName(h.name); setNameTouched(true); }
      toast({ title: 'From the studio', description: 'The picture and the words are in — choose who sees it and the budget.' });
    } catch { /* an old or foreign link: start blank */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioParam]);
  useEffect(() => {
    if (!pieceParam || startedFrom.current || !ready || !hasSite) return;
    startedFrom.current = true;
    setKind('site');
    api<{ pieces: SitePiece[] }>('/api/website/site-pieces').then(d => {
      setPieces(d.pieces);
      const p = d.pieces.find(x => x.id === pieceParam);
      if (p) addPiece(p);
    }).catch(e => setPiecesError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceParam, ready, hasSite]);
  const shownPieces = useMemo(() => {
    const words = pieceQ.toLowerCase().split(/\s+/).filter(Boolean);
    const list = (pieces ?? []).filter(p => words.every(w => `${p.name} ${p.collection} ${p.facts.join(' ')}`.toLowerCase().includes(w)));
    return (words.length ? list : [...list.filter(p => p.newArrival), ...list.filter(p => !p.newArrival)]).slice(0, 30);
  }, [pieces, pieceQ]);

  // ── The plan ──
  const usingPost = kind === 'post';
  const goals = GOALS.filter(g => (usingPost ? !g.photosOnly : !g.postOnly) && (g.key !== 'channel' || !!STORE_LINKS.waChannel));
  useEffect(() => { if ((!usingPost && goalOf(goal).postOnly) || (usingPost && goalOf(goal).photosOnly)) setGoal('whatsapp'); }, [usingPost, goal]);
  // The channel goal opens the shop's own channel.
  useEffect(() => { if (goal === 'channel' && !isChannelLink(link) && STORE_LINKS.waChannel) setLink(STORE_LINKS.waChannel); }, [goal]); // eslint-disable-line react-hooks/exhaustive-deps
  // One photo only for a story-size partner.
  useEffect(() => { if (vertical && (usingPost || photos.length > 1)) setVertical(null); }, [vertical, usingPost, photos.length]);
  const startIso = startLater ? new Date(start).toISOString() : null;
  const endIso = days ? new Date((startLater ? Date.parse(start) : Date.now()) + days * 86_400_000).toISOString() : null;
  const readyPhotos = photos.filter(p => p.hash && !p.error);
  const plan: AdPlan = useMemo(() => {
    const source: AdPlan['source'] = usingPost
      ? { kind: 'post', mediaId: post?.id ?? '', permalink: post?.permalink ?? undefined, thumb: post?.thumb, caption: post?.caption }
      : { kind: 'photos', photos: readyPhotos.map(({ hash, url, headline: h, link: l }) => ({ hash, url, headline: h, link: l })), vertical };
    const p: AdPlan = {
      goal, source, text, headline, link, button, audience,
      budget: { kind: budgetKind, amount: amount ?? 0, start: startIso, end: endIso },
      launch, name: '',
    };
    return { ...p, name: nameTouched && name.trim() ? name.trim() : defaultName(p) };
  }, [usingPost, post, readyPhotos, vertical, goal, text, headline, link, button, audience, budgetKind, amount, startIso, endIso, launch, name, nameTouched]);
  // The days it would run through that the house keeps free of product ads (Taheri's Bohra calendar).
  const quiet = useMemo(() => {
    if (!STORE_AD_STUDIO) return [];
    const from = karachiDay(startIso ? new Date(startIso) : new Date());
    const to = karachiDay(new Date(endIso ? Date.parse(endIso) : Date.now() + 30 * 86_400_000));
    return quietDaysBetween(from, to).filter(d => d.level === 'sacred' || d.level === 'near');
  }, [startIso, endIso]);
  const ctx = {
    pageId: status?.settings?.pageId ?? null, instagramUserId: status?.settings?.instagramUserId ?? null,
    instagramUsername: status?.settings?.instagramUsername ?? null, whatsappGreeting: status?.settings?.whatsappGreeting ?? null,
    currency, minDaily: status?.account?.minDailyBudget ?? null,
  };
  const problems = planProblems(plan, ctx);
  const stillUploading = photos.some(p => p.uploading);

  // The preview goes stale when the ad changes.
  const previewKey = JSON.stringify([plan.goal, plan.source, plan.text, plan.headline, plan.link, plan.button]);
  useEffect(() => { setPreviews(null); setPreviewError(null); }, [previewKey]);
  const preview = async () => {
    setPreviewBusy(true); setPreviewError(null);
    try { const d = await api<{ previews: { format: string; src: string }[] }>('/api/ads/preview', { body: { plan } }); setPreviews(d.previews); setPreviewTab(0); }
    catch (e) { setPreviewError(e instanceof Error ? e.message : String(e)); }
    finally { setPreviewBusy(false); }
  };

  const send = async () => {
    setSending(true); setSendError(null);
    try {
      const d = await api<{ adId: string; live: boolean; warnings: string[] }>('/api/ads/create', { body: { plan } });
      setMade(d);
      try { localStorage.setItem(LAST_KEY, JSON.stringify({ audience, amount, budgetKind, days, goal })); } catch { /* private mode */ }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
      toast({ title: 'The ad wasn’t made', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setSending(false); }
  };
  const again = () => {
    setMade(null); setPost(null); setPhotos([]); setText(''); setHeadline(''); setPreviews(null); setName(''); setNameTouched(false); setSendError(null);
    window.scrollTo({ top: 0 });
  };

  const summary = planSummary(plan, currency);

  return (
    <PageShell title="New ad" icon={<Rocket className="h-7 w-7" />} width="narrow" subtitle={status?.settings?.instagramUsername ? `As @${status.settings.instagramUsername}` : undefined}>
      {!ready ? <NotReady status={status} error={statusError} loading={statusLoading} onRetry={reload} /> : made ? (
        <div className="rounded-xl border p-6 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 mx-auto text-success" />
          <p className="text-lg font-semibold">{made.live ? 'The ad is on its way' : 'The ad is made — paused'}</p>
          <p className="text-sm text-muted-foreground">{made.live ? 'Meta reviews every ad first (usually within the hour); it starts as soon as it is approved.' : 'Nothing is spent until you switch it on in Campaigns.'}</p>
          {made.warnings.map((w, i) => <p key={i} className="text-xs text-warning">{w}</p>)}
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button asChild className="h-11"><Link href={`/ads/campaigns?ad=${made.adId}`}>See it in Campaigns</Link></Button>
            <Button variant="outline" className="h-11" onClick={again}>Make another</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {status && <AccountAlerts status={status} />}

          <Card n={1} title="What to promote">
            <div className="grid grid-cols-3 gap-1.5">
              {([['post', 'A post', <Instagram key="i" className="h-4 w-4" />], ['photos', 'New photos', <ImagePlus key="p" className="h-4 w-4" />], ...(hasSite ? [['site', 'Website piece', <Globe key="g" className="h-4 w-4" />]] : [])] as [typeof kind, string, React.ReactNode][]).map(([k, label, icon]) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={cn('flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs', kind === k ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground')}>{icon}{label}</button>
              ))}
            </div>

            {kind === 'post' && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">The post runs as it is — its photo, caption, likes and comments. Tap one.</p>
                {mediaError && <ErrorLine error={mediaError} onRetry={() => loadMedia()} />}
                {!media && mediaBusy && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading Instagram…</p>}
                {media && (
                  <ul className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                    {media.map(m => {
                      const on = post?.id === m.id;
                      return (
                        <li key={m.id}>
                          <button type="button" onClick={() => setPost(on ? null : m)} disabled={m.boostable === false} title={m.why ?? undefined}
                            className={cn('relative block w-full aspect-square overflow-hidden rounded-md bg-muted', on && 'ring-2 ring-primary', m.boostable === false && 'opacity-40')}>
                            {m.thumb ? <img src={m.thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Film className="h-6 w-6 m-auto text-muted-foreground" />}
                            {m.type !== 'IMAGE' && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{m.type === 'REEL' ? 'Reel' : m.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Video'}</span>}
                            {on && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="h-3 w-3" /></span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {mediaAfter && <Button variant="outline" size="sm" className="w-full" disabled={mediaBusy} onClick={() => loadMedia(mediaAfter)}>{mediaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Older posts'}</Button>}
                {post && <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line rounded-md bg-muted/50 p-2">{post.caption || 'No caption.'}</p>}
              </div>
            )}

            {kind === 'site' && (
              <div className="space-y-2">
                {piecesError && <ErrorLine error={piecesError} />}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={pieceQ} onChange={e => setPieceQ(e.target.value)} placeholder="Search the website — ruby, kara, jhumka…" className="h-10 pl-9 text-base sm:text-sm" />
                </div>
                {!pieces && !piecesError && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading the website…</p>}
                <ul className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 max-h-80 overflow-y-auto">
                  {shownPieces.map(p => (
                    <li key={p.id}><button type="button" onClick={() => addPiece(p)} disabled={photos.length >= 10} className="block w-full text-left rounded-md border overflow-hidden hover:border-primary/60">
                      <img src={p.thumb} alt="" loading="lazy" className="aspect-square w-full object-cover bg-muted" />
                      <span className="block px-1.5 py-1 text-[10px] leading-tight line-clamp-2">{p.name}</span>
                    </button></li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">Each piece is added as a photo below (several make a carousel), with its own link.</p>
              </div>
            )}

            {kind !== 'post' && (
              <div className="space-y-2">
                {photos.length > 0 && (
                  <ul className="space-y-1.5">
                    {photos.map((p, i) => (
                      <li key={p.key} className="flex items-center gap-2 rounded-lg border p-1.5">
                        <img src={p.url || p.local} alt="" className="h-14 w-14 rounded-md object-cover bg-muted shrink-0" />
                        <div className="min-w-0 flex-1 space-y-1">
                          {p.uploading ? <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Sending to Meta…</span>
                            : p.error ? <span className="text-xs text-destructive">{p.error}</span>
                            : photos.length > 1 ? <Input value={p.headline ?? ''} onChange={e => setPhotos(ph => ph.map(x => (x.key === p.key ? { ...x, headline: e.target.value } : x)))} placeholder="Card headline" className="h-8 text-base sm:text-xs" />
                            : <span className="text-xs text-muted-foreground">Ready</span>}
                          {photos.length > 1 && goal === 'website' && !p.uploading && !p.error && <Input value={p.link ?? ''} onChange={e => setPhotos(ph => ph.map(x => (x.key === p.key ? { ...x, link: e.target.value } : x)))} placeholder="Card link (optional)" className="h-8 text-base sm:text-xs" />}
                        </div>
                        {photos.length > 1 && <div className="flex flex-col"><button type="button" className="p-1 min-h-0 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" className="p-1 min-h-0 disabled:opacity-30" disabled={i === photos.length - 1} onClick={() => move(i, 1)} aria-label="Down"><ArrowDown className="h-3.5 w-3.5" /></button></div>}
                        <button type="button" className="p-1.5 min-h-0 text-muted-foreground" onClick={() => setPhotos(ph => ph.filter(x => x.key !== p.key))} aria-label="Remove"><X className="h-4 w-4" /></button>
                      </li>
                    ))}
                  </ul>
                )}
                {kind === 'photos' && photos.length < 10 && (
                  <>
                    <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={e => { upload(e.target.files); e.target.value = ''; }} />
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" className="h-11" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4 mr-1.5" /> {photos.length ? 'Add more' : 'From this phone'}</Button>
                      <Button variant={libOpen ? 'secondary' : 'outline'} className="h-11" onClick={() => setLibOpen(o => !o)}><Images className="h-4 w-4 mr-1.5" /> Ad account photos</Button>
                    </div>
                    {libOpen && (
                      <div className="rounded-lg border p-2 space-y-2">
                        <p className="text-[11px] text-muted-foreground">Every picture in this ad account’s Ads Manager library — tap to use it again.</p>
                        {libError && <ErrorLine error={libError} onRetry={() => loadLibrary()} />}
                        {!library && !libError && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading the library…</p>}
                        {library && !library.length && <p className="text-sm text-muted-foreground">The library is empty so far.</p>}
                        <ul className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-72 overflow-y-auto">
                          {(library ?? []).map(img => {
                            const used = photos.some(p => p.hash === img.hash);
                            return (
                              <li key={img.hash}><button type="button" disabled={used || photos.length >= 10} onClick={() => setPhotos(ph => [...ph, { key: `lib${img.hash}`, hash: img.hash, url: img.url, local: img.thumb }])}
                                className={cn('relative block w-full aspect-square overflow-hidden rounded-md bg-muted min-h-0', used && 'ring-2 ring-primary')} title={img.name}>
                                <img src={img.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                                {used && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="h-3 w-3" /></span>}
                              </button></li>
                            );
                          })}
                        </ul>
                        {libAfter && <Button variant="ghost" size="sm" className="w-full" onClick={() => loadLibrary(libAfter)}>More</Button>}
                      </div>
                    )}
                  </>
                )}
                {vertical && photos.length === 1 && (
                  <div className="flex items-center gap-2 rounded-lg border p-2 text-xs">
                    {vertical.url && <img src={vertical.url} alt="" className="h-14 w-8 rounded object-cover" />}
                    <span className="flex-1">With its 9:16 version for stories, reels and WhatsApp Status — one ad, each place its own size.</span>
                    <button type="button" className="p-1.5 min-h-0 text-muted-foreground" onClick={() => setVertical(null)} aria-label="Drop the story size"><X className="h-4 w-4" /></button>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">{photos.length > 1 ? `${photos.length} photos make a carousel, in this order.` : 'One photo, or up to ten for a carousel.'} Meta is told not to retouch, crop, animate or re-word anything.</p>
              </div>
            )}
          </Card>

          <Card n={2} title="What it’s for">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {goals.map(g => (
                <button key={g.key} type="button" onClick={() => setGoal(g.key)} className={cn('flex items-start gap-3 rounded-lg border p-3 text-left', goal === g.key ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50')}>
                  <span className={cn('mt-0.5', goal === g.key ? 'text-primary' : 'text-muted-foreground')}>{GOAL_ICON[g.key]}</span>
                  <span><span className="block text-sm font-medium">{g.label}</span><span className="block text-xs text-muted-foreground">{g.hint}</span></span>
                </button>
              ))}
            </div>
            {(goal === 'whatsapp' || goal === 'messages') && <p className="text-[11px] text-muted-foreground">Needs a WhatsApp number linked to the Facebook Page. The chat opens with {status?.settings?.whatsappGreeting ? 'the message set on the Setup tab' : 'a hello'} and three tap-to-ask questions.{goal === 'messages' ? ' Someone who lives in Instagram gets Instagram Direct instead — answer both.' : ''}</p>}
            {goal === 'channel' && <p className="text-[11px] text-muted-foreground">Meta has no “follow a channel” goal yet, so this is a link ad to the channel — it buys taps on the link; follows show in WhatsApp, not here.</p>}
          </Card>

          {!usingPost && (
            <Card n={3} title="The words">
              <Textarea value={text} onChange={e => setText(e.target.value)} rows={5} placeholder="What the ad says — the piece, its weight, why it’s special." className="text-base sm:text-sm" />
              <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Headline (short)" className="h-10 text-base sm:text-sm" />
              {goal === 'channel' && (
                <Input value={link} onChange={e => setLink(e.target.value)} placeholder="https://whatsapp.com/channel/…" inputMode="url" className="h-10 text-base sm:text-sm" />
              )}
              {goal === 'website' && (
                <>
                  <Input value={link} onChange={e => setLink(e.target.value)} placeholder="https://… — the page the button opens" inputMode="url" className="h-10 text-base sm:text-sm" />
                  <div className="flex flex-wrap gap-1.5">
                    {BUTTONS.map(b => <button key={b.key} type="button" onClick={() => setButton(b.key)} className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', button === b.key ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>{b.label}</button>)}
                  </div>
                </>
              )}
            </Card>
          )}

          <Card n={usingPost ? 3 : 4} title="Who sees it">
            <AudienceEditor draft={audience} onChange={setAudience} goal={goalOf(goal).optimization} currency={currency} />
          </Card>

          <Card n={usingPost ? 4 : 5} title="Budget and dates">
            <div className="inline-flex rounded-full border p-0.5 text-xs">
              {(['daily', 'total'] as const).map(k => <button key={k} type="button" onClick={() => { setBudgetKind(k); if (k === 'total' && !days) setDays(7); }} className={cn('rounded-full px-3 py-1.5 min-h-0', budgetKind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{k === 'daily' ? 'Per day' : 'In total'}</button>)}
            </div>
            <div className="flex items-center gap-2">
              <AmountInput value={amount} onValueChange={setAmount} className="h-12 text-lg tabular-nums max-w-[12rem]" aria-label="Budget" />
              <span className="text-sm text-muted-foreground">{currency}{budgetKind === 'daily' ? ' a day' : ' in total'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(budgetKind === 'daily' ? [500, 1000, 2000, 3000, 5000] : [3000, 5000, 10000, 20000, 50000]).map(v => <button key={v} type="button" onClick={() => setAmount(v)} className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', amount === v ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>{money(v, currency)}</button>)}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How long</p>
              <div className="flex flex-wrap gap-1.5">
                {[3, 7, 14, 30].map(d => <button key={d} type="button" onClick={() => setDays(d)} className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', days === d ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>{d} days</button>)}
                {budgetKind === 'daily' && <button type="button" onClick={() => setDays(null)} className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', days === null ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>Until I stop it</button>}
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={startLater} onChange={e => setStartLater(e.target.checked)} className="h-4 w-4" /> Start later
              </label>
              {startLater && <Input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} min={localInput(Date.now())} className="h-10 max-w-xs" />}
            </div>
            {quiet.length > 0 && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-2.5 text-xs space-y-0.5">
                <p className="font-semibold flex items-center gap-1.5"><CalendarX className="h-4 w-4" /> {days ? 'It would run through days the house keeps free of product ads' : 'Left running, it would reach days the house keeps free of product ads'}:</p>
                {quiet.slice(0, 6).map(d => <p key={d.date}>{d.date} · {hijriLabel(d.hijri)} — {d.observance?.name}{d.level === 'near' ? ' (the days before)' : ''}</p>)}
                {quiet.length > 6 && <p>…and {quiet.length - 6} more.</p>}
                <p className="text-muted-foreground">End it before, or start after. Ads → Studio → Guide has the calendar.</p>
              </div>
            )}
            {amount ? <p className="text-xs text-muted-foreground">{budgetKind === 'daily'
              ? days ? <>At most about <b className="text-foreground">{money(amount * days, currency)}</b> over {days} days (Meta may spend a little more on a good day and less on others).</> : <>About <b className="text-foreground">{money(amount * 30, currency)}</b> a month until it’s paused.</>
              : <>About <b className="text-foreground">{money(amount / (days || 1), currency)}</b> a day over {days} days.</>}</p> : null}
          </Card>

          <Card n={usingPost ? 5 : 6} title="Preview">
            {!previews ? (
              <Button variant="outline" className="w-full h-11" disabled={previewBusy || (usingPost ? !post : !readyPhotos.length)} onClick={preview}>{previewBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />} See it as Instagram will show it</Button>
            ) : previews.length ? (
              <>
                <div className="inline-flex rounded-full border p-0.5 text-xs">
                  {previews.map((p, i) => <button key={p.format} type="button" onClick={() => setPreviewTab(i)} className={cn('rounded-full px-3 py-1.5 min-h-0', previewTab === i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{p.format === 'INSTAGRAM_STANDARD' ? 'Feed' : p.format === 'INSTAGRAM_STORY' ? 'Story' : 'Reels'}</button>)}
                </div>
                <iframe key={previews[previewTab].src} src={previews[previewTab].src} title="Preview" className="w-full h-[600px] rounded-lg border bg-white" sandbox="allow-scripts allow-same-origin allow-popups" />
              </>
            ) : <p className="text-sm text-muted-foreground">Meta gave no preview.</p>}
            {previewError && <ErrorLine error={previewError} />}
          </Card>

          <Card n={usingPost ? 6 : 7} title="Make it">
            <Input value={nameTouched ? name : plan.name} onChange={e => { setName(e.target.value); setNameTouched(true); }} className="h-10 text-base sm:text-sm" aria-label="Name in Ads Manager" />
            <div className="grid grid-cols-2 gap-1.5">
              {(['paused', 'live'] as const).map(l => (
                <button key={l} type="button" onClick={() => setLaunch(l)} className={cn('rounded-lg border p-3 text-left', launch === l ? 'border-primary ring-1 ring-primary' : '')}>
                  <span className="block text-sm font-medium">{l === 'paused' ? 'Save it paused' : 'Put it live'}</span>
                  <span className="block text-[11px] text-muted-foreground">{l === 'paused' ? 'Look it over in Campaigns, switch it on there.' : 'Starts once Meta approves it.'}</span>
                </button>
              ))}
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5 rounded-lg bg-muted/40 p-3">{summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
            {problems.length > 0 && (
              <ul className="text-xs space-y-1">{problems.map((p, i) => <li key={i} className="flex gap-1.5 text-warning"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{p}{/Setup/.test(p) && <Link href="/ads/setup" className="text-primary shrink-0">Setup →</Link>}</li>)}</ul>
            )}
            {sendError && <ErrorLine error={sendError} />}
            <Button className="w-full h-12 text-base" disabled={!!problems.length || stillUploading || sending} onClick={() => setConfirm(true)}>
              {sending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Rocket className="h-5 w-5 mr-2" />} {launch === 'live' ? 'Make the ad and put it live' : 'Make the ad (paused)'}
            </Button>
          </Card>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{launch === 'live' ? 'Put this ad live?' : 'Make this ad?'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="text-sm space-y-1">{summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(false); send(); }}>{launch === 'live' ? 'Put it live' : 'Make it'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
