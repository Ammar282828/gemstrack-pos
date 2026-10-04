/**
 * The Studio's boards in Firestore (board-shape.ts says what a board is).
 *
 *   studio_boards/{id}                  the board: name, designs, notes, rev
 *   studio_board_views/{board}__{frame} the design as the page last drew it (a JPEG, ≤ 900 KB) and the
 *                                        design's rev it shows — what a connected agent looks at
 *   app_settings/studio_agent           the agent keys, as SHA-256 hashes (a key is shown once)
 *
 * Every change is a list of operations applied in a transaction, so the page and an agent working on
 * the same board at once never overwrite each other. Server-only.
 */

import { createHash, randomBytes } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { applyOps, type Board, type BoardOp } from './board-shape';

export const BOARDS = 'studio_boards';
const VIEWS = 'studio_board_views';
const AGENT = 'app_settings/studio_agent';

export interface BoardSummary { id: string; name: string; frames: number; notes: number; updated: string; by: string }

const now = () => new Date().toISOString();
const fail = (m: string, status: number) => Object.assign(new Error(m), { status });

export async function listBoards(): Promise<BoardSummary[]> {
  const snap = await adminDb.collection(BOARDS).orderBy('updated', 'desc').limit(200).get();
  return snap.docs.map(d => {
    const b = d.data() as Omit<Board, 'id'>;
    return { id: d.id, name: b.name, frames: b.frames?.length ?? 0, notes: b.notes?.length ?? 0, updated: b.updated, by: b.by ?? '' };
  });
}

export async function getBoard(id: string): Promise<Board | null> {
  const s = await adminDb.collection(BOARDS).doc(id).get();
  return s.exists ? ({ id: s.id, ...(s.data() as Omit<Board, 'id'>) }) : null;
}

export async function createBoard(name: string, by: string): Promise<Board> {
  const clean = name.trim().slice(0, 60) || 'Untitled board';
  const ref = adminDb.collection(BOARDS).doc();
  const board: Omit<Board, 'id'> = { name: clean, frames: [], notes: [], rev: 1, updated: now(), by };
  await ref.set(board);
  return { id: ref.id, ...board };
}

export async function deleteBoard(id: string): Promise<void> {
  const views = await adminDb.collection(VIEWS).where('board', '==', id).get();
  const batch = adminDb.batch();
  views.docs.forEach(d => batch.delete(d.ref));
  batch.delete(adminDb.collection(BOARDS).doc(id));
  await batch.commit();
}

/** Apply operations in a transaction; the board's rev goes up by one. Returns the board and the ids added. */
export async function changeBoard(id: string, ops: BoardOp[], by: string): Promise<{ board: Board; added: string[] }> {
  if (!Array.isArray(ops) || !ops.length) throw fail('Nothing to change.', 400);
  if (ops.length > 60) throw fail('At most 60 changes at once.', 400);
  const ref = adminDb.collection(BOARDS).doc(id);
  return adminDb.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) throw fail('That board is gone.', 404);
    const current = { id: s.id, ...(s.data() as Omit<Board, 'id'>) };
    const { board, added } = applyOps(current, ops);
    const next: Board = { ...board, rev: current.rev + 1, updated: now(), by };
    const { id: _id, ...data } = next;
    tx.set(ref, data);
    return { board: next, added };
  });
}

// ── What a design looks like, for the agent ────────────────────────────────

const viewId = (board: string, frame: string) => `${board}__${frame}`;

export async function putView(board: string, frame: string, rev: number, jpeg: Buffer): Promise<void> {
  if (jpeg.length > 900 * 1024) throw fail('The picture is too big (900 KB at most).', 413);
  await adminDb.collection(VIEWS).doc(viewId(board, frame)).set({ board, frame, rev, jpeg, at: now() });
}

export async function getView(board: string, frame: string): Promise<{ rev: number; jpeg: Buffer; at: string } | null> {
  const s = await adminDb.collection(VIEWS).doc(viewId(board, frame)).get();
  if (!s.exists) return null;
  const d = s.data() as { rev: number; jpeg: Buffer; at: string };
  return { rev: d.rev, jpeg: Buffer.from(d.jpeg), at: d.at };
}

/** The revs the page has drawn for each design of a board, so it draws only what changed. */
export async function viewRevs(board: string): Promise<Record<string, number>> {
  const snap = await adminDb.collection(VIEWS).where('board', '==', board).select('frame', 'rev').get();
  return Object.fromEntries(snap.docs.map(d => [d.get('frame') as string, d.get('rev') as number]));
}

// ── Agent keys ─────────────────────────────────────────────────────────────

export interface AgentKey { hash: string; label: string; at: string; last: string | null; tail: string }
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export async function listAgentKeys(): Promise<Omit<AgentKey, 'hash'>[]> {
  const s = await adminDb.doc(AGENT).get();
  return ((s.get('keys') as AgentKey[] | undefined) ?? []).map(({ hash: _h, ...k }) => k);
}

/** A new key: returned once, kept only as its hash. */
export async function createAgentKey(label: string): Promise<string> {
  const key = `tstudio_${randomBytes(24).toString('base64url')}`;
  const entry: AgentKey = { hash: hashKey(key), label: label.trim().slice(0, 60) || 'Claude Code', at: now(), last: null, tail: key.slice(-4) };
  await adminDb.runTransaction(async tx => {
    const ref = adminDb.doc(AGENT);
    const s = await tx.get(ref);
    const keys = ((s.get('keys') as AgentKey[] | undefined) ?? []).slice(-9);
    tx.set(ref, { keys: [...keys, entry] }, { merge: true });
  });
  return key;
}

export async function revokeAgentKey(tail: string): Promise<void> {
  await adminDb.runTransaction(async tx => {
    const ref = adminDb.doc(AGENT);
    const s = await tx.get(ref);
    const keys = ((s.get('keys') as AgentKey[] | undefined) ?? []).filter(k => k.tail !== tail);
    tx.set(ref, { keys }, { merge: true });
  });
}

/** The key's label when it is one of ours (and its last use is noted, at most once a minute); null otherwise. */
export async function checkAgentKey(key: string): Promise<string | null> {
  if (!key || !key.startsWith('tstudio_') || key.length > 80) return null;
  const h = hashKey(key);
  const ref = adminDb.doc(AGENT);
  const s = await ref.get();
  const keys = (s.get('keys') as AgentKey[] | undefined) ?? [];
  const hit = keys.find(k => k.hash === h);
  if (!hit) return null;
  if (!hit.last || Date.now() - Date.parse(hit.last) > 60_000) {
    await ref.set({ keys: keys.map(k => (k.hash === h ? { ...k, last: now() } : k)) }, { merge: true }).catch(() => undefined);
  }
  return hit.label;
}
