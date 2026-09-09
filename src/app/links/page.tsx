"use client";

/**
 * The link page — what the QR on every invoice and workshop slip opens.
 *
 * Dressed as taheri.shop, and matched to it by measurement rather than memory: ground
 * #0A1111, gold #BE9F76, rules at white 10%, micro-type set uppercase at 0.2em.
 *
 * ON THE HIERARCHY. Everything here used to sit between 9px and 14px — the channel
 * names, the thing a customer actually came to choose between, were 14px against 12.5px
 * body copy, so colour was carrying the load that size should carry and the page had no
 * focal point below the wordmark. There are four rungs now and they are far apart:
 *
 *   21px  Didone     the category — Diamonds, Gemstones, Watches
 *   15px  Inter      the shop's utility links, which are verbs, not departments
 *   13px  Inter      the welcome and the invitation to visit
 *   11.5px Inter     what each channel actually carries
 *   9px   micro-caps section labels, actions, the address — furniture, and quiet
 *
 * The quiet tiers are quiet by SIZE and letterspacing, not by opacity. They were set at
 * white/25 and white/40, which measure 2.2:1 and 3.8:1 on this ground and fail AA — a
 * page read by customers in daylight, some of them older, on whatever phone they have.
 * Nothing here is below white/50 (5.3:1) any more, and it still reads as furniture,
 * because 8.5px letterspaced caps whisper on their own without being faint too.
 *
 * ON THE SERIF. Five of the six channels are "X by Taheri". This page is already
 * Taheri, so the repeated half is the one part carrying no information, and it was
 * printed six times in the loudest position available. The distinguishing noun is now
 * set large in the wordmark's own Didone and the shared half whispers beside it, which
 * turns six brand names back into what they are — a jeweller's list of departments.
 *
 * The serif is the one liberty taken. My earlier note here said the storefront uses the
 * Didone only as wordmark artwork so this page would too; that was the right instinct
 * for decoration and the wrong one for hierarchy, because a second voice separates two
 * kinds of thing in a way that another two pixels never will. It is spent on six words
 * and nothing else. The utility rows below stay in Inter deliberately: "Talk to us" is
 * an action, not a department, and setting it in the same face as "Diamonds" would say
 * they are the same kind of thing.
 *
 * Public: no sign-in, no data, nothing out of the book.
 */

import React from 'react';
import Image from 'next/image';
import { Bodoni_Moda } from 'next/font/google';
import { STORE_CONFIG, STORE_COMMUNITIES, STORE_LINKS, STORE_LOGO_LIGHT_URL } from '@/lib/store-config';

// Self-hosted by next/font, so it is one same-origin file rather than a round-trip to
// Google — this page is often the first thing a customer loads on a slow phone.
const didone = Bodoni_Moda({ subsets: ['latin'], weight: ['400'], display: 'swap' });

type IconName = 'whatsapp' | 'instagram' | 'globe' | 'star';

interface Channel { href: string; label: string; lead: string; tail: string; sub: string }
interface Utility { href: string; label: string; sub: string; action: string; icon: IconName }

export default function LinksPage() {
  const utilities: Utility[] = ([
    { href: STORE_LINKS.instagram || STORE_CONFIG.instagramUrl,
      label: 'Instagram', sub: 'The work, up close', action: 'Follow', icon: 'instagram' },
    { href: STORE_LINKS.whatsapp || STORE_CONFIG.whatsappUrl,
      label: 'Talk to us', sub: 'Ask anything — a price, a repair, an idea', action: 'Chat', icon: 'whatsapp' },
    { href: STORE_LINKS.website,
      label: 'taheri.shop', sub: 'Browse the whole house at your own pace', action: 'Visit', icon: 'globe' },
    { href: STORE_LINKS.googleReview,
      label: 'Leave a review', sub: 'Tell Karachi what you thought', action: 'Review', icon: 'star' },
  ] as Utility[]).filter((e) => Boolean(e.href));

  return (
    <main className="min-h-screen bg-[#0A1111] px-6 pb-16 pt-14 text-white antialiased">
      <style>{`
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
        .btn:focus-visible { outline: 1px solid #BE9F76; outline-offset: 3px; }
        /* The icon warms with the hairline rather than on its own, so one gesture
           happens per card instead of two. */
        .btn .ico { color: rgba(255,255,255,.42); transition: color .3s ease; }
        .btn:hover .ico, .btn:focus-visible .ico { color: #BE9F76; }
        @media (prefers-reduced-motion: reduce) { .btn, .btn .ico { transition: none; } }
      `}</style>

      <div className="mx-auto w-full max-w-[27rem]">

        <header className="mb-14 text-center">
          <Image src={STORE_LOGO_LIGHT_URL} alt={STORE_CONFIG.name} width={240} height={60}
                 priority className="mx-auto h-auto w-40" />
          {/* The storefront's own line, set the way the storefront sets it. */}
          <p className="mt-5 text-[9px] font-light uppercase tracking-[0.24em] text-white/55">
            Gold born from dust.
          </p>
          {/* One line of welcome. A customer arrives here from a paper receipt with no
              idea what they have opened, and a page of unexplained buttons is a page
              they close. */}
          <p className="mx-auto mt-6 max-w-[19rem] text-[13px] font-light leading-relaxed text-white/55">
            Everything Taheri, in one place — new pieces as they are finished,
            the day&rsquo;s rate, and a way to reach us that is not a queue.
          </p>
        </header>

        <Block heading="Channels" note="Join any of them">
          {STORE_COMMUNITIES.map((c) => <ChannelRow key={c.href} {...c} />)}
        </Block>

        {utilities.length > 0 && (
          <Block heading="Find us">
            {utilities.map((e) => <UtilityRow key={e.href} {...e} />)}
          </Block>
        )}

        {/* The strip along the bottom of taheri.shop, kept. */}
        <footer className="mt-14 border-t border-white/10 pt-7 text-center">
          <p className="text-[13px] font-light text-white/70">Or come and see us</p>
          <p className="mt-2.5 text-[9px] uppercase tracking-[0.2em] text-white/50">
            Najmi Market, Shop #40 &amp; #16, Saddar, Karachi
          </p>
          <p className="mt-1.5 text-[9px] uppercase tracking-[0.2em] text-white/50">
            0335 2275553 &nbsp;·&nbsp; 0326 2275554
          </p>
        </footer>
      </div>
    </main>
  );
}

function Block({ heading, note, children }: { heading: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="text-[9px] uppercase tracking-[0.2em] text-white/50">{heading}</h2>
        {note && <span className="text-[9px] uppercase tracking-[0.16em] text-white/50">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * A department. The lead carries the weight; the shared half stands down.
 *
 * aria-label gives the channel's real name, so what a screen reader announces matches
 * what WhatsApp shows on arrival — the split is a way of setting the words, not a
 * renaming.
 */
function ChannelRow({ href, label, lead, tail, sub }: Channel) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} — ${sub}`}
      className="btn mb-2.5 flex items-start gap-4 rounded-lg border border-white/10 px-5 py-[18px]"
    >
      {/* Pinned to the name rather than floated to the middle of the card. The name is
          what the mark belongs to — centring it against a two-line block left it
          hovering between the two, attached to neither. */}
      <span className="mt-[3px] flex"><Icon name="whatsapp" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={`${didone.className} text-[21px] leading-none tracking-[0.005em] text-white`}>
            {lead}
          </span>
          <span className="text-[8.5px] uppercase tracking-[0.18em] text-white/50">{tail}</span>
        </span>
        <span className="mt-2 block text-[11.5px] font-light leading-snug text-white/55">{sub}</span>
      </span>
      <span className="shrink-0 self-center text-[9px] uppercase tracking-[0.2em] text-[#BE9F76]">
        Join
      </span>
    </a>
  );
}

/** A thing to do, rather than a thing to browse — hence Inter, and hence smaller. */
function UtilityRow({ href, label, sub, action, icon }: Utility) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn mb-2.5 flex items-center gap-4 rounded-lg border border-white/10 px-5 py-4"
    >
      <Icon name={icon} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-light leading-tight text-white">{label}</span>
        <span className="mt-1.5 block text-[11.5px] font-light leading-snug text-white/55">{sub}</span>
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
