/**
 * Retouching a jewellery photograph (the owner, 2026-09-26: "a photo retouching option which retouches
 * jewelry and background and photo in both pos using magnific api open ai model image", then "magnific
 * only", then "magnific api should use open ai image gen"), in Post a Piece and Add Photos.
 *
 * Everything goes through the Magnific API, one key:
 *   1. GPT Image 2.5 Edit (OpenAI's model, on Magnific; the editing-precision `sunburst` variant):
 *      the piece cleaned (dust, fingerprints, scratches), metal and stones brought up, the background
 *      cleaned and evened, light and colour corrected — the piece itself pinned as it is.
 *   2. Magnific's Precision upscaler, when GPT Image returned less than 2k (a photo that isn't
 *      square): nothing redrawn, the fine detail back, and catalogue size (up to 3000 px). It is a
 *      bonus — its queue can be slow, so if it stalls the GPT Image result is kept.
 * The route (/api/website/post/ai, op "retouch") then compares the result with the original
 * ("same piece?"), as it does for every AI edit.
 *
 * The key is read at runtime from Secret Manager — `magnific-api-key` in this house's project,
 * readable by its App Hosting account — so a missing key is a message on the page, never a failed
 * rollout. MAGNIFIC_API_KEY in the environment wins (local development). Server-only. Never logs
 * the key.
 */

import sharp from 'sharp';
import { readSecret } from '@/lib/secret-manager';
import { AiError, type InlineImage } from '@/lib/social/ai';

export type RetouchPart = 'jewelry' | 'background' | 'light';
export const RETOUCH_PARTS: RetouchPart[] = ['jewelry', 'background', 'light'];

const API = 'https://api.magnific.com/v1/ai';
/** What GPT Image is sent; it re-renders at its own 1k/2k size anyway. */
const EDIT_EDGE = 2048;
/** Precision's input; its result (about twice this) is brought to at most CATALOGUE_EDGE. */
const DETAIL_EDGE = 1536;
const CATALOGUE_EDGE = 3000;

export async function magnificKey(): Promise<string | null> {
  const fromEnv = process.env.MAGNIFIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try { return (await readSecret('magnific-api-key'))?.trim() || null; } catch { return null; }
}

/**
 * The retouching brief. Follows the house's image-prompt rules (lib/social/prompts.ts):
 * the piece first, its identity pinned, the metal never named (the model recolours what
 * it is told), and what to avoid last.
 */
export function retouchPrompt(parts: RetouchPart[], tidy = false): string {
  const want = new Set(parts.length ? parts : RETOUCH_PARTS);
  const lines = [
    'Retouch this jewellery product photograph for a fine-jewellery catalogue.',
    'The piece must stay exactly the same: the same design, shape and proportions; every stone in the same place with the same cut, size, count and colour; the same metal colour and finish; the same engraving, chain, links and clasp. Do not add, remove, move or redesign anything on the piece.',
  ];
  if (want.has('jewelry')) lines.push('The piece: remove dust, lint, fingerprints, fine scratches and spots; make the metal clean and polished with crisp, even highlights; make the stones clear and bright with natural sparkle; keep edges and fine detail sharp.');
  if (want.has('background')) lines.push('The background: keep the same background, surface, stand or bust, but clean it — remove dust, marks, stray threads, creases and uneven patches, and make it smooth and even.');
  else lines.push('Leave the background exactly as it is.');
  if (tidy) lines.push('Remove any price tag, string, thread or label attached to the piece, and fill what was behind it naturally.');
  if (want.has('light')) lines.push('Light and colour: correct the white balance and exposure, balanced contrast, true natural colours, no heavy filter or colour cast.');
  lines.push(
    'Keep the framing, angle, crop and composition exactly as in the original. If a weight or a logo is printed on the photo, keep it exactly as it is.',
    'Photorealistic studio product photography.',
    'Avoid: any change to the design, extra or missing stones, warped or melted metal, a plastic or CGI look, over-sharpened halos, blur, new props, text, logos or watermarks that were not there.',
  );
  return lines.join('\n');
}


/** Start a Magnific task, wait for it, and download its first result. */
async function magnificTask(path: string, body: Record<string, unknown>, key: string, what: string, waitMs: number): Promise<Buffer> {
  const headers = { 'x-magnific-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' };
  const start = await fetch(`${API}/${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const s = await start.json().catch(() => ({})) as { data?: { task_id?: string }; message?: string };
  if (!start.ok || !s.data?.task_id) {
    throw new AiError(`${what} couldn't take it: ${s.message || `status ${start.status}`}`, start.status === 401 ? 503 : start.status === 429 ? 429 : 502);
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3_000));
    const res = await fetch(`${API}/${path}/${s.data.task_id}`, { headers, signal: AbortSignal.timeout(20_000) });
    const t = await res.json().catch(() => ({})) as { data?: { status?: string; generated?: string[] } };
    const status = t.data?.status;
    if (status === 'COMPLETED' && t.data?.generated?.[0]) {
      const img = await fetch(t.data.generated[0], { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new AiError(`${what}'s result didn't download (${img.status}).`, 502);
      return Buffer.from(await img.arrayBuffer());
    }
    if (status === 'FAILED') throw new AiError(`${what} couldn’t finish this photo. Try again.`, 502);
  }
  throw new AiError(`${what} is taking too long. Try again in a minute.`, 504);
}

/** Step 1: GPT Image 2.5 Edit. `auto` keeps the photo's shape, but only at 1k; a square photo can go to 2k. */
async function gptRetouch(jpeg: Buffer, parts: RetouchPart[], tidy: boolean, key: string): Promise<Buffer> {
  const input = await sharp(jpeg).resize({ width: EDIT_EDGE, height: EDIT_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const { width = 1, height = 1 } = await sharp(input).metadata();
  const square = Math.abs(width / height - 1) < 0.04;
  return magnificTask('text-to-image/gpt-image-2-5-edit', {
    prompt: retouchPrompt(parts, tidy),
    reference_images: [input.toString('base64')],
    variant: 'sunburst',
    quality: 'high',
    ...(square ? { resolution: '2k', aspect_ratio: 'square_1_1' } : { resolution: '1k', aspect_ratio: 'auto' }),
    output_format: 'jpeg',
    num_images: 1,
  }, key, 'GPT Image', 150_000);
}

/** Step 2: Precision — gentle, detail back without the grain or crunch a product photo doesn't want. */
async function preciseDetail(jpeg: Buffer, key: string): Promise<Buffer> {
  const input = await sharp(jpeg).resize({ width: DETAIL_EDGE, height: DETAIL_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  return magnificTask('image-upscaler-precision', { image: input.toString('base64'), sharpen: 35, smart_grain: 0, ultra_detail: 30 }, key, 'Magnific', 90_000);
}

export interface Retouched { image: InlineImage; steps: string[] }

/** Retouch a photo: GPT Image 2.5 Edit, then Precision when the edit came back small — both on Magnific. */
export async function retouchPhoto(photo: Buffer, parts: RetouchPart[] = RETOUCH_PARTS, tidy = false): Promise<Retouched> {
  const key = await magnificKey();
  if (!key) throw new AiError('Retouching isn’t set up for this shop yet: add magnific-api-key in Secret Manager.', 503);
  const start = await sharp(photo).rotate().jpeg({ quality: 92 }).toBuffer();
  const steps = ['GPT Image 2.5 (Magnific)'];
  const t0 = Date.now();
  let out = await gptRetouch(start, parts, tidy, key);
  const t1 = Date.now();
  const { width = 0, height = 0 } = await sharp(out).metadata();
  if (Math.max(width, height) < 2000) {
    try {
      out = await preciseDetail(out, key);
      steps.push('Magnific Precision');
    } catch (e) {
      console.warn('[retouch] Precision skipped:', e instanceof Error ? e.message : e);
    }
  }
  console.log(`[retouch] GPT Image ${((t1 - t0) / 1000).toFixed(0)} s${steps.length > 1 ? `, Precision ${((Date.now() - t1) / 1000).toFixed(0)} s` : ''}`);
  const final = await sharp(out).resize({ width: CATALOGUE_EDGE, height: CATALOGUE_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { image: { mimeType: 'image/jpeg', data: final.toString('base64') }, steps };
}
