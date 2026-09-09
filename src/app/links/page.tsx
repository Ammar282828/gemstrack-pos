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

type IconName = 'whatsapp' | 'instagram' | 'globe' | 'star';

interface Entry { href: string; label: string; sub: string; action: string; icon: IconName }

export default function LinksPage() {
  // Every channel is a WhatsApp community, so every channel carries the WhatsApp mark.
  // Six identical glyphs would be decoration if the rows were otherwise the same — they
  // are not: the mark answers "what opens when I press this", which is the one thing the
  // label cannot say and the one thing somebody hesitating wants to know.
  const channels: Entry[] = STORE_COMMUNITIES.map((c) => ({ ...c, action: 'Join', icon: 'whatsapp' as const }));

  const shop: Entry[] = ([
    { href: STORE_LINKS.instagram || STORE_CONFIG.instagramUrl,
      label: 'Instagram', sub: 'The work, up close', action: 'Follow', icon: 'instagram' },
    { href: STORE_LINKS.whatsapp || STORE_CONFIG.whatsappUrl,
      label: 'Talk to us', sub: 'Ask anything \u2014 a price, a repair, an idea', action: 'Chat', icon: 'whatsapp' },
    { href: STORE_LINKS.website,
      label: 'taheri.shop', sub: 'Browse the whole house at your own pace', action: 'Visit', icon: 'globe' },
    { href: STORE_LINKS.googleReview,
      label: 'Leave a review', sub: 'Tell Karachi what you thought', action: 'Review', icon: 'star' },
  ] as Entry[]).filter((e) => Boolean(e.href));

  return (
    <main className="min-h-screen bg-[#0A1111] px-6 pb-16 pt-14 text-white antialiased">
      <style>{`
        /* The ground has to be on the document, not just on <main>.
           The POS body carries the app's own palette, which is near-white, so a phone
           rubber-banding at the top or bottom of this page flashed white behind it —
           and the browser's own chrome tinted to match. Scoped to this page: React
           removes the tag when it unmounts. */
        /* !important because globals.css paints <html> through .boot-light /
           .boot-dark, whose class selector outranks a bare html rule. Those exist to
           get the POS's first paint right and know nothing about this page. */
        html, body { background-color: #0A1111 !important; }

        /* The storefront's own restraint: gold is a line and a word, never a fill.
           A card's hairline warms to gold under the finger; nothing else moves. */
        .btn { transition: border-color .3s ease, background-color .3s ease; }
        .btn:hover, .btn:focus-visible {
          border-color: rgba(190,159,118,.9);
          background-color: rgba(255,255,255,.03);
        }
        /* The icon warms with the hairline rather than on its own, so one gesture
           happens per card instead of two. */
        .btn .ico { color: rgba(255,255,255,.3); transition: color .3s ease; }
        .btn:hover .ico, .btn:focus-visible .ico { color: #BE9F76; }
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
          {/* One line of welcome. A customer arrives here from a paper receipt with no
              idea what they have opened, and a page of unexplained buttons is a page
              they close. */}
          <p className="mx-auto mt-5 max-w-[19rem] text-[12.5px] font-light leading-relaxed text-white/50">
            Everything Taheri, in one place — new pieces as they are finished,
            the day&rsquo;s rate, and a way to reach us that is not a queue.
          </p>
        </header>

        <Block heading="Channels" note="Join the ones you care about">
          {channels.map((c) => <Row key={c.href} {...c} />)}
        </Block>

        {shop.length > 0 && (
          <Block heading="Find us">
            {shop.map((e) => <Row key={e.href} {...e} />)}
          </Block>
        )}

        {/* The strip along the bottom of taheri.shop, kept. */}
        <footer className="mt-14 border-t border-white/10 pt-7 text-center">
          <p className="text-[12.5px] font-light text-white/70">Or come and see us</p>
          <p className="mt-2 text-[9px] uppercase tracking-[0.2em] text-white/40">
            Najmi Market, Shop #40 &amp; #16, Saddar, Karachi
          </p>
          <p className="mt-1.5 text-[9px] uppercase tracking-[0.2em] text-white/40">
            0335 2275553 &nbsp;·&nbsp; 0326 2275554
          </p>
        </footer>
      </div>
    </main>
  );
}

function Block({ heading, note, children }: { heading: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-[9px] uppercase tracking-[0.2em] text-white/40">{heading}</h2>
        {note && <span className="text-[10px] font-light text-white/30">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({ href, label, sub, action, icon }: Entry) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn mb-2.5 flex items-center gap-4 rounded-lg border border-white/10 px-5 py-4"
    >
      <Icon name={icon} />
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

/**
 * The marks, drawn rather than fetched.
 *
 * Inline SVG because this page is the first thing a customer sees after scanning a
 * receipt, often on a slow phone: an icon font or a sprite is a round-trip that can
 * arrive late and shift the layout under their thumb. Four small paths cost nothing and
 * are there in the first paint.
 *
 * WhatsApp is filled because its glyph is only recognisable filled — a stroked outline
 * of it reads as a generic speech bubble. The other three are hairlines at the same
 * weight as the card borders, which is what keeps them quiet.
 */
function Icon({ name }: { name: IconName }) {
  const common = { width: 17, height: 17, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'ico shrink-0' } as const;

  if (name === 'whatsapp') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12.04 2A9.9 9.9 0 0 0 2.1 11.9a9.8 9.8 0 0 0 1.35 4.96L2 22l5.28-1.38a9.9 9.9 0 0 0 4.76 1.21h.01A9.9 9.9 0 0 0 22 11.94 9.9 9.9 0 0 0 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.05-.2-.31a8.2 8.2 0 0 1-1.26-4.38 8.24 8.24 0 1 1 8.25 8.25Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.12-1.05-.39-2-1.23a7.5 7.5 0 0 1-1.38-1.72c-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.41-.56-.42h-.47a.9.9 0 0 0-.66.31c-.22.25-.87.85-.87 2.07s.89 2.4 1.01 2.56c.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.1-.22-.17-.47-.29Z" />
      </svg>
    );
  }

  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

  if (name === 'instagram') {
    return (
      <svg {...common} {...line}>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="3.8" />
        <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (name === 'globe') {
    return (
      <svg {...common} {...line}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 3.6 9A14 14 0 0 1 12 21a14 14 0 0 1-3.6-9A14 14 0 0 1 12 3Z" />
      </svg>
    );
  }

  return (
    <svg {...common} {...line}>
      <path d="m12 3.5 2.7 5.48 6.05.88-4.38 4.27 1.04 6.02L12 17.3l-5.41 2.85 1.04-6.02L3.25 9.86l6.05-.88L12 3.5Z" />
    </svg>
  );
}
