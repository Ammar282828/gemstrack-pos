/** A refused move answered the way every write route answers it: 409 with the reason and what is allowed instead. */
import { NextResponse } from 'next/server';
import { MoveRefused } from './machine';

export const moveRefusedBody = (e: MoveRefused) => ({ error: e.message, machine: e.machine, from: e.from, to: e.to, allowed: e.allowed });

/** The 409 for a MoveRefused, or null when `e` is anything else (so a catch can `return moveRefusedResponse(e) ?? …`). */
export function moveRefusedResponse(e: unknown): NextResponse | null {
  return e instanceof MoveRefused ? NextResponse.json(moveRefusedBody(e), { status: e.status }) : null;
}
