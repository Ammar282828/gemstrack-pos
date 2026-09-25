/**
 * Which ad account, Facebook Page and Instagram account this house advertises
 * from — `app_settings/meta_ads` in this house's own Firestore (Mina's POS has
 * its own). Not secret: ids and names. Chosen on the Setup tab from whatever the
 * connected login can see, and picked automatically when there is only one
 * sensible answer.
 *
 * META_AD_ACCOUNT_ID pins the ad account (the Setup tab then offers no other);
 * META_ADS_INSTAGRAM names the house's own Instagram (collectionstaheri,
 * houseofmina__), so the right one is chosen and the wrong house's is flagged.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { actId, graph, graphAll, MetaAdsError } from './meta';
import { fromMinor, type AdsAccount } from './shape';

const DOC = () => adminDb.collection('app_settings').doc('meta_ads');

export const PINNED_ACCOUNT = () => (process.env.META_AD_ACCOUNT_ID || '').trim().replace(/^act_/, '');
export const HOUSE_INSTAGRAM = () => (process.env.META_ADS_INSTAGRAM || process.env.INSTAGRAM_USERNAME || '').trim().replace(/^@/, '').toLowerCase();

export interface AdsSettings {
  adAccountId: string | null;
  adAccountName: string | null;
  pageId: string | null;
  pageName: string | null;
  instagramUserId: string | null;
  instagramUsername: string | null;
  /** A welcome message pre-filled in WhatsApp when someone taps a chat ad. */
  whatsappGreeting: string | null;
  updatedAt: string | null;
}

const EMPTY: AdsSettings = { adAccountId: null, adAccountName: null, pageId: null, pageName: null, instagramUserId: null, instagramUsername: null, whatsappGreeting: null, updatedAt: null };

export async function loadAdsSettings(): Promise<AdsSettings> {
  const snap = await DOC().get();
  const s = { ...EMPTY, ...(snap.exists ? (snap.data() as Partial<AdsSettings>) : {}) };
  if (PINNED_ACCOUNT()) s.adAccountId = PINNED_ACCOUNT();
  return s;
}

export async function saveAdsSettings(patch: Partial<AdsSettings>): Promise<AdsSettings> {
  const clean: Partial<AdsSettings> = {};
  for (const k of Object.keys(EMPTY) as (keyof AdsSettings)[]) if (k in patch) (clean as Record<string, unknown>)[k] = patch[k] ?? null;
  if (PINNED_ACCOUNT()) delete clean.adAccountId;
  await DOC().set({ ...clean, updatedAt: new Date().toISOString() }, { merge: true });
  return loadAdsSettings();
}

/** The chosen ad account as "act_…", or a clear error for the page. */
export async function requireAccount(): Promise<{ act: string; settings: AdsSettings }> {
  const settings = await loadAdsSettings();
  if (!settings.adAccountId) throw new MetaAdsError('Choose the ad account for this shop on the Setup tab first.', 409);
  return { act: actId(settings.adAccountId), settings };
}

// ── What the connected login can see ──────────────────────────────────────

export interface AccountChoice { id: string; name: string; currency: string; status: number; business: string | null }
export interface PageChoice { id: string; name: string; picture: string | null; canAdvertise: boolean; instagram: { id: string; username: string; picture: string | null } | null; whatsapp: string | null }
export interface InstagramChoice { id: string; username: string; picture: string | null; via: 'page' | 'ad account' | 'business'; pageId: string | null }

export async function listAdAccounts(): Promise<AccountChoice[]> {
  const rows = await graphAll<{ account_id: string; name: string; currency: string; account_status: number; business?: { name?: string } }>(
    'me/adaccounts', { fields: 'account_id,name,currency,account_status,business{name}' }, 200);
  return rows.map(r => ({ id: r.account_id, name: r.name, currency: r.currency, status: r.account_status, business: r.business?.name ?? null }));
}

export async function listPages(): Promise<PageChoice[]> {
  const rows = await graphAll<{ id: string; name: string; tasks?: string[]; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }>(
    'me/accounts', { fields: 'id,name,tasks,picture{url},instagram_business_account{id,username,profile_picture_url}' }, 200);
  const pages = rows.map(r => ({
    id: r.id,
    name: r.name,
    picture: r.picture?.data?.url ?? null,
    // No `tasks` (a system user's view) means Meta didn't say; let the create step find out.
    canAdvertise: !r.tasks || r.tasks.includes('ADVERTISE'),
    instagram: r.instagram_business_account ? { id: r.instagram_business_account.id, username: r.instagram_business_account.username ?? '', picture: r.instagram_business_account.profile_picture_url ?? null } : null,
    whatsapp: null as string | null,
  }));
  // The WhatsApp number linked to each Page, for chat ads. Meta only answers for Pages that have one.
  await Promise.all(pages.map(async p => {
    try {
      const d = await graph<{ whatsapp_number?: string }>(p.id, { params: { fields: 'whatsapp_number' }, timeoutMs: 8000 });
      p.whatsapp = d.whatsapp_number || null;
    } catch { /* not linked, or not readable — either way "none" */ }
  }));
  return pages;
}

/** Every Instagram account the ad account may run ads as, from each place Meta keeps them. */
export async function listInstagramAccounts(act: string | null, pages: PageChoice[]): Promise<InstagramChoice[]> {
  const out = new Map<string, InstagramChoice>();
  for (const p of pages) if (p.instagram) out.set(p.instagram.id, { id: p.instagram.id, username: p.instagram.username, picture: p.instagram.picture, via: 'page', pageId: p.id });
  if (act) {
    try {
      const rows = await graphAll<{ id: string; username?: string; profile_picture_url?: string }>(`${actId(act)}/connected_instagram_accounts`, { fields: 'id,username,profile_picture_url' }, 50);
      for (const r of rows) if (!out.has(r.id)) out.set(r.id, { id: r.id, username: r.username ?? '', picture: r.profile_picture_url ?? null, via: 'ad account', pageId: null });
    } catch { /* not every account answers this edge; the Pages' own links above are the main source */ }
  }
  return [...out.values()];
}

export async function accountSummary(act: string): Promise<AdsAccount> {
  const d = await graph<Record<string, unknown>>(actId(act), {
    params: { fields: 'account_id,name,currency,timezone_name,account_status,disable_reason,amount_spent,spend_cap,balance,min_daily_budget,funding_source_details,business{name}' },
  });
  const currency = String(d.currency || 'PKR');
  const cap = Number(d.spend_cap || 0);
  const funding = d.funding_source_details as { display_string?: string } | undefined;
  return {
    id: String(d.account_id || act.replace(/^act_/, '')),
    name: String(d.name || ''),
    currency,
    timezone: String(d.timezone_name || ''),
    status: Number(d.account_status || 0),
    disableReason: Number(d.disable_reason || 0),
    amountSpent: fromMinor(d.amount_spent as string, currency),
    spendCap: cap > 0 ? fromMinor(cap, currency) : null,
    balance: fromMinor(d.balance as string, currency),
    minDailyBudget: d.min_daily_budget ? fromMinor(d.min_daily_budget as string, currency) : null,
    funding: funding?.display_string ?? null,
    businessName: (d.business as { name?: string } | undefined)?.name ?? null,
  };
}

/**
 * Fill in what can be decided without asking: the only ad account, the house's
 * own Instagram (by META_ADS_INSTAGRAM) and the Page it is linked to. Never
 * overwrites a choice already made.
 */
export async function autoChoose(current: AdsSettings, accounts: AccountChoice[], pages: PageChoice[], igs: InstagramChoice[]): Promise<AdsSettings> {
  const patch: Partial<AdsSettings> = {};
  if (!current.adAccountId) {
    const live = accounts.filter(a => a.status === 1);
    const only = accounts.length === 1 ? accounts[0] : live.length === 1 ? live[0] : null;
    if (only) { patch.adAccountId = only.id; patch.adAccountName = only.name; }
  }
  if (!current.instagramUserId) {
    const want = HOUSE_INSTAGRAM();
    const ig = (want ? igs.find(i => i.username.toLowerCase() === want) : null) ?? (igs.length === 1 ? igs[0] : null);
    if (ig) {
      patch.instagramUserId = ig.id; patch.instagramUsername = ig.username;
      const page = ig.pageId ? pages.find(p => p.id === ig.pageId) : null;
      if (page && !current.pageId) { patch.pageId = page.id; patch.pageName = page.name; }
    }
  }
  if (!current.pageId && !patch.pageId && pages.length === 1) { patch.pageId = pages[0].id; patch.pageName = pages[0].name; }
  return Object.keys(patch).length ? saveAdsSettings(patch) : current;
}
