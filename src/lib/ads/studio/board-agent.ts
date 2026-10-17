/**
 * The Studio's boards for an agent (Claude Code, Codex, Cursor …): the Model Context Protocol's
 * tools, served by /api/studio/mcp over plain JSON-RPC (Streamable HTTP, JSON answers only).
 * What pen.dev does with its .pen files, on the house's own photographs, layouts and rules.
 *
 * The agent works like the page: it adds a design with a layout (template) and words, and the
 * server lays it out and draws it at once (server-draw.ts, since 2026-10-15 — before, only an open
 * page could); `view_design` shows the agent that drawing, drawing it first when it is stale. Words an agent writes go
 * through the same rules as the AI's (no sale words or hashtags; no figure the ERP didn't give).
 * Server-only.
 */

import { BRAND, brandBrief } from './brand';
import { AD_FORMATS, AD_TEMPLATES } from './templates';
import { breaksHouseRule, inventedFigures } from './prompts';
import { listAssets, loadAssessments, assetJpeg } from './assets';
import { adScore } from './assessment';
import { changeBoard, createBoard, getBoard, getView, listBoards, viewRevs } from './board';
import { BOARD_SCALE, framePx, isTemplateId, safeTemplate, wordsOf, type BoardFrame, type BoardOp } from './board-shape';
import { isAdFormat } from './templates';
import { addUpload } from './uploads';
import { MAIN, replacePicture } from './board-pictures';
import { FONT_LABEL } from '@/lib/social/editor';
import { settleBoard } from './server-draw';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: `${BRAND.identity.name.toLowerCase()}-studio`, version: '1.0.0' };

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult { content: Content[]; isError?: boolean }
const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const json = (v: unknown): ToolResult => text(JSON.stringify(v, null, 1));
const oops = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true });

const S = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const N = (description: string) => ({ type: 'number', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const FIELDS = obj({
  kicker: S('Small line above the headline (≤ 40 chars), e.g. the collection.'),
  headline: S('The headline (≤ 60 chars), in the house voice.'),
  weight: S('The specs line, exactly as the ERP gives it (find_photos → specs). Never invent a figure.'),
  details: S('The call to action (≤ 40 chars).'),
});
const FORMAT = S('The shape.', { enum: Object.keys(AD_FORMATS) });
const TEMPLATE = S('The layout.', { enum: AD_TEMPLATES.map(t => t.id) });

/** The most picture bytes upload_photo takes, decoded. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/** Base64 (or a data: URL) to bytes; throws with what was wrong. */
export function decodePicture(data: unknown): Buffer {
  if (typeof data !== 'string' || !data.trim()) throw new Error('upload_photo needs `data`: the picture file as base64.');
  const raw = data.trim().replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '');
  if (raw.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4) throw new Error(`That picture is over ${MAX_UPLOAD_MB} MB.`);
  if (!raw || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) throw new Error('`data` is not valid base64.');
  const buf = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!buf.length) throw new Error('`data` is not valid base64.');
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error(`That picture is over ${MAX_UPLOAD_MB} MB.`);
  return buf;
}

export const TOOLS = [
  { name: 'get_style', description: 'Read FIRST. The house brief (voice, hard rules, marks, visual rules), the layouts, the shapes, the design document format and how to work on a board.', inputSchema: obj({}) },
  { name: 'list_boards', description: 'The boards, newest first.', inputSchema: obj({}) },
  { name: 'create_board', description: 'Make a new board.', inputSchema: obj({ name: S('Its name.') }, ['name']) },
  { name: 'get_board', description: 'A board: every design (id, position, shape, layout, words, photo, document, whether its drawing is current) and every sticky note. Notes are the owner\'s instructions — read them.', inputSchema: obj({ board: S('Board id.'), docs: { type: 'boolean', description: 'Include each design\'s full layout document (default false).' } }, ['board']) },
  { name: 'find_photos', description: 'Search the photo library (taheri.shop pieces and the shared Drive): id, name, collection, the ERP\'s specs line, the AI assessment\'s headline and ad score.', inputSchema: obj({ query: S('Words in the name, collection or subject.'), collection: S('Exact collection name.'), source: S('site or drive.', { enum: ['site', 'drive'] }), limit: N('At most 40 (default 12).') }) },
  { name: 'view_photo', description: 'Look at a library photo.', inputSchema: obj({ id: S('Photo id from find_photos.') }, ['id']) },
  { name: 'add_design', description: 'Put a new design on a board: a photo, a shape, a layout and its words. The server lays it out and draws it at once; view_design shows it.', inputSchema: obj({ board: S('Board id.'), photo: S('Photo id from find_photos.'), format: FORMAT, template: TEMPLATE, fields: FIELDS, label: S('A short name shown above it.'), near: S('Id of a design to place it beside.'), why: S('One line: the idea behind it.') }, ['board', 'photo']) },
  { name: 'update_design', description: 'Change a design. A new layout or shape lays it out afresh (hand edits go); new words keep the layout. `doc` replaces the whole layout document (see get_style) — for fine changes only.', inputSchema: obj({ board: S('Board id.'), id: S('Design id.'), template: TEMPLATE, format: FORMAT, fields: FIELDS, label: S('Its name.'), why: S('The idea.'), doc: { type: 'object', description: 'The full layout document (get_board with docs:true for the current one).' }, sizes: S('Put it with the other sizes of the same ad: their shared `sizes` name (get_board), or a new one; "" takes it out. Linked texts are edited as one across a design\'s sizes.'), only_this_size: { type: 'boolean', description: 'Keep this change off the design\'s other sizes (default false: words and style of linked texts go to every size).' } }, ['board', 'id']) },
  { name: 'move_design', description: 'Move a design on the board (board units; a 1080-px-wide design is 360 across).', inputSchema: obj({ board: S('Board id.'), id: S('Design id.'), x: N('Left.'), y: N('Top.') }, ['board', 'id', 'x', 'y']) },
  { name: 'remove_design', description: 'Take a design off a board.', inputSchema: obj({ board: S('Board id.'), id: S('Design id.') }, ['board', 'id']) },
  { name: 'add_note', description: 'Leave a sticky note on a board for the owner (a question, the reasoning behind a set of designs).', inputSchema: obj({ board: S('Board id.'), text: S('The note.'), x: N('Left (optional).'), y: N('Top (optional).') }, ['board', 'text']) },
  { name: 'remove_note', description: 'Take a note off a board.', inputSchema: obj({ board: S('Board id.'), id: S('Note id.') }, ['board', 'id']) },
  { name: 'view_design', description: 'Look at a design as drawn. The server draws it first when the drawing is missing or older than the design, so the board does not need to be open.', inputSchema: obj({ board: S('Board id.'), id: S('Design id.') }, ['board', 'id']) },
  { name: 'upload_photo', description: `Put a picture of your own in the photo library, exactly as the ERP's own uploads are kept (a non-picture is refused; it is stored upright, at most 2400 px, under 900 KB, PNG if it has transparency). Send the file's bytes as base64 (a data: URL also works); at most ${MAX_UPLOAD_MB} MB decoded. Answers the library id (\`up:…\`) and size, which add_design, replace_design_photo, find_photos and view_photo take.`, inputSchema: obj({ data: S('The picture file, base64 (or a data: URL).'), name: S('Its name in the library (a filename also works).'), filename: S('The original filename, used as the name when none is given.'), mime: S('Its type, e.g. image/jpeg (optional; must be an image).') }, ['data']) },
  { name: 'replace_design_photo', description: 'Swap the photo of a design for another library photo (find_photos, or upload_photo\'s id). Only the picture changes: the words, layers, layout, crop, placement, template, fields and label stay. Pass `layer` (an image layer\'s id from get_board with docs:true, or "bg" for a library background) to swap that picture instead of the design\'s own photo. Then view_design once the page has redrawn it.', inputSchema: obj({ board: S('Board id.'), id: S('Design id.'), photo: S('Library photo id (find_photos, upload_photo).'), layer: S('Optional: an image layer id, or "bg", to replace that picture instead of the design\'s own photo.') }, ['board', 'id', 'photo']) },
] as const;

function styleGuide(): string {
  const formats = Object.entries(AD_FORMATS).map(([k, f]) => `- ${k}: ${f.label}, ${f.frame.w}×${f.frame.h} px — ${f.where}`).join('\n');
  const layouts = AD_TEMPLATES.map(t => `- ${t.id}: ${t.label} — ${t.note}`).join('\n');
  return [
    `# ${BRAND.identity.name} Studio — how to design here`,
    brandBrief(),
    `## Shapes (format)\n${formats}`,
    `## Layouts (template)\n${layouts}\nA 9:16 story, or a website photo with the wordmark burned in (markedByWebsite in find_photos), always gets the framed layout instead of a full-bleed one (headline, clean, band, certified): over-photo words cross the piece on a story, and a crop cuts the burned-in mark.\nThe layout draws the words from \`fields\` (kicker, headline, weight = the ERP's specs line, details = call to action) in the house's type, colours and marks. Prefer choosing a layout and writing words over writing documents by hand.`,
    `## Words\n- Use the photo's \`specs\` line from find_photos as \`weight\`, exactly. Never add a figure (karat, weight, price, carat, year) that the ERP didn't give: it is refused.\n- No sale or discount words, no hashtags: refused.\n- Prices are allowed only when the owner gives one in a note.`,
    `## The layout document (doc), for fine changes\nA StoryDoc: { bg: { photoId: "photo", placement: { mode: "fill", zoom, focusX, focusY }, dim (0–1), gradient, color }, layers: Layer[], frame: { w, h } }. Coordinates are design pixels from the top left.\n- text: { id, kind:"text", text, bind?: "kicker"|"headline"|"weight"|"details" (bound text shows that field), link?: a key shared with the same text in the design's other sizes (a bound text is linked by its field), unlinked?: true to free it, x, y (y is the first line's baseline), size, font, color, align:"left"|"center"|"right", width, fit, spacing (em), lineHeight, upper, shadow, box: null | { color, radius, pad }, rotate, opacity }\n- wordmark: { id, kind:"wordmark", mark:"wordmark"|"t", x, y, width, color, autoColor, rotate, opacity }\n- rect/circle/line/arrow/shape: { id, kind, x, y, w, h, color, stroke, fill, curve, radius, rotate, opacity }\n- image: { id, kind:"image", photoId:"photo", x, y, w, h?, radius, border, shadow, rotate, opacity }\nFonts: ${Object.keys(FONT_LABEL).join(', ')}. At most 80 layers, 60 KB.`,
    `## Working on a board\n1. get_board — read the owner's notes first.\n2. find_photos → view_photo to choose.\n3. add_design (several, with \`near\` to set variants side by side; label each, give \`why\`).\n4. view_design to check each one (the server draws it); update_design to fix.\n5. add_note to explain the set or ask a question.\nSizes: a design and its other shapes share \`sizes\`; a text linked across them (same \`link\`, or the same \`bind\`) takes a change to its words or style in every size, its size by the same ratio, its place and width staying each size's own. update_design with only_this_size:true to change one alone.\nOn the board a design is drawn at ${Math.round(BOARD_SCALE * 100)}% of its pixel size; designs sit in rows 48 units apart.`,
  ].join('\n\n');
}

/** The owner's rules on the words of a design an agent wrote; empty when they pass. */
export function wordProblems(f: Pick<BoardFrame, 'fields' | 'doc'>): string[] {
  const facts = f.fields.weight;
  const out: string[] = [];
  for (const w of wordsOf(f)) {
    if (breaksHouseRule(w)) out.push(`“${w}” has sale/discount words or a hashtag`);
    const made = inventedFigures(w, facts);
    if (made.length) out.push(`“${w}” has ${made.join(', ')}, which the ERP didn't give (the specs line is “${facts || 'empty'}”)`);
  }
  return out;
}

const summary = (f: BoardFrame, drawn: number | undefined, docs: boolean) => ({
  id: f.id, label: f.label, x: Math.round(f.x), y: Math.round(f.y), format: f.format, size: framePx(f), template: f.template,
  fields: f.fields, photo: f.assetId, by: f.by, rev: f.rev, why: f.why ?? null, sizes: f.group ?? null,
  laidOut: !!f.doc, drawing: drawn === f.rev ? 'current' : drawn ? `stale (shows rev ${drawn})` : 'not drawn yet',
  ...(docs ? { doc: f.doc } : {}),
});

/** Lay out and draw on the server what a change touched (server-draw.ts); a line saying how it went. */
async function drawNow(board: string, ids: string[]): Promise<string> {
  try {
    const r = await settleBoard(board, { ids });
    const bad = r.filter(x => x.error);
    return bad.length ? ` The server couldn't draw ${bad.map(x => `${x.id} (${x.error})`).join(', ')}; the page draws it when the board is open.` : ' Laid out and drawn on the server; view_design shows it.';
  } catch (e) { return ` The server couldn't draw it (${e instanceof Error ? e.message : String(e)}); the page draws it when the board is open.`; }
}

async function boardOf(id: unknown) {
  const b = typeof id === 'string' && /^[\w-]{1,40}$/.test(id) ? await getBoard(id) : null;
  if (!b) throw Object.assign(new Error(`No board “${String(id)}” — list_boards gives the ids.`), { status: 404 });
  return b;
}

export async function callTool(name: string, args: Record<string, unknown>, who: string): Promise<ToolResult> {
  const by = `agent:${who}`;
  const change = (board: string, ops: BoardOp[]) => changeBoard(board, ops, by);
  switch (name) {
    case 'get_style': return text(styleGuide());
    case 'list_boards': return json(await listBoards());
    case 'create_board': { const b = await createBoard(String(args.name ?? ''), by); return json({ id: b.id, name: b.name }); }
    case 'get_board': {
      const b = await boardOf(args.board);
      const drawn = await viewRevs(b.id);
      return json({ id: b.id, name: b.name, rev: b.rev, notes: b.notes, designs: b.frames.map(f => summary(f, drawn[f.id], args.docs === true)) });
    }
    case 'find_photos': {
      const [lib, assessed] = await Promise.all([listAssets(), loadAssessments()]);
      const words = String(args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const limit = Math.min(40, Math.max(1, Number(args.limit) || 12));
      const rows = lib.assets.filter(a => (!args.source || a.source === args.source) && (!args.collection || a.collection === args.collection))
        .map(a => ({ a, s: assessed.get(a.id)?.assessment ?? null }))
        .filter(({ a, s }) => words.every(w => `${a.name} ${a.collection} ${s?.subject ?? ''} ${s?.category ?? ''}`.toLowerCase().includes(w)))
        .sort((x, y) => (y.s ? adScore(y.s, 'portrait') : -1) - (x.s ? adScore(x.s, 'portrait') : -1))
        .slice(0, limit)
        .map(({ a, s }) => ({ id: a.id, name: a.name, collection: a.collection, source: a.source, specs: a.specs, page: a.page, subject: s?.subject ?? null, headline: s?.headline ?? null, adScore: s ? adScore(s, 'portrait') : null, markedByWebsite: a.source === 'site' }));
      return json(rows);
    }
    case 'view_photo': {
      const jpeg = await assetJpeg(String(args.id ?? ''), 768);
      return { content: [{ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' }] };
    }
    case 'add_design': {
      const b = await boardOf(args.board);
      const photo = String(args.photo ?? '');
      const lib = await listAssets();
      const asset = lib.assets.find(a => a.id === photo);
      if (!asset) return oops(`No photo “${photo}” — find_photos gives the ids.`);
      const fields = { kicker: '', headline: asset.name, weight: asset.specs, details: BRAND.voice.ctas[0].replace(/\.$/, ''), ...(args.fields as object ?? {}) };
      // A website photo carries the burned-in wordmark; its unmarked Drive original is used when there is one (as the maker does).
      const marked = asset.source === 'site' && !asset.original;
      const format = isAdFormat(args.format) ? args.format : 'portrait';
      const frame = { assetId: asset.original?.id ?? photo, marked, format, template: safeTemplate(isTemplateId(args.template) ? args.template : 'headline', { marked, format }), fields, label: args.label ?? asset.name, why: args.why, by: 'agent', doc: null } as Partial<BoardFrame> & { assetId: string };
      const problems = wordProblems({ fields: fields as BoardFrame['fields'], doc: null });
      if (problems.length) return oops(`Not added — ${problems.join('; ')}.`);
      const { added } = await change(b.id, [{ op: 'add', frame, near: typeof args.near === 'string' ? args.near : undefined }]);
      return json({ id: added[0], note: `Added.${await drawNow(b.id, added)}` });
    }
    case 'update_design': {
      const b = await boardOf(args.board);
      const cur = b.frames.find(f => f.id === args.id);
      if (!cur) return oops(`No design “${String(args.id)}” on this board.`);
      const patch: Partial<BoardFrame> = { by: 'agent' };
      if (args.fields) patch.fields = { ...cur.fields, ...(args.fields as object) } as BoardFrame['fields'];
      if (args.label !== undefined) patch.label = String(args.label);
      if (args.why !== undefined) patch.why = String(args.why);
      if (args.format) patch.format = args.format as BoardFrame['format'];
      if (args.template || args.format) patch.template = safeTemplate((args.template ?? cur.template) as BoardFrame['template'], { marked: cur.marked, format: patch.format ?? cur.format });
      if (args.sizes !== undefined) patch.group = (String(args.sizes).trim().slice(0, 40) || null) as unknown as string;
      if (args.doc) patch.doc = args.doc as BoardFrame['doc'];
      else if ((args.template && args.template !== cur.template) || (args.format && args.format !== cur.format)) patch.doc = null;
      const problems = wordProblems({ fields: patch.fields ?? cur.fields, doc: patch.doc === undefined ? cur.doc : patch.doc });
      if (problems.length) return oops(`Not changed — ${problems.join('; ')}.`);
      const { linked } = await change(b.id, [{ op: 'put', id: cur.id, patch, quiet: args.only_this_size === true }]);
      const also = linked.length ? ` Its linked text changed in ${linked.join(', ')} too.` : '';
      return text(`Changed${patch.doc === null ? ' and laid out afresh' : ''}.${also}${await drawNow(b.id, [cur.id, ...linked])}`);
    }
    case 'upload_photo': {
      if (args.mime !== undefined && !/^image\/[\w.+-]+$/i.test(String(args.mime))) return oops(`Not a picture (${String(args.mime).slice(0, 40)}).`);
      let buf: Buffer;
      try { buf = decodePicture(args.data); } catch (e) { return oops(e instanceof Error ? e.message : String(e)); }
      const u = await addUpload(buf, { name: String(args.name || args.filename || ''), by });
      return json({ id: `up:${u.id}`, name: u.name, w: u.w, h: u.h, note: 'In the library. add_design or replace_design_photo take this id; view_photo shows it.' });
    }
    case 'replace_design_photo': {
      const b = await boardOf(args.board);
      const cur = b.frames.find(f => f.id === args.id);
      if (!cur) return oops(`No design “${String(args.id)}” on this board.`);
      const photo = String(args.photo ?? '');
      const asset = (await listAssets()).assets.find(a => a.id === photo);
      if (!asset) return oops(`No photo “${photo}” — find_photos gives the ids.`);
      const target = typeof args.layer === 'string' && args.layer ? args.layer : MAIN;
      if (target !== MAIN && !cur.doc) await settleBoard(b.id, { ids: [cur.id] }).catch(() => undefined);
      const laid = target !== MAIN && !cur.doc ? (await getBoard(b.id))?.frames.find(f => f.id === cur.id) : cur;
      if (target !== MAIN && !laid?.doc) return oops('That design has no layout document yet, so it has no layers to replace.');
      const pick = { assetId: asset.original?.id ?? photo, marked: asset.source === 'site' && !asset.original };
      let next;
      try { next = replacePicture({ doc: (laid ?? cur).doc as NonNullable<BoardFrame['doc']>, assetId: cur.assetId, marked: cur.marked }, target, pick); }
      catch (e) { return oops(e instanceof Error ? e.message : String(e)); }
      const patch: Partial<BoardFrame> = { by: 'agent', assetId: next.assetId, marked: next.marked };
      if (target !== MAIN) patch.doc = next.doc;
      await change(b.id, [{ op: 'put', id: cur.id, patch }]);
      return text(`Photo replaced; words, layers and crop kept.${await drawNow(b.id, [cur.id])}`);
    }
    case 'move_design': { const b = await boardOf(args.board); await change(b.id, [{ op: 'move', id: String(args.id), x: Number(args.x), y: Number(args.y) }]); return text('Moved.'); }
    case 'remove_design': { const b = await boardOf(args.board); await change(b.id, [{ op: 'remove', id: String(args.id) }]); return text('Removed.'); }
    case 'add_note': {
      const b = await boardOf(args.board);
      const { added } = await change(b.id, [{ op: 'note', note: { text: String(args.text ?? ''), by: 'agent', ...(typeof args.x === 'number' && typeof args.y === 'number' ? { x: args.x, y: args.y } : {}) } }]);
      return json({ id: added[0] });
    }
    case 'remove_note': { const b = await boardOf(args.board); await change(b.id, [{ op: 'noteRemove', id: String(args.id) }]); return text('Removed.'); }
    case 'view_design': {
      const b = await boardOf(args.board);
      const f = b.frames.find(x => x.id === args.id);
      if (!f) return oops(`No design “${String(args.id)}” on this board.`);
      let v = await getView(b.id, f.id);
      let fresh = f;
      // Missing or older than the design: the server draws it now, so no one has to open the board.
      if (!v || v.rev !== f.rev || !f.doc) {
        const r = (await settleBoard(b.id, { ids: [f.id] }).catch(e => [{ id: f.id, error: String(e) }]))[0] as { error?: string } | undefined;
        fresh = (await getBoard(b.id))?.frames.find(x => x.id === f.id) ?? f;
        v = await getView(b.id, f.id);
        if (!v) return text(`“${f.label}” couldn't be drawn on the server${r?.error ? ` (${r.error})` : ''}; the page draws it when the board is open.`);
      }
      const note = v.rev === fresh.rev ? `“${fresh.label}” (${framePx(fresh).w}×${framePx(fresh).h}), current.` : `“${fresh.label}”: this drawing is of rev ${v.rev}; the design is at rev ${fresh.rev}.`;
      return { content: [{ type: 'text', text: note }, { type: 'image', data: v.jpeg.toString('base64'), mimeType: 'image/jpeg' }] };
    }
    default:
      return oops(`Unknown tool “${name}”.`);
  }
}

export const INSTRUCTIONS = `${BRAND.identity.name}'s design boards. Call get_style first; read each board's notes (the owner's instructions) with get_board. Designs are the house's own layouts on library photos; words follow the house rules.`;
