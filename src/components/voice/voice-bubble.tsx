"use client";

/**
 * The microphone that floats on every screen.
 *
 * Say what happened, see it read back, press once. Nothing is written from speech without
 * that confirmation: the model's reading is a claim, and a claim about somebody's money is
 * worth one glance before it becomes a row in the book.
 *
 * When the sound cannot separate two people the confirmation becomes a choice instead —
 * this shop has four Alifyas, and a coin toss between them is the one outcome that must
 * never happen quietly.
 *
 * The words show while he is still talking (lib/voice/live.ts), and everything on the card can
 * be changed before it is written: the words themselves, read again, or any part of the entry
 * (lib/voice/edit.ts, voice-editor.tsx) — owner, 2026-10-01.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { READ_ONLY_ACTIONS, type RawIntent, type Reading } from '@/lib/voice/resolve';
import { documentsFor, type DocEntry } from '@/lib/voice/documents';
import { applyEdit, canEdit, newDraft, readDraft, type Draft, type Edit } from '@/lib/voice/edit';
import { startLive, type LiveSession, type LiveState } from '@/lib/voice/live';
import { VoiceEditor } from './voice-editor';
import { applyReading, type AppliedEntry } from '@/lib/voice/apply';
import { answerQuestion } from '@/lib/voice/answers';
import { speak, stopSpeaking, speechOutputSupported } from '@/lib/voice/speak';
import { phoneticKey, type LearnedAlias, type PersonKind, type RankedName, type RosterEntry } from '@/lib/voice/phonetics';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Mic, RotateCw, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_KARAT_VALUE_FOR_CALCULATION } from '@/lib/store';
import { authedFetch } from '@/lib/voice/authed-fetch';
import { isWalkInName } from '@/lib/walk-in';

type Phase = 'idle' | 'listening' | 'thinking' | 'confirming' | 'writing';

/** Corrections already made, keyed by sound. Least-used first, so the one made most often wins. */
function aliasMap(voiceAliases: { heardKey: string; kind: PersonKind; refId: string; uses?: number }[]): Map<string, LearnedAlias> {
  const map = new Map<string, LearnedAlias>();
  for (const a of [...voiceAliases].sort((x, y) => (x.uses ?? 1) - (y.uses ?? 1))) {
    map.set(a.heardKey, { kind: a.kind, id: a.refId });
  }
  return map;
}

/** Resolves once the book is in memory, or after `ms` — whichever is first. */
function untilLoaded(ms: number): Promise<void> {
  const ready = () => {
    const s = useAppStore.getState();
    return s.hasCustomersLoaded && s.hasKarigarsLoaded && s.hasOrdersLoaded && s.hasInvoicesLoaded && s.hasHisaabLoaded;
  };
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); unsub(); resolve(); };
    const timer = setTimeout(done, ms);
    const unsub = useAppStore.subscribe(() => { if (ready()) done(); });
  });
}

/** Stops on its own, so a bubble left running in a pocket cannot record the whole day. */
const MAX_RECORDING_MS = 30_000;

/**
 * Below this the recording heard nothing at all. A phone that lets only one listener have the
 * microphone gives it to the live words and hands the recorder silence; then the live words
 * are what is read.
 */
const SILENT_PEAK = 0.02;

type Heard = { audio: Blob } | { text: string };

export function VoiceBubble() {
  const router = useRouter();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>('idle');
  /** The model's reply as the shop has changed it; the reading is built from it. */
  const [draft, setDraft] = useState<Draft | null>(null);
  const [transcript, setTranscript] = useState('');
  /** The words in the box, as the shop has corrected them. */
  const [words, setWords] = useState('');
  const [rereading, setRereading] = useState(false);
  /** What the browser hears as he speaks: settled, and still being guessed. */
  const [live, setLive] = useState<{ final: string; interim: string; state: LiveState }>({ final: '', interim: '', state: 'starting' });
  const liveRef = useRef<LiveSession | null>(null);
  const liveWordsRef = useRef('');
  const peakRef = useRef(0);
  /** What the model said it heard as the name, kept so a correction can be learned. */
  const [heardAs, setHeardAs] = useState('');
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const customers = useAppStore((s) => s.customers);
  const karigars = useAppStore((s) => s.karigars);
  const settings = useAppStore((s) => s.settings);
  const loadCustomers = useAppStore((s) => s.loadCustomers);
  const loadKarigars = useAppStore((s) => s.loadKarigars);
  const voiceAliases = useAppStore((s) => s.voiceAliases);
  const loadVoiceAliases = useAppStore((s) => s.loadVoiceAliases);
  const teachVoiceAlias = useAppStore((s) => s.teachVoiceAlias);

  /**
   * Selected one at a time on purpose. A selector returning a fresh object literal is a new
   * reference on every store change, which makes this component re-render in a loop — and
   * a loop here means the microphone is torn down mid-sentence.
   */
  const addHisaabEntry = useAppStore((s) => s.addHisaabEntry);
  const addExpense = useAppStore((s) => s.addExpense);
  const addAdditionalRevenue = useAppStore((s) => s.addAdditionalRevenue);
  const addCustomer = useAppStore((s) => s.addCustomer);
  const addKarigar = useAppStore((s) => s.addKarigar);
  const updateCustomer = useAppStore((s) => s.updateCustomer);
  const updateKarigar = useAppStore((s) => s.updateKarigar);
  const deleteHisaabEntry = useAppStore((s) => s.deleteHisaabEntry);
  const deleteExpense = useAppStore((s) => s.deleteExpense);
  const deleteAdditionalRevenue = useAppStore((s) => s.deleteAdditionalRevenue);
  const deleteCustomer = useAppStore((s) => s.deleteCustomer);
  const deleteKarigar = useAppStore((s) => s.deleteKarigar);
  const recordOrderAdvance = useAppStore((s) => s.recordOrderAdvance);
  const updateOrderStatus = useAppStore((s) => s.updateOrderStatus);
  const updateOrder = useAppStore((s) => s.updateOrder);
  const updateInvoicePayment = useAppStore((s) => s.updateInvoicePayment);
  const store = useMemo(() => ({
    addHisaabEntry, addExpense, addAdditionalRevenue,
    addCustomer, addKarigar, updateCustomer, updateKarigar,
    deleteHisaabEntry, deleteExpense, deleteAdditionalRevenue, deleteCustomer, deleteKarigar,
    recordOrderAdvance, updateOrderStatus, updateOrder, updateInvoicePayment,
  }), [addHisaabEntry, addExpense, addAdditionalRevenue, addCustomer, addKarigar, updateCustomer,
       updateKarigar, deleteHisaabEntry, deleteExpense, deleteAdditionalRevenue, deleteCustomer, deleteKarigar,
       recordOrderAdvance, updateOrderStatus, updateOrder, updateInvoicePayment]);

  /** Everything the fixed queries read. Nothing here is written to. */
  const hisaabEntries = useAppStore((s) => s.hisaabEntries);
  const karigarJobs = useAppStore((s) => s.karigarJobs);
  const orders = useAppStore((s) => s.orders);
  const invoices = useAppStore((s) => s.generatedInvoices);
  const loadHisaab = useAppStore((s) => s.loadHisaab);
  const loadKarigarJobs = useAppStore((s) => s.loadKarigarJobs);
  const loadOrders = useAppStore((s) => s.loadOrders);
  const loadInvoices = useAppStore((s) => s.loadGeneratedInvoices);

  /** The entry just written, so "undo" a moment later means that one and nothing else. */
  const lastWrite = useRef<AppliedEntry | null>(null);

  /**
   * Loaded when the microphone is pressed, not when the page opens.
   *
   * This bubble floats on every screen, and on mount it used to open listeners on
   * seven collections — the whole book, most of a megabyte — so the Settings page
   * paid for the hisaab. The loaders are shared with the pages and guarded, so a
   * page that already has its data costs nothing here; and a press gives the store
   * the few seconds of speech to fill in, with send() waiting briefly for it.
   */
  const warm = useCallback(() => {
    loadCustomers();
    loadKarigars();
    loadVoiceAliases();
    loadHisaab();
    loadKarigarJobs();
    loadOrders();
    loadInvoices();
  }, [loadCustomers, loadKarigars, loadVoiceAliases, loadHisaab, loadKarigarJobs, loadOrders, loadInvoices]);

  /** The orders and bills a sentence can name. Open ones first. */
  const documents = useMemo(() => documentsFor(orders, invoices), [orders, invoices]);

  /**
   * Corrections already made, keyed by sound.
   *
   * Handed to the matcher, where a learned name outranks everything else — the model
   * completing a half-heard "Alifya" to a full roster name is still a guess, and this is
   * the one signal that is not.
   */
  const aliases = useMemo(() => aliasMap(voiceAliases), [voiceAliases]);

  const roster = useMemo<RosterEntry[]>(() => [
    ...customers.filter((c) => !isWalkInName(c.name)).map((c) => ({ id: c.id, name: c.name, kind: 'customer' as const, phone: c.phone })),
    ...karigars.map((k) => ({ id: k.id, name: k.name, kind: 'karigar' as const, phone: k.contact })),
  ], [customers, karigars]);

  /** What would be written now: the draft, read by the same rules as a spoken sentence. */
  const reading = useMemo<Reading | null>(
    () => (draft ? readDraft(draft, { roster, aliases, documents }) : null),
    [draft, roster, aliases, documents],
  );

  /**
   * Say it out loud, when the browser can.
   *
   * Never awaited by the caller: a voice that fails to start must not take the entry down
   * with it. The card on screen already says everything the speech does, so silence is a
   * degraded experience rather than a broken one.
   */
  const say = useCallback(async (text: string) => {
    if (!speechOutputSupported()) return;
    try { await speak(text); } catch { /* silence is the fallback */ }
  }, []);

  const cleanup = useCallback(() => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    liveRef.current?.stop();
    liveRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  /** Ask the model what was meant: the recording, or words (the live words, or the box corrected). */
  const interpret = useCallback(async (heard: Heard) => {
    // The book may still be arriving if the press was the first thing done on
    // this screen. Give it a moment, then read whatever is there.
    await untilLoaded(2500);
    const st = useAppStore.getState();
    const rosterNow: RosterEntry[] = [
      ...st.customers.filter((c) => !isWalkInName(c.name)).map((c) => ({ id: c.id, name: c.name, kind: 'customer' as const, phone: c.phone })),
      ...st.karigars.map((k) => ({ id: k.id, name: k.name, kind: 'karigar' as const, phone: k.contact })),
    ];
    const documentsNow = documentsFor(st.orders, st.generatedInvoices);
    const aliasesNow = aliasMap(st.voiceAliases);
    let said: { audio: string; mimeType: string } | { text: string };
    if ('audio' in heard) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('Could not read the recording.'));
        // A data: URL is "data:<mime>;base64,<payload>" — only the payload is wanted.
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
        fr.readAsDataURL(heard.audio);
      });
      said = { audio: base64, mimeType: heard.audio.type || 'audio/webm' };
    } else said = { text: heard.text };

    const res = await authedFetch('/api/voice/listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...said,
        roster: rosterNow,
        documents: documentsNow,
        shopName: settings.shopName,
        today: new Date().toISOString().slice(0, 10),
        // '21k' -> '21'; the prompt states a number, not a karat label.
        orderKarat: DEFAULT_KARAT_VALUE_FOR_CALCULATION.replace('k', ''),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Voice failed.');
    return { raw: data as RawIntent & { transcript?: string }, ctx: { roster: rosterNow, aliases: aliasesNow, documents: documentsNow } };
  }, [settings.shopName]);

  /** What to do with the model's reply: go somewhere, answer, undo, or show the card. */
  const handle = useCallback(async (
    raw: RawIntent & { transcript?: string },
    ctx: { roster: RosterEntry[]; aliases: Map<string, LearnedAlias>; documents: DocEntry[] },
    fallbackWords: string,
    /** A person already chosen on the card, kept when the words read again name the same sound. */
    keep?: { heard: string; person: RankedName },
  ) => {
    const heardWords = (raw.transcript ?? '').trim() || fallbackWords;
    setTranscript(heardWords);
    setWords(heardWords);
    setHeardAs(raw.person?.spoken_as || raw.person?.name || '');

    /* The model's answer is a claim. This is where it becomes a pinned, checked reading. */
    let d = newDraft(raw);
    const heardKey = phoneticKey(raw.person?.spoken_as || raw.person?.name || '').join(' ');
    if (keep && heardKey && heardKey === phoneticKey(keep.heard).join(' ')) d = { ...d, pinPerson: keep.person, personChosen: true };
    const resolved = readDraft(d, ctx);

    // Nothing to write and nothing to choose — act and get out of the way. Opening an
    // order or a bill is the same: once it is pinned, it is a screen, not a question.
    if ((resolved.action === 'navigate' || resolved.action === 'open_order' || resolved.action === 'open_invoice') && resolved.screen) {
      setPhase('idle');
      setDraft(null);
      router.push(resolved.screen);
      return;
    }

    /**
     * "Undo" is not a reading to confirm — it is a correction, and making somebody
     * confirm a correction to a mistake is the wrong way round.
     */
    if (raw.action === 'undo' || /\bundo\b/i.test(heardWords)) {
      const back = lastWrite.current;
      setPhase('idle');
      setDraft(null);
      if (!back?.undo) {
        void say('There is nothing to undo.');
        toast({ title: 'Nothing to undo' });
        return;
      }
      try {
        await back.undo();
        lastWrite.current = null;
        void say('Undone.');
        toast({ title: 'Undone' });
      } catch {
        toast({ title: 'Could not undo that', variant: 'destructive' });
      }
      return;
    }

    /* A question reads from the book and writes nothing. Answer it and stop. */
    if (resolved.action === 'ask') {
      const answer = answerQuestion(resolved.query ?? 'summary', {
        data: { customers, karigars, hisaabEntries, karigarJobs, orders },
        person: resolved.person,
        field: resolved.fields ? Object.keys(resolved.fields)[0] : null,
      });
      setPhase('idle');
      setDraft(null);
      void say(answer.text);
      toast({ title: answer.text });
      return;
    }

    setDraft(d);
    setPhase('confirming');
    // Read the reading back while it is being looked at, rather than after.
    if (resolved.summary) void say(resolved.summary);
  }, [router, toast, say, customers, karigars, hisaabEntries, karigarJobs, orders]);

  const send = useCallback(async (heard: Heard, liveWords: string) => {
    setPhase('thinking');
    try {
      const { raw, ctx } = await interpret(heard);
      await handle(raw, ctx, liveWords);
    } catch (err) {
      setPhase('idle');
      toast({
        title: 'Could not hear that',
        description: err instanceof Error ? err.message : 'Try again.',
        variant: 'destructive',
      });
    }
  }, [interpret, handle, toast]);

  /** The words in the box were corrected: read them again, as words this time. */
  const reread = useCallback(async () => {
    const text = words.trim();
    if (!text || rereading) return;
    setRereading(true);
    try {
      const { raw, ctx } = await interpret({ text });
      // "Which Ahsan?" answered on the card is not asked again because a figure was corrected.
      const keep = draft?.personChosen && reading?.person && heardAs ? { heard: heardAs, person: reading.person } : undefined;
      await handle({ ...raw, transcript: text }, ctx, text, keep);
    } catch (err) {
      toast({ title: 'Could not read that', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    } finally {
      setRereading(false);
    }
  }, [words, rereading, interpret, handle, toast, draft, reading, heardAs]);

  /** One change on the card. Opening an order or a bill, once pinned, simply goes there. */
  const edit = useCallback((e: Edit) => {
    if (!draft || !reading) return;
    const next = applyEdit(draft, e, reading);
    const r = readDraft(next, { roster, aliases, documents });
    if ((r.action === 'open_order' || r.action === 'open_invoice') && r.screen) {
      setDraft(null);
      setPhase('idle');
      router.push(r.screen);
      return;
    }
    setDraft(next);
  }, [draft, reading, roster, aliases, documents, router]);

  const start = useCallback(async () => {
    // The microphone must never open while the assistant is still speaking, or it records
    // its own voice and answers itself.
    stopSpeaking();
    warm();
    /**
     * Wake the server while he is still talking.
     *
     * The backend scales to zero between uses, so the first sentence of the day was
     * paying a cold start on top of the model call — and paying it AFTER the sentence
     * was finished, when every second is felt. A press of the microphone is a reliable
     * few seconds' notice. The status route is cached server-side for five minutes, so
     * this costs one tiny model call per idle period, not one per press.
     */
    void authedFetch('/api/voice/status').catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // The bars move with the voice, so it is never in doubt that it is recording.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      peakRef.current = 0;
      const tick = () => {
        analyser.getByteFrequencyData(bins);
        const avg = bins.reduce((a, b) => a + b, 0) / bins.length;
        const lvl = Math.min(1, avg / 90);
        peakRef.current = Math.max(peakRef.current, lvl);
        setLevel(lvl);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const liveWords = liveWordsRef.current;
        const silent = peakRef.current < SILENT_PEAK;
        cleanup();
        // The recording, which Gemini reads best; the live words when the recording came back silent.
        if (blob.size > 1000 && !(silent && liveWords)) void send({ audio: blob }, liveWords);
        else if (liveWords) void send({ text: liveWords }, liveWords);
        else { setPhase('idle'); toast({ title: 'Nothing was recorded' }); }
      };
      recorder.start();

      // The words as he says them, where the browser can (lib/voice/live.ts).
      liveWordsRef.current = '';
      setLive({ final: '', interim: '', state: 'starting' });
      liveRef.current = startLive(
        (final, interim) => setLive((l) => ({ ...l, final, interim })),
        (state) => setLive((l) => ({ ...l, state })),
      );

      setPhase('listening');
      stopTimerRef.current = setTimeout(() => stopRef.current(), MAX_RECORDING_MS);
    } catch {
      cleanup();
      toast({
        title: 'The microphone did not open',
        description: 'Browsers only allow it over https or on this computer itself.',
        variant: 'destructive',
      });
    }
  }, [cleanup, send, toast, warm]);

  const stop = useCallback(() => {
    liveWordsRef.current = liveRef.current?.stop() ?? '';
    liveRef.current = null;
    recorderRef.current?.stop();
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const write = useCallback(async () => {
    if (!reading || !draft) return;
    if (!reading.postable) {
      if (reading.blockedBecause) void say(reading.blockedBecause);
      return;
    }
    /**
     * A person chosen on the card is the shop answering "who?", and that answer is the only
     * evidence in the whole matcher that is not a guess. Write it down before the entry, so
     * the correction survives even if the write itself fails.
     */
    if (draft.personChosen && reading.person && heardAs && phoneticKey(heardAs).length) {
      try { await teachVoiceAlias(heardAs, reading.person.kind, reading.person.id, reading.person.name); } catch { /* the entry still goes through */ }
    }
    setPhase('writing');
    try {
      const applied = await applyReading(reading, store);
      lastWrite.current = applied;
      void say(applied.said);
      toast({
        title: applied.said,
        description: applied.undo ? 'Say "undo" to take it back.' : undefined,
      });
      setDraft(null);
      setPhase('idle');
      if (applied.href) router.push(applied.href);
    } catch (err) {
      setPhase('confirming');
      toast({
        title: 'Not written',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
    }
  }, [reading, draft, store, router, toast, heardAs, teachVoiceAlias, say]);

  const dismiss = () => { setDraft(null); setPhase('idle'); };

  const busy = phase === 'thinking' || phase === 'writing';
  const liveShown = `${live.final} ${live.interim}`.trim();
  const wordsChanged = words.trim() !== transcript.trim() && words.trim().length > 0;

  return (
    <>
      {/* While he talks, and while it is being read: the words so far. */}
      {(phase === 'listening' || phase === 'thinking') && (
        <div
          role="status" aria-live="polite"
          className="glass fixed bottom-[8.75rem] left-4 right-4 z-40 rounded-xl border bg-background/95 p-3 shadow-lg md:bottom-24 md:left-auto md:w-96"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {phase === 'listening'
              ? <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-destructive" />
              : <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />}
            <span>{phase === 'listening' ? 'Listening — press the square when done' : 'Reading what you said…'}</span>
            {phase === 'listening' && (
              <span className="ml-auto flex h-3 items-end gap-0.5" aria-hidden>
                {[0.55, 1, 0.7, 0.9, 0.5].map((f, i) => (
                  <span key={i} className="w-0.5 rounded-full bg-primary transition-[height]" style={{ height: `${Math.max(15, Math.min(100, level * f * 140))}%` }} />
                ))}
              </span>
            )}
          </div>
          {liveShown ? (
            <p className="mt-2 max-h-32 overflow-y-auto text-sm leading-relaxed">
              {live.final}{live.final && live.interim ? ' ' : ''}<span className="text-muted-foreground">{live.interim}</span>
            </p>
          ) : phase === 'listening' && (
            <p className="mt-2 text-sm text-muted-foreground">
              {live.state === 'unsupported' || live.state === 'failed'
                ? 'This browser can’t show the words as you speak. You’ll see them, and can change them, when you stop.'
                : 'Say it now…'}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        aria-label={phase === 'listening' ? 'Stop listening' : 'Talk to the book'}
        onClick={phase === 'listening' ? stop : start}
        disabled={busy}
        className={cn(
          // Clear of the mobile bottom nav, which is 4rem tall.
          'fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all md:bottom-6',
          phase === 'listening'
            ? 'bg-primary text-primary-foreground'
            : 'glass-fab bg-background text-foreground border hover:bg-accent',
          busy && 'opacity-60',
        )}
        style={phase === 'listening'
          // Recording is the one state you must never be in doubt about, so the button
          // itself breathes with the voice rather than showing a static red dot.
          ? { transform: `scale(${1 + level * 0.18})` }
          : undefined}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" />
          : phase === 'listening' ? <Square className="h-5 w-5" />
          : <Mic className="h-5 w-5" />}
      </button>

      <Dialog open={(phase === 'confirming' || phase === 'writing') && reading !== null} onOpenChange={(o) => { if (!o) dismiss(); }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {reading?.ambiguous || reading?.docAmbiguous ? 'Which one?'
                : reading?.postable ? 'Write this down?'
                : 'Not ready to write'}
            </DialogTitle>
            <DialogDescription>Change anything before it is written.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* What was heard. Correct the words and read them again, when it misheard the sentence itself. */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Heard</span>
                {wordsChanged && (
                  <Button type="button" size="sm" variant="secondary" onClick={reread} disabled={rereading}>
                    {rereading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCw className="mr-1.5 h-3.5 w-3.5" />}
                    Read again
                  </Button>
                )}
              </div>
              <Textarea
                value={words} onChange={(e) => setWords(e.target.value)} rows={2}
                className="resize-none text-sm" placeholder="Type what you meant to say"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && wordsChanged) { e.preventDefault(); void reread(); } }}
              />
            </div>

            {reading?.summary && <p className="text-sm font-medium">{reading.summary}</p>}
            {reading?.blockedBecause && !reading.ambiguous && !reading.docAmbiguous && (
              <p className="text-sm text-destructive">{reading.blockedBecause}</p>
            )}

            {reading?.ambiguous && reading.candidates.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  More than one person sounds like that. Nothing is written until you choose.
                </p>
                {reading.candidates.map((c) => (
                  <Button
                    key={`${c.kind}-${c.id}`}
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => edit({ kind: 'person', person: c })}
                  >
                    <span>{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.kind === 'customer' ? 'Customer' : 'Karigar'}
                    </span>
                  </Button>
                ))}
              </div>
            )}

            {/* The person is settled; the order or bill is not. */}
            {!reading?.ambiguous && reading?.docAmbiguous && reading.docCandidates.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{reading.blockedBecause}</p>
                {reading.docCandidates.map((d) => (
                  <Button
                    key={d.id}
                    variant="outline"
                    className="h-auto w-full justify-between py-2 text-left"
                    onClick={() => edit({ kind: 'doc', doc: d })}
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">{d.id}</span>
                      <span className="block truncate text-xs text-muted-foreground">{d.customerName} · {d.label}</span>
                    </span>
                  </Button>
                ))}
              </div>
            )}

            {reading && canEdit(reading) && (
              <VoiceEditor reading={reading} roster={roster} aliases={aliases} documents={documents} onEdit={edit} />
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={dismiss}>
              {reading?.postable ? 'Cancel' : 'Close'}
            </Button>
            {reading && !READ_ONLY_ACTIONS.has(reading.action) && (
              <Button onClick={() => write()} disabled={phase === 'writing' || rereading || !reading.postable}>
                {phase === 'writing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Write it down
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
