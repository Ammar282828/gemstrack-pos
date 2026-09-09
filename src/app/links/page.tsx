"use client";

/**
 * The link page — what the QR on every invoice and workshop slip opens.
 *
 * Dressed as taheri.shop, not as a generic link page, and matched to it by
 * measurement rather than memory: ground #0A1111, Inter throughout at light weights,
 * micro-type set uppercase at 0.2em, gold #BE9F76, and rules at white 10%. The
 * storefront uses the Didone only as wordmark artwork, so this does too.
 *
 * Buttons rather than ruled lines: a customer meets this seconds after scanning a
 * code off a receipt, and it has to look pressable at a glance. Gold stays an edge
 * and a word — it is never a fill on the storefront and it is not one here.
 *
 * Public: no sign-in, no data, nothing out of the book.
 */

import React from 'react';
import Image from 'next/image';
import { STORE_CONFIG, STORE_COMMUNITIES, STORE_LINKS, STORE_LOGO_LIGHT_URL } from '@/lib/store-config';

interface Entry { href: string; label: string; sub: string; action: string }

export default function LinksPage() {
  const channels = STORE_COMMUNITIES.map((c) => ({ ...c, action: 'Join' }));

  const shop: Entry[] = [
    { href: STORE_LINKS.instagram || STORE_CONFIG.instagramUrl,
      label: 'Instagram', sub: 'See the work', action: 'Follow' },
    { href: STORE_LINKS.whatsapp || STORE_CONFIG.whatsappUrl,
      label: 'Message the counter', sub: 'We answer through the day', action: 'Open' },
    { href: STORE_LINKS.website,
      label: 'taheri.shop', sub: 'The full house', action: 'Visit' },
    { href: STORE_LINKS.googleReview,
      label: 'Leave a review', sub: 'Opens the stars, takes a minute', action: 'Write' },
  ].filter((e) => Boolean(e.href));

  return (
    <main className="min-h-screen bg-[#0A1111] px-6 pb-16 pt-14 text-white antialiased">
      <style>{`
        /* The storefront's own restraint: gold is a line and a word, never a fill.
           A card's hairline warms to gold under the finger; nothing else moves. */
        .btn { transition: border-color .3s ease, background-color .3s ease; }
        .btn:hover, .btn:focus-visible {
          border-color: rgba(190,159,118,.9);
          background-color: rgba(255,255,255,.03);
        }
        .btn:focus-visible { outline: 1px solid #BE9F76; outline-offset: 3px; }
        @media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
      `}</style>

      <div className="mx-auto w-full max-w-[27rem]">

        <header className="mb-12 text-center">
          <Image src={STORE_LOGO_LIGHT_URL} alt={STORE_CONFIG.name} width={240} height={60}
                 priority className="mx-auto h-auto w-40" />
          {/* The storefront's own line, set the way the storefront sets it. */}
          <p className="mt-5 text-[11px] font-light uppercase tracking-[0.2em] text-white/60">
            Gold born from dust.
          </p>
        </header>

        <Block heading="Channels">
          {channels.map((c) => <Row key={c.href} {...c} />)}
        </Block>

        {shop.length > 0 && (
          <Block heading="The shop">
            {shop.map((e) => <Row key={e.href} {...e} />)}
          </Block>
        )}

        {/* The strip along the bottom of taheri.shop, kept. */}
        <footer className="mt-14 space-y-2 border-t border-white/10 pt-6 text-center">
          <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">
            Najmi Market, Shop #40 &amp; #16, Saddar, Karachi
          </p>
          <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">
            0335 2275553 &nbsp;·&nbsp; 0326 2275554
          </p>
        </footer>
      </div>
    </main>
  );
}

function Block({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-[9px] uppercase tracking-[0.2em] text-white/40">{heading}</h2>
      {children}
    </section>
  );
}

function Row({ href, label, sub, action }: Entry) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn mb-2.5 flex items-center gap-4 rounded-lg border border-white/10 px-5 py-4"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-light leading-tight text-white">{label}</span>
        <span className="mt-1 block text-[11px] font-light leading-tight text-white/40">{sub}</span>
      </span>
      <span className="shrink-0 text-[9px] uppercase tracking-[0.2em] text-[#BE9F76]">
        {action}
      </span>
    </a>
  );
}
