/**
 * The vision model looks at the house's photographs as ads, several to a call.
 *
 * Ten photographs a request, each at 640 px: the Vertex key's project allows only a
 * handful of calls a minute (CLAUDE.md, "One Vertex AI key"), so one call a photo would
 * take a working day for the whole library and ten take under an hour. The model answers
 * one assessment per photograph by its number; each is checked by normalizeAssessment
 * before it is stored, and one it skipped is simply asked again next time.
 *
 * Server-only.
 */

import { CHECK_MODEL, generateJson, prepareImage } from '@/lib/social/ai';
import { assetJpeg, saveAssessment, type StudioAsset } from './assets';
import { normalizeAssessment, FIXES, type AssetAssessment } from './assessment';
import { brandBrief } from './brand';

export const ASSESS_BATCH = 10;
export const ASSESS_MODEL = process.env.AD_STUDIO_MODEL?.trim() || CHECK_MODEL;

const SYSTEM = `You are the senior creative director for a jewellery house's paid social (Meta: Instagram and Facebook feed, stories and reels, in Pakistan). You judge photographs strictly, as ads a stranger will scroll past on a phone, never as catalogue records.

${brandBrief()}

HOW TO SCORE ONE PHOTOGRAPH
- score 0–100, its readiness as an ad as it stands: 85+ runs today; 70–84 good after a small fix; 50–69 only after real work; under 50 not for ads.
- placements 0–100 each: square (1:1 feed), portrait (4:5 feed), story (9:16 stories and reels). Judge whether the piece survives that crop with room to spare — in a story the piece must sit clear of the top 14% and bottom 35%, where the app draws its own buttons. A square photo with a centred piece usually scores lower for story; say so with the fix "extend-story".
- quality 0–10 each: sharpness (metal detail, stone facets), lighting (the metal should gleam, stones should spark, no flat grey), composition (the piece large and deliberate in the frame), colour (true metal colour, clean whites).
- burnedText: true when any text, number, label, weight or watermark is on the photograph itself.
- brandRisks: only real breaches of the house's rules visible in the picture — sale or discount text, a meme or trend look, loud stickers or bursts, another brand's mark or watermark, cheap props. A price, a karat or a weight on the photo is allowed and is not a risk. Empty when none.
- strengths and issues: short phrases a shopkeeper would use, at most four each.
- fixes: only from this list, only when the fix would lift the score: ${Object.entries(FIXES).map(([k, v]) => `${k} (${v.label.toLowerCase()})`).join(', ')}.
- headline: at most seven words for this piece in the house's voice — heritage, craft, trust; no figures (the maker adds the ERP's own), no emoji.
- subject: one plain line saying what is in the picture. category: ring, bangle, bracelet, necklace, necklace set, earrings, pendant, chain, set, watch, or other. shot: packshot, on-hand, on-model, lifestyle, flatlay, boxed, graphic or other. background: clean, textured, box or busy.

Answer for every photograph, in order, each with its number.`;

const ITEM = {
  type: 'OBJECT',
  properties: {
    photo: { type: 'INTEGER' },
    score: { type: 'NUMBER' },
    placements: { type: 'OBJECT', properties: { square: { type: 'NUMBER' }, portrait: { type: 'NUMBER' }, story: { type: 'NUMBER' } }, required: ['square', 'portrait', 'story'] },
    subject: { type: 'STRING' },
    category: { type: 'STRING' },
    shot: { type: 'STRING' },
    background: { type: 'STRING' },
    quality: { type: 'OBJECT', properties: { sharpness: { type: 'NUMBER' }, lighting: { type: 'NUMBER' }, composition: { type: 'NUMBER' }, colour: { type: 'NUMBER' } }, required: ['sharpness', 'lighting', 'composition', 'colour'] },
    burnedText: { type: 'BOOLEAN' },
    brandRisks: { type: 'ARRAY', items: { type: 'STRING' } },
    strengths: { type: 'ARRAY', items: { type: 'STRING' } },
    issues: { type: 'ARRAY', items: { type: 'STRING' } },
    fixes: { type: 'ARRAY', items: { type: 'STRING' } },
    headline: { type: 'STRING' },
  },
  required: ['photo', 'score', 'placements', 'subject', 'category', 'shot', 'background', 'quality', 'burnedText', 'brandRisks', 'strengths', 'issues', 'fixes', 'headline'],
};
const SCHEMA = { type: 'OBJECT', properties: { photos: { type: 'ARRAY', items: ITEM } }, required: ['photos'] };

export interface BatchResult {
  done: { id: string; assessment: AssetAssessment }[];
  failed: { id: string; error: string }[];
}

/** Assess up to ASSESS_BATCH assets in one model call and store what comes back. */
export async function assessBatch(assets: StudioAsset[]): Promise<BatchResult> {
  const batch = assets.slice(0, ASSESS_BATCH);
  const failed: BatchResult['failed'] = [];
  const loaded: { asset: StudioAsset; image: { mimeType: string; data: string } }[] = [];
  // One photograph at a time: ten decoded together took a 512 MiB instance past its limit (2026-10-01).
  for (const asset of batch) {
    try { loaded.push({ asset, image: await prepareImage(await assetJpeg(asset.id, 640)) }); }
    catch (e) { failed.push({ id: asset.id, error: e instanceof Error ? e.message : 'Could not load the photograph.' }); }
  }
  if (!loaded.length) return { done: [], failed };

  const parts = loaded.flatMap(({ asset, image }, i) => [
    { text: `Photograph ${i + 1} — "${asset.name}" (${asset.source === 'site' ? 'on the website' : 'from a shoot'}, ${asset.collection}):` },
    { inlineData: image },
  ]);
  parts.push({ text: `Assess all ${loaded.length} photographs.` });

  const answer = await generateJson<{ photos?: (Record<string, unknown> & { photo?: number })[] }>({
    model: ASSESS_MODEL, system: SYSTEM, parts, schema: SCHEMA, temperature: 0.2,
  });

  const done: BatchResult['done'] = [];
  const byNumber = new Map((answer.photos ?? []).map(p => [Number(p.photo), p]));
  await Promise.all(loaded.map(async ({ asset }, i) => {
    const a = normalizeAssessment(byNumber.get(i + 1));
    if (!a) { failed.push({ id: asset.id, error: 'The model skipped it.' }); return; }
    await saveAssessment(asset, a, ASSESS_MODEL);
    done.push({ id: asset.id, assessment: a });
  }));
  return { done, failed };
}
