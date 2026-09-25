/**
 * Meta's automated rules for this house's ad account — watchdogs that Meta runs
 * itself every half hour, so nothing in the POS has to be awake: "pause an ad
 * set that has spent Rs 500 today and brought nothing", "tell me when…". Made
 * from a few ready-made kinds; any rule made in Ads Manager shows here too and
 * can be switched off or deleted.
 *
 * Meta may refuse a pausing rule that has a cost condition (error 2703); the
 * page then offers the "tell me" version of the same rule.
 *
 * Server-only.
 */

import { actId, graph, graphAll, loadConnection, MetaAdsError } from './meta';
import { money, fromMinor, toMinor } from './shape';

export type RuleKind = 'pause_no_results' | 'notify_no_results' | 'pause_daily_spend' | 'notify_cost_per_result';

export const RULE_KINDS: { key: RuleKind; label: string; hint: string; needs: 'spend' | 'cost' }[] = [
  { key: 'pause_no_results', label: 'Pause what’s not working', hint: 'Pause any ad set that has spent this much today with no result.', needs: 'spend' },
  { key: 'notify_no_results', label: 'Tell me what’s not working', hint: 'A Facebook notification when an ad set has spent this much today with no result.', needs: 'spend' },
  { key: 'pause_daily_spend', label: 'Daily ceiling', hint: 'Pause any ad set once it has spent this much today (it starts again tomorrow only if switched on).', needs: 'spend' },
  { key: 'notify_cost_per_result', label: 'Results getting expensive', hint: 'A Facebook notification when an ad set’s cost per result this week goes above this.', needs: 'cost' },
];

interface Filter { field: string; value: unknown; operator: string }
export interface Rule { id: string; name: string; enabled: boolean; summary: string; created: string | null }

const FIELD: Record<string, string> = { spent: 'spent', results: 'results', cost_per_result: 'cost per result', impressions: 'impressions', cpm: 'CPM', ctr: 'CTR', frequency: 'frequency' };
const OP: Record<string, string> = { GREATER_THAN: '>', LESS_THAN: '<', EQUAL: '=', IN_RANGE: 'between', IN: 'in' };
const PRESET: Record<string, string> = { TODAY: 'today', YESTERDAY: 'yesterday', LAST_3_DAYS: 'last 3 days', LAST_7_DAYS: 'last 7 days', LAST_14_DAYS: 'last 14 days', LAST_30_DAYS: 'last 30 days', LIFETIME: 'lifetime', MAXIMUM: 'all time' };
const DO: Record<string, string> = { PAUSE: 'pause it', UNPAUSE: 'switch it on', NOTIFICATION: 'notify', CHANGE_BUDGET: 'change the budget', CHANGE_BID: 'change the bid', ROTATE: 'rotate' };
const WHEN: Record<string, string> = { SEMI_HOURLY: 'every 30 min', HOURLY: 'hourly', DAILY: 'daily', CUSTOM: 'on a schedule' };

export function describeRule(r: { evaluation_spec?: { filters?: Filter[] }; execution_spec?: { execution_type?: string }; schedule_spec?: { schedule_type?: string } }, currency: string): string {
  const filters = r.evaluation_spec?.filters ?? [];
  const entity = String(filters.find(f => f.field === 'entity_type')?.value ?? 'ADSET').toLowerCase().replace('adset', 'ad set');
  const preset = filters.find(f => f.field === 'time_preset')?.value as string | undefined;
  const conds = filters.filter(f => !['entity_type', 'time_preset', 'id'].includes(f.field)).map(f => {
    const v = ['spent', 'cost_per_result', 'cpm', 'cpc'].includes(f.field) && typeof f.value === 'number' ? money(fromMinor(f.value, currency), currency) : String(f.value);
    return `${FIELD[f.field] ?? f.field.replace(/_/g, ' ')} ${OP[f.operator] ?? f.operator.toLowerCase()} ${v}`;
  });
  return [`${entity}s`, preset ? PRESET[preset] ?? preset.toLowerCase() : '', ...conds].filter(Boolean).join(' · ')
    + ` → ${DO[r.execution_spec?.execution_type ?? ''] ?? r.execution_spec?.execution_type ?? '?'}`
    + (r.schedule_spec?.schedule_type ? `, ${WHEN[r.schedule_spec.schedule_type] ?? r.schedule_spec.schedule_type.toLowerCase()}` : '');
}

export async function listRules(act: string, currency: string): Promise<Rule[]> {
  const rows = await graphAll<Record<string, unknown>>(`${actId(act)}/adrules_library`, { fields: 'id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time' }, 250);
  return rows.map(r => ({
    id: String(r.id), name: String(r.name ?? ''), enabled: r.status === 'ENABLED',
    summary: describeRule(r as Parameters<typeof describeRule>[0], currency),
    created: (r.created_time as string) ?? null,
  }));
}

/** The rule's three specs, from a kind and an amount in the account's currency. Pure (tested). */
export function ruleSpecs(kind: RuleKind, amount: number, currency: string, userId: string | null): { name: string; evaluation_spec: unknown; execution_spec: unknown; schedule_spec: unknown } {
  const minor = toMinor(amount, currency);
  const base: Filter[] = [{ field: 'entity_type', value: 'ADSET', operator: 'EQUAL' }];
  const notify = userId ? { execution_options: [{ field: 'user_ids', value: [userId], operator: 'EQUAL' }] } : {};
  const label = RULE_KINDS.find(k => k.key === kind)!.label;
  const name = `${label} — ${money(amount, currency)}`;
  const semi = { schedule_type: 'SEMI_HOURLY' };
  switch (kind) {
    case 'pause_no_results':
    case 'notify_no_results':
      return {
        name,
        evaluation_spec: { evaluation_type: 'SCHEDULE', filters: [...base, { field: 'time_preset', value: 'TODAY', operator: 'EQUAL' }, { field: 'spent', value: minor, operator: 'GREATER_THAN' }, { field: 'results', value: 1, operator: 'LESS_THAN' }] },
        execution_spec: { execution_type: kind === 'pause_no_results' ? 'PAUSE' : 'NOTIFICATION', ...notify },
        schedule_spec: semi,
      };
    case 'pause_daily_spend':
      return {
        name,
        evaluation_spec: { evaluation_type: 'SCHEDULE', filters: [...base, { field: 'time_preset', value: 'TODAY', operator: 'EQUAL' }, { field: 'spent', value: minor, operator: 'GREATER_THAN' }] },
        execution_spec: { execution_type: 'PAUSE', ...notify },
        schedule_spec: semi,
      };
    case 'notify_cost_per_result':
      return {
        name,
        evaluation_spec: { evaluation_type: 'SCHEDULE', filters: [...base, { field: 'time_preset', value: 'LAST_7_DAYS', operator: 'EQUAL' }, { field: 'cost_per_result', value: minor, operator: 'GREATER_THAN' }] },
        execution_spec: { execution_type: 'NOTIFICATION', ...notify },
        schedule_spec: { schedule_type: 'DAILY' },
      };
  }
}

export async function createRule(act: string, kind: RuleKind, amount: number, currency: string): Promise<{ id: string }> {
  if (!(amount > 0)) throw new MetaAdsError('An amount, please.', 400);
  const conn = await loadConnection();
  const specs = ruleSpecs(kind, amount, currency, conn?.userId || null);
  try {
    return await graph<{ id: string }>(`${actId(act)}/adrules_library`, { method: 'POST', params: specs });
  } catch (e) {
    if (e instanceof MetaAdsError && (e.code === 2703 || /cost condition/i.test(e.message)) && kind.startsWith('pause')) {
      throw new MetaAdsError('Meta won’t let a pausing rule look at spend. Use “Tell me what’s not working” instead — the same check, as a notification.', 400, e.code);
    }
    throw e;
  }
}

async function own(act: string, id: string) {
  if (!/^\d+$/.test(id)) throw new MetaAdsError('Not a rule id.', 400);
  const r = await graph<{ account_id?: string }>(id, { params: { fields: 'account_id' } }).catch(() => ({} as { account_id?: string }));
  // Rules report their account; when Meta doesn't say, the list it came from is this account's.
  if (r.account_id && `act_${r.account_id}` !== actId(act)) throw new MetaAdsError('That rule belongs to another ad account.', 403);
}

export async function setRule(act: string, id: string, enabled: boolean) {
  await own(act, id);
  await graph(id, { method: 'POST', params: { status: enabled ? 'ENABLED' : 'DISABLED' } });
}

export async function deleteRule(act: string, id: string) {
  await own(act, id);
  await graph(id, { method: 'DELETE' });
}
