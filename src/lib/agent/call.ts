/**
 * One call from an outside AI, as both doors take it (/api/agent/mcp and /api/agent/v1/*): the key is
 * checked (keys.ts), the call counted against the key's hour (600, as the Studio's agent had), the tool run
 * (registry.ts), and the call written to the activity log under the key's label ("via ChatGPT"), so the
 * owner sees what an AI read, made or changed. The key itself is never logged, nor a delete code.
 * Server-only.
 */

import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { rateLimit } from '@/lib/website/ratelimit';
import { mediaOrigin, publicOrigin } from '@/lib/social/gate';
import { checkKey, noteUse, type AgentKey, type KeyCheck } from './keys';
import { runTool, type AgentCtx, type AgentTool, type RunResult } from './registry';

/** Calls a key may make an hour. */
export const CALLS_PER_HOUR = 600;

/** The key from `Authorization: Bearer …` (or `X-API-Key`, which some GPT Action setups send). */
export function keyFrom(req: Pick<NextRequest, 'headers'>): string {
  const auth = req.headers.get('authorization') || '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1];
  return bearer || (req.headers.get('x-api-key') || '').trim();
}

export async function authenticate(req: Pick<NextRequest, 'headers'>): Promise<KeyCheck> {
  return checkKey(keyFrom(req)).catch((e): KeyCheck => {
    console.error('[agent] key check failed:', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'unknown', message: 'The key could not be checked just now. Try again.' };
  });
}

/** Within the key's hour? */
export async function withinLimit(key: AgentKey): Promise<{ ok: boolean; retryAfter: number }> {
  const r = await rateLimit('ai-key', key.id, CALLS_PER_HOUR, 3_600);
  return { ok: r.ok, retryAfter: r.retryAfter };
}

/**
 * A line in the activity log, in both of its shapes: the server's (action, title, detail, by, at, via) and
 * the one Settings → Activity reads (timestamp, eventType, description, details, entityId).
 */
export function agentLogger(key: AgentKey) {
  return async (action: string, title: string, detail: string, ref?: string): Promise<void> => {
    const at = new Date().toISOString();
    try {
      await adminDb.collection('activity_log').add({
        action, title, detail, relatedId: ref || null, by: key.email, at, via: `ai:${key.label}`,
        timestamp: at, eventType: action, description: title, details: `${detail ? `${detail} · ` : ''}via ${key.label}`, entityId: ref || '',
      });
    } catch (e) { console.error('[agent] activity log', e instanceof Error ? e.message : e); }
  };
}

export function contextFor(req: NextRequest, key: AgentKey, o: { imageUrls: boolean }): AgentCtx {
  return { key, origin: publicOrigin(req), mediaOrigin: mediaOrigin(req), via: `via ${key.label}`, log: agentLogger(key), imageUrls: o.imageUrls };
}

/** Arguments as the log may show them: no codes, no pictures, nothing long. */
export function argsForLog(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const out: string[] = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (/code|secret|token|key|password/i.test(k) || k === 'data') continue;
    if (v === undefined || v === null || v === '') continue;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    out.push(`${k}: ${s.length > 60 ? `${s.slice(0, 57)}…` : s}`);
    if (out.length >= 6) break;
  }
  return out.join(', ');
}

const refOf = (args: unknown): string | undefined => {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  for (const k of ['invoiceId', 'orderId', 'customerId', 'repairId', 'design', 'queue_id', 'id', 'sku']) if (typeof a[k] === 'string' && a[k]) return String(a[k]).slice(0, 80);
  return undefined;
};

/** Run a tool for a key and log it. */
export async function callAgentTool(all: readonly AgentTool[], name: string, args: unknown, ctx: AgentCtx): Promise<RunResult> {
  noteUse(ctx.key.id).catch(() => undefined);
  const r = await runTool(all, name, args, ctx);
  if (r.ok && r.out.logged) return r;
  const title = r.tool?.title ?? name;
  const what = argsForLog(args);
  if (r.ok) await ctx.log(`ai.${r.tool.effect}`, `${ctx.key.label}: ${title}`, what, refOf(args));
  else await ctx.log('ai.refused', `${ctx.key.label}: ${title} — not done`, `${r.error.slice(0, 200)}${what ? ` (${what})` : ''}`, refOf(args));
  return r;
}
