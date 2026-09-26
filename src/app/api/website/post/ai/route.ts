/**
 * Post a Piece — the AI.
 *
 *   POST multipart { op, params (JSON), image… }
 *
 *   enhance   image[0]            → the same photo, retouched (same shape)
 *   reframe   image[0], {aspect}  → the photo extended to a new shape (9:16 for a story)
 *   restage   image[0..2], {sceneId | scene, aspect} → the piece in a new setting
 *   letter    image[0] = a finished 9:16 background, {text…} → the story lettered by the model,
 *             read back and compared with what was asked
 *   caption   image[0..1], {facts} → headlines, hook, WhatsApp and Instagram captions,
 *             and a plan for the story (scene, colours, layout)
 *   check     image[0] = reference, image[1] = edit → is it the same piece?
 *   retouch   image[0], {parts: jewelry|background|light} → the same photo retouched by
 *             OpenAI's image model, then its detail restored by Magnific (lib/social/retouch.ts)
 *
 * Every image edit is checked against the photo it came from before it is
 * returned — a model that quietly moves a stone must not reach a customer
 * looking like the real thing. The check is advice shown on the page, not a
 * block: the counter decides.
 *
 * Follows NEXT_PUBLIC_OPEN_ACCESS like the rest of the website routes, and so
 * is capped: IMAGE_AI_DAILY_CAP calls a day for the whole shop (default 300)
 * and 60 an hour from any one address, which bounds what a stranger who finds
 * the URL could spend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';
import { AiError, CHECK_MODEL, aiConfigured, generateImage, generateJson, generateText, prepareImage, type InlineImage } from '@/lib/social/ai';
import {
  ASPECTS, CAPTION_SCHEMA, CHECK_PROMPT, CHECK_SCHEMA, CHECK_SYSTEM, READ_PROMPT, SCENES,
  captionSystem, captionUserPrompt, customPrompt, enhancePrompt, letteringPrompt, nearestAspect, reframePrompt, restagePrompt, sameText,
  type Aspect, type CaptionResult, type CheckResult, type LetteringText,
} from '@/lib/social/prompts';
import { whatsappCaption } from '@/lib/social/caption';
import { PALETTES } from '@/lib/social/palettes';
import { STORE_BRAND, STORE_CONFIG, STORE_POST_FOOTER, STORE_POST_PIECE, STORE_POST_TAGLINE } from '@/lib/store-config';
import { notInThisShop } from '@/lib/social/gate';
import sharp from 'sharp';
import { recordError } from '@/lib/social/errors';
import { RETOUCH_PARTS, retouchPhoto, type RetouchPart } from '@/lib/social/retouch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';
const DAILY_CAP = Number(process.env.IMAGE_AI_DAILY_CAP) || 300;
const MAX_BYTES = 25 * 1024 * 1024;

async function gate(req: NextRequest): Promise<string | NextResponse> {
  if (!STORE_POST_PIECE) return notInThisShop();
  if (OPEN_ACCESS) return 'counter';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

/** "TAHERI" → "Taheri": the name as a sentence says it. */
const shopName = () => (STORE_CONFIG.name || 'TAHERI').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

/** Is the edit the same piece as the reference? Never throws: a failed check reads as "not checked". */
async function checkSame(reference: InlineImage, edit: InlineImage): Promise<CheckResult | null> {
  try {
    return await generateJson<CheckResult>({
      model: CHECK_MODEL,
      system: CHECK_SYSTEM,
      parts: [{ inlineData: reference }, { inlineData: edit }, { text: CHECK_PROMPT }],
      schema: CHECK_SCHEMA,
      temperature: 0,
    });
  } catch (e) {
    console.warn('[post ai] check failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  if (!aiConfigured()) return NextResponse.json({ error: 'AI is not set up for this shop (IMAGE_AI_PROJECT).' }, { status: 503 });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'Send the request as multipart/form-data.' }, { status: 400 }); }
  const op = String(form.get('op') || '');
  let params: Record<string, unknown> = {};
  try { params = JSON.parse(String(form.get('params') || '{}')); } catch { /* empty */ }
  const files = form.getAll('image').filter((f): f is File => f instanceof File).slice(0, 4);
  if (files.some(f => f.size > MAX_BYTES)) return NextResponse.json({ error: 'An image is over 25 MB.' }, { status: 413 });

  const [shop, caller] = await Promise.all([
    rateLimit('post-ai-day', 'shop', DAILY_CAP, 86_400),
    rateLimit('post-ai-hour', callerKey(req.headers), 60, 3_600),
  ]);
  if (!shop.ok || !caller.ok) {
    const wait = Math.ceil(Math.max(shop.ok ? 0 : shop.retryAfter, caller.ok ? 0 : caller.retryAfter) / 60);
    return NextResponse.json({ error: `The AI limit for now is reached. Try again in about ${wait} minute${wait === 1 ? '' : 's'}.` }, { status: 429 });
  }

  const started = Date.now();
  try {
    const images = await Promise.all(files.map(async f => prepareImage(Buffer.from(await f.arrayBuffer()))));
    const need = (n: number) => { if (images.length < n) throw new AiError(`Send ${n === 1 ? 'a photo' : `${n} images`} with this request.`, 400); };
    const aspectOf = (v: unknown, fallback: Aspect): Aspect => (ASPECTS as readonly string[]).includes(String(v)) ? (v as Aspect) : fallback;
    const tidy = params.tidy !== false;

    let result: Record<string, unknown>;
    switch (op) {
      case 'enhance':
      case 'reframe':
      case 'restage':
      case 'custom': {
        need(1);
        const meta = await sharp(Buffer.from(images[0].data, 'base64')).metadata();
        const own = nearestAspect(meta.width || 1, meta.height || 1);
        // 'custom' keeps the photo's own shape unless a shape is asked for.
        const aspect = op === 'enhance' || (op === 'custom' && !params.aspect) ? own : aspectOf(params.aspect, '9:16');
        // The counter may edit the whole prompt on the page; theirs is used as written.
        const raw = String(params.rawPrompt || '').trim().slice(0, 4000);
        let prompt: string;
        if (raw) prompt = raw;
        else if (op === 'custom') {
          const instruction = String(params.instruction || '').trim().slice(0, 1000);
          if (!instruction) throw new AiError('Say what you want changed.', 400);
          prompt = customPrompt(instruction, params.aspect ? aspect : null);
        } else if (op === 'enhance') prompt = enhancePrompt({ tidy });
        else if (op === 'reframe') prompt = reframePrompt(aspect, tidy);
        else {
          const custom = String(params.scene || '').trim().slice(0, 400);
          const preset = SCENES.find(s => s.id === params.sceneId);
          if (!custom && !preset) throw new AiError('Choose a setting or describe one.', 400);
          prompt = restagePrompt(custom || preset!.brief, aspect);
        }
        const image = await generateImage({ images, prompt, aspect });
        const check = await checkSame(images[0], { mimeType: image.mimeType, data: image.data });
        result = { image, check, aspect };
        break;
      }
      case 'retouch': {
        need(1);
        const asked = Array.isArray(params.parts) ? params.parts.filter((x): x is RetouchPart => (RETOUCH_PARTS as string[]).includes(String(x))) : [];
        const meta = await sharp(Buffer.from(images[0].data, 'base64')).metadata();
        const { image, steps } = await retouchPhoto(Buffer.from(images[0].data, 'base64'), asked);
        // The check reads a 2048-px copy, like every other edit it compares.
        const check = await checkSame(images[0], await prepareImage(Buffer.from(image.data, 'base64')));
        result = { image, check, aspect: nearestAspect(meta.width || 1, meta.height || 1), steps };
        break;
      }
      case 'letter': {
        need(1);
        const t = params as unknown as LetteringText;
        if (!t.headline) throw new AiError('A headline is needed to letter the story.', 400);
        const image = await generateImage({ images, prompt: letteringPrompt(t), aspect: '9:16' });
        // Read it back: an image model can misspell, and a wrong weight on a story is worse than none.
        const read = await generateText({ parts: [{ inlineData: { mimeType: image.mimeType, data: image.data } }, { text: READ_PROMPT }] }).catch(() => '');
        const lines = read.split('\n').map(s => s.trim()).filter(Boolean);
        const wanted = [t.kicker, t.headline, t.weight, t.details].filter(Boolean) as string[];
        const missing = wanted.filter(w => !lines.some(l => sameText(l, w)) && !sameText(lines.join(' '), w) && !lines.join(' ').toLowerCase().includes(w.toLowerCase()));
        result = { image, lettering: { read: lines, missing, verified: !!read && missing.length === 0 } };
        break;
      }
      case 'caption': {
        need(1);
        const facts = params as Record<string, string | string[]>;
        const numbers = Array.isArray(facts.numbers) ? facts.numbers.map(String) : [];
        const c = await generateJson<CaptionResult>({
          system: captionSystem(shopName(), STORE_BRAND),
          parts: [...images.slice(0, 2).map(i => ({ inlineData: i })), { text: captionUserPrompt({
            shop: shopName(),
            headline: String(facts.headline || ''), weight: String(facts.weight || ''), metal: String(facts.metal || ''),
            stones: String(facts.stones || ''), collection: String(facts.collection || ''), numbers, link: String(facts.link || ''),
            tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER,
            scenes: SCENES, palettes: PALETTES.map(p => ({ id: p.id, label: p.label })),
            brief: String(facts.brief || '').slice(0, 500),
          }) }],
          schema: CAPTION_SCHEMA,
        });
        // The facts are the counter's, not the model's. If the caption dropped or changed
        // the weight or a number, keep the model's words but rebuild the frame around them.
        const weight = String(facts.weight || '');
        const faithful = (!weight || c.whatsappCaption.includes(weight)) && numbers.every(n => c.whatsappCaption.includes(n))
          && (!STORE_POST_FOOTER || c.whatsappCaption.includes(STORE_POST_FOOTER))
          && !/najmi|saddar/i.test(c.whatsappCaption);
        if (!faithful) {
          c.whatsappCaption = whatsappCaption(
            { headline: String(facts.headline || c.headlines[0] || ''), metal: String(facts.metal || ''), weight: weight.replace(/g(\s*each)?$/i, ''), weightEach: /each$/i.test(weight), stones: String(facts.stones || ''), hook: c.hook },
            { whatsappNumbers: numbers, link: String(facts.link || ''), tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER },
          );
        }
        if (!SCENES.some(s => s.id === c.sceneId)) c.sceneId = SCENES[0].id;
        if (!PALETTES.some(p => p.id === c.paletteId)) c.paletteId = PALETTES[0].id;
        result = { caption: { ...c, rebuilt: !faithful } };
        break;
      }
      case 'check': {
        need(2);
        result = { check: await checkSame(images[0], images[1]) };
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown op "${op}".` }, { status: 400 });
    }
    console.log(`[post ai] ${op} by ${who} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const status = e instanceof AiError ? e.status : 502;
    console.warn(`[post ai] ${op} failed after ${((Date.now() - started) / 1000).toFixed(1)}s:`, e instanceof Error ? e.message : e);
    await recordError(op === 'caption' ? 'caption' : 'ai', e, { op, by: who });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI request failed' }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
