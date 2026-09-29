/**
 * The Vertex AI key every Gemini call in the ERP is sent with — Post a Piece, the website
 * captions, the Ads helper, the voice and both scanners, in both houses (owner, 2026-09-29:
 * "use this key for everything now").
 *
 * A Vertex API key bound to a service account in the project that pays for the AI. It goes as
 * `x-goog-api-key` to Vertex's keyed endpoint — aiplatform.googleapis.com/v1/publishers/google/
 * models/<model>:generateContent, no project or region in the path — and Google bills the key's
 * own project. With no key found, the calls are signed as before and bill to IMAGE_AI_PROJECT /
 * VERTEX_PROJECT (Murtaza's Jewel Gen, whose billing was switched off on 2026-09-29).
 *
 * Where it comes from, first found:
 *   VERTEX_AI_KEY (or the older GEMINI_API_KEY)   a server-side variable — for a local run
 *   Secret Manager VERTEX_AI_KEY_SECRET           default `vertex-ai-key` in this project; House
 *                                                 of Mina names Taheri's, so one key serves both
 * Read at run time, never declared in apphosting.yaml: the key must never sit in a committed
 * file (gemstrack-pos is a public repository), and a secret that isn't there yet means "not set
 * up", not a failed rollout. Kept five minutes, so a new version takes over within that; a
 * missing one is asked for again after a minute, so creating the secret switches the AI over
 * with no deploy. The App Hosting account of each house needs Secret Accessor on it.
 *
 * Server-only. Never logs the value.
 */

import { readSecret } from './secret-manager';

const TTL = 5 * 60_000;
const MISS_TTL = 60_000;

let cached: { key: string; at: number } | null = null;
let pending: Promise<string> | null = null;

export const vertexKeySecret = () => process.env.VERTEX_AI_KEY_SECRET?.trim() || 'vertex-ai-key';

/** A key set as a variable (known without asking Secret Manager). */
export const envVertexKey = () => process.env.VERTEX_AI_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';

/** The key, or '' when there is none (the caller then signs the request as the project). */
export async function vertexKey(): Promise<string> {
  const env = envVertexKey();
  if (env) return env;
  if (cached && Date.now() - cached.at < (cached.key ? TTL : MISS_TTL)) return cached.key;
  pending ??= readSecret(vertexKeySecret())
    .then(v => v?.trim() || '')
    .catch((e) => {
      console.warn(`[ai] ${e instanceof Error ? e.message : String(e)} — signing AI calls as the project instead.`);
      return '';
    })
    .then((key) => { cached = { key, at: Date.now() }; pending = null; return key; });
  return pending;
}

/** Vertex's keyed endpoint for a publisher model — global, no project in the path. */
export const keyedModelUrl = (model: string, method: 'generateContent' | 'countTokens' = 'generateContent') =>
  `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${method}`;
