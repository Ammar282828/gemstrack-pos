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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Bot, CalendarDays, Copy, Download, FolderOpen, Loader2, Maximize, Minus, Pencil, Plus, Rocket, Send, Shapes, Sparkles, StickyNote, Trash2, ImagePlus, Files, KeyRound, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PALETTES, canvasToJpeg, loadImage } from '@/lib/social/story';
import { reflow, renderDocTo, type Assets, type Bind, type Fields, type StoryDoc } from '@/lib/social/editor';
import { AD_FORMATS, AD_FORMAT_ORDER, AD_TEMPLATES, MORE_FORMAT_ORDER, PHOTO, applyAdTemplate, blankAd, formatInfo, type AdFormat, type AdTemplateId } from '@/lib/ads/studio/templates';
import { BOARD_SCALE, applyOps, framePx, newId, safeTemplate, type Board, type BoardFrame, type BoardNote, type BoardOp } from '@/lib/ads/studio/board-shape';
import type { BoardSummary } from '@/lib/ads/studio/board';
import type { Direction } from '@/lib/ads/studio/prompts';
import { VOICE } from '@/lib/ads/studio/brand';
import { HANDOFF_PREFIX, type StudioHandoff } from '@/lib/ads/studio/handoff';
import type { WeeklyState } from '@/lib/ads/studio/weekly';
import { STORE_LINKS } from '@/lib/store-config';
import { SoloEditor, useStoryDoc } from '../../website/post/story-editor';
import { FONTS, bodyFace, headlineFace, serifFace } from '../../website/post/fonts';
import { useSiteAssets } from '../../website/post/site-assets';
import { api, authHeaders } from '../ads-kit';
import { AuthedImg, SITE_LABEL, downloadBlob, fetchAsset, safeName, type LibraryItem, type LibraryResponse } from './studio-kit';

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
function photoOf(id: string): Promise<Pic> {
  let p = pics.get(id);
  if (!p) {
    p = fetchAsset(id, 1600).then(async blob => ({ blob, img: await loadImage(blob), url: URL.createObjectURL(blob) }));
    p.catch(() => pics.delete(id));
    pics.set(id, p);
  }
  return p;
}

let fontsOnce: Promise<unknown> | null = null;
const fontsReady = () => (fontsOnce ??= Promise.all(
  [`600 40px ${FONTS.headline}`, `400 40px ${FONTS.body}`, `400 40px ${FONTS.serif}`, `italic 400 40px ${FONTS.serif}`].map(f => document.fonts.load(f).catch(() => null)),
));

const assetsFor = (pic: Pic | null, marks: Assets['marks']): Assets => ({ photos: pic ? { [PHOTO]: pic.img } : {} as Assets['photos'], marks, fonts: FONTS });
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
  const [editing, setEditing] = useState<string | null>(null);
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
      const r = await api<{ board: Board; added: string[] }>(`/api/ads/studio/boards/${id}`, { method: 'PATCH', body: { ops } });
      setBoard(r.board);
      return r.added;
    } catch (e) {
      fail('That didn’t save', e);
      load().catch(() => undefined);
      return [];
    } finally { busy.current--; }
  }, [id, fail, load]);

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
  useEffect(() => { if (board && !fitted.current) { fitted.current = true; requestAnimationFrame(fit); } }, [board, fit]);

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
      send([g.kind === 'frame' ? { op: 'move', id: g.id!, x, y } : { op: 'noteMove', id: g.id!, x, y }]);
    }
  };

  // ── Actions ──
  const selFrame = sel?.kind === 'frame' ? frames.find(f => f.id === sel.id) ?? null : null;
  const selNote = sel?.kind === 'note' ? notes.find(n => n.id === sel.id) ?? null : null;

  const addNote = () => {
    const el = boxRef.current;
    const at = el ? { x: (el.clientWidth / 2 - view.x) / view.z - 120, y: (el.clientHeight / 2 - view.y) / view.z - 80 } : { x: 0, y: 0 };
    const nid = newId('note');
    send([{ op: 'note', note: { id: nid, text: 'Note', ...at } }]).then(() => setSel({ kind: 'note', id: nid }));
  };

  const addPhoto = async (item: LibraryItem, format: AdFormat) => {
    setPicker(false);
    const fid = newId('frame');
    await send([{ op: 'add', frame: {
      // The website photo's unmarked Drive original when there is one (as the maker does): no burned-in wordmark cut by the frame.
      id: fid, assetId: item.original?.id ?? item.id, marked: item.source === 'site' && !item.original, format, template: safeTemplate('headline', { marked: item.source === 'site' && !item.original, format }), label: item.name, by: 'page', doc: null,
      fields: {
        kicker: item.source === 'site' && item.collection !== 'Website' ? item.collection : '',
        headline: item.assessment?.headline || item.name, weight: item.specs ?? '', details: VOICE.ctas[0].replace(/\.$/, ''),
      },
    } }]);
    setSel({ kind: 'frame', id: fid });
  };

  const duplicate = (f: BoardFrame, format?: AdFormat) => {
    const { id: _id, rev: _rev, x: _x, y: _y, ...rest } = f;
    const short = format ? formatInfo(format).short : '';
    send([{ op: 'add', near: f.id, frame: { ...rest, by: 'page', ...(format ? { format, doc: null, template: safeTemplate(f.template, { marked: f.marked, format }), label: `${f.label} · ${short}` } : { label: `${f.label} · copy` }) } }]);
  };

  /** The design at full size (or the same layout in another shape: the story for Instagram). */
  const render = async (f: BoardFrame, shape?: AdFormat, px?: number, q = 0.92) => {
    const pic = f.assetId ? await photoOf(f.assetId) : null;
    const a = assetsFor(pic, marks);
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
        const { id: _id, rev: _rev, x: _x, y: _y, ...rest } = f;
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

  if (!board) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Opening the board…</p>;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <div className="space-y-2 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => setPicker(true)}><ImagePlus className="h-4 w-4 mr-1" /> Add a photo</Button>
          <Button size="sm" variant="outline" onClick={addNote}><StickyNote className="h-4 w-4 mr-1" /> Note</Button>
          <span className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, (boxRef.current?.clientWidth ?? 0) / 2, (boxRef.current?.clientHeight ?? 0) / 2)}><Minus className="h-4 w-4" /></Button>
            <span className="text-xs tabular-nums w-10 text-center text-muted-foreground">{Math.round(view.z * 100)}%</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Zoom in" onClick={() => zoomAt(1.25, (boxRef.current?.clientWidth ?? 0) / 2, (boxRef.current?.clientHeight ?? 0) / 2)}><Plus className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={fit}><Maximize className="h-4 w-4 mr-1" /> Fit</Button>
          </span>
        </div>
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
          className="relative h-[68svh] min-h-[420px] overflow-hidden rounded-xl border bg-muted/40 touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.25) 1px, transparent 1px)', backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
          onPointerDown={e => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        >
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            {frames.map(f => {
              const p = pos('frame', f);
              return (
                <FrameCard key={f.id} frame={f} x={p.x} y={p.y} selected={sel?.kind === 'frame' && sel.id === f.id} fresh={fresh.has(f.id)}
                  marks={marks} ready={marksReady && fontsOk} boardId={board.id} drawnRev={drawn[f.id]}
                  onDown={e => onDown(e, { kind: 'frame', id: f.id, x: f.x, y: f.y })} onLaidOut={onLaidOut} onDrawn={onDrawn}
                  onOpen={() => setEditing(f.id)} />
              );
            })}
            {notes.map(n => {
              const p = pos('note', n);
              return <NoteCard key={n.id} note={n} x={p.x} y={p.y} selected={sel?.kind === 'note' && sel.id === n.id} onDown={e => onDown(e, { kind: 'note', id: n.id, x: n.x, y: n.y })} onText={t => send([{ op: 'noteText', id: n.id, text: t }])} />;
            })}
          </div>
          {!frames.length && !notes.length && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-sm text-muted-foreground text-center max-w-xs">Add a photo to start, or connect an agent and ask it to fill the board.</p>
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">Drag the ground to move around · pinch or ctrl-scroll to zoom · double-tap a design to edit it.</p>
      </div>

      <aside className="space-y-3">
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
            onRemove={() => { send([{ op: 'remove', id: selFrame.id }]); setSel(null); }} />
        )}
        {selNote && (
          <section className="rounded-xl border p-3 space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><StickyNote className="h-4 w-4" /> Note{selNote.by === 'agent' ? ' from the agent' : ''}</p>
            <p className="text-xs text-muted-foreground">Edit it on the board. A note is a brief for Let it cook, and the first thing a connected agent reads.</p>
            <Button size="sm" variant="outline" onClick={() => { send([{ op: 'noteRemove', id: selNote.id }]); setSel(null); }}><Trash2 className="h-4 w-4 mr-1" /> Remove the note</Button>
          </section>
        )}
        {!sel && <p className="text-xs text-muted-foreground rounded-xl border p-3">Tap a design to edit it, cook variants of it, or make it in another shape.</p>}
      </aside>

      <PhotoPicker open={picker} onOpenChange={setPicker} onPick={addPhoto} />
      {queueFor && <QueueDialog frame={queueFor} onClose={() => setQueueFor(null)} onQueue={o => queuePost(queueFor, o)} />}
      {editing && (() => {
        const f = frames.find(x => x.id === editing);
        return f ? <FrameEditor frame={f} marks={marks} onClose={() => setEditing(null)} onSave={patch => { send([{ op: 'put', id: f.id, patch: { ...patch, by: 'page' } }]); setEditing(null); }} /> : null;
      })()}
    </div>
  );
}

// ── A design on the board ──────────────────────────────────────────────────

function FrameCard({ frame: f, x, y, selected, fresh, marks, ready, boardId, drawnRev, onDown, onLaidOut, onDrawn, onOpen }: {
  frame: BoardFrame; x: number; y: number; selected: boolean; fresh: boolean; marks: Assets['marks']; ready: boolean; boardId: string; drawnRev: number | undefined;
  onDown: (e: React.PointerEvent) => void; onLaidOut: (f: BoardFrame, doc: StoryDoc) => void; onDrawn: (id: string, rev: number) => void; onOpen: () => void;
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
        const a = assetsFor(pic, marks);
        if (!f.doc) { onLaidOut(f, layOut(f, a)); return; }
        const shown = await canvasToJpeg(drawTo(f.doc, f.fields, a, SHOW_PX), 0.86);
        if (!live) return;
        setUrl(old => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(shown); });
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

function QueueDialog({ frame: f, onClose, onQueue }: { frame: BoardFrame; onClose: () => void; onQueue: (o: { whatsapp: string[]; instagram: boolean; caption: string }) => void }) {
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
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
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

function FrameEditor({ frame: f, marks, onClose, onSave }: { frame: BoardFrame; marks: Assets['marks']; onClose: () => void; onSave: (p: Partial<BoardFrame>) => void }) {
  const [pic, setPic] = useState<Pic | null>(null);
  const [fields, setFields] = useState<Fields>(f.fields);
  const [template, setTemplate] = useState<AdTemplateId>(f.template);
  const assets = useMemo(() => assetsFor(pic, marks), [pic, marks]);
  const doc = useStoryDoc(f.doc ?? blankAd(f.format));
  const started = useRef(false);
  useEffect(() => { if (f.assetId) photoOf(f.assetId).then(setPic).catch(() => setPic(null)); }, [f.assetId]);
  useEffect(() => {
    if (started.current || (f.assetId && !pic)) return;
    started.current = true;
    if (!f.doc) doc.reset(layOut({ ...f, fields, template }, assets));
  }, [pic]); // eslint-disable-line react-hooks/exhaustive-deps
  const F = formatInfo(f.format);
  const ready = !f.assetId || !!pic;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[95svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f.label || 'Design'}</DialogTitle>
          <DialogDescription>{F.label} · {F.px}×{Math.round(F.px * F.frame.h / F.frame.w)}</DialogDescription>
        </DialogHeader>
        <SoloEditor side={{
          label: 'The design', sub: F.label,
          placeholder: ready ? undefined : <div className="flex h-60 items-center justify-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fetching the photo…</div>,
          props: {
            api: doc, square: true, fields, assets,
            photos: pic ? [{ id: PHOTO, url: pic.url, label: f.label }] : [],
            palette: PALETTES[0], onPalette: () => undefined, lettered: null, weightOwnLine: true, websiteLabel: SITE_LABEL,
            onField: (b: Bind, v: string) => setFields(x => ({ ...x, [b]: v })),
            presets: AD_TEMPLATES.map(t => ({ id: t.id, label: t.label })),
            onPreset: id => { setTemplate(id as AdTemplateId); doc.change(d => applyAdTemplate(d, id as AdTemplateId, fields, assets, { photoMarked: f.marked })); },
            previewPreset: id => applyAdTemplate(doc.doc, id as AdTemplateId, fields, assets, { photoMarked: f.marked }),
            fileName: safeName(fields.headline || f.label),
          },
        }} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready} onClick={() => onSave({ doc: doc.doc, fields, template })}>Save to the board</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Choosing a photo ───────────────────────────────────────────────────────

function PhotoPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (item: LibraryItem, format: AdFormat) => void }) {
  const [q, setQ] = useState('');
  const [format, setFormat] = useState<AdFormat>('portrait');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
      <DialogContent className="max-w-3xl max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a photo</DialogTitle>
          <DialogDescription>From taheri.shop and the shared Drive, best for ads first.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — ring, emerald, bangles…" className="h-9 flex-1 min-w-[180px] text-base sm:text-sm" />
          <Select value={format} onValueChange={v => setFormat(v as AdFormat)}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>{FORMATS.map(x => <SelectItem key={x} value={x}>{AD_FORMATS[x as Exclude<AdFormat, 'custom'>].label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
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
