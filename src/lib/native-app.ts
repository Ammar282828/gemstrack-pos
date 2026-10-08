/**
 * The ERP inside its iPhone app (apps/ios, docs/features/iphone-app.md).
 *
 * The app is a native shell around this same site, so everything the ERP does reaches the phones
 * with the next page load. It is Safari's engine without Safari, though, and four things a browser
 * gives a page are the app's to give there. This file asks the app for them when the page finds
 * itself inside it (Capacitor's bridge on `window`), and changes nothing anywhere else:
 *
 * - Google sign-in. Google refuses to sign anyone in inside an app's web view; the app signs in
 *   with Apple's sign-in sheet and hands back Google's ID token (googleIdTokenFromApp).
 * - Files out. A download (`<a download>`, jsPDF's save) goes nowhere in a web view, and the
 *   page's own share sheet cannot carry files there: both go to the iPhone's share sheet — Print,
 *   Save to Files, WhatsApp, AirDrop — which is where savePDF already sends Safari on iOS.
 * - Live words. A web view has no SpeechRecognition; the app's recogniser stands in for it, so
 *   lib/voice/live.ts runs unchanged.
 * - The status bar. Its text follows the ERP's palette (which can differ from the phone's).
 */

type Listener = { remove: () => unknown };

/** What Capacitor's native bridge puts on `window` in the app (its native-bridge.js). */
export interface AppBridge {
  isNativePlatform?: () => boolean;
  nativePromise: <T = unknown>(plugin: string, method: string, options?: Record<string, unknown>) => Promise<T>;
  addListener: (plugin: string, event: string, callback: (data: Record<string, unknown>) => void) => Listener;
}

/** The app's bridge, or null in a browser. */
export function appBridge(): AppBridge | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: AppBridge }).Capacitor;
  return cap?.isNativePlatform?.() && typeof cap.nativePromise === 'function' ? cap : null;
}

export const inApp = (): boolean => appBridge() !== null;

/**
 * The native iPhone app (apps/iphone), not the Capacitor shell: its pages are single screens inside
 * the app's own bars and sign-in ("ERPNative/1" in the user agent, Web/WebScreen.swift).
 */
export const inNativeApp = (): boolean => typeof navigator !== 'undefined' && /\bERPNative\//.test(navigator.userAgent);

/** The app adds "ERPApp/1 (<house>)" to its user agent (apps/ios/scripts/house.mjs): the server's way to tell. */
export const isAppUserAgent = (ua: string | null | undefined): boolean => /\bERPApp\/\d/.test(String(ua ?? ''));

// ── Google sign-in ───────────────────────────────────────────────────────────────────────────

/** A sign-in the app could not finish; `code` is the app's: cancelled, not-configured, network, failed. */
export class AppSignInError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'AppSignInError';
  }
}

/** Google's ID token for the account chosen in the app's sign-in sheet, for signInWithCredential. */
export async function googleIdTokenFromApp(): Promise<string> {
  const cap = appBridge();
  if (!cap) throw new AppSignInError('failed', 'Not in the app');
  try {
    const r = await cap.nativePromise<{ idToken?: string }>('ERPNative', 'googleSignIn', {});
    if (!r?.idToken) throw new AppSignInError('failed', 'Google sent no sign-in token');
    return r.idToken;
  } catch (e) {
    if (e instanceof AppSignInError) throw e;
    const err = e as { code?: string; message?: string };
    throw new AppSignInError(err?.code || 'failed', err?.message || 'Sign-in failed');
  }
}

// ── Files out ────────────────────────────────────────────────────────────────────────────────

const EXT: Record<string, string> = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'application/json': '.json', 'text/csv': '.csv', 'text/plain': '.txt', 'video/mp4': '.mp4',
};

/** A name the phone's files take: no slashes or control characters, never empty, never hidden. */
export function safeFileName(name: string | null | undefined, type?: string): string {
  const clean = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^[.\s-]+/, '')
    .trim()
    .slice(0, 120);
  return clean || `file${EXT[String(type || '').split(';')[0]] ?? ''}`;
}

/** The last part of an address, as a file name ("…/invoice.pdf?x=1" → "invoice.pdf"). */
export function fileNameFromUrl(href: string): string {
  if (/^(blob|data):/i.test(href)) return '';
  try { return decodeURIComponent(new URL(href).pathname.split('/').pop() || ''); } catch { return ''; }
}

/** Bytes as base64, the way the bridge carries a file. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** An `<a download>` this file hands to the share sheet: a blob, a data address or this site's own file. */
export function downloadHref(a: { hasAttribute(name: string): boolean; href: string }, origin: string): string | null {
  if (!a.hasAttribute('download') || !a.href) return null;
  if (/^(blob|data):/i.test(a.href)) return a.href;
  try { return new URL(a.href).origin === origin ? a.href : null; } catch { return null; }
}

const cancelled = (e: unknown) => /cancel/i.test(String((e as Error)?.message ?? e));
const abort = () => new DOMException('Share canceled', 'AbortError');

/** Files onto the iPhone's share sheet: written to the app's cache first, then offered. */
async function shareFiles(cap: AppBridge, files: File[], extra: { title?: string; text?: string; url?: string } = {}) {
  const stamp = Date.now();
  const uris: string[] = [];
  for (const [i, f] of files.entries()) {
    const { uri } = await cap.nativePromise<{ uri: string }>('Filesystem', 'writeFile', {
      // A folder each, so the file keeps its own name in Save to Files and on WhatsApp.
      path: `shared/${stamp}-${i}/${safeFileName(f.name, f.type)}`,
      data: await blobToBase64(f),
      directory: 'CACHE',
      recursive: true,
    });
    uris.push(uri);
  }
  try {
    await cap.nativePromise('Share', 'share', {
      files: uris,
      ...(extra.title && { title: extra.title, dialogTitle: extra.title }),
      ...(extra.text && { text: extra.text }),
      ...(extra.url && { url: extra.url }),
    });
  } catch (e) {
    if (cancelled(e)) throw abort();
    throw e;
  }
}

/**
 * Hand the page's ways out to the app. Once per page; `onError` hears a file that could not be
 * handed over (the person closing the sheet is not an error).
 */
export function installAppBridges(onError: (message: string) => void): void {
  const cap = appBridge();
  const w = window as unknown as { __erpAppBridges?: boolean };
  if (!cap || w.__erpAppBridges) return;
  w.__erpAppBridges = true;

  // What earlier shares left in the cache.
  cap.nativePromise('Filesystem', 'rmdir', { path: 'shared', directory: 'CACHE', recursive: true }).catch(() => undefined);

  // navigator.share, files and all: savePDF, Post a piece, the studio's "Post it" already use it.
  const share = async (data: ShareData = {}) => {
    const files = Array.from((data.files ?? []) as File[]);
    if (files.length) return shareFiles(cap, files, { title: data.title, text: data.text, url: data.url });
    try {
      await cap.nativePromise('Share', 'share', {
        ...(data.title && { title: data.title }), ...(data.text && { text: data.text }), ...(data.url && { url: data.url }),
      });
    } catch (e) {
      if (cancelled(e)) throw abort();
      throw e;
    }
  };
  const canShare = (data?: ShareData) => !!data && !!((data.files && data.files.length) || data.url || data.text || data.title);
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: canShare });

  // Downloads. A page that frees its blob right after the click would free it before the file is
  // read, so in the app a freed address lives a minute longer.
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url: string) => { setTimeout(() => revoke(url), 60_000); };

  const handOver = (href: string, name: string) => {
    void (async () => {
      const blob = await (await fetch(href)).blob();
      const file = new File([blob], safeFileName(name || fileNameFromUrl(href), blob.type), { type: blob.type || 'application/octet-stream' });
      await shareFiles(cap, [file], { title: file.name });
    })().catch((e) => {
      if ((e as Error)?.name === 'AbortError') return;
      console.warn('[app] could not hand the file to the share sheet', e);
      onError(`The file couldn't be shared: ${(e as Error)?.message || e}`);
    });
  };
  const intercept = (a: HTMLAnchorElement) => {
    const href = downloadHref(a, location.origin);
    if (!href) return false;
    handOver(href, a.download);
    return true;
  };
  // a.click() (most of the ERP), a.dispatchEvent(click) (jsPDF's save), and a tap on a real link.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!intercept(this)) click.call(this);
  };
  const dispatch = EventTarget.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (this: HTMLAnchorElement, ev: Event) {
    if (ev.type === 'click' && intercept(this)) return false;
    return dispatch.call(this, ev);
  };
  document.addEventListener('click', (ev) => {
    const a = (ev.target as Element | null)?.closest?.('a[download]') as HTMLAnchorElement | null;
    if (a && intercept(a)) ev.preventDefault();
  }, true);

  // Live words.
  (window as unknown as Record<string, unknown>).SpeechRecognition = appSpeechRecognition(cap);
}

// ── Live words ───────────────────────────────────────────────────────────────────────────────

type Handler<E> = ((e: E) => void) | null;

/**
 * The Web Speech API's SpeechRecognition, as much of it as lib/voice/live.ts uses, on the app's
 * recogniser (events "speech" — the whole session's words so far — and "speechEnd").
 */
export function appSpeechRecognition(cap: AppBridge) {
  // Sessions that failed at once, in a row: live.ts restarts a session that ends, and a recogniser
  // that cannot start would otherwise be restarted for ever.
  let quickFailures = 0;
  return class AppSpeechRecognition {
    lang = 'en-IN';
    continuous = true;
    interimResults = true;
    maxAlternatives = 1;
    onresult: Handler<{ results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }> = null;
    onerror: Handler<{ error: string }> = null;
    onend: (() => void) | null = null;
    private subs: Listener[] = [];
    private ended = false;
    private heard = false;
    private began = 0;

    start() {
      this.began = Date.now();
      this.subs.push(cap.addListener('ERPNative', 'speech', (d) => {
        this.heard = true;
        quickFailures = 0;
        const result = Object.assign([{ transcript: String(d?.transcript ?? '') }], { isFinal: !!d?.isFinal });
        this.onresult?.({ results: [result] });
      }));
      this.subs.push(cap.addListener('ERPNative', 'speechEnd', (d) => {
        if (d?.error) this.fail('no-speech');
        this.finish();
      }));
      cap.nativePromise('ERPNative', 'speechStart', { lang: this.lang }).catch((e: { code?: string }) => {
        this.onerror?.({ error: e?.code === 'not-allowed' ? 'not-allowed' : 'audio-capture' });
        this.finish();
      });
    }

    stop() {
      cap.nativePromise('ERPNative', 'speechStop', {}).catch(() => undefined).finally(() => this.finish());
    }

    abort() { this.stop(); }

    private fail(error: string) {
      if (!this.heard && Date.now() - this.began < 1500 && ++quickFailures >= 3) error = 'audio-capture';
      this.onerror?.({ error });
    }

    private finish() {
      if (this.ended) return;
      this.ended = true;
      this.subs.forEach((s) => { try { s.remove(); } catch { /* gone */ } });
      this.subs = [];
      this.onend?.();
    }
  };
}

// ── The status bar ───────────────────────────────────────────────────────────────────────────

/** The bar behind the clock follows what the page shows: its colour, and light text on dark. */
export function tellAppChrome(background: string, dark: boolean): void {
  appBridge()?.nativePromise('ERPNative', 'chrome', { background, dark }).catch(() => undefined);
}
