/**
 * Talking to Gemini through Vertex AI.
 *
 * NOT the API-key endpoint (generativelanguage.googleapis.com). That one bills against
 * an AI Studio prepay pool which is separate from the project's own billing, and this
 * shop's pool is empty — every call comes back RESOURCE_EXHAUSTED however valid the key
 * is. Vertex bills to the project's Google Cloud account, which is funded.
 *
 * It also means no API key by default. On App Hosting the request is signed by the
 * backend's own service account through Application Default Credentials, so there is no
 * secret to store, rotate, leak, or grant access to. Locally it uses whatever `gcloud auth
 * application-default login` left behind.
 *
 * The exception, and since 2026-09-29 the rule: the Vertex AI key (src/lib/ai-key.ts —
 * Secret Manager `vertex-ai-key`, or VERTEX_AI_KEY / GEMINI_API_KEY as a variable). When
 * there is one it is used in place of the signed request, against Vertex AI's keyed
 * endpoint (the same aiplatform host, no project or region in the path), and billed to
 * the key's own project — the same key as Post a Piece and the Ads helper. It never
 * reaches the browser, and the request shape is the same either way, so nothing above
 * this file can tell which was used.
 */

import { GoogleAuth } from 'google-auth-library';
import { envVertexKey, keyedModelUrl, vertexKey } from '@/lib/ai-key';
import { markExhausted, modelOrder } from '@/lib/ai-fallback';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

// VERTEX_PROJECT lets Vertex bill to a different Google Cloud project than the
// app's own. House of Mina runs on hom-pos, which has no funded Vertex, so its
// backend sets VERTEX_PROJECT=gemstrack-pos (and that project grants its App
// Hosting service account roles/aiplatform.user). Unset, the app's own project.
const PROJECT = process.env.VERTEX_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
const LOCATION = process.env.VERTEX_LOCATION?.trim() || 'us-central1';

/**
 * Pinned, and to what Vertex actually serves this project rather than to whatever is
 * newest. The 3.x family is not offered here; 2.5-flash is, and it handles the mixed
 * Urdu/Gujarati/English sentences and the structured output this app depends on.
 * VERTEX_MODEL overrides it so a retirement need not wait on a deploy.
 */
export const VERTEX_MODEL = process.env.VERTEX_MODEL?.trim() || 'gemini-2.5-flash';

export const geminiConfigured = () => Boolean(envVertexKey() || PROJECT);

export interface InlinePart { inlineData: { mimeType: string; data: string } }
export interface TextPart { text: string }
export type Part = TextPart | InlinePart;

export interface GenerateOptions {
  system: string;
  parts: Part[];
  /** An OpenAPI-ish schema. Vertex uses uppercase type names: OBJECT, STRING, NUMBER… */
  schema: Record<string, unknown>;
  temperature?: number;
  /**
   * How long the model may think before answering, in tokens. 0 turns it off.
   *
   * Left unset, 2.5 Flash decides for itself, and for the voice prompt it decided on
   * a couple of hundred tokens of deliberation every time — measured at 2.2–5.4 s per
   * call against 1.0–1.2 s with it off, for the same answer. A sentence said across
   * the counter is not a problem that needs working through; a page of handwriting
   * might be, so the scanners leave this alone.
   */
  thinkingBudget?: number;
  signal?: AbortSignal;
  /**
   * The model, when not VERTEX_MODEL: the scanners ask for a stronger one (vision/scan-model.ts).
   * One Google doesn't serve here (404), or calls exhausted (429; 3.1 Pro on 2026-10-01, lib/ai-fallback.ts),
   * hands over to VERTEX_MODEL at once, so a scan never fails for it.
   */
  model?: string;
  /**
   * Wait out a rate limit rather than fail: 5 s, 15 s, 30 s. For the scanners, where a slip is
   * worth waiting for; voice, where somebody is standing there, waits 3 s once. The Vertex AI
   * key's project allows only a few calls a minute (2026-09-29).
   */
  patient?: boolean;
}

export class GeminiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Where to send it and how to prove who is asking — see the note at the top. */
async function endpoint(model: string): Promise<{ url: string; headers: Record<string, string> }> {
  const key = await vertexKey();
  if (key) return { url: keyedModelUrl(model), headers: { 'x-goog-api-key': key } };
  if (!PROJECT) throw new GeminiError('No Google Cloud project configured.', 503);

  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  if (!token) throw new GeminiError('Could not authenticate to Vertex AI.', 503);

  return {
    url: `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}`
      + `/locations/${LOCATION}/publishers/google/models/${model}:generateContent`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

/**
 * One call, one parsed JSON object.
 *
 * Throws GeminiError with a usable status rather than returning a half-answer: a route
 * that cannot tell "no credit" from "could not read that" ends up telling the shop the
 * wrong thing to do about it.
 */
const WAIT_PATIENT = [5000, 15000, 30000];
const WAIT_BRIEF = [3000];

export async function generateJson<T>({
  system, parts, schema, temperature = 0, thinkingBudget, signal, model, patient,
}: GenerateOptions): Promise<T> {
  const models = modelOrder([model?.trim() || VERTEX_MODEL, VERTEX_MODEL]);
  const waits = patient ? WAIT_PATIENT : WAIT_BRIEF;
  const request = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
      ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
    },
  });

  let body: unknown = null;
  for (let m = 0, attempt = 0; ;) {
    const { url, headers } = await endpoint(models[m]);
    const res = await fetch(url, { method: 'POST', signal, headers: { ...headers, 'Content-Type': 'application/json' }, body: request });
    body = await res.json().catch(() => null);
    if (res.ok) break;
    const err = ((Array.isArray(body) ? body[0] : body) as { error?: { status?: string; message?: string } } | null)?.error ?? {};
    // A model this project isn't served, or one Google calls exhausted: the next, now.
    if ((res.status === 404 || res.status === 429) && m < models.length - 1) {
      if (res.status === 429) markExhausted(models[m]);
      console.warn(`[gemini] ${models[m]} answered ${res.status} — trying ${models[m + 1]}`);
      m++; attempt = 0; continue;
    }
    if (res.status === 429 && attempt < waits.length) { await new Promise(r => setTimeout(r, waits[attempt++])); continue; }
    // A rate limit is a wait, not a fault; with the key it is almost never the money.
    if (err.status === 'RESOURCE_EXHAUSTED' || res.status === 429) {
      throw new GeminiError('Google is holding the AI to its per-minute quota right now. Try again in a minute.', 429);
    }
    throw new GeminiError(String(err.message ?? `Vertex AI returned ${res.status}`), res.status);
  }

  // Every text part, not the first: a Gemini 3 answer can come in several, and reading one
  // of them was a JSON cut in half ("Could not read that back"). Thoughts are left out.
  type Parts = Array<{ text?: string; thought?: boolean }>;
  const answer = ((Array.isArray(body) ? body[0] : body) as { candidates?: Array<{ content?: { parts?: Parts } }> } | null)
    ?.candidates?.[0]?.content?.parts ?? [];
  const text = answer.filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) throw new GeminiError('Gemini returned nothing to read.', 502);

  try {
    return JSON.parse(text) as T;
  } catch {
    // A schema was asked for, so this is rare; when it happens the honest answer is that
    // nothing was understood rather than a half-parsed guess at an amount.
    throw new GeminiError('Could not read that back.', 502);
  }
}
