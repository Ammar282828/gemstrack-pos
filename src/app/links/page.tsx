"use client";

/**
 * The link page — what the QR on every invoice and workshop slip opens.
 *
 * Built as the shop's own khata: the bound ledger kept at the counter. Each channel is
 * a ruled entry, name in the left column and the action out at the right margin, the
 * way a line in that book actually reads. The headings are stamped small caps.
 *
 * Gold is a rule, not a fill — the house rule, and the one worth stating plainly. It
 * appears only as a hairline: never a button colour, never a wash. The single moment
 * of movement is that hairline drawing itself along a row under the finger, like a pen
 * run down a ledger line, and it is the only animation on the page.
 *
 * Public: no sign-in, no data, nothing from the book itself.
 */

import React from 'react';
import Image from 'next/image';
import { Bodoni_Moda } from 'next/font/google';
import { STORE_CONFIG, STORE_COMMUNITIES, STORE_LINKS, STORE_LOGO_URL } from '@/lib/store-config';

/** A true Didone, to sit with the wordmark's own high contrast. */
const didone = Bodoni_Moda({ subsets: ['latin'], weight: ['400', '500'], display: 'swap' });

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
    <main className="min-h-screen bg-[#FBF9F5] px-6 pb-20 pt-16 text-[#14110D] antialiased">
      <style>{`
        /* The signature: a gold hairline drawn along the entry, left to right. */
        .entry { position: relative; }
        .entry::after {
          content: ''; position: absolute; left: 0; bottom: -1px; height: 1px; width: 100%;
          background: #A98341; transform: scaleX(0); transform-origin: left;
          transition: transform .45s cubic-bezier(.22,.61,.36,1);
        }
        .entry:hover::after, .entry:focus-visible::after { transform: scaleX(1); }
        .entry:focus-visible { outline: none; }
        .entry:focus-visible .entry-label { text-decoration: underline; text-underline-offset: 3px; }
        @media (prefers-reduced-motion: reduce) {
          .entry::after { transition: none; }
        }
      `}</style>

      <div className="mx-auto w-full max-w-[30rem]">

        {/* Letterhead */}
        <header className="mb-14 text-center">
          <Image src={STORE_LOGO_URL} alt={STORE_CONFIG.name} width={240} height={60}
                 priority className="mx-auto h-auto w-40" />
          <p className={`${didone.className} mt-5 text-[13px] italic tracking-wide text-[#6E675C]`}>
            Gold, diamonds &amp; gemstones
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.28em] text-[#A98341]">Karachi</p>
        </header>

        <Ledger heading="Channels" note="Pick the one you care about">
          {channels.map((c) => <Row key={c.href} {...c} />)}
        </Ledger>

        {shop.length > 0 && (
          <Ledger heading="The shop">
            {shop.map((e) => <Row key={e.href} {...e} />)}
          </Ledger>
        )}

        <footer className="mt-16 text-center">
          <span className="text-[10px] uppercase tracking-[0.28em] text-[#B4AC9E]">
            {STORE_CONFIG.name}
          </span>
        </footer>
      </div>
    </main>
  );
}

/** A stamped small-cap heading over a ruled block, as the book has. */
function Ledger({ heading, note, children }: {
  heading: string; note?: string; children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <div className="mb-1 flex items-baseline justify-between border-b border-[#14110D] pb-2">
        <h2 className="text-[10px] uppercase tracking-[0.28em] text-[#14110D]">{heading}</h2>
        {note && <span className="text-[10px] tracking-wide text-[#B4AC9E]">{note}</span>}
      </div>
      <div>{children}</div>
    </section>
  );
}

function Row({ href, label, sub, action }: Entry) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="entry group flex items-baseline gap-4 border-b border-[#E3DDD1] py-4"
    >
      <span className="min-w-0 flex-1">
        <span className="entry-label block text-[15px] leading-tight text-[#14110D]">{label}</span>
        <span className="mt-0.5 block text-[12px] leading-tight text-[#6E675C]">{sub}</span>
      </span>
      {/* The action sits out at the right margin, where a figure would be totalled. */}
      <span className={`${didone.className} shrink-0 text-[13px] italic text-[#A98341]`}>
        {action}
      </span>
    </a>
  );
}
