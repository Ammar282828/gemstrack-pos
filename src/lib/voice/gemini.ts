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
 * The one exception: GEMINI_API_KEY. Set, it is used in place of the signed request,
 * against Vertex AI's express endpoint (the same aiplatform host, keyed rather than
 * signed, no project or region in the path). That is for a machine with no gcloud
 * login, or a deployment whose backend account cannot be granted Vertex. It is a
 * server-side variable only — never NEXT_PUBLIC_ — and the request shape is the same
 * either way, so nothing above this file can tell which was used.
 */

import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
const LOCATION = process.env.VERTEX_LOCATION?.trim() || 'us-central1';
const API_KEY = process.env.GEMINI_API_KEY?.trim() || '';

/**
 * Pinned, and to what Vertex actually serves this project rather than to whatever is
 * newest. The 3.x family is not offered here; 2.5-flash is, and it handles the mixed
 * Urdu/Gujarati/English sentences and the structured output this app depends on.
 * VERTEX_MODEL overrides it so a retirement need not wait on a deploy.
 */
export const VERTEX_MODEL = process.env.VERTEX_MODEL?.trim() || 'gemini-2.5-flash';

export const geminiConfigured = () => Boolean(API_KEY || PROJECT);

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
}

export class GeminiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Where to send it and how to prove who is asking — see the note at the top. */
async function endpoint(): Promise<{ url: string; headers: Record<string, string> }> {
  if (API_KEY) {
    return {
      url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${VERTEX_MODEL}:generateContent`,
      headers: { 'x-goog-api-key': API_KEY },
    };
  }
  if (!PROJECT) throw new GeminiError('No Google Cloud project configured.', 503);

  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  if (!token) throw new GeminiError('Could not authenticate to Vertex AI.', 503);

  return {
    url: `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}`
      + `/locations/${LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`,
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
export async function generateJson<T>({
  system, parts, schema, temperature = 0, thinkingBudget, signal,
}: GenerateOptions): Promise<T> {
  const { url, headers } = await endpoint();

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
        responseSchema: schema,
        ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
      },
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (Array.isArray(body) ? body[0] : body)?.error ?? {};
    const message = String(err.message ?? `Vertex AI returned ${res.status}`);
    // Worth separating: a depleted account is the shop's to fix, not a fault to retry.
    if (err.status === 'RESOURCE_EXHAUSTED') {
      throw new GeminiError('The Google Cloud account has no credit left for this.', 429);
    }
    throw new GeminiError(message, res.status);
  }

  const text = (Array.isArray(body) ? body[0] : body)
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiError('Gemini returned nothing to read.', 502);

  try {
    return JSON.parse(text) as T;
  } catch {
    // A schema was asked for, so this is rare; when it happens the honest answer is that
    // nothing was understood rather than a half-parsed guess at an amount.
    throw new GeminiError('Could not read that back.', 502);
  }
}
