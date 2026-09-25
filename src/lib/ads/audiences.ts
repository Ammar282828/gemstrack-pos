/**
 * This house's Meta audiences: the ones in the ad account, and three kinds the
 * POS makes —
 *
 *   customers   the POS's own customer book (a segment of it), hashed here with
 *               SHA-256 before anything is sent; Meta matches the hashes to
 *               accounts and never receives a readable phone or email
 *   engagers    everyone who engaged with the house's Instagram in the last N days
 *   lookalike   people like one of the above, in a country, 1–10%
 *
 * Every audience is checked to be this house's before it is changed or deleted.
 *
 * Server-only.
 */

import { createHash } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { actId, graph, graphAll, MetaAdsError } from './meta';
import { customerRows, SCHEMA, type Segment, type CustomerLike, type InvoiceLike } from './audience-rows';

export interface Audience {
  id: string; name: string; kind: string; description: string | null;
  size: [number, number] | null; ready: boolean; status: string | null;
  created: string | null; retentionDays: number | null;
}

const KIND: Record<string, string> = {
  CUSTOM: 'Customer list', LOOKALIKE: 'Lookalike', ENGAGEMENT: 'Instagram / Facebook engagers', WEBSITE: 'Website visitors',
  IG_BUSINESS: 'Instagram engagers', VIDEO: 'Video viewers', APP: 'App users', OFFLINE_CONVERSION: 'Offline', CLAIM: 'Claim', PARTNER: 'Partner',
};

export async function listAudiences(act: string): Promise<Audience[]> {
  const rows = await graphAll<Record<string, unknown>>(`${actId(act)}/customaudiences`, {
    fields: 'id,name,subtype,description,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,time_created,retention_days',
  }, 500);
  return rows.map(r => {
    const lo = Number(r.approximate_count_lower_bound ?? -1), hi = Number(r.approximate_count_upper_bound ?? -1);
    const delivery = r.delivery_status as { code?: number; description?: string } | undefined;
    const op = r.operation_status as { code?: number; description?: string } | undefined;
    return {
      id: String(r.id), name: String(r.name ?? ''),
      kind: KIND[String(r.subtype)] ?? String(r.subtype ?? '').toLowerCase().replace(/_/g, ' '),
      description: (r.description as string) || null,
      size: lo >= 0 && hi > 0 ? [lo, hi] as [number, number] : null,
      ready: !delivery || delivery.code === 200,
      status: delivery && delivery.code !== 200 ? delivery.description ?? null : op && op.code !== 200 && op.code !== 0 ? op.description ?? null : null,
      created: r.time_created ? new Date(Number(r.time_created) * 1000).toISOString() : null,
      retentionDays: r.retention_days ? Number(r.retention_days) : null,
    };
  }).sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
}

/** Is the audience this house's? */
async function own(act: string, id: string): Promise<void> {
  if (!/^\d+$/.test(id)) throw new MetaAdsError('Not an audience id.', 400);
  const a = await graph<{ account_id?: string }>(id, { params: { fields: 'account_id' } });
  if (`act_${a.account_id}` !== actId(act)) throw new MetaAdsError('That audience belongs to another ad account, not this shop’s.', 403);
}

const sha = (v: string) => (v ? createHash('sha256').update(v).digest('hex') : '');

/** Terms of service not accepted: Meta's error 200 / 1870090, as a link to accept them. */
function termsHint(e: unknown, act: string): never {
  if (e instanceof MetaAdsError && (e.subcode === 1870090 || /terms/i.test(e.message))) {
    throw new MetaAdsError(`Meta needs the Custom Audience terms accepted once for this ad account: https://business.facebook.com/ads/manage/customaudiences/tos/?act=${actId(act).replace('act_', '')} — then try again.`, 409, e.code, e.subcode);
  }
  throw e;
}

async function posCustomers(segment: Segment): Promise<string[][]> {
  const [cs, inv] = await Promise.all([
    adminDb.collection('customers').select('name', 'phone', 'altPhone', 'email').get(),
    segment === 'all' ? Promise.resolve(null) : adminDb.collection('invoices').select('customerId', 'customerContact', 'createdAt').get(),
  ]);
  const customers: CustomerLike[] = cs.docs.map(d => ({ id: d.id, ...(d.data() as Omit<CustomerLike, 'id'>) }));
  const invoices: InvoiceLike[] = inv ? inv.docs.map(d => d.data() as InvoiceLike) : [];
  return customerRows(customers, invoices, segment);
}

/** Send the rows, hashed, in batches of 10,000 (Meta's limit per call), as one session. */
async function upload(audienceId: string, rows: string[][]): Promise<{ received: number; invalid: number }> {
  const hashed = rows.map(r => r.map(sha));
  const sessionId = Math.floor(Math.random() * 1e12);
  let received = 0, invalid = 0;
  for (let i = 0, seq = 1; i < hashed.length; i += 10_000, seq++) {
    const chunk = hashed.slice(i, i + 10_000);
    const d = await graph<{ num_received?: number; num_invalid_entries?: number }>(`${audienceId}/users`, {
      method: 'POST',
      params: {
        payload: { schema: SCHEMA, data: chunk },
        session: { session_id: sessionId, batch_seq: seq, last_batch_flag: i + 10_000 >= hashed.length, estimated_num_total: hashed.length },
      },
      timeoutMs: 60_000,
    });
    received += Number(d.num_received ?? chunk.length);
    invalid += Number(d.num_invalid_entries ?? 0);
  }
  return { received, invalid };
}

export async function createCustomerAudience(act: string, name: string, segment: Segment): Promise<{ id: string; sent: number; received: number; invalid: number }> {
  const rows = await posCustomers(segment);
  if (rows.length < 20) throw new MetaAdsError(`Only ${rows.length} customer${rows.length === 1 ? '' : 's'} in that group have a phone or email — Meta needs far more to match (at least 100 for ads to run).`, 400);
  let id: string;
  try {
    id = (await graph<{ id: string }>(`${actId(act)}/customaudiences`, {
      method: 'POST',
      params: { name, subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY', description: `From the POS customer book (${segment}), ${new Date().toISOString().slice(0, 10)}` },
    })).id;
  } catch (e) { termsHint(e, act); }
  try {
    const r = await upload(id, rows);
    return { id, sent: rows.length, ...r };
  } catch (e) {
    await graph(id, { method: 'DELETE' }).catch(() => undefined);
    termsHint(e, act);
  }
}

/** Add today's customers to an existing customer-list audience (Meta ignores ones it already has). */
export async function refreshCustomerAudience(act: string, id: string, segment: Segment): Promise<{ sent: number; received: number; invalid: number }> {
  await own(act, id);
  const rows = await posCustomers(segment);
  try { return { sent: rows.length, ...(await upload(id, rows)) }; } catch (e) { termsHint(e, act); }
}

export const ENGAGEMENT_EVENTS: { key: string; label: string }[] = [
  { key: 'ig_business_profile_all', label: 'Anyone who engaged with the account' },
  { key: 'ig_business_profile_visit', label: 'Visited the profile' },
  { key: 'ig_user_messaged_business', label: 'Sent the shop a message' },
  { key: 'ig_business_profile_engaged', label: 'Engaged with a post or ad' },
];

export async function createEngagementAudience(act: string, igUserId: string, name: string, days: number, event: string): Promise<{ id: string }> {
  const retention = Math.min(730, Math.max(1, Math.round(days))) * 86_400;
  if (!ENGAGEMENT_EVENTS.some(e => e.key === event)) throw new MetaAdsError('Which kind of engagement?', 400);
  try {
    return await graph<{ id: string }>(`${actId(act)}/customaudiences`, {
      method: 'POST',
      params: {
        name,
        prefill: 1,
        rule: { inclusions: { operator: 'or', rules: [{ event_sources: [{ id: igUserId, type: 'ig_business' }], retention_seconds: retention, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: event }] } }] } },
      },
    });
  } catch (e) { termsHint(e, act); }
}

export async function createLookalike(act: string, originId: string, name: string, percent: number, country: string): Promise<{ id: string }> {
  await own(act, originId);
  const ratio = Math.min(10, Math.max(1, Math.round(percent))) / 100;
  const cc = /^[A-Z]{2}$/.test(country) ? country : 'PK';
  try {
    return await graph<{ id: string }>(`${actId(act)}/customaudiences`, {
      method: 'POST',
      params: { name, subtype: 'LOOKALIKE', origin_audience_id: originId, lookalike_spec: { ratio, country: cc } },
    });
  } catch (e) { termsHint(e, act); }
}

export async function deleteAudience(act: string, id: string): Promise<void> {
  await own(act, id);
  await graph(id, { method: 'DELETE' });
}
