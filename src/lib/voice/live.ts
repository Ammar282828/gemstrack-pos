/**
 * The words on screen while he is still talking (owner, 2026-10-01: "show the transcript as
 * it's recording").
 *
 * From the browser's own speech recognition (Chrome, Edge, Safari on iPhone and Mac), free
 * and on the device's side, not from Gemini: the Vertex key's project answers only a few
 * calls a minute, so asking Gemini every second is not possible, and one sentence costing
 * twenty calls would not be right either. Gemini still reads the recording afterwards, and
 * its reading (which knows the roster, the Gujarati and the Urdu) is the one written down;
 * this is the preview that shows it is hearing him, and the fallback when the recording
 * itself comes back silent (a phone that gives the microphone to only one of the two).
 *
 * English (India) because the shop writes its names in Roman letters and the sentences are
 * mostly Roman-script Urdu, Gujarati and English: the Urdu recogniser writes Urdu script and
 * the Gujarati one Gujarati, which nobody here reads the book in.
 */

export const LIVE_LANG = 'en-IN';

export interface LiveResult { transcript: string; isFinal: boolean }

/**
 * The text so far: what earlier sessions settled, then this session's settled words, then the
 * words still being guessed at. Recognition restarts on its own every few seconds of silence
 * (and on an iPhone after every pause), and each restart begins a fresh result list, so what a
 * session settled is carried over by the caller as `committed`.
 */
export function liveText(committed: string, results: LiveResult[]): { final: string; interim: string } {
  const settled = results.filter(r => r.isFinal).map(r => r.transcript.trim()).filter(Boolean);
  const guessing = results.filter(r => !r.isFinal).map(r => r.transcript.trim()).filter(Boolean);
  return {
    final: [committed.trim(), ...settled].filter(Boolean).join(' '),
    interim: guessing.join(' '),
  };
}

export type LiveState = 'unsupported' | 'starting' | 'on' | 'failed';

export interface LiveSession {
  /** Stop listening; resolves with everything heard, settled or not. */
  stop(): string;
}

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

function ctor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const liveSupported = () => ctor() !== null;

/** Errors that mean it will not work this time, so it is not restarted. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network', 'bad-grammar']);

/**
 * Start showing words. `onText` gets the settled text and the guess after it on every change;
 * `onState` says whether it is working. Never throws: a browser without it, or one that
 * refuses, simply shows no words.
 */
export function startLive(
  onText: (final: string, interim: string) => void,
  onState: (s: LiveState) => void,
  lang = LIVE_LANG,
): LiveSession {
  const Ctor = ctor();
  let committed = '';
  let current: LiveResult[] = [];
  let stopped = false;
  let failed = false;
  let rec: Recognition | null = null;
  const all = () => { const t = liveText(committed, current); return [t.final, t.interim].filter(Boolean).join(' '); };

  const begin = () => {
    if (!Ctor || stopped || failed) return;
    try {
      rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        current = Array.from(e.results).map(r => ({ transcript: r[0]?.transcript ?? '', isFinal: r.isFinal }));
        const t = liveText(committed, current);
        onState('on');
        onText(t.final, t.interim);
      };
      rec.onerror = (e) => {
        if (FATAL.has(e.error)) { failed = true; onState('failed'); }
      };
      rec.onend = () => {
        // A session ended by itself (silence, or the phone's own limit): keep what it settled
        // and carry on, until the shop presses stop.
        const t = liveText(committed, current);
        committed = [t.final, t.interim].filter(Boolean).join(' ');
        current = [];
        if (!stopped && !failed) setTimeout(begin, 120);
      };
      rec.start();
    } catch {
      failed = true;
      onState('failed');
    }
  };

  if (!Ctor) onState('unsupported');
  else { onState('starting'); begin(); }

  return {
    stop() {
      stopped = true;
      const text = all();
      try { rec?.stop(); } catch { /* already stopped */ }
      return text.trim();
    },
  };
}
