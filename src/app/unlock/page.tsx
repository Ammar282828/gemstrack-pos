"use client";

/**
 * The counter passcode screen.
 *
 * Dressed as the shop, not as a security product: this is the first thing anyone at
 * the counter sees each month, and it is on a phone in one hand. Hence the keypad
 * rather than a text field — no keyboard to summon, no zoom on focus, and thumb-sized
 * targets. Four digits submit themselves; nobody should have to reach for Enter.
 *
 * It says nothing about what is behind it. A wrong code gets "that code didn't work"
 * and no clue whether the shop, the URL, or the digit was the mistake.
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { STORE_LOGO_LIGHT_URL, STORE_LOGO_ASPECT } from '@/lib/store-config';

const LENGTH = 4;

/**
 * Where to land after unlocking — this shop's own pages only.
 *
 * `next` normally comes from the middleware, but anyone can put it in a URL and send
 * that URL to the counter. A leading slash is not enough of a check: "//evil.com" is
 * protocol-relative and "/\\evil.com" is normalised to the same thing, so both send the
 * browser off-site. That is worth care out of proportion to its size, because the
 * moment it fires is the moment somebody has just typed the shop's code into a screen
 * that asked for it — precisely when a strange site looks trustworthy.
 *
 * Resolving against the real origin and insisting the result still matches settles
 * every encoding of the trick at once, rather than one at a time.
 */
function sameOrigin(next: string | null): string {
  if (!next) return '/';
  try {
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
}

function Keypad() {
  const params = useSearchParams();
  const nextParam = params.get('next');

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = useCallback(async (value: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      });
      if (!res.ok) {
        // Say which of the three it was. Telling somebody their code is wrong when the
        // server broke, or when they are locked out, sends them back to the keypad to
        // do the one thing that cannot help -- and the correct code was already typed.
        setProblem(
          res.status === 401 ? 'That code didn’t work.'
          : res.status === 429 ? 'Too many tries. Wait a while, then try again.'
          : 'The shop’s server did not answer. The code may be fine — try once more.',
        );
        setCode('');
        return;
      }
      // A full load, not a client push: the middleware has to see the new cookie.
      // Resolved here rather than at render: this component is server-rendered first,
      // where there is no window to resolve an origin against.
      window.location.href = sameOrigin(nextParam);
    } catch {
      setProblem('Could not reach the shop’s server.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }, [nextParam]);

  const push = (d: string) => {
    if (busy || code.length >= LENGTH) return;
    const value = code + d;
    setCode(value);
    setProblem(null);
    if (value.length === LENGTH) void submit(value);
  };

  // The shop's phones have keyboards sometimes, and a till has one always.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) push(e.key);
      else if (e.key === 'Backspace') setCode((c) => c.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-10 bg-[#0A1111] px-6 py-12 text-white">
      <div className="flex flex-col items-center gap-3">
        <Image
          src={STORE_LOGO_LIGHT_URL}
          alt="Taheri"
          width={168}
          height={Math.round(168 / STORE_LOGO_ASPECT)}
          priority
        />
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">Counter access</p>
      </div>

      <div className="flex items-center gap-4" aria-live="polite">
        {Array.from({ length: LENGTH }).map((_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full border transition-colors ${
              problem ? 'border-red-400/60'
                : i < code.length ? 'border-[#BE9F76] bg-[#BE9F76]'
                : 'border-white/25'
            }`}
          />
        ))}
      </div>

      <p className={`-mt-6 h-8 max-w-[17rem] text-center text-xs ${problem ? 'text-red-400/80' : 'text-transparent'}`}>
        {problem ?? '\u00A0'}
      </p>

      <div className="grid w-full max-w-[17rem] grid-cols-3 gap-3">
        {['1','2','3','4','5','6','7','8','9'].map((d) => (
          <Key key={d} onClick={() => push(d)} disabled={busy}>{d}</Key>
        ))}
        <span />
        <Key onClick={() => push('0')} disabled={busy}>0</Key>
        <Key onClick={() => setCode((c) => c.slice(0, -1))} disabled={busy} muted>←</Key>
      </div>
    </main>
  );
}

function Key({
  children, onClick, disabled, muted,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-16 rounded-full border border-white/10 text-xl font-light transition-colors
        hover:border-[#BE9F76]/50 hover:bg-white/[0.04] active:bg-white/[0.08]
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        focus-visible:outline-[#BE9F76] disabled:opacity-40
        ${muted ? 'text-white/40' : 'text-white/90'}`}
    >
      {children}
    </button>
  );
}

export default function UnlockPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-[#0A1111]" />}>
      <Keypad />
    </Suspense>
  );
}
