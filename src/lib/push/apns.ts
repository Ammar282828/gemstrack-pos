/**
 * Apple's push service, spoken to directly (HTTP/2, token auth): no Firebase SDK in the app and
 * no service in between. lib/push/send.ts decides who gets what; this only delivers.
 *
 * Server-only.
 */

import crypto from 'node:crypto';
import http2 from 'node:http2';
import type { ApnsKey } from './apns-key';

/** TestFlight and the App Store deliver through Apple's production service. */
const HOST = 'https://api.push.apple.com';

export interface ApnsAlert {
  title: string;
  body: string;
  /** The ERP page the notification opens (a path). */
  url?: string;
  /** Groups the shop's notifications by kind in Notification Centre. */
  thread?: string;
}

/** The payload Apple delivers to the phone. */
export function apnsPayload(a: ApnsAlert) {
  return {
    aps: { alert: { title: a.title, body: a.body }, sound: 'default', ...(a.thread ? { 'thread-id': a.thread } : {}) },
    ...(a.url ? { url: a.url } : {}),
  };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Apple's provider token: ES256 over the team and the time, by the key's ID. */
export function apnsJwt(key: ApnsKey, now = Date.now()): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: key.keyId }));
  const body = b64url(JSON.stringify({ iss: key.teamId, iat: Math.floor(now / 1000) }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: key.p8, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}

// Apple refuses a token refreshed more than once in 20 minutes and one older than an hour.
let cached: { keyId: string; jwt: string; at: number } | null = null;
function tokenFor(key: ApnsKey): string {
  const now = Date.now();
  if (!cached || cached.keyId !== key.keyId || now - cached.at > 40 * 60_000) cached = { keyId: key.keyId, jwt: apnsJwt(key, now), at: now };
  return cached.jwt;
}

export interface ApnsTarget {
  token: string;
  /** The app's bundle ID: the notification's topic. */
  bundleId: string;
}

export interface ApnsOutcome {
  sent: number;
  /** Tokens Apple says are no longer any phone's (the app was deleted): to forget. */
  gone: string[];
  failed: { token: string; status: number; reason: string }[];
}

/** One notification to each phone; never throws for a phone's refusal. */
export async function sendApns(key: ApnsKey, targets: ApnsTarget[], alert: ApnsAlert): Promise<ApnsOutcome> {
  const out: ApnsOutcome = { sent: 0, gone: [], failed: [] };
  if (!targets.length) return out;
  const body = JSON.stringify(apnsPayload(alert));
  const jwt = tokenFor(key);
  const session = http2.connect(HOST);
  session.on('error', () => undefined);
  try {
    await Promise.all(targets.map((t) => new Promise<void>((resolve) => {
      const req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${t.token}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': t.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
      let status = 0;
      let text = '';
      let done = false;
      const finish = (error?: string) => {
        if (done) return;
        done = true;
        if (status === 200 && !error) out.sent++;
        else {
          const reason = error || (() => { try { return String(JSON.parse(text).reason || ''); } catch { return text.slice(0, 80); } })();
          if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') out.gone.push(t.token);
          else out.failed.push({ token: t.token, status, reason: reason || 'no answer' });
        }
        resolve();
      };
      req.setTimeout(15_000, () => { finish('timed out'); req.close(http2.constants.NGHTTP2_CANCEL); });
      req.on('response', (h) => { status = Number(h[':status']) || 0; });
      req.on('data', (c) => { text += c; });
      req.on('end', () => finish());
      req.on('close', () => finish(status ? undefined : 'closed'));
      req.on('error', (e) => finish(e.message));
      req.end(body);
    })));
  } finally {
    session.close();
  }
  return out;
}
