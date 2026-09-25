/**
 * Post a Piece's AI: Gemini's image and text models on Vertex AI.
 *
 * Billed to IMAGE_AI_PROJECT — Murtaza's "Jewel Gen" project (funded, Vertex
 * on), not the POS's own. In production the request is signed by the App
 * Hosting service account, which that project grants roles/aiplatform.user.
 * Locally, IMAGE_AI_CREDENTIALS can point at an authorized-user JSON (gcloud
 * keeps one per signed-in account under ~/.config/gcloud/legacy_credentials/)
 * so a laptop whose own login has no access to that project can still test;
 * nothing else in the app uses it.
 *
 * Models are the location "global" publisher models, pinned by name and
 * overridable without a deploy of code:
 *   IMAGE_AI_MODEL        gemini-3-pro-image      Nano Banana Pro — edits, re-stages
 *   IMAGE_AI_TEXT_MODEL   gemini-3.1-pro-preview  captions and the story plan
 *   IMAGE_AI_CHECK_MODEL  gemini-3.8-flash        "is it the same piece?", reading text back
 *
 * Server-only.
 */

import { GoogleAuth } from 'google-auth-library';
import sharp from 'sharp';

const PROJECT = process.env.IMAGE_AI_PROJECT?.trim()
  || process.env.VERTEX_PROJECT?.trim()
  || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  || process.env.GOOGLE_CLOUD_PROJECT
  || '';
const LOCATION = process.env.IMAGE_AI_LOCATION?.trim() || 'global';
export const IMAGE_MODEL = process.env.IMAGE_AI_MODEL?.trim() || 'gemini-3-pro-image';
export const TEXT_MODEL = process.env.IMAGE_AI_TEXT_MODEL?.trim() || 'gemini-3.1-pro-preview';
export const CHECK_MODEL = process.env.IMAGE_AI_CHECK_MODEL?.trim() || 'gemini-3.8-flash';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  ...(process.env.IMAGE_AI_CREDENTIALS ? { keyFile: process.env.IMAGE_AI_CREDENTIALS } : {}),
});

export class AiError extends Error {
  constructor(message: string, public status = 502) { super(message); this.name = 'AiError'; }
}

export const aiConfigured = () => Boolean(PROJECT);
/** The Google Cloud project AI calls bill to (Taheri: Murtaza's; House of Mina: VERTEX_PROJECT, Taheri's). */
export const aiProject = () => PROJECT;

export interface InlineImage { mimeType: string; data: string }
type Part = { text: string } | { inlineData: InlineImage };

const host = () => LOCATION === 'global' ? 'aiplatform.googleapis.com' : `${LOCATION}-aiplatform.googleapis.com`;

/**
 * One generateContent call, retried twice on the errors that are worth it
 * (rate limits and the model being briefly overloaded), never on a refusal.
 */
async function call(model: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!PROJECT) throw new AiError('No Google Cloud project is set for AI (IMAGE_AI_PROJECT).', 503);
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  if (!token) throw new AiError('Could not sign in to Vertex AI.', 503);
  const url = `https://${host()}/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    });
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.ok && data) return data;
    const err = (data?.error ?? {}) as { status?: string; message?: string };
    const retryable = res.status === 429 || res.status === 503 || res.status === 500;
    if (retryable && attempt < 2) { await new Promise(r => setTimeout(r, 2500 * (attempt + 1))); continue; }
    if (err.status === 'RESOURCE_EXHAUSTED') throw new AiError('The AI account is out of quota or credit right now. Try again in a minute.', 429);
    throw new AiError(String(err.message || `Vertex AI returned ${res.status}`).slice(0, 300), res.status);
  }
}

type Candidate = { content?: { parts?: Array<{ text?: string; thought?: boolean; inlineData?: InlineImage }> }; finishReason?: string };
const partsOf = (data: Record<string, unknown>) => ((data.candidates as Candidate[] | undefined)?.[0]?.content?.parts ?? []);

/** A photo for the model: at most 2048 on the long side, JPEG. Keeps requests small and fast. */
export async function prepareImage(bytes: Buffer): Promise<InlineImage> {
  const out = await sharp(bytes).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return { mimeType: 'image/jpeg', data: out.toString('base64') };
}

export interface ImageResult { mimeType: 'image/jpeg'; data: string; width: number; height: number; note?: string }

/**
 * An image from the image model: references first, then the brief. The model
 * answers in PNG at 2K; it goes back to the browser as a JPEG a fifth the size.
 */
export async function generateImage(opts: { images: InlineImage[]; prompt: string; aspect?: string; size?: '1K' | '2K' | '4K' }): Promise<ImageResult> {
  const data = await call(IMAGE_MODEL, {
    contents: [{ role: 'user', parts: [...opts.images.map(i => ({ inlineData: i })), { text: opts.prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { ...(opts.aspect ? { aspectRatio: opts.aspect } : {}), imageSize: opts.size ?? '2K' },
    },
  });
  const parts = partsOf(data);
  const img = parts.find(p => p.inlineData?.data && !p.thought)?.inlineData;
  if (!img) {
    const said = parts.find(p => p.text && !p.thought)?.text;
    const reason = (data.candidates as Candidate[] | undefined)?.[0]?.finishReason;
    throw new AiError(said ? `The model did not make an image: ${said.slice(0, 200)}` : `The model did not make an image${reason ? ` (${reason})` : ''}. Try again or change the request.`, 422);
  }
  const jpeg = await sharp(Buffer.from(img.data, 'base64')).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  return {
    mimeType: 'image/jpeg',
    data: jpeg.data.toString('base64'),
    width: jpeg.info.width,
    height: jpeg.info.height,
    note: parts.find(p => p.text && !p.thought)?.text?.slice(0, 300),
  };
}

/** A structured answer from a text model, parsed. */
export async function generateJson<T>(opts: { model?: string; system: string; parts: Part[]; schema: Record<string, unknown>; temperature?: number }): Promise<T> {
  const data = await call(opts.model ?? TEXT_MODEL, {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: opts.parts }],
    generationConfig: { temperature: opts.temperature ?? 0.7, responseMimeType: 'application/json', responseSchema: opts.schema },
  });
  const text = partsOf(data).filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) throw new AiError('The model returned nothing to read.', 502);
  try { return JSON.parse(text) as T; }
  catch { throw new AiError('Could not read the model’s answer.', 502); }
}

/** Plain text from a text model — used to read lettering back off an image. */
export async function generateText(opts: { model?: string; parts: Part[] }): Promise<string> {
  const data = await call(opts.model ?? CHECK_MODEL, {
    contents: [{ role: 'user', parts: opts.parts }],
    generationConfig: { temperature: 0 },
  });
  return partsOf(data).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
}

// ── For the checks panel ───────────────────────────────────────────────────

/** A one-word call to the cheap model: proves the project, the permission and the quota in a second. */
export async function aiPing(): Promise<void> {
  await generateText({ model: CHECK_MODEL, parts: [{ text: 'Reply with the single word OK.' }] });
}

/** Does Vertex still serve the image model by this name? Reads the model card; costs nothing. true, or the HTTP status it got. */
export async function imageModelServed(): Promise<true | number> {
  if (!PROJECT) return 0;
  const token = (await (await auth.getClient()).getAccessToken()).token;
  const res = await fetch(`https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${IMAGE_MODEL}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT },
    signal: AbortSignal.timeout(8000),
  });
  return res.ok ? true : res.status;
}
