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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { resolveIntent, READ_ONLY_ACTIONS, type RawIntent, type Reading } from '@/lib/voice/resolve';
import { applyReading, type AppliedEntry } from '@/lib/voice/apply';
import { answerQuestion } from '@/lib/voice/answers';
import { speak, stopSpeaking, speechOutputSupported } from '@/lib/voice/speak';
import { phoneticKey, type LearnedAlias, type RankedName, type RosterEntry } from '@/lib/voice/phonetics';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_KARAT_VALUE_FOR_CALCULATION } from '@/lib/store';
import { authedFetch } from '@/lib/voice/authed-fetch';

type Phase = 'idle' | 'listening' | 'thinking' | 'confirming' | 'writing';

/** Stops on its own, so a bubble left running in a pocket cannot record the whole day. */
const MAX_RECORDING_MS = 30_000;

export function VoiceBubble() {
  const router = useRouter();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>('idle');
  const [reading, setReading] = useState<Reading | null>(null);
  const [transcript, setTranscript] = useState('');
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
  const store = useMemo(() => ({
    addHisaabEntry, addExpense, addAdditionalRevenue,
    addCustomer, addKarigar, updateCustomer, updateKarigar,
    deleteHisaabEntry, deleteExpense, deleteAdditionalRevenue, deleteCustomer, deleteKarigar,
  }), [addHisaabEntry, addExpense, addAdditionalRevenue, addCustomer, addKarigar, updateCustomer,
       updateKarigar, deleteHisaabEntry, deleteExpense, deleteAdditionalRevenue, deleteCustomer, deleteKarigar]);

  /** Everything the fixed queries read. Nothing here is written to. */
  const hisaabEntries = useAppStore((s) => s.hisaabEntries);
  const karigarJobs = useAppStore((s) => s.karigarJobs);
  const orders = useAppStore((s) => s.orders);
  const loadHisaab = useAppStore((s) => s.loadHisaab);
  const loadKarigarJobs = useAppStore((s) => s.loadKarigarJobs);
  const loadOrders = useAppStore((s) => s.loadOrders);

  /** The entry just written, so "undo" a moment later means that one and nothing else. */
  const lastWrite = useRef<AppliedEntry | null>(null);

  useEffect(() => {
    loadCustomers();
    loadKarigars();
    loadVoiceAliases();
    loadHisaab();
    loadKarigarJobs();
    loadOrders();
  }, [loadCustomers, loadKarigars, loadVoiceAliases, loadHisaab, loadKarigarJobs, loadOrders]);

  /**
   * Corrections already made, keyed by sound.
   *
   * Handed to the matcher, where a learned name outranks everything else — the model
   * completing a half-heard "Alifya" to a full roster name is still a guess, and this is
   * the one signal that is not.
   */
  const aliases = useMemo(() => {
    const map = new Map<string, LearnedAlias>();
    // Least-used first, so the correction made most often is the one left in the map.
    for (const a of [...voiceAliases].sort((x, y) => (x.uses ?? 1) - (y.uses ?? 1))) {
      map.set(a.heardKey, { kind: a.kind, id: a.refId });
    }
    return map;
  }, [voiceAliases]);

  const roster = useMemo<RosterEntry[]>(() => [
    ...customers.map((c) => ({ id: c.id, name: c.name, kind: 'customer' as const, phone: c.phone })),
    ...karigars.map((k) => ({ id: k.id, name: k.name, kind: 'karigar' as const, phone: k.contact })),
  ], [customers, karigars]);

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
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const send = useCallback(async (blob: Blob) => {
    setPhase('thinking');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('Could not read the recording.'));
        // A data: URL is "data:<mime>;base64,<payload>" — only the payload is wanted.
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
        fr.readAsDataURL(blob);
      });

      const res = await authedFetch('/api/voice/listen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: base64,
          mimeType: blob.type || 'audio/webm',
          roster,
          shopName: settings.shopName,
          today: new Date().toISOString().slice(0, 10),
          // '21k' -> '21'; the prompt states a number, not a karat label.
          orderKarat: DEFAULT_KARAT_VALUE_FOR_CALCULATION.replace('k', ''),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Voice failed.');

      const raw = data as RawIntent & { transcript?: string };
      setTranscript(raw.transcript ?? '');
      setHeardAs(raw.person?.spoken_as || raw.person?.name || '');

      /* The model's answer is a claim. This is where it becomes a pinned, checked reading. */
      const resolved = resolveIntent(raw, { roster, aliases });
      setReading(resolved);

      // Nothing to write and nothing to choose — act and get out of the way.
      if (resolved.action === 'navigate' && resolved.screen) {
        setPhase('idle');
        setReading(null);
        router.push(resolved.screen);
        return;
      }

      /**
       * "Undo" is not a reading to confirm — it is a correction, and making somebody
       * confirm a correction to a mistake is the wrong way round.
       */
      if (raw.action === 'undo' || /\bundo\b/i.test(raw.transcript ?? '')) {
        const back = lastWrite.current;
        setPhase('idle');
        setReading(null);
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
        setReading(null);
        void say(answer.text);
        toast({ title: answer.text });
        return;
      }

      setPhase('confirming');
      // Read the reading back while it is being looked at, rather than after.
      if (resolved.summary) void say(resolved.summary);
    } catch (err) {
      setPhase('idle');
      toast({
        title: 'Could not hear that',
        description: err instanceof Error ? err.message : 'Try again.',
        variant: 'destructive',
      });
    }
  }, [roster, aliases, settings.shopName, router, toast, say,
      customers, karigars, hisaabEntries, karigarJobs, orders]);

  const start = useCallback(async () => {
    // The microphone must never open while the assistant is still speaking, or it records
    // its own voice and answers itself.
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // The bars move with the voice, so it is never in doubt that it is recording.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(bins);
        const avg = bins.reduce((a, b) => a + b, 0) / bins.length;
        setLevel(Math.min(1, avg / 90));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        cleanup();
        if (blob.size > 1000) void send(blob);
        else { setPhase('idle'); toast({ title: 'Nothing was recorded' }); }
      };
      recorder.start();
      setPhase('listening');
      stopTimerRef.current = setTimeout(() => recorderRef.current?.stop(), MAX_RECORDING_MS);
    } catch {
      toast({
        title: 'The microphone did not open',
        description: 'Browsers only allow it over https or on this computer itself.',
        variant: 'destructive',
      });
    }
  }, [cleanup, send, toast]);

  const stop = useCallback(() => recorderRef.current?.stop(), []);

  const write = useCallback(async (chosen?: RankedName) => {
    if (!reading) return;
    const finalReading: Reading = chosen
      ? { ...reading, person: chosen, candidates: [], ambiguous: false, postable: true, blockedBecause: null }
      : reading;
    setPhase('writing');
    try {
      /**
       * Picking from the list is the shop answering "which one?", and that answer is the
       * only evidence in the whole matcher that is not a guess. Write it down before the
       * entry, so the correction survives even if the write itself fails.
       */
      if (chosen && heardAs && phoneticKey(heardAs).length) {
        await teachVoiceAlias(heardAs, chosen.kind, chosen.id, chosen.name);
      }
      const applied = await applyReading(finalReading, store);
      lastWrite.current = applied;
      void say(applied.said);
      toast({
        title: applied.said,
        description: applied.undo ? 'Say "undo" to take it back.' : undefined,
      });
      setReading(null);
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
  }, [reading, store, router, toast, heardAs, teachVoiceAlias, say]);

  const dismiss = () => { setReading(null); setPhase('idle'); };

  const busy = phase === 'thinking' || phase === 'writing';

  return (
    <>
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
            : 'bg-background text-foreground border hover:bg-accent',
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

      <Dialog open={phase === 'confirming' && reading !== null} onOpenChange={(o) => { if (!o) dismiss(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reading?.ambiguous ? 'Which one?'
                : reading?.postable ? 'Write this down?'
                : 'Nothing written'}
            </DialogTitle>
            {transcript && (
              <DialogDescription className="italic">“{transcript}”</DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-3">
            {reading?.summary && <p className="text-sm">{reading.summary}</p>}

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
                    onClick={() => write(c)}
                  >
                    <span>{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.kind === 'customer' ? 'Customer' : 'Karigar'}
                    </span>
                  </Button>
                ))}
              </div>
            )}

            {!reading?.ambiguous && reading?.blockedBecause && (
              <p className="text-sm text-muted-foreground">{reading.blockedBecause}</p>
            )}

            {reading?.postable && reading.person && (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium">{reading.person.name}</div>
                <div className="text-muted-foreground">
                  {reading.person.kind === 'customer' ? 'Customer' : 'Karigar'}
                  {reading.person.via === 'phonetic' && ' · matched by sound'}
                  {reading.person.via === 'learned' && ' · a name you corrected before'}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={dismiss}>
              {reading?.postable ? 'Cancel' : 'Close'}
            </Button>
            {reading?.postable && !reading.ambiguous && (
              <Button onClick={() => write()} disabled={phase === 'writing'}>
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
