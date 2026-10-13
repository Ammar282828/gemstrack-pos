/**
 * Google's push service (FCM) for the Android app, through firebase-admin's messaging under the
 * backend's own service account: no key to upload. lib/push/send.ts decides who gets what; this
 * only delivers. The outcome has the shape of apns.ts's.
 *
 * Server-only.
 */

import { getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import '@/lib/firebase-admin'; // initialises the default app

export interface FcmAlert {
  title: string;
  body: string;
  /** The ERP page the notification opens (a path). */
  url?: string;
  /** The push kind; also the Android notification channel's id. */
  kind: string;
}

export interface FcmOutcome {
  sent: number;
  /** Tokens FCM says are no longer any phone's (the app was removed): to forget. */
  gone: string[];
  failed: { token: string; status: number; reason: string }[];
}

const GONE = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

/** One notification to each Android phone; never throws for a phone's refusal. */
export async function sendFcm(tokens: string[], alert: FcmAlert): Promise<FcmOutcome> {
  const out: FcmOutcome = { sent: 0, gone: [], failed: [] };
  if (!tokens.length) return out;
  const res = await getMessaging(getApp()).sendEach(tokens.map((token) => ({
    token,
    notification: { title: alert.title, body: alert.body },
    data: { url: alert.url ?? '', kind: alert.kind },
    android: { priority: 'high' as const, notification: { channelId: alert.kind } },
  })));
  res.responses.forEach((r, i) => {
    if (r.success) out.sent++;
    else if (r.error && GONE.has(r.error.code)) out.gone.push(tokens[i]);
    else out.failed.push({ token: tokens[i], status: 0, reason: r.error?.code || r.error?.message || 'no answer' });
  });
  return out;
}
