/**
 * What an operation of the app's write route gets besides its body: the activity log, the
 * WhatsApp alert and the follow-ups the phone posts once the write has landed (route.ts).
 * Groups of operations live in their own files (ops-<group>.ts), each with its table of who may
 * run them and its handler, so one route answers them all and no two groups edit the same lines.
 */

import type { NextResponse } from 'next/server';

export type FollowUp = { path: string; body: Record<string, unknown> };

export interface OpContext {
  /** The signed-in person's email, as the activity log records it. */
  email: string;
  log: (action: string, title: string, detail: string, ref?: string) => Promise<void>;
  /** A WhatsApp alert the browser would raise for the same change (/api/notifications/alert). */
  alert: (body: Record<string, unknown>) => void;
  followUps: FollowUp[];
}

export type OpRoles = Record<string, ('owner' | 'staff')[]>;

/** Runs `op` if the group has it; null leaves it to the next group. */
export type OpHandler = (op: string, body: Record<string, unknown>, ctx: OpContext) => Promise<NextResponse | null>;
