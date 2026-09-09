"use client";

/**
 * The link page — what the QR on every invoice and workshop slip opens.
 *
 * Built as the shop's own khata: the bound ledger kept at the counter. Each channel is
 * a ruled entry, name in the left column and the action out at the right margin, the
 * way a line in that book actually reads. The headings are stamped small caps.
 *
 * Each entry is a button, because this is what a customer meets seconds after scanning
 * a code and it should look pressable at a glance — but on the house rule: gold is an
 * edge and a word, never a fill. A card's border warms to gold under the finger and
 * the whole thing lifts a hair. That is the only movement on the page.
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
        /* Buttons, but on the house rule: gold is an edge and a word, never a fill.
           The border warms to gold and the card lifts a hair — enough to feel pressed
           on a phone, quiet enough that six of them do not shout. */
        .btn { transition: border-color .25s ease, transform .25s ease, box-shadow .25s ease; }
        .btn:hover, .btn:focus-visible {
          border-color: #A98341;
          transform: translateY(-1px);
          box-shadow: 0 2px 14px rgba(20,17,13,.06);
        }
        .btn:active { transform: translateY(0); box-shadow: none; }
        .btn:focus-visible { outline: 1px solid #A98341; outline-offset: 3px; }
        @media (prefers-reduced-motion: reduce) {
          .btn, .btn:hover, .btn:focus-visible { transition: none; transform: none; }
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
      <div className="mb-4 flex items-baseline justify-between border-b border-[#14110D] pb-2">
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
      className="btn mb-2.5 flex items-center gap-4 rounded-xl border border-[#E3DDD1] bg-white px-5 py-4"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-tight text-[#14110D]">{label}</span>
        <span className="mt-1 block text-[12px] leading-tight text-[#6E675C]">{sub}</span>
      </span>
      {/* The action stays gold lettering on transparent — the one place gold is allowed. */}
      <span className={`${didone.className} shrink-0 text-[13px] italic text-[#A98341]`}>
        {action}
      </span>
    </a>
  );
}
