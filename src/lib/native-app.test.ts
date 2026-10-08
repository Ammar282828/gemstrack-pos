import { describe, expect, it } from 'vitest';
import { appSpeechRecognition, blobToBase64, downloadHref, fileNameFromUrl, isAppUserAgent, safeFileName, type AppBridge } from './native-app';
import { appSignInAdvice, embeddedBrowser } from './sign-in-trouble';

const APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ERPApp/1 (taheri)';
const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

describe('the iPhone app is not an in-app browser', () => {
  it('knows its own user agent', () => {
    expect(isAppUserAgent(APP_UA)).toBe(true);
    expect(isAppUserAgent(IG_UA)).toBe(false);
    expect(isAppUserAgent(undefined)).toBe(false);
  });
  it('is not told to open Safari', () => {
    expect(embeddedBrowser(APP_UA)).toBeNull();
    // Another app's web view still is.
    expect(embeddedBrowser(IG_UA)).toEqual({ app: 'this app', platform: 'ios' });
  });
  it('says nothing when the person closed the sheet', () => {
    expect(appSignInAdvice('cancelled')).toBeNull();
    expect(appSignInAdvice('not-configured')).toMatch(/Safari/);
    expect(appSignInAdvice('failed', 'invalid_grant')).toMatch(/invalid_grant/);
  });
});

describe('files out of the app', () => {
  it('names files the phone can keep', () => {
    expect(safeFileName('Invoice - Ali/Raza.pdf')).toBe('Invoice - Ali-Raza.pdf');
    expect(safeFileName('../../etc')).toBe('etc');
    expect(safeFileName('', 'application/pdf')).toBe('file.pdf');
    expect(safeFileName(undefined, 'image/png; charset=binary')).toBe('file.png');
    expect(safeFileName(null)).toBe('file');
  });
  it('takes a name from an address', () => {
    expect(fileNameFromUrl('https://erp.taheri.shop/api/report/Monthly%20report.pdf?x=1')).toBe('Monthly report.pdf');
    expect(fileNameFromUrl('blob:https://erp.taheri.shop/1234')).toBe('');
  });
  it('hands over downloads of blobs, data and this site, and nothing else', () => {
    const a = (href: string, download = true) => ({ href, hasAttribute: (n: string) => n === 'download' && download });
    const origin = 'https://erp.taheri.shop';
    expect(downloadHref(a('blob:https://erp.taheri.shop/1'), origin)).toBe('blob:https://erp.taheri.shop/1');
    expect(downloadHref(a('data:application/pdf;base64,JVBERg=='), origin)).toMatch(/^data:/);
    expect(downloadHref(a('https://erp.taheri.shop/x.pdf'), origin)).toBe('https://erp.taheri.shop/x.pdf');
    expect(downloadHref(a('https://firebasestorage.googleapis.com/x.png'), origin)).toBeNull();
    expect(downloadHref(a('blob:https://erp.taheri.shop/1', false), origin)).toBeNull();
  });
  it('carries bytes as base64, large files too', async () => {
    expect(await blobToBase64(new Blob(['%PDF']))).toBe('JVBERg==');
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(Buffer.from(await blobToBase64(new Blob([big])), 'base64').equals(Buffer.from(big))).toBe(true);
  });
});

/** A stand-in for Capacitor's bridge: records calls, and lets the test play the phone's events. */
function fakeBridge(startFails?: { code: string }) {
  const listeners: Record<string, ((d: Record<string, unknown>) => void)[]> = {};
  const calls: string[] = [];
  const cap: AppBridge = {
    isNativePlatform: () => true,
    nativePromise: (async (_p: string, method: string) => {
      calls.push(method);
      if (method === 'speechStart' && startFails) throw startFails;
      return {};
    }) as AppBridge['nativePromise'],
    addListener: (_p, event, cb) => {
      (listeners[event] ||= []).push(cb);
      return { remove: () => { listeners[event] = listeners[event].filter((f) => f !== cb); } };
    },
  };
  const emit = (event: string, d: Record<string, unknown>) => (listeners[event] || []).forEach((f) => f(d));
  return { cap, emit, calls, listeners };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('live words from the app', () => {
  it('gives live.ts the shape of the Web Speech API', async () => {
    const { cap, emit, calls } = fakeBridge();
    const Rec = appSpeechRecognition(cap);
    const rec = new Rec();
    const heard: { t: string; f: boolean }[] = [];
    let ended = 0;
    rec.onresult = (e) => { const r = e.results[0]; heard.push({ t: r[0].transcript, f: r.isFinal }); };
    rec.onend = () => { ended++; };
    rec.start();
    emit('speech', { transcript: 'do tola', isFinal: false });
    emit('speech', { transcript: 'do tola sona', isFinal: true });
    emit('speechEnd', {});
    expect(heard).toEqual([{ t: 'do tola', f: false }, { t: 'do tola sona', f: true }]);
    expect(ended).toBe(1);
    rec.stop();
    await tick();
    expect(ended).toBe(1); // once
    expect(calls).toContain('speechStart');
  });

  it('refused at the start is fatal, as in the browser', async () => {
    const { cap } = fakeBridge({ code: 'not-allowed' });
    const rec = new (appSpeechRecognition(cap))();
    const errors: string[] = [];
    rec.onerror = (e) => errors.push(e.error);
    rec.start();
    await tick();
    expect(errors).toEqual(['not-allowed']);
  });

  it('a recogniser that fails at once, again and again, is given up on', () => {
    const { cap, emit } = fakeBridge();
    const Rec = appSpeechRecognition(cap);
    const errors: string[] = [];
    for (let i = 0; i < 3; i++) {
      const rec = new Rec();
      rec.onerror = (e) => errors.push(e.error);
      rec.start();
      emit('speechEnd', { error: 'No speech detected' });
    }
    // no-speech restarts in live.ts; audio-capture stops it.
    expect(errors).toEqual(['no-speech', 'no-speech', 'audio-capture']);
  });
});
