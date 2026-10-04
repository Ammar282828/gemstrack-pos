/**
 * The Studio's boards for an agent (Claude Code, Codex, Cursor …): the Model Context Protocol's
 * tools, served by /api/studio/mcp over plain JSON-RPC (Streamable HTTP, JSON answers only).
 * What pen.dev does with its .pen files, on the house's own photographs, layouts and rules.
 *
 * The agent works like the page: it adds a design with a layout (template) and words, and the
 * page — the only place with the photo, the fonts and a canvas — lays it out and draws it the next
 * time the board is open; `view_design` shows the agent that drawing. Words an agent writes go
 * through the same rules as the AI's (no sale words or hashtags; no figure the ERP didn't give).
 * Server-only.
 */

import { BRAND, brandBrief } from './brand';
import { AD_FORMATS, AD_TEMPLATES } from './templates';
import { breaksHouseRule, inventedFigures } from './prompts';
import { listAssets, loadAssessments, assetJpeg } from './assets';
import { adScore } from './assessment';
import { changeBoard, createBoard, getBoard, getView, listBoards, viewRevs } from './board';
import { BOARD_SCALE, framePx, wordsOf, type BoardFrame, type BoardOp } from './board-shape';
import { FONT_LABEL } from '@/lib/social/editor';

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

export const TOOLS = [
  { name: 'get_style', description: 'Read FIRST. The house brief (voice, hard rules, marks, visual rules), the layouts, the shapes, the design document format and how to work on a board.', inputSchema: obj({}) },
  { name: 'list_boards', description: 'The boards, newest first.', inputSchema: obj({}) },
  { name: 'create_board', description: 'Make a new board.', inputSchema: obj({ name: S('Its name.') }, ['name']) },
  { name: 'get_board', description: 'A board: every design (id, position, shape, layout, words, photo, document, whether its drawing is current) and every sticky note. Notes are the owner\'s instructions — read them.', inputSchema: obj({ board: S('Board id.'), docs: { type: 'boolean', description: 'Include each design\'s full layout document (default false).' } }, ['board']) },
  { name: 'find_photos', description: 'Search the photo library (taheri.shop pieces and the shared Drive): id, name, collection, the ERP\'s specs line, the AI assessment\'s headline and ad score.', inputSchema: obj({ query: S('Words in the name, collection or subject.'), collection: S('Exact collection name.'), source: S('site or drive.', { enum: ['site', 'drive'] }), limit: N('At most 40 (default 12).') }) },
  { name: 'view_photo', description: 'Look at a library photo.', inputSchema: obj({ id: S('Photo id from find_photos.') }, ['id']) },
  { name: 'add_design', description: 'Put a new design on a board: a photo, a shape, a layout and its words. The page lays it out and draws it (open the board in the ERP); then view_design shows it.', inputSchema: obj({ board: S('Board id.'), photo: S('Photo id from find_photos.'), format: FORMAT, template: TEMPLATE, fields: FIELDS, label: S('A short name shown above it.'), near: S('Id of a design to place it beside.'), why: S('One line: the idea behind it.') }, ['board', 'photo']) },
  { name: 'update_design', description: 'Change a design. A new layout or shape lays it out afresh (hand edits go); new words keep the layout. `doc` replaces the whole layout document (see get_style) — for fine changes only.', inputSchema: obj({ board: S('Board id.'), id: S('Design id.'), template: TEMPLATE, format: FORMAT, fields: FIELDS, label: S('Its name.'), why: S('The idea.'), doc: { type: 'object', description: 'The full layout document (get_board with docs:true for the current one).' } }, ['board', 'id']) },
  { name: 'move_design', description: 'Move a design on the board (board units; a 1080-px-wide design is 360 across).', inputSchema: obj({ board: S('Board id.'), id: S('Design id.'), x: N('Left.'), y: N('Top.') }, ['board', 'id', 'x', 'y']) },
  { name: 'remove_design', description: 'Take a design off a board.', inputSchema: obj({ board: S('Board id.'), id: S('Design id.') }, ['board', 'id']) },
  { name: 'add_note', description: 'Leave a sticky note on a board for the owner (a question, the reasoning behind a set of designs).', inputSchema: obj({ board: S('Board id.'), text: S('The note.'), x: N('Left (optional).'), y: N('Top (optional).') }, ['board', 'text']) },
  { name: 'remove_note', description: 'Take a note off a board.', inputSchema: obj({ board: S('Board id.'), id: S('Note id.') }, ['board', 'id']) },
  { name: 'view_design', description: 'Look at a design as the page drew it. If the page hasn\'t drawn its latest change yet, says so (the board must be open in the ERP).', inputSchema: obj({ board: S('Board id.'), id: S('Design id.') }, ['board', 'id']) },
] as const;

function styleGuide(): string {
  const formats = Object.entries(AD_FORMATS).map(([k, f]) => `- ${k}: ${f.label}, ${f.frame.w}×${f.frame.h} px — ${f.where}`).join('\n');
  const layouts = AD_TEMPLATES.map(t => `- ${t.id}: ${t.label} — ${t.note}`).join('\n');
  return [
    `# ${BRAND.identity.name} Studio — how to design here`,
    brandBrief(),
    `## Shapes (format)\n${formats}`,
    `## Layouts (template)\n${layouts}\nThe layout draws the words from \`fields\` (kicker, headline, weight = the ERP's specs line, details = call to action) in the house's type, colours and marks. Prefer choosing a layout and writing words over writing documents by hand.`,
    `## Words\n- Use the photo's \`specs\` line from find_photos as \`weight\`, exactly. Never add a figure (karat, weight, price, carat, year) that the ERP didn't give: it is refused.\n- No sale or discount words, no hashtags: refused.\n- Prices are allowed only when the owner gives one in a note.`,
    `## The layout document (doc), for fine changes\nA StoryDoc: { bg: { photoId: "photo", placement: { mode: "fill", zoom, focusX, focusY }, dim (0–1), gradient, color }, layers: Layer[], frame: { w, h } }. Coordinates are design pixels from the top left.\n- text: { id, kind:"text", text, bind?: "kicker"|"headline"|"weight"|"details" (bound text shows that field), x, y (y is the first line's baseline), size, font, color, align:"left"|"center"|"right", width, fit, spacing (em), lineHeight, upper, shadow, box: null | { color, radius, pad }, rotate, opacity }\n- wordmark: { id, kind:"wordmark", mark:"wordmark"|"t", x, y, width, color, autoColor, rotate, opacity }\n- rect/circle/line/arrow/shape: { id, kind, x, y, w, h, color, stroke, fill, curve, radius, rotate, opacity }\n- image: { id, kind:"image", photoId:"photo", x, y, w, h?, radius, border, shadow, rotate, opacity }\nFonts: ${Object.keys(FONT_LABEL).join(', ')}. At most 80 layers, 60 KB.`,
    `## Working on a board\n1. get_board — read the owner's notes first.\n2. find_photos → view_photo to choose.\n3. add_design (several, with \`near\` to set variants side by side; label each, give \`why\`).\n4. view_design to check each one once the page has drawn it; update_design to fix.\n5. add_note to explain the set or ask a question.\nOn the board a design is drawn at ${Math.round(BOARD_SCALE * 100)}% of its pixel size; designs sit in rows 48 units apart.`,
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
  fields: f.fields, photo: f.assetId, by: f.by, rev: f.rev, why: f.why ?? null,
  laidOut: !!f.doc, drawing: drawn === f.rev ? 'current' : drawn ? `stale (shows rev ${drawn})` : 'not drawn yet',
  ...(docs ? { doc: f.doc } : {}),
});

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
      const frame = { assetId: asset.original?.id ?? photo, marked: asset.source === 'site' && !asset.original, format: args.format, template: args.template ?? 'headline', fields, label: args.label ?? asset.name, why: args.why, by: 'agent', doc: null } as Partial<BoardFrame> & { assetId: string };
      const problems = wordProblems({ fields: fields as BoardFrame['fields'], doc: null });
      if (problems.length) return oops(`Not added — ${problems.join('; ')}.`);
      const { added } = await change(b.id, [{ op: 'add', frame, near: typeof args.near === 'string' ? args.near : undefined }]);
      return json({ id: added[0], note: 'Added. The page lays it out and draws it when the board is open in the ERP; then view_design shows it.' });
    }
    case 'update_design': {
      const b = await boardOf(args.board);
      const cur = b.frames.find(f => f.id === args.id);
      if (!cur) return oops(`No design “${String(args.id)}” on this board.`);
      const patch: Partial<BoardFrame> = { by: 'agent' };
      if (args.fields) patch.fields = { ...cur.fields, ...(args.fields as object) } as BoardFrame['fields'];
      if (args.label !== undefined) patch.label = String(args.label);
      if (args.why !== undefined) patch.why = String(args.why);
      if (args.template) patch.template = args.template as BoardFrame['template'];
      if (args.format) patch.format = args.format as BoardFrame['format'];
      if (args.doc) patch.doc = args.doc as BoardFrame['doc'];
      else if ((args.template && args.template !== cur.template) || (args.format && args.format !== cur.format)) patch.doc = null;
      const problems = wordProblems({ fields: patch.fields ?? cur.fields, doc: patch.doc === undefined ? cur.doc : patch.doc });
      if (problems.length) return oops(`Not changed — ${problems.join('; ')}.`);
      await change(b.id, [{ op: 'put', id: cur.id, patch }]);
      return text(patch.doc === null ? 'Changed; the page lays it out afresh when the board is open.' : 'Changed.');
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
      const v = await getView(b.id, f.id);
      if (!v) return text(`“${f.label}” hasn't been drawn yet — it is drawn when the board is open in the ERP (Ads → Studio → Board).`);
      const note = v.rev === f.rev ? `“${f.label}” (${framePx(f).w}×${framePx(f).h}), current.` : `“${f.label}”: this drawing is of rev ${v.rev}; the design is at rev ${f.rev} — the page redraws it when the board is open.`;
      return { content: [{ type: 'text', text: note }, { type: 'image', data: v.jpeg.toString('base64'), mimeType: 'image/jpeg' }] };
    }
    default:
      return oops(`Unknown tool “${name}”.`);
  }
}

export const INSTRUCTIONS = `${BRAND.identity.name}'s design boards. Call get_style first; read each board's notes (the owner's instructions) with get_board. Designs are the house's own layouts on library photos; words follow the house rules.`;
