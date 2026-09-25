/**
 * Everything Post a Piece depends on, tested live, each with the fix in words.
 *
 * Run when the page opens and whenever the counter asks. Every check has its
 * own eight-second budget and runs alongside the others, so one slow system
 * never hides the rest; each answers ok / warn / fail / off ("off" = this shop
 * doesn't use it) with a detail line and, when not ok, what to do. The AI
 * check makes one tiny model call, so its answer is kept for ten minutes.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { STORE_CONFIG } from '@/lib/store-config';
import { whatsAppChannelInfo, whatsAppDiagnostics, whatsAppProvider, whatsAppStatus } from '@/lib/whatsapp';
import { loadFeatured } from '@/lib/website/featured';
import { aiConfigured, aiPing, imageModelServed, IMAGE_MODEL } from './ai';
import { instagramConfigured, instagramHealth, tokenStoreAccess } from './instagram';
import { diagnose, type Action } from './diagnose';
import { diagnoseContext, recentErrors, type RecordedError } from './errors';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'off';
export type CheckGroup = 'Website' | 'WhatsApp' | 'Instagram' | 'AI';
export interface Check { id: string; group: CheckGroup; label: string; status: CheckStatus; detail: string; fix?: string; action?: Action }

const TIMEOUT_MS = 8000;
const within = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), TIMEOUT_MS))]);

const site = () => (process.env.WEBSITE_ORIGIN || process.env.NEXT_PUBLIC_STORE_WEBSITE_URL || '').replace(/\/+$/, '');
const siteName = () => site().replace(/^https?:\/\//, '');
const ctx = () => diagnoseContext();

let aiCache: { at: number; checks: Check[] } | null = null;

/** Wrap a check: whatever it throws becomes a failed check with the diagnosis, never a broken panel. */
async function guard(id: string, group: CheckGroup, label: string, where: Parameters<typeof diagnose>[0], run: () => Promise<Omit<Check, 'id' | 'group' | 'label'>>): Promise<Check> {
  try {
    return { id, group, label, ...(await within(run())) };
  } catch (e) {
    const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : undefined;
    // Node's fetch says only "fetch failed"; the reason (ENOTFOUND, ECONNREFUSED, a certificate…) is in its cause.
    const cause = (e as { cause?: { code?: string; hostname?: string } })?.cause;
    const message = `${e instanceof Error ? e.message : String(e)}${cause?.code ? ` (${cause.code}${cause.hostname ? ` ${cause.hostname}` : ''})` : ''}`;
    const d = diagnose(where, { status, message }, ctx());
    return { id, group, label, status: 'fail', detail: message.slice(0, 200), fix: d.fix, action: d.action };
  }
}

// ── Website ────────────────────────────────────────────────────────────────

function websiteChecks(): Promise<Check>[] {
  if (!site()) return [Promise.resolve({ id: 'website', group: 'Website', label: 'Website', status: 'off', detail: 'This shop has no website set (NEXT_PUBLIC_STORE_WEBSITE_URL).' })];
  return [
    guard('website-up', 'Website', `${siteName()} is up`, 'website', async () => {
      const res = await fetch(`${site()}/`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.ok
        ? { status: 'ok', detail: `Answered in time (${res.status}).` }
        : { status: 'fail', detail: `Answered ${res.status}.`, fix: `${siteName()} isn’t loading. Open it in a browser; if it’s down, the host (Hostinger) needs looking at — photos can’t go up until it’s back.`, action: { label: `Open ${siteName()}`, href: site() } };
    }),
    guard('website-key', 'Website', 'Upload key matches the website', 'website', async () => {
      const secret = process.env.WEBSITE_UPLOAD_SECRET;
      if (!secret) return { status: 'fail', detail: 'WEBSITE_UPLOAD_SECRET is not set on the POS.', fix: diagnose('website', { status: 503, message: 'not configured' }, ctx()).fix };
      // An empty upload with the key: the site answers 400 ("rel must be…") when the key is
      // right and 401 when it is wrong — a real test of the key that writes nothing.
      const res = await fetch(`${site()}/api/upload.php`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: new FormData(), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 400) return { status: 'ok', detail: 'The website accepts the POS’s upload key.' };
      const d = diagnose('website', { status: res.status, message: (await res.text()).slice(0, 200) }, ctx());
      return { status: 'fail', detail: `The upload endpoint answered ${res.status}.`, fix: d.fix, action: d.action };
    }),
    guard('featured', 'Website', 'Set of the day can be saved', 'featured', async () => {
      const f = await loadFeatured();
      return { status: 'ok', detail: f ? `Today: ${f.key.split('/').pop()}` : 'Nothing featured right now.' };
    }),
  ];
}

// ── WhatsApp ───────────────────────────────────────────────────────────────

function whatsappChecks(): Promise<Check>[] {
  const community = (process.env.WHATSAPP_COMMUNITY_CHAT_ID || '').trim();
  const channel = (process.env.WHATSAPP_CHANNEL_ID || '').trim();
  // One read of the line serves the checks below: Green API rate-limits its methods,
  // and two reads at once made the second come back empty.
  const diag = whatsAppDiagnostics(community || undefined);
  const gateway = () => (whatsAppProvider() === 'waha' ? 'WAHA' : 'Green API');
  return [
    guard('wa-line', 'WhatsApp', 'WhatsApp line is signed in', 'whatsapp', async () => {
      const s = await whatsAppStatus();
      if (!s.configured) return { status: 'fail', detail: 'No WhatsApp gateway is set (WAHA or Green API).', fix: diagnose('whatsapp', { status: 503, message: 'is not configured' }, ctx()).fix };
      if (s.ok) return { status: 'ok', detail: s.provider === 'waha' ? 'WAHA reports the line as connected (WORKING).' : 'Green API reports the line as authorized.' };
      const d = diagnose('whatsapp', { message: `notAuthorized ${s.state ?? ''} ${s.detail ?? ''}` }, ctx());
      return { status: 'fail', detail: `${gateway()} says the line is “${s.state ?? s.detail ?? 'unknown'}”.`, fix: d.fix, action: d.action };
    }),
    guard('wa-community', 'WhatsApp', 'Can post in the community', 'whatsapp', async () => {
      if (!community) return { status: 'off', detail: 'No community is set for this shop (WHATSAPP_COMMUNITY_CHAT_ID), so the page won’t offer WhatsApp.' };
      const d = await diag;
      if (!d.group) return { status: 'fail', detail: 'The announcements group could not be read.', fix: diagnose('whatsapp', 'chat id not found', ctx()).fix };
      // Both lists are plain digits (whatsAppDiagnostics), whatever id form the gateway uses.
      if (d.phone && !d.group.admins.includes(d.phone)) {
        return { status: 'fail', detail: `+${d.phone} is in “${d.group.name}” but isn’t an admin.`, fix: diagnose('whatsapp', 'not admin', ctx()).fix };
      }
      return { status: 'ok', detail: `“${d.group.name}”, ${d.group.size.toLocaleString()} members; the line is an admin.` };
    }),
    guard('wa-channel', 'WhatsApp', 'Can post in the channel', 'whatsapp', async () => {
      if (!channel) return { status: 'off', detail: 'No WhatsApp channel is set for this shop (WHATSAPP_CHANNEL_ID), so posts go to the community only.' };
      if (whatsAppProvider() !== 'waha') return { status: 'warn', detail: 'A channel is set, but Green API can’t post to channels — it needs WAHA.' };
      const c = await whatsAppChannelInfo(channel);
      if (!c) return { status: 'fail', detail: 'The channel could not be read.', fix: diagnose('whatsapp', 'channel not found', ctx()).fix };
      if (c.role && !/owner|admin/i.test(c.role)) {
        return { status: 'fail', detail: `The line follows “${c.name}” but is ${c.role.toLowerCase()}, not an admin.`, fix: diagnose('whatsapp', 'channel not admin', ctx()).fix };
      }
      return { status: 'ok', detail: `“${c.name}”${c.followers != null ? `, ${c.followers.toLocaleString()} followers` : ''}; the line is ${c.role ? c.role.toLowerCase() : 'an admin'}.` };
    }),
    guard('wa-queue', 'WhatsApp', 'Nothing stuck waiting to send', 'whatsapp', async () => {
      const d = await diag;
      if (d.provider === 'waha') return { status: 'ok', detail: 'WAHA sends straight away — there is no queue to back up.' };
      if (d.queued === null) return { status: 'warn', detail: 'Could not read the send queue.' };
      if (d.queued > 3) return { status: 'warn', detail: `${d.queued} messages are waiting to go out.`, fix: 'The phone with the WhatsApp line may be off or without internet. Make sure it’s on and connected; the queue sends by itself once it is.' };
      return { status: 'ok', detail: d.queued ? `${d.queued} waiting — normal while sending.` : 'Queue is empty.' };
    }),
  ];
}

// ── Instagram ──────────────────────────────────────────────────────────────

function instagramChecks(): Promise<Check>[] {
  if (!process.env.INSTAGRAM_APP_ID && !process.env.INSTAGRAM_APP_SECRET) {
    return [Promise.resolve({ id: 'ig', group: 'Instagram', label: 'Instagram', status: 'off', detail: 'Instagram isn’t set up for this shop; stories are shared by hand.' })];
  }
  // The address Instagram fetches story images from (see mediaOrigin in gate.ts).
  const origin = ((process.env.SOCIAL_MEDIA_ORIGIN || '').trim() || STORE_CONFIG.appUrl || '').replace(/\/+$/, '');
  return [
    guard('ig-config', 'Instagram', 'Instagram app is set up', 'instagram', async () => instagramConfigured()
      ? { status: 'ok', detail: `Instagram app ${process.env.INSTAGRAM_APP_ID}.` }
      : { status: 'fail', detail: 'INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET is missing.', fix: diagnose('instagram', 'not set up for this shop', ctx()).fix }),
    guard('ig-store', 'Instagram', 'POS can keep the Instagram login', 'instagram', async () => {
      const a = await tokenStoreAccess();
      return a.read && a.write
        ? { status: 'ok', detail: 'Can read and renew the saved login.' }
        : { status: 'fail', detail: `Access to the instagram-token secret: read ${a.read ? 'yes' : 'no'}, write ${a.write ? 'yes' : 'no'}.`, fix: diagnose('instagram', 'could not save the instagram connection', ctx()).fix, action: diagnose('instagram', 'could not save the instagram connection', ctx()).action };
    }),
    guard('ig-token', 'Instagram', 'Connected to Instagram', 'instagram', async () => {
      const h = await instagramHealth();
      if (!h) return { status: 'warn', detail: 'Not connected yet.', fix: 'Press Connect Instagram below and approve as the shop’s account.' };
      if (h.daysLeft < 7) return { status: 'warn', detail: `@${h.username}; the login lapses in ${h.daysLeft} day${h.daysLeft === 1 ? '' : 's'}.`, fix: 'Post one story (it renews itself) or press Connect Instagram again.' };
      const q = h.quota ? ` · ${h.quota.used} of ${h.quota.total} API posts used in the last 24 h` : '';
      if (h.quota && h.quota.used >= h.quota.total) return { status: 'fail', detail: `@${h.username}${q}.`, fix: diagnose('instagram', 'content_publishing_limit', ctx()).fix };
      return { status: 'ok', detail: `@${h.username}; renews itself, ${h.daysLeft} days left${q}.` };
    }),
    guard('ig-public', 'Instagram', 'Instagram can reach the POS', 'instagram', async () => {
      if (!origin) return { status: 'warn', detail: 'NEXT_PUBLIC_APP_URL is not set, so the image address Instagram fetches may be wrong.' };
      // A made-up id: the route answers 404 when it is up and public, which is all this needs to know.
      const res = await fetch(`${origin}/api/public/social/health-check-000000000000`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.status === 404
        ? { status: 'ok', detail: `${origin.replace(/^https?:\/\//, '')} answers from outside.` }
        : { status: 'fail', detail: `The public image address answered ${res.status}.`, fix: 'Instagram fetches the story from the POS’s public address, which isn’t answering properly. Until it does, share stories from your phone.' };
    }),
  ];
}

// ── AI ─────────────────────────────────────────────────────────────────────

async function aiChecks(fresh: boolean): Promise<Check[]> {
  if (!aiConfigured()) return [{ id: 'ai', group: 'AI', label: 'AI', status: 'off', detail: 'No AI project is set (IMAGE_AI_PROJECT).' }];
  if (!fresh && aiCache && Date.now() - aiCache.at < 10 * 60_000) return aiCache.checks;
  const checks = await Promise.all([
    guard('ai-access', 'AI', 'AI answers', 'ai', async () => {
      const t = Date.now();
      await aiPing();
      return { status: 'ok', detail: `Vertex AI answered in ${((Date.now() - t) / 1000).toFixed(1)} s (${process.env.IMAGE_AI_PROJECT}).` };
    }),
    guard('ai-model', 'AI', 'Image model is available', 'ai', async () => {
      const served = await imageModelServed();
      if (served === true) return { status: 'ok', detail: `${IMAGE_MODEL} is served.` };
      if (served === 404) return { status: 'fail', detail: `${IMAGE_MODEL} was not found.`, fix: diagnose('ai', { status: 404, message: 'publisher model' }, ctx()).fix };
      // Reading the model card needs a permission the POS doesn't have to have; posting only needs the model to answer.
      return { status: 'ok', detail: `${IMAGE_MODEL} is set (its card couldn’t be read, ${served}; the AI answers check above is what counts).` };
    }),
  ]);
  aiCache = { at: Date.now(), checks };
  return checks;
}

async function aiUsage(): Promise<Check> {
  return guard('ai-usage', 'AI', 'Today’s AI allowance', 'ai', async () => {
    const cap = Number(process.env.IMAGE_AI_DAILY_CAP) || 300;
    const snap = await adminDb.collection('website_ratelimit').doc('post-ai-day__shop').get();
    const d = snap.data() as { count?: number; windowStart?: number } | undefined;
    const used = d && Date.now() - Number(d.windowStart) < 86_400_000 ? Number(d.count) || 0 : 0;
    if (used >= cap) return { status: 'fail', detail: `${used} of ${cap} used.`, fix: diagnose('ai', 'ai limit for now is reached', ctx()).fix };
    if (used >= cap * 0.8) return { status: 'warn', detail: `${used} of ${cap} used today.`, fix: 'Nearly at the daily cap. It resets 24 hours after the first call of the day.' };
    return { status: 'ok', detail: `${used} of ${cap} used today.` };
  });
}

// ── All of it ──────────────────────────────────────────────────────────────

export interface HealthReport { at: string; checks: Check[]; errors: RecordedError[]; summary: { ok: number; warn: number; fail: number } }

export async function runChecks(opts: { freshAi?: boolean } = {}): Promise<HealthReport> {
  const [rest, ai, usage, errors] = await Promise.all([
    Promise.all([...websiteChecks(), ...whatsappChecks(), ...instagramChecks()]),
    aiChecks(!!opts.freshAi),
    aiUsage(),
    recentErrors().catch(() => [] as RecordedError[]),
  ]);
  const checks = [...rest, ...ai, usage];
  return {
    at: new Date().toISOString(),
    checks,
    errors,
    summary: {
      ok: checks.filter(c => c.status === 'ok').length,
      warn: checks.filter(c => c.status === 'warn').length,
      fail: checks.filter(c => c.status === 'fail').length,
    },
  };
}
