"use client";

/**
 * The link page — what the QR on every invoice, order slip and repair receipt opens.
 * One page for both houses (links.taheri.shop, links.houseofmina.store): its words and
 * links are STORE_LINKS / STORE_LINKS_PAGE, its dress is the house's brand.
 *
 * Taheri's is dressed as taheri.shop, matched by measurement rather than memory: ground
 * #0A1111, gold #BE9F76, rules at white 10%, micro-type set uppercase at 0.2em. House of
 * Mina's is its catalogue's dark theme: maroon-black #140B0B, rose #E8A5AE, Newsreader
 * where Taheri has the Didone.
 *
 * ON THE HIERARCHY. Everything here used to sit between 9px and 14px — the channel
 * names, the thing a customer actually came to choose between, were 14px against 12.5px
 * body copy, so colour was carrying the load that size should carry and the page had no
 * focal point below the wordmark. There are four rungs now and they are far apart:
 *
 *   21px  serif      the top row — the WhatsApp channel (or community) to follow
 *   15px  sans       the shop's utility links, which are verbs, not departments
 *   13px  sans       the welcome and the invitation to visit
 *   11.5px sans      what each row actually carries
 *   9px   micro-caps section labels, actions, the address — furniture, and quiet
 *
 * The quiet tiers are quiet by SIZE and letterspacing, not by opacity. They were set at
 * white/25 and white/40, which measure 2.2:1 and 3.8:1 on this ground and fail AA — a
 * page read by customers in daylight, some of them older, on whatever phone they have.
 * Nothing here is below white/50 (5.3:1) any more, and it still reads as furniture,
 * because 8.5px letterspaced caps whisper on their own without being faint too.
 *
 * ON THE SERIF. Taheri's page used to list six WhatsApp communities ("Diamonds by
 * Taheri", …); since 2026-09-25 it leads with the WhatsApp channel alone (owner: "remove
 * all community links"). The top row keeps their setting: the lead ("Collections") large
 * in the house's serif, the tail ("by Taheri") whispering beside it. An accent hairline
 * at rest marks it as the thing to tap. A house with no channel (House of Mina) puts its
 * community there instead.
 *
 * The serif is the one liberty taken, spent on one word. The utility rows below stay in
 * the sans deliberately: "Talk to us" is an action, not a department, and setting it in
 * the same face would say they are the same kind of thing.
 *
 * Public: no sign-in, no data, nothing out of the book.
 */

import React from 'react';
import Image from 'next/image';
import { Bodoni_Moda, Newsreader } from 'next/font/google';
import { STORE_BRAND, STORE_CONFIG, STORE_LINKS, STORE_LINKS_PAGE, STORE_LOGO_ASPECT, STORE_LOGO_LIGHT_URL } from '@/lib/store-config';

// Self-hosted by next/font, so it is one same-origin file rather than a round-trip to
// Google — this page is often the first thing a customer loads on a slow phone. Both
// are declared (next/font wants literals); only the house's own is ever drawn.
const didone = Bodoni_Moda({ subsets: ['latin'], weight: ['400'], display: 'swap', preload: false });
const newsreader = Newsreader({ subsets: ['latin'], weight: ['400'], display: 'swap', preload: false });

const HOUSE = STORE_BRAND === 'mina'
  ? { ground: '#140B0B', accent: '#E8A5AE', accentRgb: '232,165,174', serif: newsreader.className }
  : { ground: '#0A1111', accent: '#BE9F76', accentRgb: '190,159,118', serif: didone.className };

type IconName = 'whatsapp' | 'instagram' | 'tiktok' | 'globe' | 'bag' | 'star';

interface Channel { href: string; label: string; lead: string; tail: string; sub: string; action: string; featured?: boolean }
interface Utility { href: string; label: string; sub: string; action: string; icon: IconName }

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export default function LinksPage() {
  const utilities: Utility[] = ([
    { href: STORE_LINKS.instagram || STORE_CONFIG.instagramUrl,
      label: 'Instagram', sub: 'The work, up close', action: 'Follow', icon: 'instagram' },
    { href: STORE_LINKS.tiktok,
      label: 'TikTok', sub: 'Every piece, in motion', action: 'Follow', icon: 'tiktok' },
    { href: STORE_LINKS.whatsapp || STORE_CONFIG.whatsappUrl,
      label: 'Talk to us', sub: 'Ask anything — a price, a repair, an idea', action: 'Chat', icon: 'whatsapp' },
    { href: STORE_LINKS.website,
      label: STORE_LINKS_PAGE.websiteLabel || host(STORE_LINKS.website),
      sub: 'Browse the whole house at your own pace', action: 'Visit', icon: 'globe' },
    { href: STORE_LINKS.shop,
      label: host(STORE_LINKS.shop), sub: 'Order online, delivered to your door', action: 'Shop', icon: 'bag' },
    { href: STORE_LINKS.googleReview,
      label: 'Leave a review', sub: 'Tell Karachi what you thought', action: 'Review', icon: 'star' },
  ] as Utility[]).filter((e) => Boolean(e.href));

  // The top row: the channel (follow, nothing to join, lands in Updates), or — for a
  // house without one — its community.
  const top = STORE_LINKS.waChannel
    ? { href: STORE_LINKS.waChannel, kind: 'channel', action: 'Follow' }
    : STORE_LINKS.waCommunity
      ? { href: STORE_LINKS.waCommunity, kind: 'community', action: 'Join' }
      : null;
  const { lead, tail, line } = STORE_LINKS_PAGE.feature;

  // The wordmark is drawn 40px tall whatever its shape (Taheri's is 160 wide, Mina's
  // wider), and never past 200px.
  const logoWidth = Math.min(200, Math.round(40 * STORE_LOGO_ASPECT));

  return (
    <main className="min-h-screen px-6 pb-16 pt-14 text-white antialiased" style={{ backgroundColor: HOUSE.ground }}>
      <style>{`
        /* !important because globals.css paints <html> through .boot-light /
           .boot-dark, whose class selector outranks a bare html rule. Those exist to
           get the POS's first paint right and know nothing about this page. */
        html, body { background-color: ${HOUSE.ground} !important; }

        /* The storefront's own restraint: the accent is a line and a word, never a fill.
           A card's hairline warms to it under the finger; nothing else moves. */
        .btn { transition: border-color .3s ease, background-color .3s ease; }
        .btn.feat { border-color: rgba(${HOUSE.accentRgb},.45); }
        .btn:hover, .btn:focus-visible {
          border-color: rgba(${HOUSE.accentRgb},.9);
          background-color: rgba(255,255,255,.03);
        }
        .btn:focus-visible { outline: 1px solid ${HOUSE.accent}; outline-offset: 3px; }
        .accent { color: ${HOUSE.accent}; }
        /* The icon warms with the hairline rather than on its own, so one gesture
           happens per card instead of two. */
        .btn .ico { color: rgba(255,255,255,.42); transition: color .3s ease; }
        .btn:hover .ico, .btn:focus-visible .ico { color: ${HOUSE.accent}; }
        @media (prefers-reduced-motion: reduce) { .btn, .btn .ico { transition: none; } }
      `}</style>

      <div className="mx-auto w-full max-w-[27rem]">

        <header className="mb-14 text-center">
          <Image src={STORE_LOGO_LIGHT_URL} alt={STORE_CONFIG.name} width={logoWidth * 2} height={80}
                 priority className="mx-auto h-auto" style={{ width: logoWidth }} />
          {/* The storefront's own line, set the way the storefront sets it. */}
          {STORE_LINKS_PAGE.tagline && (
            <p className="mt-5 text-[9px] font-light uppercase tracking-[0.24em] text-white/55">
              {STORE_LINKS_PAGE.tagline}
            </p>
          )}
          {/* One line of welcome. A customer arrives here from a paper receipt with no
              idea what they have opened, and a page of unexplained buttons is a page
              they close. */}
          <p className="mx-auto mt-6 max-w-[19rem] text-[13px] font-light leading-relaxed text-white/55">
            {STORE_LINKS_PAGE.welcome}
          </p>
        </header>

        {top && (
          <Block heading={`WhatsApp ${top.kind}`}>
            <ChannelRow href={top.href} label={`${lead} ${tail} — WhatsApp ${top.kind}`}
                        lead={lead} tail={tail} sub={line} action={top.action} featured />
          </Block>
        )}

        {utilities.length > 0 && (
          <Block heading="Find us">
            {utilities.map((e) => <UtilityRow key={e.href} {...e} />)}
          </Block>
        )}

        {/* The strip along the bottom of the house's website, kept. */}
        {STORE_LINKS_PAGE.visit.length > 0 && (
          <footer className="mt-14 border-t border-white/10 pt-7 text-center">
            <p className="text-[13px] font-light text-white/70">Or come and see us</p>
            {STORE_LINKS_PAGE.visit.map((row, i) => (
              <p key={row} className={`${i ? 'mt-1.5' : 'mt-2.5'} text-[9px] uppercase tracking-[0.2em] text-white/50`}>
                {row}
              </p>
            ))}
          </footer>
        )}
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
function ChannelRow({ href, label, lead, tail, sub, action, featured }: Channel) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} — ${sub}`}
      className={`btn mb-2.5 flex items-start gap-4 rounded-lg border px-5 py-[18px] ${featured ? 'feat' : 'border-white/10'}`}
    >
      {/* Pinned to the name rather than floated to the middle of the card. The name is
          what the mark belongs to — centring it against a two-line block left it
          hovering between the two, attached to neither. */}
      <span className="mt-[3px] flex"><Icon name="whatsapp" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={`${HOUSE.serif} text-[21px] leading-none tracking-[0.005em] text-white`}>
            {lead}
          </span>
          <span className="text-[8.5px] uppercase tracking-[0.18em] text-white/50">{tail}</span>
        </span>
        <span className="mt-2 block text-[11.5px] font-light leading-snug text-white/55">{sub}</span>
      </span>
      <span className="accent shrink-0 self-center text-[9px] uppercase tracking-[0.2em]">
        {action}
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
      <span className="accent shrink-0 text-[9px] uppercase tracking-[0.2em]">
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
 * arrive late and shift the layout under their thumb. A few small paths cost nothing and
 * are there in the first paint.
 *
 * WhatsApp is filled because its glyph is only recognisable filled — a stroked outline
 * of it reads as a generic speech bubble. The others are hairlines at the same
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

  if (name === 'tiktok') {
    return (
      <svg {...common} {...line}>
        <path d="M13.5 3.5v11.25a3.75 3.75 0 1 1-3.75-3.75" />
        <path d="M13.5 3.5c.4 2.4 2.3 4.2 4.75 4.4" />
      </svg>
    );
  }

  if (name === 'bag') {
    return (
      <svg {...common} {...line}>
        <path d="M5 8h14l-1 12.5H6L5 8Z" />
        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
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
