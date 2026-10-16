'use client';

/**
 * Studio → Board (the owner, 2026-10-04, after an audit of pen.dev: "sure run it"): an endless canvas
 * of designs side by side — each the maker's own layout on one library photo — and sticky notes.
 *
 *   Pan and zoom    drag the ground (or two fingers), wheel / pinch to zoom, Fit to see everything
 *   A design        tap to choose: edit it in the designer, Let it cook (2–6 AI variants side by side,
 *                   made in parallel), the same in another shape, duplicate, download, remove
 *   Notes           the owner's words on the board: a brief for Let it cook, and what a connected
 *                   agent reads first
 *   An agent        Connect an agent: a key for Claude Code (or any MCP client) to work on the
 *                   boards over /api/studio/mcp — it lays designs down; this page lays them out and
 *                   draws them, and sends each drawing back for the agent to look at
 *
 * Every change is an operation the server applies in a transaction (board-shape.ts), so the page and
 * an agent never overwrite each other; the page asks for what changed every few seconds.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLingering } from '@/hooks/use-lingering';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { Bot, CalendarDays, Copy, Download, FolderOpen, Loader2, Maximize, Maximize2, Minimize2, Minus, Pencil, Plus, Rocket, Send, Shapes, Sparkles, StickyNote, Trash2, ImagePlus, Files, KeyRound, X, Upload, Undo2, Wand2, Type, Crown, Redo2, LayoutGrid, ChevronDown, ChevronLeft, ChevronRight, Check as CheckIcon, MousePointerClick, PanelRight, Link2, Link2Off } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PALETTES, canvasToJpeg, loadImage } from '@/lib/social/story';
import { applyPalette, newImageLayer, newText, reflow, renderDocTo, type Assets, type Bind, type Fields, type StoryDoc } from '@/lib/social/editor';
import { AD_FORMATS, AD_FORMAT_ORDER, AD_TEMPLATES, MORE_FORMAT_ORDER, PHOTO, applyAdTemplate, blankAd, formatInfo, type AdFormat, type AdTemplateId } from '@/lib/ads/studio/templates';
import { BOARD_SCALE, applyOps, framePx, newId, safeTemplate, type Board, type BoardFrame, type BoardNote, type BoardOp } from '@/lib/ads/studio/board-shape';
import { MAIN, assetOfRef, extraIds, libRef, pictureSlots, replacePicture, rewriteUploads, uploadSrcs, type PictureSlot, type PictureTarget, freshCrops } from '@/lib/ads/studio/board-pictures';
import type { BoardSummary } from '@/lib/ads/studio/board';
import type { CopyResult, Direction } from '@/lib/ads/studio/prompts';
import { SCENES, nearestAspect } from '@/lib/social/prompts';
import { VOICE } from '@/lib/ads/studio/brand';
import { HANDOFF_PREFIX, type StudioHandoff } from '@/lib/ads/studio/handoff';
import type { WeeklyState } from '@/lib/ads/studio/weekly';
import { STORE_LINKS } from '@/lib/store-config';
import { linkAll, linkKey, linkedCount, sizesOf, toggleLink } from '@/lib/ads/studio/board-links';
import { tidyLayout } from '@/lib/ads/studio/board-tidy';
import { resizeOne } from '@/lib/design/resize';
import { SoloEditor, useStoryDoc, type DesignerExtras, type Editor, type SidePanel } from '../website/post/story-editor';
import { MarksSection } from '../website/post/editor-panels';
import { FONTS, bodyFace, headlineFace, serifFace } from '../website/post/fonts';
import { useSiteAssets } from '../website/post/site-assets';
import { api, authHeaders } from '../ads/ads-kit';
import { AuthedImg, SITE_LABEL, downloadBlob, fetchAsset, runImageOp, safeName, type LibraryItem, type LibraryResponse } from './studio-kit';

const LAST_KEY = 'taheri_studio_board';
const POLL_MS = 4000;
/** While an agent is at work (it changed the board in the last two minutes): asked for every 1.5 s. */
const POLL_AGENT_MS = 1500;
const agentBusy = (b: Pick<Board, 'by' | 'updated'> | null) => !!b && b.by.startsWith('agent:') && Date.now() - Date.parse(b.updated) < 120_000;
const SHOW_PX = 540;   // the size each design is drawn at for the board
const VIEW_PX = 720;   // and for the agent to look at
const FORMATS: AdFormat[] = [...AD_FORMAT_ORDER, ...MORE_FORMAT_ORDER];
/** Angles for Let it cook: each variant is asked for the owner's brief from a different side. */
const ANGLES = ['', 'bold and graphic, one strong line', 'quiet luxury — very few words', 'heritage and trust', 'as a gift', 'the craft, up close'];

// ── Photos and drawing ─────────────────────────────────────────────────────

interface Pic { img: HTMLImageElement; blob: Blob; url: string }
const pics = new Map<string, Promise<Pic>>();
/** The same pictures once here, to read at once: the designer moving to the next design draws it in its first frame. */
const picsDone = new Map<string, Pic>();
/** `alpha`: a library picture laid on the design (inset, background, logo) keeps its transparency (a PNG); the design's own photo is always a JPEG. */
function photoOf(id: string, alpha = false): Promise<Pic> {
  const key = alpha ? `alpha|${id}` : id;
  let p = pics.get(key);
  if (!p) {
    p = fetchAsset(id, 1600, alpha).then(async blob => ({ blob, img: await loadImage(blob), url: URL.createObjectURL(blob) }));
    p.then(x => picsDone.set(key, x), () => pics.delete(key));
    pics.set(key, p);
  }
  return p;
}

let fontsOnce: Promise<unknown> | null = null;
const fontsReady = () => (fontsOnce ??= Promise.all(
  [`600 40px ${FONTS.headline}`, `400 40px ${FONTS.body}`, `400 40px ${FONTS.serif}`, `italic 400 40px ${FONTS.serif}`].map(f => document.fonts.load(f).catch(() => null)),
));

/** A picture this page already has (an upload, an AI result): kept as if fetched, so it isn't fetched back. */
function remember(id: string, blob: Blob) {
  const p = loadImage(blob).then(img => ({ blob, img, url: URL.createObjectURL(blob) }));
  p.then(x => { picsDone.set(id, x); picsDone.set(`alpha|${id}`, x); }, () => { pics.delete(id); pics.delete(`alpha|${id}`); });
  pics.set(id, p);
  pics.set(`alpha|${id}`, p);
}

/** A picture into the Studio's library (POST /api/ads/studio/uploads): its asset id, `up:<id>`. */
async function uploadPicture(blob: Blob, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', blob, `${safeName(name)}.${blob.type === 'image/png' ? 'png' : 'jpg'}`);
  form.append('name', name);
  const { asset } = await api<{ asset: { id: string } }>('/api/ads/studio/uploads', { form });
  remember(asset.id, blob);
  return asset.id;
}

/**
 * A design may hold more library photos than its own — a product shot inset beside the hand that wears it
 * (2026-10-06, owner: "add the product shot in there"), a picture uploaded from the computer, an AI edit, or
 * a library photo as the background. Each is `lib:<asset id>` (board-pictures.ts); the page fetches each
 * like the design's own photo, so the board, the editor, downloads and every send draw the same pictures.
 */
type Extras = Record<string, Pic>;
async function extrasOf(doc: StoryDoc | null | undefined): Promise<Extras> {
  const ids = extraIds(doc);
  const got = await Promise.all(ids.map(id => photoOf(assetOfRef(id)!, true).catch(() => null)));
  return Object.fromEntries(ids.flatMap((id, i) => (got[i] ? [[id, got[i]!]] : [])));
}
/** The pictures of extrasOf that are already here (null when any is still to come). */
function extrasNow(doc: StoryDoc | null | undefined): Extras | null {
  const out: Extras = {};
  for (const id of extraIds(doc)) { const x = picsDone.get(`alpha|${assetOfRef(id)}`); if (!x) return null; out[id] = x; }
  return out;
}
const assetsFor = (pic: Pic | null, marks: Assets['marks'], extras: Extras = {}): Assets => ({
  photos: { ...(pic ? { [PHOTO]: pic.img } : {}), ...Object.fromEntries(Object.entries(extras).map(([k, v]) => [k, v.img])) } as Assets['photos'],
  marks, fonts: FONTS,
});
const layOut = (f: Pick<BoardFrame, 'format' | 'template' | 'fields' | 'marked'>, a: Assets): StoryDoc =>
  applyAdTemplate(blankAd(f.format), f.template, f.fields, a, { photoMarked: f.marked });
const drawTo = (doc: StoryDoc, fields: Fields, a: Assets, px: number) => renderDocTo(reflow(doc, fields, a), fields, a, px);

// ── The page ───────────────────────────────────────────────────────────────

export function BoardSection() {
  const { toast } = useToast();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);

  const loadList = useCallback(async () => {
    const r = await api<{ boards: BoardSummary[] }>('/api/ads/studio/boards');
    setBoards(r.boards);
    return r.boards;
  }, []);

  // The list too: a board an agent makes appears without a reload, and is offered.
  const [offer, setOffer] = useState<BoardSummary | null>(null);
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const list = await loadList();
        const seen = known.current;
        known.current = new Set(list.map(b => b.id));
        const fresh = seen ? list.find(b => !seen.has(b.id)) : undefined;
        if (fresh) { setOffer(fresh); setCurrent(c => c ?? fresh.id); }
      } catch { /* the next one */ }
    }, 6000);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    loadList().then(list => {
      known.current = new Set(list.map(b => b.id));
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_KEY); } catch { /* private mode */ }
      setCurrent(list.find(b => b.id === last)?.id ?? list[0]?.id ?? null);
    }).catch(e => toast({ title: 'The boards didn’t load', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }));
  }, [loadList, toast]);

  const choose = (id: string) => { setCurrent(id); try { localStorage.setItem(LAST_KEY, id); } catch { /* private mode */ } };
  const create = async () => {
    const name = window.prompt('Name the board', 'New board');
    if (name === null) return;
    try {
      const r = await api<{ board: Board }>('/api/ads/studio/boards', { body: { name } });
      await loadList(); choose(r.board.id);
    } catch (e) { toast({ title: 'Couldn’t make it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };

  return (
    <div className="space-y-3">
      <span aria-hidden className={cn(headlineFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(bodyFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(serifFace.className, 'sr-only')}>.</span>
      <div className="flex flex-wrap items-center gap-2">
        {boards && boards.length > 0 && (
          <Select value={current ?? undefined} onValueChange={choose}>
            <SelectTrigger className="h-9 w-[220px]"><SelectValue placeholder="Choose a board" /></SelectTrigger>
            <SelectContent>
              {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" onClick={create}><Plus className="h-4 w-4 mr-1" /> New board</Button>
        <WeeklyButton onBoard={id => { loadList().then(() => choose(id)); }} />
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAgentOpen(true)}><Bot className="h-4 w-4 mr-1" /> Connect an agent</Button>
      </div>
      {!boards && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading the boards…</p>}
      {boards && boards.length === 0 && (
        <div className="rounded-xl border-2 border-dashed p-8 text-center space-y-3">
          <p className="text-sm">A board holds designs side by side — your own, the AI’s variants, and an agent’s — with notes beside them.</p>
          <Button onClick={create}><Plus className="h-4 w-4 mr-1" /> Make the first board</Button>
        </div>
      )}
      {offer && offer.id !== current && (
        <p className="text-sm rounded-lg border border-primary/40 bg-primary/5 p-2.5 flex items-center gap-2">
          {offer.by.startsWith('agent:') ? <Bot className="h-4 w-4 shrink-0 text-primary" /> : <Plus className="h-4 w-4 shrink-0" />}
          <span className="flex-1">{offer.by.startsWith('agent:') ? 'The agent made a new board' : 'A new board'}: <b>{offer.name}</b></span>
          <Button size="sm" onClick={() => { choose(offer.id); setOffer(null); }}>Open it</Button>
          <button type="button" className="p-1 min-h-0 text-muted-foreground" onClick={() => setOffer(null)} aria-label="Not now"><X className="h-4 w-4" /></button>
        </p>
      )}
      {current && <BoardView key={current} id={current} onGone={() => { setCurrent(null); loadList(); }} onRenamed={loadList} />}
      <AgentDialog open={agentOpen} onOpenChange={setAgentOpen} />
    </div>
  );
}

/**
 * This week's board, now (weekly.ts — the tick makes it by itself on Mondays from 9:00): a new board of
 * the week's new pieces, designed a few at a time while this page waits; it opens as soon as it exists.
 */
function WeeklyButton({ onBoard }: { onBoard: (id: string) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async () => {
    if (!window.confirm('Make this week’s board now? It designs up to six of the week’s new pieces (about a minute each).')) return;
    setBusy('Starting…');
    try {
      let action = 'start';
      let lastDone = -1;
      for (let i = 0; i < 12; i++) {
        const { weekly } = await api<{ weekly: WeeklyState & { busy?: boolean } }>('/api/ads/studio/weekly', { body: { action } });
        if (i === 0 && weekly.board) onBoard(weekly.board);
        action = 'continue';
        if (!weekly.pending.length) {
          toast({ title: 'This week’s board is ready', description: `${weekly.done} piece${weekly.done === 1 ? '' : 's'} designed${weekly.failed.length ? `; ${weekly.failed.length} couldn’t be` : ''}.` });
          break;
        }
        setBusy(`${weekly.done} designed, ${weekly.pending.length} to go…`);
        // Nothing new this round (the AI's per-minute quota, or the tick at it): a minute before asking again.
        const stuck = weekly.done === lastDone;
        lastDone = weekly.done;
        if (weekly.busy || stuck) await new Promise(r => setTimeout(r, weekly.busy ? 15_000 : 60_000));
      }
    } catch (e) { toast({ title: 'Couldn’t make it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  return (
    <Button size="sm" variant="outline" disabled={!!busy} onClick={run} title="The tick makes one by itself every Monday from 9:00">
      {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CalendarDays className="h-4 w-4 mr-1" />} {busy ?? 'This week’s board'}
    </Button>
  );
}

type Selected = { kind: 'frame' | 'note'; id: string } | null;

function BoardView({ id, onGone, onRenamed }: { id: string; onGone: () => void; onRenamed: () => void }) {
  const { toast } = useToast();
  const [board, setBoard] = useState<Board | null>(null);
  const [drawn, setDrawn] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<Selected>(null);
  const [view, setView] = useState({ x: 40, y: 40, z: 0.7 });
  const [drag, setDrag] = useState<{ kind: 'frame' | 'note'; id: string; x: number; y: number } | null>(null);
  const [picker, setPicker] = useState(false);
  // Full screen: the board alone, edge to edge (the browser's full screen where it has one; an iPhone has none, so
  // the board also covers the page itself). Esc or the button leaves.
  const [full, setFull] = useState(false);
  // The stage (2026-10-14, owner: "the board designer should take up 95% of the screen from the get go"): the
  // board opens as a 95vw × 95svh sheet over the page; the side panel is a drawer on top of it. "Close" returns
  // to the board inside the page (its picker and buttons); the dock brings the stage back.
  const [stage, setStage] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const fullRef = useRef<HTMLDivElement>(null);
  const toggleFull = () => {
    const next = !full;
    setFull(next);
    try {
      // The whole page (the board covers it): the designer and the menus open on <body>, which a full-screen
      // board element would hide.
      if (next) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch { /* the covering view still works */ }
  };
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('keydown', onKey); };
  }, []);
  const [editing, setEditing] = useState<string | null>(null);
  // The board's drawing of each design, for the designer's strip (FrameCard draws them; batched to one render a frame).
  const thumbsRef = useRef<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbFrame = useRef(0);
  const onThumb = useCallback((fid: string, url: string) => {
    thumbsRef.current = { ...thumbsRef.current, [fid]: url };
    if (!thumbFrame.current) thumbFrame.current = requestAnimationFrame(() => { thumbFrame.current = 0; setThumbs(thumbsRef.current); });
  }, []);
  const [cooking, setCooking] = useState<string | null>(null);
  const { marks, ready: marksReady } = useSiteAssets(true);
  const [fontsOk, setFontsOk] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;
  const busy = useRef(0);   // changes in flight: the poll waits for them
  const fitted = useRef(false);

  useEffect(() => { fontsReady().then(() => setFontsOk(true)); }, []);

  const fail = useCallback((title: string, e: unknown) => toast({ title, description: e instanceof Error ? e.message : String(e), variant: 'destructive' }), [toast]);

  const load = useCallback(async () => {
    const r = await api<{ board: Board; drawn: Record<string, number> }>(`/api/ads/studio/boards/${id}`);
    setBoard(r.board); setDrawn(r.drawn);
    return r.board;
  }, [id]);

  useEffect(() => { load().catch(e => { fail('The board didn’t load', e); onGone(); }); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // What an agent (or another phone) changed. Asked for even while the tab is behind another — the
  // owner is often watching the agent's chat, and the agent can only see a design once this page has
  // drawn it — and every 1.5 s while an agent is at work (2026-10-04, owner: "why isn't the page
  // updating dynamically"). Designs that arrived or changed glow for a moment; new ones are brought
  // into view unless the owner has just moved the board.
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const touched = useRef(0);   // when the owner last panned, zoomed or dragged
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const cur = boardRef.current;
      if (cur && !busy.current && !dragRef.current) {
        try {
          const r = await api<{ same?: boolean; board?: Board; drawn?: Record<string, number> }>(`/api/ads/studio/boards/${id}?since=${cur.rev}`);
          if (r.board && !busy.current && !stop) {
            const before = new Map(cur.frames.map(f => [f.id, f.rev]));
            const changed = r.board.frames.filter(f => before.get(f.id) !== f.rev && f.by !== 'page').map(f => f.id);
            const grew = r.board.frames.length > cur.frames.length || r.board.notes.length > cur.notes.length;
            setBoard(r.board); if (r.drawn) setDrawn(r.drawn);
            if (changed.length) {
              setFresh(new Set(changed));
              setTimeout(() => setFresh(new Set()), 2500);
            }
            if (grew && Date.now() - touched.current > 8000) requestAnimationFrame(() => fitRef.current());
          }
        } catch { /* the next one */ }
      }
      if (!stop) timer = setTimeout(tick, agentBusy(boardRef.current) ? POLL_AGENT_MS : POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  /** Change the board: shown at once, then applied on the server (whose answer is the truth). */
  const send = useCallback(async (ops: BoardOp[]): Promise<string[]> => {
    const cur = boardRef.current;
    if (!cur) return [];
    try { setBoard(applyOps(cur, ops).board); } catch { /* the server says why */ }
    busy.current++;
    try {
      // The server takes 60 changes a request (board.ts): Tidy on a big board moves more.
      const added: string[] = [];
      for (let i = 0; i < ops.length; i += 60) {
        const r = await api<{ board: Board; added: string[] }>(`/api/ads/studio/boards/${id}`, { method: 'PATCH', body: { ops: ops.slice(i, i + 60) } });
        setBoard(r.board);
        added.push(...r.added);
      }
      return added;
    } catch (e) {
      fail('That didn’t save', e);
      load().catch(() => undefined);
      return [];
    } finally { busy.current--; }
  }, [id, fail, load]);

  /** The designer's Save: one `put`, and unlike `send` it throws, so the designer stays open (nothing lost) when it fails. */
  const saveFrame = useCallback(async (fid: string, patch: Partial<BoardFrame>): Promise<number> => {
    const ops: BoardOp[] = [{ op: 'put', id: fid, patch: { ...patch, by: 'page' } }];
    busy.current++;
    try {
      const r = await api<{ board: Board; linked?: string[] }>(`/api/ads/studio/boards/${id}`, { method: 'PATCH', body: { ops } });
      setBoard(r.board);
      return r.linked?.length ?? 0;   // its other sizes that took the change (board-links.ts)
    } finally { busy.current--; }
  }, [id]);

  // ── Undo and redo: every change the page makes by hand is a step with its own inverse (board ops). ──
  type Step = { undo: BoardOp[]; redo: BoardOp[] };
  const past = useRef<Step[]>([]);
  const future = useRef<Step[]>([]);
  const [, setSteps] = useState(0);
  const act = useCallback((redo: BoardOp[], undo: BoardOp[]) => {
    past.current.push({ undo, redo });
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setSteps(n => n + 1);
    return send(redo);
  }, [send]);
  const undo = useCallback(() => {
    const st = past.current.pop();
    if (!st) return;
    future.current.push(st); setSteps(n => n + 1);
    send(st.undo);
  }, [send]);
  const redo = useCallback(() => {
    const st = future.current.pop();
    if (!st) return;
    past.current.push(st); setSteps(n => n + 1);
    send(st.redo);
  }, [send]);
  /** The op that puts a design back exactly as it was (same id, place and everything). */
  const restoreOf = (f: BoardFrame): BoardOp => { const { rev: _rev, ...rest } = f; return { op: 'add', frame: rest }; };

  const frames = board?.frames ?? [];
  const notes = board?.notes ?? [];
  const pos = (kind: 'frame' | 'note', o: { id: string; x: number; y: number }) => (drag && drag.kind === kind && drag.id === o.id ? drag : o);

  // ── Pan, zoom, drag ──
  const fit = useCallback(() => {
    const el = boxRef.current; const b = boardRef.current;
    if (!el || !b) return;
    const rects = [
      ...b.frames.map(f => ({ x: f.x, y: f.y, w: framePx(f).w * BOARD_SCALE, h: framePx(f).h * BOARD_SCALE + 28 })),
      ...b.notes.map(n => ({ x: n.x, y: n.y, w: 240, h: 160 })),
    ];
    if (!rects.length) { setView({ x: 40, y: 40, z: 0.7 }); return; }
    const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y)) - 28;
    const x1 = Math.max(...rects.map(r => r.x + r.w)), y1 = Math.max(...rects.map(r => r.y + r.h));
    const pad = 32;
    const z = Math.min(1.5, Math.max(0.08, Math.min((el.clientWidth - pad * 2) / (x1 - x0), (el.clientHeight - pad * 2) / (y1 - y0))));
    setView({ z, x: pad - x0 * z + (el.clientWidth - pad * 2 - (x1 - x0) * z) / 2, y: pad - y0 * z });
  }, []);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  /** The board's designs as read: row by row (tops within a short step of each other), left to right. */
  const reading = useMemo(() => [...frames].sort((a, b) => Math.round(a.y / 160) - Math.round(b.y / 160) || a.x - b.x), [frames]);
  /** Bring a design into view (keeping the zoom) when it is off the visible board. */
  const reveal = useCallback((fid: string) => requestAnimationFrame(() => {
    const el = boxRef.current, f = boardRef.current?.frames.find(x => x.id === fid);
    if (!el || !f) return;
    setView(v => {
      const w = framePx(f).w * BOARD_SCALE * v.z, h = (framePx(f).h * BOARD_SCALE + 28) * v.z;
      const left = v.x + f.x * v.z, top = v.y + (f.y - 28) * v.z;
      if (left >= 0 && top >= 0 && left + w <= el.clientWidth && top + h <= el.clientHeight) return v;
      return { ...v, x: el.clientWidth / 2 - (f.x * v.z + w / 2), y: el.clientHeight / 2 - ((f.y - 28) * v.z + h / 2) };
    });
  }), []);
  useEffect(() => { if (board && !fitted.current) { fitted.current = true; requestAnimationFrame(fit); } }, [board, fit]);
  // The box changed size (stage, inline, full screen): fit what is on it again.
  const sized = useRef(true);
  useEffect(() => { if (sized.current) { sized.current = false; return; } const r = requestAnimationFrame(() => fitRef.current()); return () => cancelAnimationFrame(r); }, [stage, full]);
  // Picking a design brings its panel up over the board; picking nothing puts it away.
  const quietSel = useRef(false);   // picked on the way back from the designer: the panel stays as it was
  useEffect(() => { if (quietSel.current) { quietSel.current = false; return; } setDrawer(!!sel); }, [sel?.kind, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = useCallback((k: number, cx: number, cy: number) => {
    setView(v => {
      const z = Math.min(3, Math.max(0.06, v.z * k));
      return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) };
    });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = Date.now();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'frame' | 'note'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; pinch?: { d: number; z: number } } | null>(null);

  const onDown = (e: React.PointerEvent, target?: { kind: 'frame' | 'note'; id: string; x: number; y: number }) => {
    if ((e.target as HTMLElement).closest('textarea,button,input')) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pan', sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2, ox: view.x, oy: view.y, moved: true, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z } };
      setDrag(null);
      return;
    }
    gesture.current = target
      ? { kind: target.kind, id: target.id, sx: e.clientX, sy: e.clientY, ox: target.x, oy: target.y, moved: false }
      : { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const r = boxRef.current!.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      const z = Math.min(3, Math.max(0.06, g.pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / g.pinch.d));
      const sx = g.sx - r.left, sy = g.sy - r.top;
      setView({ z, x: cx - (sx - g.ox) * (z / g.pinch.z), y: cy - (sy - g.oy) * (z / g.pinch.z) });
      return;
    }
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    touched.current = Date.now();
    if (g.kind === 'pan') setView(v => ({ ...v, x: g.ox + dx, y: g.oy + dy }));
    else setDrag({ kind: g.kind, id: g.id!, x: g.ox + dx / view.z, y: g.oy + dy / view.z });
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g || pointers.current.size) { if (!pointers.current.size) gesture.current = null; return; }
    gesture.current = null;
    if (g.kind === 'pan') { if (!g.moved) setSel(null); return; }
    setSel({ kind: g.kind, id: g.id! });
    if (g.moved && drag) {
      const { x, y } = drag;
      setDrag(null);
      act([g.kind === 'frame' ? { op: 'move', id: g.id!, x, y } : { op: 'noteMove', id: g.id!, x, y }],
        [g.kind === 'frame' ? { op: 'move', id: g.id!, x: g.ox, y: g.oy } : { op: 'noteMove', id: g.id!, x: g.ox, y: g.oy }]);
    }
  };

  // ── Actions ──
  const selFrame = sel?.kind === 'frame' ? frames.find(f => f.id === sel.id) ?? null : null;
  const selNote = sel?.kind === 'note' ? notes.find(n => n.id === sel.id) ?? null : null;

  /** The board point under a screen point (or the middle of the view). */
  const boardPoint = (clientX?: number, clientY?: number) => {
    const el = boxRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const sx = clientX === undefined ? el.clientWidth / 2 : clientX - r.left, sy = clientY === undefined ? el.clientHeight / 2 : clientY - r.top;
    return { x: Math.round((sx - view.x) / view.z), y: Math.round((sy - view.y) / view.z) };
  };
  const addNote = (clientX?: number, clientY?: number) => {
    const c = boardPoint(clientX, clientY);
    const nid = newId('note');
    act([{ op: 'note', note: { id: nid, text: 'Note', x: c.x - 120, y: c.y - 80 } }], [{ op: 'noteRemove', id: nid }]).then(() => setSel({ kind: 'note', id: nid }));
  };
  const removeFrame = (f: BoardFrame) => { act([{ op: 'remove', id: f.id }], [restoreOf(f)]); setSel(null); };
  const removeNote = (n: BoardNote) => { act([{ op: 'noteRemove', id: n.id }], [{ op: 'note', note: { ...n } }]); setSel(null); };
  const setNoteText = (n: BoardNote, text: string) => act([{ op: 'noteText', id: n.id, text }], [{ op: 'noteText', id: n.id, text: n.text }]);

  /** Tidy up: the designs in rows, in their reading order, an even gap apart. One step to undo. */
  /** Neat rows, each ad's sizes side by side (2026-10-16: a shoot's 4:5, 9:16 and 3:4 were split across rows), as many ads a row as fill the board's shape. */
  const tidy = () => {
    if (!frames.length) return;
    const el = boxRef.current;
    const moves: BoardOp[] = [], back: BoardOp[] = [];
    const placed = tidyLayout(frames, el ? el.clientWidth / Math.max(1, el.clientHeight) : 1.6);
    for (const f of frames) {
      const p = placed.get(f.id);
      if (p && (p.x !== f.x || p.y !== f.y)) { moves.push({ op: 'move', id: f.id, ...p }); back.push({ op: 'move', id: f.id, x: f.x, y: f.y }); }
    }
    if (!moves.length) { fit(); return; }
    act(moves, back).then(() => requestAnimationFrame(() => fitRef.current()));
  };

  /** A picture of the owner's own (device, Drive, a link, a paste): into the library, then onto the board as a frame. */
  const addOwnPhoto = async (file: File, format: AdFormat, at?: { x: number; y: number }) => {
    setPicker(false);
    const name = file.name.replace(/\.[a-z0-9]+$/i, '') || 'Uploaded picture';
    try {
      const id = await uploadPicture(file, name);
      await addPhoto({ id, name, source: 'upload' } as unknown as LibraryItem, format, at);
    } catch (e) { toast({ title: 'Couldn’t add the picture', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };

  const addPhoto = async (item: LibraryItem, format: AdFormat, at?: { x: number; y: number }) => {
    setPicker(false);
    const fid = newId('frame');
    await act([{ op: 'add', frame: {
      ...(at ? { x: at.x, y: at.y } : {}),
      // The website photo's unmarked Drive original when there is one (as the maker does): no burned-in wordmark cut by the frame.
      id: fid, assetId: item.original?.id ?? item.id, marked: item.source === 'site' && !item.original, format, template: safeTemplate('headline', { marked: item.source === 'site' && !item.original, format }), label: item.name, by: 'page', doc: null,
      fields: {
        kicker: item.source === 'site' && item.collection !== 'Website' ? item.collection : '',
        headline: item.assessment?.headline || item.name, weight: item.specs ?? '', details: VOICE.ctas[0].replace(/\.$/, ''),
      },
    } }], [{ op: 'remove', id: fid }]);
    setSel({ kind: 'frame', id: fid });
  };

  /**
   * A copy, or the design in another size. A size is the owner's own design resized (lib/design/resize.ts: their
   * words, pictures and edits carried over, not the template laid afresh), in the original's group with every text
   * linked, so a change to the words in one size goes to all of them (board-links.ts; unlink a text to free it).
   */
  const duplicate = async (f: BoardFrame, format?: AdFormat) => {
    const { id: _id, rev: _rev, x: _x, y: _y, group: _g, ...rest } = f;
    const nid = newId('frame');
    if (!format) {
      await act([{ op: 'add', near: f.id, frame: { ...rest, id: nid, by: 'page', label: `${f.label} · copy` } }], [{ op: 'remove', id: nid }]);
      setSel({ kind: 'frame', id: nid });
      return;
    }
    const group = f.group ?? f.id;
    let src = f.doc, doc: StoryDoc | null = null;
    if (f.doc) {
      try {
        const pic = f.assetId ? await photoOf(f.assetId) : null;
        const a = assetsFor(pic, marks, await extrasOf(f.doc));
        src = linkAll(f.doc);
        doc = resizeOne(src, f.fields, a, formatInfo(format).frame, { photoMarked: f.marked }).doc;
      } catch { src = f.doc; doc = null; }   // laid out from its template instead
    }
    const ops: BoardOp[] = [];
    // The keys go on the original quietly: its sizes already on the board are not touched by making another.
    if (f.group !== group || src !== f.doc) ops.push({ op: 'put', id: f.id, quiet: true, patch: { group, ...(src !== f.doc ? { doc: src } : {}) } });
    ops.push({ op: 'add', near: f.id, frame: { ...rest, id: nid, by: 'page', group, format, doc, template: safeTemplate(f.template, { marked: f.marked, format }), label: `${f.label.replace(/ · (?:\d+(?:\.\d+)?:\d+|copy)$/, '')} · ${formatInfo(format).short}` } });
    await act(ops, [{ op: 'remove', id: nid }]);
    setSel({ kind: 'frame', id: nid });
  };

  /** The design at full size (or the same layout in another shape: the story for Instagram). */
  const render = async (f: BoardFrame, shape?: AdFormat, px?: number, q = 0.92) => {
    const pic = f.assetId ? await photoOf(f.assetId) : null;
    const a = assetsFor(pic, marks, await extrasOf(f.doc));
    const doc = shape && shape !== f.format ? layOut({ ...f, format: shape, template: safeTemplate(f.template, { marked: f.marked, format: shape }) }, a) : f.doc ?? layOut(f, a);
    return { blob: await canvasToJpeg(drawTo(doc, f.fields, a, px ?? (doc.frame ?? framePx(f)).w), q), doc, pic };
  };
  const dataUrl = (b: Blob) => new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });

  const download = async (f: BoardFrame) => {
    try { downloadBlob((await render(f)).blob, `${safeName(f.fields.headline || f.label)}-${f.format}.jpg`); }
    catch (e) { fail('Couldn’t draw it', e); }
  };

  // ── Out of the board (2026-10-04, owner: "yes" — to "one tap from a design to Saved ads, a new Meta ad, or the post queue") ──
  const router = useRouter();
  const [sending, setSending] = useState<string | null>(null);
  const [queueFor, setQueueFor] = useState<BoardFrame | null>(null);
  const queueShown = useLingering(queueFor); // kept while its dialog closes (hooks/use-lingering.ts)

  const saveToSaved = async (f: BoardFrame) => {
    setSending('Saving to Saved ads…');
    try {
      const { blob, doc, pic } = await render(f);
      const thumb = await dataUrl((await render(f, undefined, 200, 0.7)).blob);
      const form = new FormData();
      form.append('meta', JSON.stringify({
        folder: null, name: f.fields.headline || f.label || 'Board design', format: f.format, template: f.template, fields: f.fields, price: '',
        text: '', headline: f.fields.headline, goal: 'whatsapp', link: '', asset: f.assetId ? { id: f.assetId, name: f.label } : null, thumb,
      }));
      form.append('image', blob, 'ad.jpg');
      if (pic) form.append('photo', pic.blob, 'photo.jpg');
      form.append('doc', new Blob([JSON.stringify(doc)], { type: 'application/json' }), 'doc.json');
      await api('/api/ads/studio/saved', { form });
      toast({ title: 'Saved', description: 'In Studio → Saved.' });
    } catch (e) { fail('Couldn’t save it', e); } finally { setSending(null); }
  };

  const toNewAd = async (f: BoardFrame) => {
    setSending('Putting it in a new ad…');
    try {
      const upload = async (b: Blob, name: string) => { const form = new FormData(); form.append('file', b, name); return api<{ hash: string; url: string | null }>('/api/ads/images', { form }); };
      const feed = f.format === 'portrait' || f.format === 'square';
      const [up, vert] = await Promise.all([
        render(f).then(r => upload(r.blob, `${safeName(f.fields.headline)}.jpg`)),
        feed ? render(f, 'story').then(r => upload(r.blob, `${safeName(f.fields.headline)}-9x16.jpg`)) : Promise.resolve(null),
      ]);
      await api('/api/ads/studio/creatives', { body: { assets: f.assetId ? [f.assetId] : [], hash: up.hash, url: up.url, format: f.format, name: f.fields.headline } }).catch(() => undefined);
      const key = Math.random().toString(36).slice(2, 10);
      const handoff: StudioHandoff = {
        photos: [{ hash: up.hash, url: up.url, headline: f.fields.headline, link: STORE_LINKS.website ?? undefined }],
        vertical: vert ? { hash: vert.hash, url: vert.url } : null,
        text: [f.fields.headline, f.fields.weight, f.fields.details].filter(Boolean).join('\n'), headline: f.fields.headline, goal: 'whatsapp',
        name: `${f.fields.headline || f.label} · ${formatInfo(f.format).short}${vert ? ' + 9:16' : ''}`,
      };
      sessionStorage.setItem(HANDOFF_PREFIX + key, JSON.stringify(handoff));
      router.push(`/ads/new?studio=${key}`);
    } catch (e) { fail('Couldn’t make a new ad', e); setSending(null); }
  };

  const queuePost = async (f: BoardFrame, o: { whatsapp: string[]; instagram: boolean; caption: string }) => {
    setQueueFor(null);
    setSending('Queuing the post…');
    let qid: string | null = null;
    try {
      const wa = o.whatsapp.length ? (await render(f)).blob : null;
      const story = o.instagram ? (await render(f, 'story', AD_FORMATS.story.frame.w)).blob : null;
      const thumb = (await dataUrl((await render(f, undefined, 240, 0.7)).blob)).split(',')[1];
      const { item } = await api<{ item: { id: string } }>('/api/website/post/queue', { body: {
        headline: f.fields.headline || f.label, caption: o.caption, fileBase: safeName(f.fields.headline || f.label),
        counts: { site: 0, wa: wa ? 1 : 0, story: !!story }, website: null, instagram: !!story, whatsapp: o.whatsapp, thumb,
      } });
      qid = item.id;
      for (const [key, b] of [['wa-0', wa], ['story', story]] as [string, Blob | null][]) {
        if (!b) continue;
        const form = new FormData();
        form.set('key', key); form.set('file', new File([b], `${key}.jpg`, { type: 'image/jpeg' }));
        await api(`/api/website/post/queue/${qid}`, { form });
      }
      await api(`/api/website/post/queue/${qid}`, { method: 'PATCH', body: { action: 'ready' } });
      toast({ title: 'In the post queue', description: 'Posts → Hub: send it now or set a time.' });
    } catch (e) {
      if (qid) api(`/api/website/post/queue/${qid}`, { method: 'DELETE' }).catch(() => undefined);
      fail('Couldn’t queue it', e);
    } finally { setSending(null); }
  };

  const cook = async (f: BoardFrame, n: number, brief: string) => {
    if (!f.assetId) { toast({ title: 'This design has no photo to work from' }); return; }
    setCooking(`Cooking ${n} variants — about a minute…`);
    try {
      const pic = await photoOf(f.assetId);
      const F = formatInfo(f.format);
      const ask = async (i: number): Promise<Direction | null> => {
        const form = new FormData();
        form.append('op', 'direct');
        form.append('params', JSON.stringify({
          name: f.label, collection: f.fields.kicker, specs: f.fields.weight, price: '', format: f.format, aspect: F.ai, shape: F.label,
          brief: [brief.trim(), ANGLES[i % ANGLES.length]].filter(Boolean).join(' — '), destination: 'a WhatsApp chat with the shop',
          kicker: f.fields.kicker, headline: f.fields.headline, cta: f.fields.details,
        }));
        form.append('image', pic.blob, 'photo.jpg');
        try { return (await api<{ direction: Direction }>('/api/ads/studio/auto', { form })).direction; } catch (e) { fail(`Variant ${i + 1} didn’t come`, e); return null; }
      };
      // Three at a time: the AI key's per-minute quota is shared with the counter.
      const out: (Direction | null)[] = [];
      for (let i = 0; i < n; i += 3) out.push(...await Promise.all(Array.from({ length: Math.min(3, n - i) }, (_, k) => ask(i + k))));
      let near = f.id;
      let made = 0;
      for (const [i, d] of out.entries()) {
        if (!d) continue;
        const { id: _id, rev: _rev, x: _x, y: _y, group: _g, ...rest } = f;   // a variant is another ad, not a size of this one
        const added = await send([{ op: 'add', near, frame: {
          ...rest, by: 'ai', doc: null, template: safeTemplate(d.layout as AdTemplateId, { marked: f.marked, format: f.format }), why: d.why, label: `${f.label} · ${i + 1}`,
          fields: { ...f.fields, kicker: d.kicker || '', headline: d.headline || f.fields.headline, details: d.cta || f.fields.details },
        } }]);
        if (added[0]) { near = added[0]; made++; }
      }
      toast({ title: made ? `${made} variant${made === 1 ? '' : 's'} on the board` : 'No variants came' });
    } catch (e) { fail('Couldn’t cook', e); } finally { setCooking(null); }
  };

  /** A design the page lays out (new, or an agent's): once, when its photo and the fonts are here. */
  const layingOut = useRef(new Set<string>());
  const onLaidOut = useCallback((f: BoardFrame, doc: StoryDoc) => {
    if (layingOut.current.has(`${f.id}:${f.rev}`)) return;
    layingOut.current.add(`${f.id}:${f.rev}`);
    send([{ op: 'put', id: f.id, patch: { doc } }]);
  }, [send]);
  const onDrawn = useCallback((fid: string, rev: number) => setDrawn(d => ({ ...d, [fid]: rev })), []);

  // ── Keys (the way Figma and Canva answer them), paste and drop ──
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (e: KeyboardEvent) => {
    if (editing || picker || queueFor) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]'))) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    const el = boxRef.current;
    const mid = () => [(el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2] as const;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'd' && selFrame) { e.preventDefault(); duplicate(selFrame); return; }
    if (mod) return;
    if ((k === 'delete' || k === 'backspace') && (selFrame || selNote)) { e.preventDefault(); if (selFrame) removeFrame(selFrame); else if (selNote) removeNote(selNote); return; }
    if (k === 'enter' && selFrame) { e.preventDefault(); setEditing(selFrame.id); return; }
    if (k === 'escape' && sel && !full) { setSel(null); return; }
    if (k === 'n') { e.preventDefault(); addNote(); return; }
    if (k === 'p') { e.preventDefault(); setPicker(true); return; }
    if (k === 'f' || (e.shiftKey && k === '!')) { e.preventDefault(); fit(); return; }
    if (k === '0') { e.preventDefault(); const [cx, cy] = mid(); zoomAt(1 / view.z, cx, cy); return; }
    if (k === '=' || k === '+') { e.preventDefault(); const [cx, cy] = mid(); zoomAt(1.25, cx, cy); return; }
    if (k === '-') { e.preventDefault(); const [cx, cy] = mid(); zoomAt(1 / 1.25, cx, cy); return; }
    if (k.startsWith('arrow') && (selFrame || selNote)) {
      e.preventDefault();
      const step = e.shiftKey ? 50 : 10;
      const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
      const o = (selFrame ?? selNote)!;
      const op = (x: number, y: number): BoardOp => (selFrame ? { op: 'move', id: o.id, x, y } : { op: 'noteMove', id: o.id, x, y });
      act([op(o.x + dx, o.y + dy)], [op(o.x, o.y)]);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keysRef.current(e);
    const onPaste = (e: ClipboardEvent) => {
      if (editing || picker) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input,textarea,[contenteditable="true"],[role="dialog"]')) return;
      const f = Array.from(e.clipboardData?.files ?? []).find(x => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      const c = boardPoint();
      addOwnPhoto(f, selFrame?.format ?? 'portrait', { x: c.x - 150, y: c.y - 180 });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  });
  const [dropping, setDropping] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDropping(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    files.forEach((f, i) => { const c = boardPoint(e.clientX, e.clientY); addOwnPhoto(f, selFrame?.format ?? 'portrait', { x: c.x - 150 + i * 40, y: c.y - 180 + i * 40 }); });
  };

  if (!board) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Opening the board…</p>;
  const overlay = stage || full;

  return (
    <div className={cn(!overlay && 'grid gap-3 lg:grid-cols-[1fr_320px]')}>
      {stage && !full && <div aria-hidden className="fixed inset-0 z-[59] bg-black/50" />}
      <div ref={fullRef} className={cn('min-w-0',
        full ? 'space-y-2 fixed inset-0 z-[60] overflow-auto bg-background p-3 pt-[max(0.75rem,env(safe-area-inset-top))]'
          : stage ? 'fixed inset-x-[2.5vw] top-[2.5svh] z-[60] flex h-[95svh] flex-col gap-2 rounded-2xl border bg-background p-2 shadow-2xl'
            : 'space-y-2')}>
        {(cooking || sending) && <p className="text-xs rounded-lg bg-primary/10 p-2 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin shrink-0" /> {cooking || sending}</p>}
        {agentBusy(board) && (
          <p className="text-xs rounded-lg border border-sky-400/50 bg-sky-400/10 p-2 flex items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-sky-500" />
            <span className="flex-1">The agent is working on this board — its designs appear here as they come. Keep this page open: it draws them for the agent.</span>
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" /></span>
          </p>
        )}
        <div
          ref={boxRef}
          className={cn('relative min-h-[420px] overflow-hidden rounded-xl border bg-muted/40 touch-none select-none cursor-grab active:cursor-grabbing', full ? 'h-[calc(100svh-1.5rem)]' : stage ? 'min-h-0 flex-1' : 'h-[72svh]')}
          style={{ backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.25) 1px, transparent 1px)', backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
          onPointerDown={e => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onDoubleClick={e => { if (e.target === e.currentTarget) addNote(e.clientX, e.clientY); }}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
          onDragLeave={e => { if (e.target === e.currentTarget) setDropping(false); }} onDrop={onDrop}
        >
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            {frames.map(f => {
              const p = pos('frame', f);
              return (
                <FrameCard key={f.id} frame={f} x={p.x} y={p.y} selected={sel?.kind === 'frame' && sel.id === f.id} fresh={fresh.has(f.id)}
                  marks={marks} ready={marksReady && fontsOk} boardId={board.id} drawnRev={drawn[f.id]}
                  onDown={e => onDown(e, { kind: 'frame', id: f.id, x: f.x, y: f.y })} onLaidOut={onLaidOut} onDrawn={onDrawn} onThumb={onThumb}
                  onOpen={() => setEditing(f.id)} />
              );
            })}
            {notes.map(n => {
              const p = pos('note', n);
              return <NoteCard key={n.id} note={n} x={p.x} y={p.y} selected={sel?.kind === 'note' && sel.id === n.id} onDown={e => onDown(e, { kind: 'note', id: n.id, x: n.x, y: n.y })} onText={t => setNoteText(n, t)} />;
            })}
          </div>
          {!frames.length && !notes.length && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-sm space-y-3 text-center">
                <MousePointerClick className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">Start with a photo</p>
                <p className="text-xs text-muted-foreground">Drop pictures here, paste one (⌘V), or pick from the library. Double-click anywhere for a note.</p>
                <Button size="sm" onClick={() => setPicker(true)}><ImagePlus className="h-4 w-4 mr-1" /> Add a photo</Button>
              </div>
            </div>
          )}
          {dropping && <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">Drop to add to the board</div>}

          {/* The selected design's own bar, floating above it. */}
          {selFrame && !drag && !editing && (() => {
            const p = pos('frame', selFrame), w = framePx(selFrame).w * BOARD_SCALE * view.z;
            const left = view.x + p.x * view.z + w / 2, top = view.y + (p.y - 28) * view.z;
            const below = top < 56;
            const bh = framePx(selFrame).h * BOARD_SCALE * view.z;
            return (
              <div onPointerDown={e => e.stopPropagation()} className="absolute z-20 flex items-center gap-0.5 rounded-full border bg-background/95 p-1 shadow-lg backdrop-blur"
                style={{ left: Math.min(Math.max(left, 170), (boxRef.current?.clientWidth ?? 400) - 170), top: below ? top + 28 * view.z + bh + 10 : top - 48, transform: 'translateX(-50%)' }}>
                <BarButton label="Edit (Enter)" onClick={() => setEditing(selFrame.id)}><Pencil className="h-4 w-4" /><span className="hidden sm:inline">Edit</span></BarButton>
                <BarButton label="Let it cook: 4 AI variants" disabled={!!cooking || !selFrame.assetId} onClick={() => cook(selFrame, 4, '')}><Sparkles className="h-4 w-4" /><span className="hidden sm:inline">Variants</span></BarButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" title="In another shape" className="flex h-8 items-center gap-0.5 rounded-full px-2 text-xs hover:bg-muted"><Shapes className="h-4 w-4" /><ChevronDown className="h-3 w-3" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="center">
                    <DropdownMenuLabel>The same design, in another shape</DropdownMenuLabel>
                    {FORMATS.filter(x => x !== selFrame.format).map(x => <DropdownMenuItem key={x} onClick={() => duplicate(selFrame, x)}>{formatInfo(x).label}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
                <BarButton label="Duplicate (⌘D)" onClick={() => duplicate(selFrame)}><Copy className="h-4 w-4" /></BarButton>
                <BarButton label="Download" onClick={() => download(selFrame)}><Download className="h-4 w-4" /></BarButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" disabled={!!sending} className="flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Use it <ChevronDown className="h-3 w-3" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setQueueFor(selFrame)}><Send className="h-4 w-4 mr-2" /> Queue a post (WhatsApp, Instagram)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toNewAd(selFrame)}><Rocket className="h-4 w-4 mr-2" /> Use in a new Meta ad</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => saveToSaved(selFrame)}><FolderOpen className="h-4 w-4 mr-2" /> Save to Saved ads</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <BarButton label="Delete (⌫)" onClick={() => removeFrame(selFrame)}><Trash2 className="h-4 w-4 text-destructive" /></BarButton>
              </div>
            );
          })()}

          {/* The dock: everything the board itself does, at the bottom of the board. */}
          <div onPointerDown={e => e.stopPropagation()} className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full border bg-background/95 p-1 shadow-lg backdrop-blur">
            <BarButton label="Add a photo (P) — or drop, or paste" onClick={() => setPicker(true)} strong><ImagePlus className="h-4 w-4" /><span className="hidden sm:inline">Photo</span></BarButton>
            <BarButton label="Add a note (N) — or double-click the board" onClick={() => addNote()}><StickyNote className="h-4 w-4" /><span className="hidden sm:inline">Note</span></BarButton>
            <span className="mx-1 h-5 w-px bg-border" />
            <BarButton label="Undo (⌘Z)" disabled={!past.current.length} onClick={undo}><Undo2 className="h-4 w-4" /></BarButton>
            <BarButton label="Redo (⇧⌘Z)" disabled={!future.current.length} onClick={redo}><Redo2 className="h-4 w-4" /></BarButton>
            <span className="mx-1 h-5 w-px bg-border" />
            <BarButton label="Zoom out (−)" onClick={() => zoomAt(1 / 1.25, (boxRef.current?.clientWidth ?? 0) / 2, (boxRef.current?.clientHeight ?? 0) / 2)}><Minus className="h-4 w-4" /></BarButton>
            <button type="button" title="Back to 100% (0)" onClick={() => zoomAt(1 / view.z, (boxRef.current?.clientWidth ?? 0) / 2, (boxRef.current?.clientHeight ?? 0) / 2)} className="w-11 text-center text-xs tabular-nums text-muted-foreground hover:text-foreground">{Math.round(view.z * 100)}%</button>
            <BarButton label="Zoom in (+)" onClick={() => zoomAt(1.25, (boxRef.current?.clientWidth ?? 0) / 2, (boxRef.current?.clientHeight ?? 0) / 2)}><Plus className="h-4 w-4" /></BarButton>
            <BarButton label="Fit everything (F)" onClick={fit}><Maximize className="h-4 w-4" /></BarButton>
            <BarButton label="Tidy up: the designs in neat rows" disabled={frames.length < 2} onClick={tidy}><LayoutGrid className="h-4 w-4" /></BarButton>
            <BarButton label={full ? 'Leave full screen (Esc)' : 'Full screen'} onClick={toggleFull}>{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</BarButton>
            {overlay && <BarButton label={drawer ? 'Hide the panel' : 'The panel: board name and the picked design'} onClick={() => setDrawer(d => !d)} strong={drawer}><PanelRight className="h-4 w-4" /></BarButton>}
            <BarButton label={stage || full ? 'Close the big view (the board inside the page)' : 'Open the board big'} onClick={() => { if (full) toggleFull(); setStage(!(stage || full)); }}>{stage || full ? <X className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</BarButton>
          </div>
        </div>
        <p className={cn('hidden text-[11px] text-muted-foreground', !overlay && 'md:block')}>Drag the board to move · ⌘-scroll or pinch to zoom · drop or paste pictures · double-click: a design to edit it, the board for a note · ⌫ delete · ⌘D duplicate · ⌘Z undo · arrows nudge</p>
      </div>

      <aside className={cn('space-y-3', overlay && (drawer && !editing
        ? 'fixed z-[60] overflow-y-auto rounded-2xl border bg-background/95 p-3 shadow-2xl backdrop-blur max-sm:inset-x-3 max-sm:bottom-20 max-sm:max-h-[55svh] sm:bottom-20 sm:right-[calc(2.5vw+0.5rem)] sm:top-[calc(2.5svh+0.5rem)] sm:w-[340px]'
        : 'hidden'))}>
        <BoardName board={board} onRename={async name => { await send([{ op: 'rename', name }]); onRenamed(); }} onDelete={async () => {
          if (!window.confirm(`Delete “${board.name}” and its ${frames.length} designs?`)) return;
          try { await api(`/api/ads/studio/boards/${board.id}`, { method: 'DELETE' }); onGone(); } catch (e) { fail('Couldn’t delete it', e); }
        }} />
        {selFrame && (
          <FramePanel key={selFrame.id} frame={selFrame} notes={notes} busy={!!cooking}
            onLabel={label => send([{ op: 'put', id: selFrame.id, patch: { label } }])}
            onEdit={() => setEditing(selFrame.id)} onCook={(n, brief) => cook(selFrame, n, brief)}
            onShape={fmt => duplicate(selFrame, fmt)} onDuplicate={() => duplicate(selFrame)} onDownload={() => download(selFrame)}
            sending={!!sending} onSave={() => saveToSaved(selFrame)} onNewAd={() => toNewAd(selFrame)} onQueue={() => setQueueFor(selFrame)}
            onRemove={() => removeFrame(selFrame)} />
        )}
        {selNote && (
          <section className="rounded-xl border p-3 space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><StickyNote className="h-4 w-4" /> Note{selNote.by === 'agent' ? ' from the agent' : ''}</p>
            <p className="text-xs text-muted-foreground">Edit it on the board. A note is a brief for Let it cook, and the first thing a connected agent reads.</p>
            <Button size="sm" variant="outline" onClick={() => removeNote(selNote)}><Trash2 className="h-4 w-4 mr-1" /> Remove the note</Button>
          </section>
        )}
        {!sel && <p className="text-xs text-muted-foreground rounded-xl border p-3">Tap a design to edit it, cook variants of it, or make it in another shape.</p>}
      </aside>

      <PhotoPicker open={picker} onOpenChange={setPicker} onPick={addPhoto} onFile={addOwnPhoto} withFormat />
      {queueShown && <QueueDialog key={queueShown.id} frame={queueShown} open={!!queueFor} onClose={() => setQueueFor(null)} onQueue={o => { if (queueFor) queuePost(queueFor, o); }} />}
      {editing && (() => {
        const f = frames.find(x => x.id === editing);
        // Back on the board, the design just edited is picked and in view.
        return f ? <FrameEditor key={f.id} frame={f} sizes={sizesOf(frames, f)} order={reading} thumbs={thumbs} marks={marks}
          onClose={() => {
            setEditing(null); quietSel.current = sel?.kind !== 'frame' || sel.id !== f.id; setSel({ kind: 'frame', id: f.id }); reveal(f.id);
            setFresh(new Set([f.id])); setTimeout(() => setFresh(new Set()), 1600);
          }}
          onSave={patch => saveFrame(f.id, patch)} onSwitch={setEditing} /> : null;
      })()}
    </div>
  );
}

/** A round button of the board's bars, its name as the tooltip (and for screen readers). */
function BarButton({ label, onClick, disabled, strong, children }: { label: string; onClick: () => void; disabled?: boolean; strong?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={cn('flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-xs transition-colors disabled:opacity-35', strong ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'hover:bg-muted')}>
      {children}
    </button>
  );
}

// ── A design on the board ──────────────────────────────────────────────────

function FrameCard({ frame: f, x, y, selected, fresh, marks, ready, boardId, drawnRev, onDown, onLaidOut, onDrawn, onThumb, onOpen }: {
  frame: BoardFrame; x: number; y: number; selected: boolean; fresh: boolean; marks: Assets['marks']; ready: boolean; boardId: string; drawnRev: number | undefined;
  onDown: (e: React.PointerEvent) => void; onLaidOut: (f: BoardFrame, doc: StoryDoc) => void; onDrawn: (id: string, rev: number) => void;
  onThumb: (id: string, url: string) => void; onOpen: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const size = framePx(f);
  const w = size.w * BOARD_SCALE, h = size.h * BOARD_SCALE;
  const sig = `${f.rev}:${f.assetId}:${ready}`;
  const sending = useRef<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    (async () => {
      try {
        const pic = f.assetId ? await photoOf(f.assetId) : null;
        const a = assetsFor(pic, marks, await extrasOf(f.doc));
        if (!f.doc) { onLaidOut(f, layOut(f, a)); return; }
        const shown = await canvasToJpeg(drawTo(f.doc, f.fields, a, SHOW_PX), 0.86);
        if (!live) return;
        const next = URL.createObjectURL(shown);
        // The old drawing goes a moment later: the designer's strip may still be showing it.
        setUrl(old => { if (old) setTimeout(() => URL.revokeObjectURL(old), 2000); return next; });
        onThumb(f.id, next);
        setErr(null);
        // The agent's copy: drawn again only when the design has changed since.
        if (drawnRev !== f.rev && sending.current !== f.rev) {
          sending.current = f.rev;
          const jpeg = await canvasToJpeg(drawTo(f.doc, f.fields, a, VIEW_PX), 0.85);
          const form = new FormData();
          form.append('frame', f.id); form.append('rev', String(f.rev)); form.append('image', jpeg, 'view.jpg');
          const res = await fetch(`/api/ads/studio/boards/${boardId}/view`, { method: 'POST', body: form, headers: await authHeaders() });
          if (res.ok) onDrawn(f.id, f.rev); else sending.current = null;
        }
      } catch (e) { if (live) setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { live = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute" style={{ left: x, top: y - 28, width: w }} onPointerDown={onDown} onDoubleClick={onOpen}>
      <p className="h-7 truncate text-[13px] text-muted-foreground flex items-center gap-1">
        {f.by === 'agent' && <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />}
        {f.by === 'ai' && <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />}
        <span className="truncate">{f.label || 'Design'}</span>
      </p>
      <div className={cn('relative overflow-hidden rounded-sm bg-background shadow-sm ring-1 ring-border transition-shadow duration-700', fresh && 'ring-8 ring-sky-400/80 shadow-[0_0_60px_rgba(56,189,248,0.6)]', selected && 'ring-4 ring-primary')} style={{ width: w, height: h }}>
        {url ? <img src={url} alt={f.label} draggable={false} className="h-full w-full object-cover pointer-events-none" />
          : <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground p-4 text-center">{err ? `Couldn’t draw it: ${err}` : <Loader2 className="h-5 w-5 animate-spin" />}</div>}
      </div>
    </div>
  );
}

function NoteCard({ note, x, y, selected, onDown, onText }: { note: BoardNote; x: number; y: number; selected: boolean; onDown: (e: React.PointerEvent) => void; onText: (t: string) => void }) {
  const [text, setText] = useState(note.text);
  useEffect(() => setText(note.text), [note.text]);
  return (
    <div className={cn('absolute w-[240px] rounded-md p-3 shadow-md', note.by === 'agent' ? 'bg-sky-100 text-sky-950' : 'bg-amber-100 text-amber-950', selected && 'ring-4 ring-primary')} style={{ left: x, top: y }} onPointerDown={onDown}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-60 flex items-center gap-1">{note.by === 'agent' ? <><Bot className="h-3 w-3" /> Agent</> : 'Note'}</p>
      {selected
        ? <textarea autoFocus value={text} onChange={e => setText(e.target.value)} onBlur={() => { if (text !== note.text) onText(text); }} className="w-full min-h-[96px] resize-none bg-transparent text-[15px] leading-snug outline-none" />
        : <p className="whitespace-pre-wrap text-[15px] leading-snug">{note.text}</p>}
    </div>
  );
}

function BoardName({ board, onRename, onDelete }: { board: Board; onRename: (n: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(board.name);
  useEffect(() => setName(board.name), [board.name]);
  return (
    <section className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== board.name) onRename(name); }} className="h-9 text-base sm:text-sm font-medium" aria-label="Board name" />
        <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label="Delete the board" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{board.frames.length} designs · {board.notes.length} notes · changed {new Date(board.updated).toLocaleString()}{board.by.startsWith('agent:') ? ' by the agent' : ''}</p>
    </section>
  );
}

function FramePanel({ frame: f, notes, busy, sending, onLabel, onEdit, onCook, onShape, onDuplicate, onDownload, onRemove, onSave, onNewAd, onQueue }: {
  frame: BoardFrame; notes: BoardNote[]; busy: boolean; onLabel: (l: string) => void; onEdit: () => void; onCook: (n: number, brief: string) => void;
  onShape: (f: AdFormat) => void; onDuplicate: () => void; onDownload: () => void; onRemove: () => void;
  sending: boolean; onSave: () => void; onNewAd: () => void; onQueue: () => void;
}) {
  const [label, setLabel] = useState(f.label);
  const [n, setN] = useState(4);
  const [brief, setBrief] = useState('');
  const own = notes.filter(x => x.by === 'page' && x.text.trim() && x.text.trim() !== 'Note');
  return (
    <>
      <section className="rounded-xl border p-3 space-y-2.5">
        <Input value={label} onChange={e => setLabel(e.target.value)} onBlur={() => { if (label !== f.label) onLabel(label); }} className="h-9 text-base sm:text-sm" aria-label="Design name" />
        <p className="text-[11px] text-muted-foreground">{formatInfo(f.format).label} · {AD_TEMPLATES.find(t => t.id === f.template)?.label ?? f.template}{f.by === 'agent' ? ' · by the agent' : f.by === 'ai' ? ' · by the AI' : ''}</p>
        {f.why && <p className="text-[11px] italic text-muted-foreground">{f.why}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={onEdit}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
          <Button size="sm" variant="outline" onClick={onDownload}><Download className="h-4 w-4 mr-1" /> Download</Button>
          <Button size="sm" variant="outline" onClick={onDuplicate}><Files className="h-4 w-4 mr-1" /> Duplicate</Button>
          <Button size="sm" variant="outline" onClick={onRemove}><Trash2 className="h-4 w-4 mr-1" /> Remove</Button>
        </div>
      </section>
      <section className="rounded-xl border p-3 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Send className="h-4 w-4" /> Use it</p>
        <div className="grid gap-2">
          <Button size="sm" disabled={sending} onClick={onQueue}><Send className="h-4 w-4 mr-1" /> Queue a post — WhatsApp, Instagram</Button>
          <Button size="sm" variant="outline" disabled={sending} onClick={onNewAd}><Rocket className="h-4 w-4 mr-1" /> Use in a new Meta ad</Button>
          <Button size="sm" variant="outline" disabled={sending} onClick={onSave}><FolderOpen className="h-4 w-4 mr-1" /> Save to Saved ads</Button>
        </div>
      </section>
      <section className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> Let it cook</p>
        <p className="text-[11px] text-muted-foreground">The AI designs variants of this one — each from a different angle — side by side.</p>
        <Textarea value={brief} onChange={e => setBrief(e.target.value)} placeholder="Aim (optional) — e.g. Eid gifting" className="min-h-[60px] text-base sm:text-sm" />
        {own.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {own.slice(0, 4).map(x => <button key={x.id} type="button" onClick={() => setBrief(x.text)} className="max-w-full truncate rounded-full border bg-amber-100 text-amber-950 px-2 py-0.5 text-[11px] min-h-0">Use note: {x.text.slice(0, 40)}</button>)}
          </div>
        )}
        <div className="flex gap-2">
          <Select value={String(n)} onValueChange={v => setN(Number(v))}>
            <SelectTrigger className="h-9 w-[84px]"><SelectValue /></SelectTrigger>
            <SelectContent>{[2, 3, 4, 5, 6].map(k => <SelectItem key={k} value={String(k)}>{k}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="flex-1 h-9" disabled={busy || !f.assetId} onClick={() => onCook(n, brief)}>{busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />} Cook {n}</Button>
        </div>
      </section>
      <section className="rounded-xl border p-3 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Shapes className="h-4 w-4" /> In another shape</p>
        <div className="flex flex-wrap gap-1">
          {FORMATS.filter(x => x !== f.format).map(x => (
            <button key={x} type="button" onClick={() => onShape(x)} className="rounded-full border px-2.5 py-1 text-[11px] min-h-0 hover:bg-muted">{AD_FORMATS[x as Exclude<AdFormat, 'custom'>].short}</button>
          ))}
        </div>
      </section>
    </>
  );
}

// ── Queue a post ───────────────────────────────────────────────────────────

function QueueDialog({ frame: f, open, onClose, onQueue }: { frame: BoardFrame; open: boolean; onClose: () => void; onQueue: (o: { whatsapp: string[]; instagram: boolean; caption: string }) => void }) {
  const [places, setPlaces] = useState<{ key: string; name: string; size: number | null }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wa, setWa] = useState<string[]>([]);
  const [ig, setIg] = useState(false);
  const [caption, setCaption] = useState([f.fields.headline, f.fields.weight, f.fields.details].filter(Boolean).join('\n'));
  useEffect(() => {
    api<{ community: { name: string } | null; channel: { name: string; followers: number | null } | null; groups: { key: string; name: string; size: number | null }[] }>('/api/website/post')
      .then(r => {
        const list = [...(r.channel ? [{ key: 'channel', name: r.channel.name, size: r.channel.followers }] : []), ...(r.groups ?? [])];
        setPlaces(list);
        setWa(list.some(p => p.key === 'channel') ? ['channel'] : []);
      })
      .catch(e => { setErr(e instanceof Error ? e.message : String(e)); setPlaces([]); });
  }, []);
  const toggle = (k: string) => setWa(w => (w.includes(k) ? w.filter(x => x !== k) : [...w, k]));
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Queue a post</DialogTitle>
          <DialogDescription>It waits in Posts → Hub, held: send it now or set a time there. Nothing goes out from here.</DialogDescription>
        </DialogHeader>
        {!places && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Finding the WhatsApp places…</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
        {places && (
          <div className="space-y-1.5">
            {places.map(p => (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wa.includes(p.key)} onChange={() => toggle(p.key)} />
                <span>{p.name}{p.size != null ? <span className="text-muted-foreground"> · {p.size.toLocaleString()}</span> : null}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ig} onChange={() => setIg(v => !v)} />
              <span>Instagram story <span className="text-muted-foreground">· the same design at 9:16</span></span>
            </label>
          </div>
        )}
        <Textarea value={caption} onChange={e => setCaption(e.target.value)} className="min-h-[90px] text-base sm:text-sm" aria-label="Caption" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!wa.length && !ig} onClick={() => onQueue({ whatsapp: wa, instagram: ig, caption })}><Send className="h-4 w-4 mr-1" /> Queue it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── The designer, on one design ────────────────────────────────────────────

type Check = { samePiece: boolean; differences: string[] } | null;
/** The image AI's tools (the route Post a piece, Edit a piece and the Studio's library use), as they apply to a picture on a design. */
type PhotoAi = { op: 'enhance' | 'clean' | 'retouch' | 'reframe' | 'restage' | 'custom'; label: string; secs: string; main?: boolean };
const PHOTO_AI: PhotoAi[] = [
  { op: 'enhance', label: 'Enhance', secs: 'about a minute' },
  { op: 'clean', label: 'Logo and labels off', secs: 'about a minute' },
  { op: 'retouch', label: 'Retouch (Magnific)', secs: 'about two minutes' },
  { op: 'reframe', label: 'Extend to the design’s shape', secs: 'about a minute', main: true },
];
const FIELD_ROWS: [Bind, string, number][] = [['kicker', 'Small line', 60], ['headline', 'Headline', 140], ['weight', 'Weight / specs', 160], ['details', 'Call to action', 80]];

/**
 * One design in the designer (2026-10-12, owner: "the boards from ad studio ads should be fully editable, let
 * me edit any present text and picture … add text, different fonts, elements … also ai features"): the
 * Canva-style designer (text, fonts, elements, photos and uploads, brand, layers, background, undo, align,
 * snap) beside the design's pictures — each replaced from the library or this device, or edited by the
 * image AI, the original restorable while the design is open — and its words, written by the AI on request.
 * Full screen of its own rather than a dialog, so the designer it opens takes clicks and keys.
 *
 * The board stays one step away (2026-10-16, owner: "editing one ad shouldn't remove me from everything else,
 * make it seamless and very smooth to use"): every change is saved as it is made (one `put` a moment later;
 * pictures uploaded in the designer go to the library first, board-pictures.ts rewriteUploads); the strip under
 * the page is the whole board, its sizes are tabs beside the name, and ‹ › or [ ] move to the next design
 * without closing — the panel that was open stays open.
 */
function FrameEditor({ frame: f, sizes, order, thumbs, marks, onClose, onSave, onSwitch }: {
  frame: BoardFrame; sizes: BoardFrame[]; order: BoardFrame[]; thumbs: Record<string, string>; marks: Assets['marks'];
  onClose: () => void; onSave: (p: Partial<BoardFrame>) => Promise<number>; onSwitch: (id: string) => void;
}) {
  const { toast } = useToast();
  const [start] = useState(f);   // the design as opened: the board's poll may hand a newer one in meanwhile
  const [assetId, setAssetId] = useState<string | null>(start.assetId);
  const [marked, setMarked] = useState(start.marked);
  const [label, setLabel] = useState(start.label);
  // Pictures already fetched are drawn in the first frame (moving between designs shows no "Fetching…" between them).
  const [pic, setPic] = useState<Pic | null>(() => (start.assetId ? picsDone.get(start.assetId) ?? null : null));
  const [picErr, setPicErr] = useState(false);
  const [extras, setExtras] = useState<Extras>(() => extrasNow(start.doc) ?? {});
  const [fields, setFields] = useState<Fields>(start.fields);
  const [template, setTemplate] = useState<AdTemplateId>(start.template);
  const [palette, setPalette] = useState(PALETTES[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [slot, setSlot] = useState<PictureTarget | null>(null);
  const [picking, setPicking] = useState<{ target: PictureTarget | 'add' } | null>(null);
  const assets = useMemo(() => assetsFor(pic, marks, extras), [pic, marks, extras]);
  const doc = useStoryDoc(start.doc ?? blankAd(start.format));
  const F = formatInfo(start.format);

  // The design's own photo, and every library picture the document draws (fetched again as pictures come and go).
  useEffect(() => {
    let live = true;
    setPicErr(false);
    if (!assetId) { setPic(null); return; }
    const now = picsDone.get(assetId);
    if (now) { setPic(now); return; }
    photoOf(assetId).then(p => live && setPic(p)).catch(() => { if (live) { setPic(null); setPicErr(true); } });
    return () => { live = false; };
  }, [assetId]);
  const extraKey = extraIds(doc.doc).join('|');
  useEffect(() => {
    let live = true;
    extrasOf(doc.doc).then(x => live && setExtras(x)).catch(() => undefined);
    return () => { live = false; };
  }, [extraKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A design never laid out (doc null) is laid out from its template once the photo is here.
  const ready = !assetId || !!pic || picErr;
  // Each picture as it was when the designer opened (or as first laid out), to put back before Save.
  const pictureMap = (d: StoryDoc | null) => new Map((d?.layers ?? []).flatMap(l => (l.kind === 'image' ? [[l.id, { photoId: l.photoId, src: l.src }] as const] : [])));
  const [origin, setOrigin] = useState(() => pictureMap(start.doc));
  const [originBg, setOriginBg] = useState<string>(start.doc?.bg.photoId ?? MAIN);
  const started = useRef(!!start.doc);
  useEffect(() => {
    if (started.current || !ready) return;
    started.current = true;
    const laid = layOut({ ...start, fields, template }, assets);
    doc.reset(laid);
    setOrigin(pictureMap(laid)); setOriginBg(laid.bg.photoId ?? MAIN);
    savedRef.current = JSON.stringify({ ...curRef.current, doc: laid }); setSaved(savedRef.current);   // laid out, not yet changed
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Saved as you go (2026-10-16, owner: "editing one ad shouldn't remove me from everything else, make it
  // seamless"): each change goes to the board a moment after it is made, so there is no Save to remember and
  // nothing to discard; closing, or moving to another design, waits for the last one.
  const cur = { doc: doc.doc, fields, template, label, assetId, marked };
  const snap = useMemo(() => JSON.stringify(cur), [doc.doc, fields, template, label, assetId, marked]); // eslint-disable-line react-hooks/exhaustive-deps
  const curRef = useRef(cur);
  curRef.current = cur;
  const savedRef = useRef<string | null>(start.doc ? snap : null);   // what the board has (set once a new design is laid out)
  const [saved, setSaved] = useState(savedRef.current);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const [linked, setLinked] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  /** Send what is on the page now, unless the board has it. One at a time; throws when it fails. */
  const persist = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    while (inflight.current) await inflight.current.catch(() => undefined);
    const c = curRef.current, s = JSON.stringify(c);
    if (savedRef.current === null || s === savedRef.current) return;
    const run = (async () => {
      setSaveState('saving');
      let d = c.doc;
      // Pictures uploaded in the designer go to the library first (the board keeps no data: URLs).
      const srcs = uploadSrcs(d);
      if (srcs.length) {
        const map: Record<string, string> = {};
        for (const [i, src] of srcs.entries()) map[src] = await uploadPicture(await (await fetch(src)).blob(), `${c.label || 'Design'} · upload ${i + 1}`);
        d = rewriteUploads(d, map);
        if (curRef.current.doc === c.doc) doc.change(() => d, { key: 'uploads' });
      }
      const n = await onSaveRef.current({ ...c, doc: d });
      savedRef.current = d === c.doc ? s : JSON.stringify({ ...c, doc: d });
      setSaved(savedRef.current); setLinked(n); setSaveState('idle'); setRetry(0);
    })();
    inflight.current = run;
    try { await run; } catch (e) { setSaveState('failed'); throw e; } finally { if (inflight.current === run) inflight.current = null; }
  }, [doc]);
  const warned = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (savedRef.current === null || snap === savedRef.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      persist().then(() => { warned.current = false; }, e => {
        if (!warned.current) { warned.current = true; fail('Not saved yet — trying again', e); }
        setRetry(r => r + 1);
      });
    }, retry ? 4000 : 700);
  }, [snap, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = snap !== saved;
  const pendingRef = useRef(false);
  pendingRef.current = pending || saveState === 'saving';
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pendingRef.current) { persist().catch(() => undefined); e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('beforeunload', warn); document.body.style.overflow = overflow; clearTimeout(timer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Save what is left, then leave (to the board, or to another design). */
  const [leaving, setLeaving] = useState(false);
  const leave = async (then: () => void) => {
    if (leaving) return;
    if (busy && !window.confirm(`${busy.replace(/…$/, '')} is still working; its result would be lost. Leave anyway?`)) return;
    setLeaving(true);
    try { await persist(); then(); } catch (e) {
      if (window.confirm(`The last change didn’t save (${e instanceof Error ? e.message : String(e)}). Leave without it?`)) then();
    } finally { setLeaving(false); }
  };
  const cancel = () => leave(onClose);

  const fail = (title: string, e: unknown) => toast({ title, description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
  useEffect(() => {
    if (picErr) toast({ title: 'The design’s photo didn’t load', description: 'Everything else is here to edit. Replace the photo under Pictures, or cancel and try again.', variant: 'destructive' });
  }, [picErr]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pictures ──
  const slots = pictureSlots(doc.doc, !!assetId);
  const urlOf = (shows: string) => (shows === MAIN ? pic?.url : shows.startsWith('data:') ? shows : extras[shows]?.url);

  const replace = (target: PictureTarget, pick: { assetId: string; marked?: boolean }) => {
    if (target === MAIN || (target === 'bg' && (!doc.doc.bg.photoId || doc.doc.bg.photoId === MAIN))) {
      // The new photo's crop starts centred (board-pictures.ts freshCrops): the old one's means nothing to it.
      setAssetId(pick.assetId); setMarked(!!pick.marked);
      doc.change(d => freshCrops(d, MAIN));
      return;
    }
    doc.change(d => replacePicture({ doc: d, assetId, marked }, target, pick).doc);
  };
  const restorable = (target: PictureTarget): boolean => {
    if (target === MAIN) return assetId !== start.assetId || marked !== start.marked;
    if (target === 'bg') return doc.doc.bg.photoId !== originBg;
    const was = origin.get(target);
    const l = doc.doc.layers.find(x => x.id === target);
    return !!was && !!l && l.kind === 'image' && (l.photoId !== was.photoId || l.src !== was.src);
  };
  const restore = (target: PictureTarget) => {
    setChecks(c => ({ ...c, [target]: null }));
    if (target === MAIN) { setAssetId(start.assetId); setMarked(start.marked); return; }
    if (target === 'bg') { doc.change(d => ({ ...d, bg: { ...d.bg, photoId: originBg } })); return; }
    const was = origin.get(target);
    if (!was) return;
    doc.change(d => ({ ...d, layers: d.layers.map(l => {
      if (l.id !== target || l.kind !== 'image') return l;
      const { src: _src, ...rest } = l;
      return was.src ? { ...rest, photoId: was.photoId, src: was.src } : { ...rest, photoId: was.photoId };
    }) }));
  };

  /** A new picture onto the design: in the middle, about half its width, kept in proportion. */
  const addPicture = (newAssetId: string) => {
    const w = Math.round(doc.doc.frame?.w ?? F.frame.w) * 0.45;
    const fw = doc.doc.frame?.w ?? F.frame.w, fh = doc.doc.frame?.h ?? F.frame.h;
    const layer = { ...newImageLayer(libRef(newAssetId)), x: Math.round(fw / 2 - w / 2), y: Math.round(fh / 2 - w / 2), w: Math.round(w), radius: 0, border: null, shadow: false };
    if (edRef.current) edRef.current.add(layer); else doc.change(d => ({ ...d, layers: [...d.layers, layer] }));
    setSlot(layer.id);
  };

  const onLibrary = (item: LibraryItem) => {
    const target = picking?.target;
    setPicking(null);
    if (!target) return;
    const pick = { assetId: item.original?.id ?? item.id, marked: item.source === 'site' && !item.original };
    if (target === 'add') addPicture(pick.assetId);
    else { replace(target, pick); setChecks(c => ({ ...c, [target]: null })); }
  };
  const onFile = async (file: File) => {
    const target = picking?.target;
    setPicking(null);
    if (!target) return;
    setBusy('Putting the picture in the library…');
    try {
      const id = await uploadPicture(file, file.name.replace(/\.[a-z0-9]+$/i, '') || 'Uploaded picture');
      if (target === 'add') addPicture(id);
      else { replace(target, { assetId: id, marked: false }); setChecks(c => ({ ...c, [target]: null })); }
    } catch (e) { fail('Couldn’t upload it', e); } finally { setBusy(null); }
  };

  /** The picture a slot shows, as a file for the AI. */
  const blobOf = async (shows: string): Promise<Blob> => {
    if (shows === MAIN) { if (!pic) throw new Error('The photo hasn’t come yet.'); return pic.blob; }
    if (shows.startsWith('data:')) return (await fetch(shows)).blob();
    const x = extras[shows] ?? await photoOf(assetOfRef(shows)!, true);
    return x.blob;
  };
  const aspectOf = (target: PictureTarget): string => {
    if (target === MAIN || target === 'bg') return F.ai;
    const l = doc.doc.layers.find(x => x.id === target);
    if (l?.kind !== 'image') return '1:1';
    const img = l.photoId === MAIN ? pic?.img : extras[l.photoId]?.img;
    return nearestAspect(l.w, l.h ?? (img ? l.w * img.naturalHeight / img.naturalWidth : l.w));
  };
  const runAi = async (target: PictureTarget, op: PhotoAi['op'] | 'restage' | 'custom', extra: { sceneId?: string; instruction?: string } = {}) => {
    const s = slots.find(x => x.target === target);
    if (!s || busy) return;
    const isMain = target === MAIN || (target === 'bg' && s.shows === MAIN);
    const wasMarked = isMain ? marked : false;
    const params: Record<string, unknown> =
      op === 'enhance' ? { tidy: false }
        : op === 'clean' ? { tidy: true }
          : op === 'retouch' ? {}
            : op === 'reframe' ? { aspect: F.ai, tidy: wasMarked }
              : op === 'restage' ? { sceneId: extra.sceneId, aspect: aspectOf(target) }
                : { instruction: extra.instruction };
    const what = PHOTO_AI.find(x => x.op === op);
    setBusy(`${what?.label ?? (op === 'restage' ? 'A new setting' : 'Your change')} — ${what?.secs ?? 'about a minute'}…`);
    try {
      const r = await runImageOp(await blobOf(s.shows), op === 'clean' ? 'enhance' : op, params);
      const id = await uploadPicture(r.blob, `${label || 'Design'} · AI ${op}`);
      // Tidied (logo off, extended clean, a new setting) carries no mark any more: the layout's own is wanted.
      const clean = op === 'clean' || op === 'restage' || (op === 'reframe' && wasMarked);
      replace(target, { assetId: id, marked: isMain ? (clean ? false : wasMarked) : false });
      setChecks(c => ({ ...c, [target]: r.check }));
      toast(r.check && !r.check.samePiece
        ? { title: 'Look closely', description: `The check thinks the piece changed: ${r.check.differences.slice(0, 2).join('; ') || 'not the same'}. Restore the original if so.`, variant: 'destructive' }
        : { title: 'Done', description: r.check ? 'The check says it is the same piece. The original is one tap away while this design is open.' : 'The original is one tap away while this design is open.' });
      if (isMain && clean && wasMarked) toast({ title: 'The logo is off the photo', description: 'Add the house’s mark from Elements → The shop’s marks, or pick a layout again.' });
    } catch (e) { fail('The AI couldn’t do that', e); } finally { setBusy(null); }
  };

  // ── Words ──
  const [brief, setBrief] = useState('');
  const [copy, setCopy] = useState<CopyResult | null>(null);
  const writeWords = async () => {
    if (busy) return;
    setBusy('Writing the words — about half a minute…');
    try {
      const r = await api<CopyResult>('/api/ads/studio/copy', { body: {
        name: label || fields.headline, collection: fields.kicker, brief, goal: 'WhatsApp conversations', specs: fields.weight,
      } });
      setCopy(r);
    } catch (e) { fail('Couldn’t write the words', e); } finally { setBusy(null); }
  };
  const setField = (b: Bind, v: string) => setFields(x => ({ ...x, [b]: v }));
  const freeText = doc.doc.layers.filter((l): l is Extract<typeof l, { kind: 'text' }> => l.kind === 'text' && !l.bind);

  // ── The designer, canvas first: the host's panels (Add, Pictures, Words) in its rail, tools for what is selected ──
  const edRef = useRef<Editor | null>(null);
  const fw = doc.doc.frame?.w ?? F.frame.w, fh = doc.doc.frame?.h ?? F.frame.h;
  const slotOfSelection = (ed: Editor): PictureTarget | null =>
    ed.one?.kind === 'image' ? ed.one.id : ed.bgSel ? (doc.doc.bg.photoId && assetOfRef(doc.doc.bg.photoId) ? 'bg' : assetId ? MAIN : null) : null;
  const openPictures = (ed: Editor, target: PictureTarget | null) => { if (target) setSlot(target); ed.setPanel('x:pictures'); };

  const panels: NonNullable<DesignerExtras['panels']> = [
    { id: 'x:add', label: 'Add', title: 'Add to the design', icon: <Plus className="h-5 w-5" />, render: ed => (edRef.current = ed,
      <AddPanel busy={!!busy}
        onText={() => ed.add({ ...newText(palette.body), x: Math.round(fw / 2), y: Math.round(fh / 2), width: Math.round(fw * 0.8) })}
        onTextStyles={() => ed.setPanel('text')} onPicture={() => setPicking({ target: 'add' })}
        onElements={() => ed.setPanel('elements')} onLayouts={() => ed.setPanel('templates')} onBrand={() => ed.setPanel('brand')}
        onLogo={() => ed.setPanel('x:logo')} />
    ) },
    { id: 'x:logo', label: 'Logo', title: 'Logo', icon: <Crown className="h-5 w-5" />, render: ed => (edRef.current = ed,
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">Tap a mark: it lands in the middle, to drag anywhere, size and turn. Its colour is under the mark once selected.</p>
        <MarksSection ed={ed} upload />
      </div>
    ) },
    { id: 'x:pictures', label: 'Pictures', title: 'Pictures', icon: <ImagePlus className="h-5 w-5" />, render: ed => (edRef.current = ed,
      <PicturesPanel slots={slots} urlOf={urlOf} selected={slotOfSelection(ed) ?? slot} busy={!!busy} checks={checks} restorable={restorable} hasMain={!!assetId}
        onChoose={t => { setSlot(t); if (t === MAIN || t === 'bg') ed.selectBg(); else ed.select([t]); }}
        onAdd={() => setPicking({ target: 'add' })} onMain={() => setPicking({ target: MAIN })}
        onReplace={t => setPicking({ target: t })} onRestore={restore} onAi={runAi} onCrop={t => { if (t === MAIN || t === 'bg') { ed.selectBg(); ed.setPanel('background'); } else { ed.select([t]); ed.setPanel('frame'); } }} />
    ) },
    { id: 'x:words', label: 'Words', title: 'Words', icon: <Pencil className="h-5 w-5" />, render: ed => {
      const sel = ed.one?.kind === 'text' ? ed.one : null;
      return (
        <div className="space-y-3">
          {FIELD_ROWS.map(([b, name, max]) => {
            const on = doc.doc.layers.some(l => l.kind === 'text' && l.bind === b);
            return (
              <label key={b} className={cn('block space-y-0.5 rounded-md', sel?.bind === b && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}>
                <span className="flex items-center justify-between text-[11px] text-muted-foreground">{name}
                  {!on && <button type="button" className="text-primary min-h-0" onClick={() => ed.setPanel('text')}>Put it on the design</button>}
                </span>
                <Input value={fields[b]} maxLength={max} onChange={e => setField(b, e.target.value)} className="h-9 text-base sm:text-sm" />
              </label>
            );
          })}
          {freeText.length > 0 && <p className="pt-1 text-[11px] font-medium text-muted-foreground">Other text on the design</p>}
          {freeText.map((l, i) => (
            <label key={l.id} className={cn('block space-y-0.5 rounded-md', sel?.id === l.id && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}>
              <span className="text-[11px] text-muted-foreground">{l.name || `Text ${i + 1}`}</span>
              <Textarea value={l.text} onFocus={() => ed.select([l.id])} onChange={e => { const t = e.target.value; doc.change(d => ({ ...d, layers: d.layers.map(x => (x.id === l.id && x.kind === 'text' ? { ...x, text: t } : x)) }), { key: `text:${l.id}` }); }} className="min-h-[44px] text-base sm:text-sm" />
            </label>
          ))}
          <WordsAi busy={!!busy} brief={brief} onBrief={setBrief} copy={copy} onWrite={writeWords}
            onUseAll={c => setFields(x => ({ ...x, kicker: c.onImage.kicker || x.kicker, headline: c.onImage.headline || x.headline, details: c.onImage.details || x.details }))}
            onHeadline={h => setField('headline', h.slice(0, 140))} />
          <div className="space-y-1.5 border-t pt-3">
            <p className="text-[11px] font-medium text-muted-foreground">Colours of the words</p>
            <div className="flex flex-wrap gap-1.5">
              {PALETTES.map(pp => (
                <button key={pp.id} type="button" title={pp.label} onClick={() => { setPalette(pp); doc.change(d => applyPalette(d, pp)); }}
                  className={cn('flex h-8 w-8 items-center justify-center rounded-full border-2 min-h-0', palette.id === pp.id ? 'border-primary' : 'border-transparent')} style={{ background: pp.dark ? '#2a2a2a' : '#EDE6DA' }}>
                  <span className="h-4 w-4 rounded-full" style={{ background: pp.headline }} />
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Fonts, sizes and any one line’s colour: select it on the design.</p>
          </div>
        </div>
      );
    } },
  ];

  /** Tools for what is selected, first in the toolbar (and the phone's bar). */
  // The design's other sizes, by shape ("9:16, 3:4"), for the link button.
  const sizesLabel = [...new Set(sizes.map(x => formatInfo(x.format).short))].join(', ');
  const tools = (ed: Editor, where: 'toolbar' | 'phone') => {
    edRef.current = ed;
    const T = ({ icon, label, onClick, primary }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) => where === 'toolbar'
      ? <button type="button" onClick={onClick} disabled={!!busy} className={cn('flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs disabled:opacity-40', primary ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'hover:bg-muted')}>{icon}{label}</button>
      : <button type="button" onClick={onClick} disabled={!!busy} className={cn('flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-1 px-1.5 py-2 text-[10px] disabled:opacity-40', primary ? 'text-primary' : 'text-foreground/80')}>{icon}<span className="whitespace-nowrap">{label}</span></button>;
    const i = where === 'toolbar' ? 'h-4 w-4' : 'h-5 w-5';
    const target = slotOfSelection(ed);
    if (target) return (<>
      <T primary icon={<ImagePlus className={i} />} label="Replace" onClick={() => setPicking({ target })} />
      <T primary icon={<Wand2 className={i} />} label="AI photo" onClick={() => openPictures(ed, target)} />
      {ed.bgSel && <T icon={<Maximize className={i} />} label="Crop" onClick={() => ed.setPanel('background')} />}
      {restorable(target) && <T icon={<Undo2 className={i} />} label="Original" onClick={() => restore(target)} />}
    </>);
    const words = <T primary={!sizes.length} icon={<Sparkles className={i} />} label={ed.one?.kind === 'text' && ed.one.bind ? 'Words · AI' : 'Words'} onClick={() => ed.setPanel('x:words')} />;
    if (ed.one?.kind === 'text') {
      if (!sizes.length) return words;
      const t = ed.one, n = linkedCount(sizes, t);
      return (<>
        <T primary icon={linkKey(t) ? <Link2 className={i} /> : <Link2Off className={i} />}
          label={linkKey(t) ? (where === 'toolbar' ? `Linked · ${n ? sizesLabel : 'as you edit'}` : 'Linked') : 'Unlinked'}
          onClick={() => { ed.update(t.id, l => toggleLink(l)); toast({ title: linkKey(t) ? 'Unlinked: this text is this size’s own' : `Linked: changes go to ${sizesLabel} too` }); }} />
        {words}
      </>);
    }
    if (ed.selLayers.length) return null;
    const loose = doc.doc.layers.filter(l => l.kind === 'text' && !linkKey(l));
    return (<>
      <T primary icon={<Plus className={i} />} label="Add" onClick={() => ed.setPanel('x:add')} />
      <T icon={<Pencil className={i} />} label="Words" onClick={() => ed.setPanel('x:words')} />
      {sizes.length > 0 && loose.length > 0 && <T icon={<Link2 className={i} />} label="Link all" onClick={() => { doc.change(d => ({ ...d, layers: d.layers.map(l => (l.kind === 'text' && !linkKey(l) ? toggleLink(l) : l)) })); toast({ title: `${loose.length} text${loose.length > 1 ? 's' : ''} linked`, description: `Changes to them now go to ${sizesLabel} too.` }); }} />}
      {assetId && <T icon={<ImagePlus className={i} />} label="Replace photo" onClick={() => setPicking({ target: MAIN })} />}
    </>);
  };

  // ── Moving between designs without leaving: the next and previous on the board, the design's other sizes ──
  const at = order.findIndex(x => x.id === start.id);
  const prev = at > 0 ? order[at - 1] : null, next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const group = [start, ...sizes].sort((a, b) => FORMATS.indexOf(a.format) - FORMATS.indexOf(b.format));
  const go = (id: string | undefined) => { if (id && id !== start.id) void leave(() => onSwitch(id)); };
  const goRef = useRef(go);
  goRef.current = go;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  useEffect(() => {
    // [ and ] (as in a slideshow): before the designer's own keys, and never while typing.
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== '[' && e.key !== ']') || e.metaKey || e.ctrlKey || e.altKey || pickingRef.current) return;
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      goRef.current(e.key === '[' ? prevRef.current?.id : nextRef.current?.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const prevRef = useRef(prev), nextRef = useRef(next);
  prevRef.current = prev; nextRef.current = next;
  // The designs one step away are fetched now, so moving to them is instant.
  useEffect(() => {
    const t = setTimeout(() => {
      for (const x of [next, prev, ...sizes, order[at + 2], order[at - 2]]) {
        if (!x) continue;
        if (x.assetId) photoOf(x.assetId).catch(() => undefined);
        extrasOf(x.doc).catch(() => undefined);
      }
    }, 250);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navBtn = 'flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 min-h-0';
  const designerExtras: DesignerExtras = {
    panels, tools, hide: ['photos'], startPanel: lastPanel === undefined ? 'x:add' : lastPanel, onPanel: p => { lastPanel = p; }, closeLabel: 'Board',
    hint: '[ ] the previous / next design · click to select · drag, resize and turn · ⌘Z / ⇧⌘Z undo · ⌘D duplicate · arrows nudge · right-click for order, lock, align · saved as you go',
    title: (
      <div className="flex min-w-0 items-center gap-0.5">
        <button type="button" className={cn(navBtn, 'hidden md:flex')} disabled={!prev || leaving} onClick={() => go(prev?.id)} title={prev ? `Previous: ${prev.label || 'Design'} ( [ )` : undefined} aria-label="Previous design"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" className={cn(navBtn, 'hidden md:flex')} disabled={!next || leaving} onClick={() => go(next?.id)} title={next ? `Next: ${next.label || 'Design'} ( ] )` : undefined} aria-label="Next design"><ChevronRight className="h-4 w-4" /></button>
        <input value={label} onChange={e => setLabel(e.target.value.slice(0, 80))} aria-label="Design name" placeholder="Design"
          className="h-8 min-w-0 max-w-[36vw] rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium outline-none hover:border-border focus:border-primary sm:max-w-[220px]" />
        {group.length > 1 && (
          <div className="hidden shrink-0 items-center rounded-full border p-0.5 sm:flex" role="tablist" aria-label="This design’s sizes">
            {group.map(g => (
              <button key={g.id} type="button" role="tab" aria-selected={g.id === start.id} disabled={leaving} onClick={() => go(g.id)} title={`${formatInfo(g.format).label}${g.id === start.id ? '' : ' — linked text follows'}`}
                className={cn('min-h-0 rounded-full px-2 py-1 text-[11px] font-medium tabular-nums', g.id === start.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {formatInfo(g.format).short}
              </button>
            ))}
          </div>
        )}
      </div>
    ),
    status: busy
      ? <span className="flex min-w-0 items-center gap-1 truncate rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary"><Loader2 className="h-3 w-3 shrink-0 animate-spin" /><span className="truncate max-w-[30vw] sm:max-w-[280px]">{busy}</span></span>
      : saveState === 'failed'
        ? <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Not saved · retrying</span>
        : <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground lg:flex">
          {saveState === 'saving' || pending ? <><Loader2 className="h-3 w-3 animate-spin" />Saving</> : <><CheckIcon className="h-3 w-3" />Saved{linked && sizes.length ? ` · ${sizesLabel} too` : ''}</>}
        </span>,
    actions: <Button size="sm" className="ml-1" disabled={leaving} onClick={cancel}>{leaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Done</Button>,
    strip: order.length > 1 ? <FrameStrip order={order} current={start.id} group={start.group} thumbs={thumbs} onPick={go} /> : undefined,
  };

  return (<>
    <SoloEditor designerOnly={{ onClose: cancel }} side={{
      label: label || 'Design', sub: F.label,
      placeholder: ready ? undefined : (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" /> Fetching the photo…
          <Button size="sm" variant="ghost" onClick={onClose}>Back to the board</Button>
        </div>
      ),
      props: {
        api: doc, square: true, fields, assets, extras: designerExtras,
        photos: [...(pic ? [{ id: PHOTO, url: pic.url, label: 'The photo' }] : []), ...Object.entries(extras).map(([id, x]) => ({ id, url: x.url, label: 'Library picture' }))],
        palette, onPalette: setPalette, lettered: null, weightOwnLine: true, websiteLabel: SITE_LABEL,
        onField: setField,
        presets: AD_TEMPLATES.map(t => ({ id: t.id, label: t.label })),
        onPreset: id => { setTemplate(id as AdTemplateId); doc.change(d => applyAdTemplate(d, id as AdTemplateId, fields, assets, { photoMarked: marked })); },
        previewPreset: id => applyAdTemplate(doc.doc, id as AdTemplateId, fields, assets, { photoMarked: marked }),
        fileName: safeName(fields.headline || label),
        cropLabel: 'Fill the frame', photoNote: 'The design’s photo: drag or pinch it on the page to choose what shows. Replace it, or edit it with AI, under Pictures.',
      },
    }} />
    <PhotoPicker open={!!picking} onOpenChange={o => { if (!o) setPicking(null); }} onPick={onLibrary} onFile={onFile} above
      title={picking?.target === 'add' ? 'Add a picture to the design' : 'Replace the picture'} />
  </>);
}

/** The designer's panel last open, kept as it moves from design to design (undefined: none opened yet). */
let lastPanel: SidePanel | null | undefined;
/** Where the strip was scrolled, so the next design's strip starts there and glides to it. */
let stripScroll = 0;

/**
 * The board under the page, in reading order: every design as it looks now (the board's own drawings, redrawn
 * as changes save), this one lit, its other sizes marked. Tap one to move to it.
 */
function FrameStrip({ order, current, group, thumbs, onPick }: { order: BoardFrame[]; current: string; group?: string; thumbs: Record<string, string>; onPick: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mobile = !!useIsMobile();
  const H = mobile ? 52 : 64;
  useLayoutEffect(() => {
    const sc = ref.current, el = sc?.querySelector<HTMLElement>('[data-current]');
    if (!sc || !el) return;
    sc.scrollLeft = stripScroll;
    sc.scrollTo({ left: el.offsetLeft - sc.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
  }, [current]);
  return (
    <div ref={ref} onScroll={e => { stripScroll = e.currentTarget.scrollLeft; }} role="listbox" aria-label="The board’s designs"
      className="flex shrink-0 items-end gap-1.5 overflow-x-auto overscroll-x-contain border-t bg-background px-3 py-2 [scrollbar-width:thin]">
      {order.map((x, i) => {
        const px = framePx(x), w = Math.round(H * px.w / px.h), on = x.id === current;
        const sib = !on && !!group && x.group === group;
        const gap = i > 0 && (!x.group || x.group !== order[i - 1].group);
        return (
          <button key={x.id} type="button" role="option" aria-selected={on} data-current={on ? '' : undefined} onClick={() => onPick(x.id)}
            title={`${x.label || 'Design'} · ${formatInfo(x.format).short}`}
            className={cn('relative shrink-0 overflow-hidden rounded-[3px] bg-muted min-h-0 transition-[box-shadow,opacity]', gap && 'ml-2.5',
              on ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : sib ? 'ring-1 ring-primary/60 opacity-95' : 'opacity-75 hover:opacity-100')}
            style={{ width: w, height: H }}>
            {thumbs[x.id] ? <img src={thumbs[x.id]} alt="" draggable={false} className="h-full w-full object-cover" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Add: the few things a design is made of, each one tap — the designer's full panels behind them. */
function AddPanel({ busy, onText, onTextStyles, onPicture, onElements, onLayouts, onBrand, onLogo }: {
  busy: boolean; onText: () => void; onTextStyles: () => void; onPicture: () => void; onElements: () => void; onLayouts: () => void; onBrand: () => void; onLogo: () => void;
}) {
  const tile = 'flex flex-col items-start gap-1 rounded-xl border p-3 text-left hover:border-primary hover:bg-primary/5 disabled:opacity-50 min-h-0';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={tile} onClick={onText}><Type className="h-5 w-5 text-primary" /><span className="text-sm font-medium">Text</span><span className="text-[11px] text-muted-foreground">A line to type into</span></button>
        <button type="button" className={tile} disabled={busy} onClick={onPicture}><ImagePlus className="h-5 w-5 text-primary" /><span className="text-sm font-medium">Picture</span><span className="text-[11px] text-muted-foreground">Library or this device</span></button>
        <button type="button" className={tile} onClick={onElements}><Shapes className="h-5 w-5 text-primary" /><span className="text-sm font-medium">Shapes</span><span className="text-[11px] text-muted-foreground">Lines, arrows, frames</span></button>
        <button type="button" className={tile} onClick={onElements}><Sparkles className="h-5 w-5 text-primary" /><span className="text-sm font-medium">Stickers</span><span className="text-[11px] text-muted-foreground">Badges</span></button>
        <button type="button" className={cn(tile, 'col-span-2')} onClick={onLogo}><Crown className="h-5 w-5 text-primary" /><span className="text-sm font-medium">Logo</span><span className="text-[11px] text-muted-foreground">The house’s mark as a vector, any colour, anywhere; or your own SVG</span></button>
      </div>
      <div className="space-y-1">
        <button type="button" className="w-full rounded-md border px-3 py-2 text-left text-sm hover:border-primary" onClick={onTextStyles}>Headings and font combinations →</button>
        <button type="button" className="w-full rounded-md border px-3 py-2 text-left text-sm hover:border-primary" onClick={onLayouts}>Start from a layout →</button>
        <button type="button" className="w-full rounded-md border px-3 py-2 text-left text-sm hover:border-primary" onClick={onBrand}>Brand colours and fonts →</button>
      </div>
      <p className="text-[11px] text-muted-foreground">Or paste a picture (⌘V). Anything you add can be dragged, resized and turned on the page.</p>
    </div>
  );
}

/** The design's pictures: choose one (or select it on the page), then replace it, crop it, or edit it with AI. */
function PicturesPanel({ slots, urlOf, selected, busy, checks, restorable, hasMain, onChoose, onAdd, onMain, onReplace, onRestore, onAi, onCrop }: {
  slots: PictureSlot[]; urlOf: (shows: string) => string | undefined; selected: PictureTarget | null; busy: boolean; checks: Record<string, Check>;
  restorable: (t: PictureTarget) => boolean; hasMain: boolean;
  onChoose: (t: PictureTarget) => void; onAdd: () => void; onMain: () => void; onReplace: (t: PictureTarget) => void; onRestore: (t: PictureTarget) => void;
  onAi: (t: PictureTarget, op: PhotoAi['op'], extra?: { sceneId?: string; instruction?: string }) => void; onCrop: (t: PictureTarget) => void;
}) {
  const current = slots.find(s => s.target === selected) ?? null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {slots.map(s => {
          const url = urlOf(s.shows);
          return (
            <button key={s.target} type="button" onClick={() => onChoose(s.target)} title={s.label}
              className={cn('relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 bg-muted min-h-0', selected === s.target ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-border')}>
              {url ? <img src={url} alt={s.label} className="h-full w-full object-cover" /> : <Loader2 className="m-auto h-4 w-4 animate-spin text-muted-foreground" />}
              {restorable(s.target) && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary" title="Changed" />}
            </button>
          );
        })}
        <button type="button" onClick={onAdd} disabled={busy} className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border-2 border-dashed text-[10px] text-muted-foreground hover:border-primary min-h-0"><Plus className="h-4 w-4" /> Add</button>
        {!hasMain && <button type="button" onClick={onMain} disabled={busy} className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border-2 border-dashed text-[10px] text-muted-foreground hover:border-primary min-h-0"><ImagePlus className="h-4 w-4" /> Photo</button>}
      </div>
      {current
        ? <PictureTools key={current.target} name={current.label} busy={busy} check={checks[current.target] ?? null} canRestore={restorable(current.target)}
            main={current.target === MAIN || (current.target === 'bg' && current.shows === MAIN)}
            onReplace={() => onReplace(current.target)} onRestore={() => onRestore(current.target)} onCrop={() => onCrop(current.target)}
            onAi={(op, extra) => onAi(current.target, op, extra)} />
        : <p className="text-[11px] text-muted-foreground">Tap a picture here or on the design. Replacing keeps its place, size, frame and crop.</p>}
    </div>
  );
}

/** The AI writes the words (the Studio's copy route, in the house's voice); a tap puts them in. */
function WordsAi({ busy, brief, onBrief, copy, onWrite, onUseAll, onHeadline }: {
  busy: boolean; brief: string; onBrief: (v: string) => void; copy: CopyResult | null; onWrite: () => void; onUseAll: (c: CopyResult) => void; onHeadline: (h: string) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/5 p-2">
      <p className="text-xs font-medium flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> Write with AI</p>
      <Input value={brief} onChange={e => onBrief(e.target.value)} placeholder="Aim (optional) — e.g. Eid gifting" className="h-8 text-base sm:text-xs" />
      <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={onWrite}>{busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />} {copy ? 'Write again' : 'Write the words'}</Button>
      {copy && (
        <div className="space-y-1.5 text-xs">
          {(copy.onImage.kicker || copy.onImage.headline || copy.onImage.details) && (
            <button type="button" className="w-full rounded-md border bg-background p-2 text-left hover:border-primary min-h-0" onClick={() => onUseAll(copy)}>
              {copy.onImage.kicker && <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{copy.onImage.kicker}</span>}
              <span className="block font-semibold">{copy.onImage.headline}</span>
              {copy.onImage.details && <span className="block text-muted-foreground">{copy.onImage.details}</span>}
              <span className="mt-1 block text-[10px] text-primary">Use all three</span>
            </button>
          )}
          {copy.headlines.length > 0 && <p className="text-[10px] text-muted-foreground">Other headlines — tap to use:</p>}
          <div className="flex flex-wrap gap-1">
            {copy.headlines.slice(0, 6).map(h => <button key={h} type="button" onClick={() => onHeadline(h)} className="rounded-full border px-2 py-0.5 text-[11px] hover:border-primary min-h-0">{h}</button>)}
          </div>
          {copy.why && <p className="text-[10px] italic text-muted-foreground">{copy.why}</p>}
        </div>
      )}
    </div>
  );
}

/** One picture's tools: replace it, the image AI on it, and its original back. */
function PictureTools({ name, main, busy, check, canRestore, onReplace, onRestore, onAi, onCrop }: {
  name: string; main: boolean; busy: boolean; check: Check; canRestore: boolean;
  onReplace: () => void; onRestore: () => void; onCrop: () => void; onAi: (op: PhotoAi['op'], extra?: { sceneId?: string; instruction?: string }) => void;
}) {
  const [scene, setScene] = useState(SCENES[0]?.id ?? '');
  const [ask, setAsk] = useState('');
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 truncate text-xs font-medium">{name}</p>
        {canRestore && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={onRestore}><Undo2 className="h-3.5 w-3.5 mr-1" /> Original</Button>}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-1.5">
        <Button size="sm" variant="outline" disabled={busy} onClick={onReplace}><ImagePlus className="h-4 w-4 mr-1" /> Replace</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCrop}><Maximize className="h-4 w-4 mr-1" /> Crop</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">From the library, or a picture from this device.</p>
      <p className="text-[11px] font-medium flex items-center gap-1 pt-1"><Wand2 className="h-3.5 w-3.5" /> With AI</p>
      <div className="grid grid-cols-2 gap-1.5">
        {PHOTO_AI.filter(x => main || !x.main).map(x => <Button key={x.op} size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal py-1 text-xs" disabled={busy} onClick={() => onAi(x.op)}>{x.label}</Button>)}
      </div>
      <div className="flex gap-1.5">
        <select value={scene} onChange={e => setScene(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs" aria-label="Setting">
          {SCENES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy || !scene} onClick={() => onAi('restage', { sceneId: scene })}>New setting</Button>
      </div>
      <div className="flex gap-1.5">
        <Input value={ask} onChange={e => setAsk(e.target.value)} placeholder="Ask for a change — e.g. warmer light" className="h-8 text-base sm:text-xs" />
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy || !ask.trim()} onClick={() => onAi('custom', { instruction: ask.trim() })}>Ask</Button>
      </div>
      {check && <p className={cn('text-[11px]', check.samePiece ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300')}>{check.samePiece ? 'The check: the same piece as before.' : `The check: the piece may have changed — ${check.differences.slice(0, 3).join('; ') || 'not the same'}.`}</p>}
      <p className="text-[10px] text-muted-foreground">Each AI edit is checked against the picture it came from, and kept in the library as an upload.</p>
    </div>
  );
}

// ── Choosing a photo ───────────────────────────────────────────────────────

function PhotoPicker({ open, onOpenChange, onPick, withFormat, title = 'Add a photo', onFile, above }: {
  open: boolean; onOpenChange: (o: boolean) => void; onPick: (item: LibraryItem, format: AdFormat) => void;
  /** Choose the new design's shape too (adding a design to the board). */
  withFormat?: boolean; title?: string;
  /** Offer a picture from this phone or computer as well. */
  onFile?: (file: File, format: AdFormat) => void;
  /** Over the full-screen designer (z-60). */
  above?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [format, setFormat] = useState<AdFormat>('portrait');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [fetching, setFetching] = useState(false);
  /** A picture from anywhere on the web: an image address, or a page that shares one (an Instagram post). */
  const fromLink = async () => {
    if (!onFile || !link.trim()) return;
    setFetching(true); setErr(null);
    try {
      const res = await fetch(`/api/ads/studio/fetch-image?url=${encodeURIComponent(link.trim())}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error || `Could not fetch it (${res.status}).`);
      const blob = await res.blob();
      const name = (() => { try { const u = new URL(link.trim()); return u.hostname.includes('instagram') ? 'Instagram photo' : (u.pathname.split('/').filter(Boolean).pop() || u.hostname); } catch { return 'Picture from a link'; } })();
      setLink('');
      onFile(new File([blob], name, { type: blob.type || 'image/jpeg' }), format);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setFetching(false); }
  };
  // A picture pasted while the picker is open (copied from a website, WhatsApp, Photos) goes straight in.
  useEffect(() => {
    if (!open || !onFile) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); onFile(f, format); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, onFile, format]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      setErr(null);
      try {
        const r = await api<LibraryResponse>(`/api/ads/studio/library?view=all&sort=score&limit=48&q=${encodeURIComponent(q)}`);
        if (live) setItems(r.items);
      } catch (e) { if (live) setErr(e instanceof Error ? e.message : String(e)); }
    }, q ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [open, q]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-w-3xl max-h-[90svh] overflow-y-auto', above && 'z-[70]')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>From {SITE_LABEL}, the shared Drive and your uploads, best for ads first.{onFile ? ' Or your own: Photos, Files, Google Drive or iCloud (“Photos, Files or Drive”), a link to any picture or Instagram post, or paste one.' : ''}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — ring, emerald, bangles…" className="h-9 flex-1 min-w-[180px] text-base sm:text-sm" />
          {withFormat && (
            <Select value={format} onValueChange={v => setFormat(v as AdFormat)}>
              <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>{FORMATS.map(x => <SelectItem key={x} value={x}>{AD_FORMATS[x as Exclude<AdFormat, 'custom'>].label}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {onFile && (<>
            {/* The system picker: Photo Library, camera, and Files, where Google Drive, iCloud and Dropbox sit. */}
            <Button size="sm" variant="outline" className="h-9" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" /> Photos, Files or Drive</Button>
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onFile(file, format); }} />
          </>)}
        </div>
        {onFile && (
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void fromLink(); }}>
            <Input value={link} onChange={e => setLink(e.target.value)} inputMode="url" placeholder="Paste a link: an Instagram post or any picture" className="h-9 flex-1 text-base sm:text-sm" />
            <Button size="sm" type="submit" className="h-9" disabled={!link.trim() || fetching}>{fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}</Button>
          </form>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!items && !err && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {items && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {items.map(it => (
              <button key={it.id} type="button" onClick={() => onPick(it, format)} className="text-left rounded-lg border overflow-hidden hover:ring-2 hover:ring-primary min-h-0">
                <AuthedImg src={it.thumb} alt={it.name} className="aspect-square w-full" />
                <p className="truncate px-1.5 py-1 text-[11px]">{it.name}</p>
              </button>
            ))}
            {!items.length && <p className="col-span-full text-sm text-muted-foreground">Nothing matches.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Connecting an agent ────────────────────────────────────────────────────

function AgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<{ label: string; at: string; last: string | null; tail: string }[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const load = useCallback(() => api<{ keys: NonNullable<typeof keys> }>('/api/ads/studio/agent-keys').then(r => setKeys(r.keys)).catch(() => setKeys([])), []);
  useEffect(() => { if (open) { setFresh(null); load(); } }, [open, load]);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const name = `${(SITE_LABEL.split('.')[0] || 'shop').toLowerCase()}-studio`;
  const command = fresh ? `claude mcp add --transport http ${name} ${origin}/api/studio/mcp --header "Authorization: Bearer ${fresh}"` : '';
  const make = async () => {
    setMaking(true);
    try { const r = await api<{ key: string }>('/api/ads/studio/agent-keys', { body: { label: 'Claude Code' } }); setFresh(r.key); load(); }
    catch (e) { toast({ title: 'Couldn’t make a key', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setMaking(false); }
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast({ title: 'Copied' }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Connect an agent</DialogTitle>
          <DialogDescription>Claude Code (or any MCP client) can read your style, search the photo library, put designs on a board, look at them and leave notes — within the house’s rules.</DialogDescription>
        </DialogHeader>
        {fresh ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Run this once in a terminal (the key is shown only now):</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-[12px]">{command}</pre>
            <Button size="sm" onClick={() => copy(command)}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
            <p className="text-[11px] text-muted-foreground">Then ask Claude, for example: “Fill the Eid board with six ring ads from the studio.” Keep this board open here: it lays out and draws what the agent adds.</p>
          </div>
        ) : (
          <Button onClick={make} disabled={making}>{making ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />} Make a key</Button>
        )}
        {keys && keys.length > 0 && (
          <div className="space-y-1.5 pt-2">
            <p className="text-xs font-semibold">Keys</p>
            {keys.map(k => (
              <div key={k.tail} className="flex items-center gap-2 text-xs">
                <span className="flex-1">{k.label} ··{k.tail} · made {new Date(k.at).toLocaleDateString()} · {k.last ? `used ${new Date(k.last).toLocaleString()}` : 'not used yet'}</span>
                <Button size="sm" variant="ghost" className="h-7" onClick={async () => { await api(`/api/ads/studio/agent-keys?tail=${k.tail}`, { method: 'DELETE' }); load(); }}><X className="h-3.5 w-3.5 mr-1" /> Revoke</Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
