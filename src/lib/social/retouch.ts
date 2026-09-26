/**
 * Retouching a jewellery photograph (the owner, 2026-09-26: "a photo retouching option
 * which retouches jewelry and background and photo in both pos using magnific api open ai
 * model image", in Post a Piece and Add Photos).
 *
 * Two steps, each used when its key is set up:
 *   1. OpenAI's image model (OPENAI_IMAGE_MODEL, gpt-image-2 by default) edits the photo:
 *      the piece cleaned (dust, fingerprints, scratches), metal and stones brought up, the
 *      background cleaned and evened, light and colour corrected — the piece itself unchanged.
 *   2. Magnific's Precision upscaler puts back the fine detail an image model softens, and
 *      takes the result to catalogue size (up to 3000 px, like the website's photos).
 * The route (/api/website/post/ai, op "retouch") then compares the result with the original
 * ("same piece?"), as it does for every AI edit.
 *
 * Keys are read at runtime from Secret Manager — `openai-api-key` and `magnific-api-key`
 * in this house's project, readable by its App Hosting account — so a missing one is a
 * message on the page, never a failed rollout. OPENAI_API_KEY / MAGNIFIC_API_KEY in the
 * environment win (local development). Server-only. Never logs a key.
 */

import sharp from 'sharp';
import { readSecret } from '@/lib/secret-manager';
import { AiError, type InlineImage } from '@/lib/social/ai';

export type RetouchPart = 'jewelry' | 'background' | 'light';
export const RETOUCH_PARTS: RetouchPart[] = ['jewelry', 'background', 'light'];

const OPENAI_MODEL = () => process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2';
/** The longest side sent to OpenAI: the model softens detail anyway, and Magnific restores it after. */
const OPENAI_EDGE = 1536;
/** Magnific's input; its result (about twice this) is brought to at most CATALOGUE_EDGE. */
const MAGNIFIC_EDGE = 1536;
const CATALOGUE_EDGE = 3000;

async function keyOf(secret: string, env: string): Promise<string | null> {
  const fromEnv = process.env[env]?.trim();
  if (fromEnv) return fromEnv;
  try { return (await readSecret(secret))?.trim() || null; } catch { return null; }
}
export const openaiKey = () => keyOf('openai-api-key', 'OPENAI_API_KEY');
export const magnificKey = () => keyOf('magnific-api-key', 'MAGNIFIC_API_KEY');

/** Which steps this house can run right now. */
export async function retouchEngines(): Promise<{ openai: boolean; magnific: boolean }> {
  const [o, m] = await Promise.all([openaiKey(), magnificKey()]);
  return { openai: !!o, magnific: !!m };
}

/**
 * The retouching brief. Follows the house's image-prompt rules (lib/social/prompts.ts):
 * the piece first, its identity pinned, the metal never named (the model recolours what
 * it is told), and what to avoid last.
 */
export function retouchPrompt(parts: RetouchPart[]): string {
  const want = new Set(parts.length ? parts : RETOUCH_PARTS);
  const lines = [
    'Retouch this jewellery product photograph for a fine-jewellery catalogue.',
    'The piece must stay exactly the same: the same design, shape and proportions; every stone in the same place with the same cut, size, count and colour; the same metal colour and finish; the same engraving, chain, links and clasp. Do not add, remove, move or redesign anything on the piece.',
  ];
  if (want.has('jewelry')) lines.push('The piece: remove dust, lint, fingerprints, fine scratches and spots; make the metal clean and polished with crisp, even highlights; make the stones clear and bright with natural sparkle; keep edges and fine detail sharp.');
  if (want.has('background')) lines.push('The background: keep the same background, surface, stand or bust, but clean it — remove dust, marks, stray threads, creases and uneven patches, and make it smooth and even.');
  else lines.push('Leave the background exactly as it is.');
  if (want.has('light')) lines.push('Light and colour: correct the white balance and exposure, balanced contrast, true natural colours, no heavy filter or colour cast.');
  lines.push(
    'Keep the framing, angle, crop and composition exactly as in the original. If a weight or a logo is printed on the photo, keep it exactly as it is.',
    'Photorealistic studio product photography.',
    'Avoid: any change to the design, extra or missing stones, warped or melted metal, a plastic or CGI look, over-sharpened halos, blur, new props, text, logos or watermarks that were not there.',
  );
  return lines.join('\n');
}

/** A size gpt-image-2 accepts (both sides divisible by 16, 1:3 to 3:1) near the photo's own shape; the older models' three. */
function openaiSize(model: string, w: number, h: number): string {
  if (!/^gpt-image-2/.test(model)) {
    const r = w / h;
    return r > 1.2 ? '1536x1024' : r < 0.83 ? '1024x1536' : '1024x1024';
  }
  const ratio = Math.min(3, Math.max(1 / 3, w / h));
  const long = OPENAI_EDGE;
  const [W, H] = ratio >= 1 ? [long, long / ratio] : [long * ratio, long];
  const r16 = (n: number) => Math.max(256, Math.round(n / 16) * 16);
  return `${r16(W)}x${r16(H)}`;
}

async function openaiEdit(jpeg: Buffer, prompt: string, key: string): Promise<Buffer> {
  const model = OPENAI_MODEL();
  const meta = await sharp(jpeg).metadata();
  const send = async (size: string) => {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', prompt);
    form.append('image', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'photo.jpg');
    form.set('size', size);
    form.set('quality', 'high');
    form.set('output_format', 'jpeg');
    form.set('n', '1');
    // Only the gpt-image-1 family takes input_fidelity; gpt-image-2 always works at high fidelity.
    if (/^gpt-image-1/.test(model)) form.set('input_fidelity', 'high');
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(200_000),
    });
    const d = await res.json().catch(() => ({})) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    return { res, d };
  };
  let { res, d } = await send(openaiSize(model, meta.width || 1024, meta.height || 1024));
  // A size the model won't take: let it choose its own.
  if (res.status === 400 && /size/i.test(d.error?.message || '')) ({ res, d } = await send('auto'));
  if (!res.ok || !d.data?.[0]?.b64_json) {
    const msg = d.error?.message || `status ${res.status}`;
    throw new AiError(`OpenAI couldn't retouch it: ${msg}`, res.status === 401 || res.status === 403 ? 503 : res.status === 429 ? 429 : 502);
  }
  return Buffer.from(d.data[0].b64_json, 'base64');
}

const MAGNIFIC = 'https://api.magnific.com/v1/ai/image-upscaler-precision';

async function magnificDetail(jpeg: Buffer, key: string): Promise<Buffer> {
  const input = await sharp(jpeg).resize({ width: MAGNIFIC_EDGE, height: MAGNIFIC_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const headers = { 'x-magnific-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' };
  const start = await fetch(MAGNIFIC, {
    method: 'POST', headers, signal: AbortSignal.timeout(30_000),
    // Gentle: detail back without the grain or crunch a product photo doesn't want.
    body: JSON.stringify({ image: input.toString('base64'), sharpen: 35, smart_grain: 0, ultra_detail: 30 }),
  });
  const s = await start.json().catch(() => ({})) as { data?: { task_id?: string }; message?: string };
  if (!start.ok || !s.data?.task_id) {
    throw new AiError(`Magnific couldn't take it: ${s.message || `status ${start.status}`}`, start.status === 401 ? 503 : start.status === 429 ? 429 : 502);
  }
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3_000));
    const res = await fetch(`${MAGNIFIC}/${s.data.task_id}`, { headers, signal: AbortSignal.timeout(20_000) });
    const t = await res.json().catch(() => ({})) as { data?: { status?: string; generated?: string[] }; message?: string };
    const status = t.data?.status;
    if (status === 'COMPLETED' && t.data?.generated?.[0]) {
      const img = await fetch(t.data.generated[0], { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new AiError(`Magnific's result didn't download (${img.status}).`, 502);
      return Buffer.from(await img.arrayBuffer());
    }
    if (status === 'FAILED') throw new AiError('Magnific couldn’t finish this photo. Try again.', 502);
  }
  throw new AiError('Magnific is taking too long. Try again in a minute.', 504);
}

export interface Retouched { image: InlineImage; steps: string[] }

/** Retouch a photo with whatever is set up; at least one of the two keys must be. */
export async function retouchPhoto(photo: Buffer, parts: RetouchPart[]): Promise<Retouched> {
  const [oKey, mKey] = await Promise.all([openaiKey(), magnificKey()]);
  if (!oKey && !mKey) {
    throw new AiError('Retouching isn’t set up for this shop yet: add openai-api-key and/or magnific-api-key in Secret Manager.', 503);
  }
  const steps: string[] = [];
  let out = await sharp(photo).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  if (oKey) {
    const small = await sharp(out).resize({ width: OPENAI_EDGE, height: OPENAI_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    out = await openaiEdit(small, retouchPrompt(parts), oKey);
    steps.push(`OpenAI ${OPENAI_MODEL()}`);
  }
  if (mKey) {
    out = await magnificDetail(out, mKey);
    steps.push('Magnific Precision');
  }
  const final = await sharp(out).resize({ width: CATALOGUE_EDGE, height: CATALOGUE_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { image: { mimeType: 'image/jpeg', data: final.toString('base64') }, steps };
}
