/**
 * The link page — what the QR on every invoice, order slip and repair receipt opens.
 * One page for both houses (links.taheri.shop, links.houseofmina.store): its words and
 * links are STORE_LINKS / STORE_LINKS_PAGE, its dress is LINKS_DRESS. Taheri's is
 * taheri.shop's ground #0A1111 and gold #BE9F76 with the Didone; House of Mina's is its
 * catalogue's maroon-black #140B0B and rose #E8A5AE with Newsreader.
 *
 * A SERVER PAGE, drawn in the first response. Until 2026-09-29 it was a client page
 * under a layout that rendered an empty <body> until the ERP's store had hydrated, so a
 * customer who scanned a receipt got blank HTML and waited for the whole ERP bundle
 * before a single link showed. Now the layout lets public pages through at once
 * (layout.tsx) and this page ships no JavaScript of its own.
 *
 * WHAT IT SHOWS, top to bottom:
 *   the wordmark, the house's line in its accent, a hairline ornament, one line of welcome,
 *     and the house's rating under it — stars, the figure, how many reviews and where (Google
 *     for Taheri; houseofmina.store for Mina, who has no Google listing), opening them all;
 *   the top row — the WhatsApp channel (or, for a house without one, the community) —
 *     as the one card with a filled button, the page's single primary action (as New
 *     Sale is the ERP's one tinted control);
 *   "What they say": a few real reviews, quoted as written (lib/reviews.ts picks them; the
 *     house's last reading, reviews-server.ts), with "Write a review" where the house has a link;
 *   "Just in": the newest pieces on the house's own website, a spread across its
 *     collections (showcase.ts), each opening its page — streamed in after the rest,
 *     so a slow site never holds up a link;
 *   the house's other links as one grouped list, not a stack of look-alike boxes;
 *   how to visit, its numbers tappable.
 *
 * Colour and size carry the hierarchy, never faintness: nothing a customer reads is below
 * white at 50% on the ground (5.3:1), since the page is read in daylight on any phone.
 * Class names are the page's own (lk-…): the ERP's Liquid Glass sheet styles `.btn`,
 * `.card` and friends on a phone that has it switched on, and must not reach this page.
 *
 * Public: no sign-in, nothing out of the book. The pieces are the site's own public list,
 * less anything hidden at the counter.
 */

import React, { Suspense } from 'react';
import Image from 'next/image';
import localFont from 'next/font/local';
import {
  LINKS_DRESS, STORE_BRAND, STORE_CONFIG, STORE_LINKS, STORE_LINKS_PAGE, STORE_LOGO_ASPECT, STORE_LOGO_LIGHT_URL,
} from '@/lib/store-config';
import { pickShowcase } from '@/lib/website/showcase';
import { ratingLabel, type ReviewsSnapshot } from '@/lib/reviews';
import { getReviews } from '@/lib/reviews-server';

// Rendered per request: the pieces change daily, and nothing here may run at build.
export const dynamic = 'force-dynamic';

// Self-hosted from src/fonts (Google's latin cuts; the build never fetches from Google — see
// website/post/fonts.ts). Both are declared (next/font wants literals); only the house's own is
// ever drawn, so only its files are fetched.
const didone = localFont({
  src: [
    { path: '../../fonts/bodoni-moda-normal-latin.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/bodoni-moda-italic-latin.woff2', weight: '400', style: 'italic' },
  ],
  display: 'swap', preload: false, adjustFontFallback: 'Times New Roman',
});
const newsreader = localFont({
  src: [
    { path: '../../fonts/newsreader-normal-latin.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/newsreader-italic-latin.woff2', weight: '400', style: 'italic' },
  ],
  display: 'swap', preload: false, adjustFontFallback: 'Times New Roman',
});
const SERIF = STORE_BRAND === 'mina' ? newsreader.className : didone.className;

const { ground: GROUND, accent: ACCENT, accentRgb: ACC } = LINKS_DRESS;

type IconName = 'whatsapp' | 'instagram' | 'tiktok' | 'globe' | 'bag' | 'star' | 'arrow' | 'google';

interface Utility { href: string; label: string; sub: string; icon: IconName }
interface Shown { id: string; name: string; url: string; thumb: string; collection: string }

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as React.CSSProperties;

export default async function LinksPage() {
  // The house's last reading (never more than 1.5 s of the page's time; none → no rating shown).
  const reviews = await getReviews();
  const utilities: Utility[] = ([
    { href: STORE_LINKS.instagram || STORE_CONFIG.instagramUrl, label: 'Instagram', sub: 'The work, up close', icon: 'instagram' },
    { href: STORE_LINKS.tiktok, label: 'TikTok', sub: 'Every piece, in motion', icon: 'tiktok' },
    { href: STORE_LINKS.whatsapp || STORE_CONFIG.whatsappUrl, label: 'Talk to us', sub: 'Ask anything — a price, a repair, an idea', icon: 'whatsapp' },
    { href: STORE_LINKS.website, label: STORE_LINKS_PAGE.websiteLabel || host(STORE_LINKS.website), sub: 'Browse the whole house at your own pace', icon: 'globe' },
    { href: STORE_LINKS.shop, label: host(STORE_LINKS.shop), sub: 'Order online, delivered to your door', icon: 'bag' },
    // With reviews showing, "Write a review" sits under them instead.
    { href: reviews?.writeUrl ? '' : STORE_LINKS.googleReview, label: 'Leave a review', sub: 'Tell Karachi what you thought', icon: 'star' },
  ] as Utility[]).filter((e) => Boolean(e.href));

  // The channel (follow, nothing to join, lands in Updates), or a house's community.
  const top = STORE_LINKS.waChannel
    ? { href: STORE_LINKS.waChannel, kind: 'channel', action: 'Follow' }
    : STORE_LINKS.waCommunity
      ? { href: STORE_LINKS.waCommunity, kind: 'community', action: 'Join' }
      : null;
  const { lead, tail, line } = STORE_LINKS_PAGE.feature;

  // The wordmark is drawn 40px tall whatever its shape, and never past 200px wide.
  const logoWidth = Math.min(200, Math.round(40 * STORE_LOGO_ASPECT));

  return (
    <main className="lk" style={{ fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif' }}>
      <style>{CSS}</style>
      <div className="lk-col">

        <header className="lk-head lk-rise" style={delay(0)}>
          <Image src={STORE_LOGO_LIGHT_URL} alt={STORE_CONFIG.name} width={logoWidth * 2} height={80}
                 priority className="mx-auto h-auto" style={{ width: logoWidth }} />
          {STORE_LINKS_PAGE.tagline && <p className="lk-tag">{STORE_LINKS_PAGE.tagline}</p>}
          <Ornament />
          {/* A customer arrives from a paper receipt with no idea what they have opened. */}
          <p className="lk-welcome">{STORE_LINKS_PAGE.welcome}</p>
          {reviews && <RatingBadge r={reviews} />}
        </header>

        {top && (
          <a
            href={top.href} target="_blank" rel="noopener noreferrer"
            // The channel's real name, as WhatsApp shows it on arrival: the split below is typesetting.
            aria-label={`${lead} ${tail} — WhatsApp ${top.kind}. ${line}`}
            className="lk-feat lk-rise" style={delay(90)}
          >
            <span className="lk-pill"><Icon name="whatsapp" size={13} /> WhatsApp {top.kind}</span>
            <span className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`${SERIF} lk-lead`}>{lead}</span>
              {tail && <span className="lk-tail">{tail}</span>}
            </span>
            {line && <span className="lk-line">{line}</span>}
            <span className="lk-cta">{top.action} on WhatsApp <Icon name="arrow" size={14} /></span>
          </a>
        )}

        {reviews && reviews.quotes.length > 0 && <Reviews r={reviews} />}

        {STORE_LINKS.website && (
          <Suspense fallback={<ShowcaseFrame><Skeleton /></ShowcaseFrame>}>
            <Showcase />
          </Suspense>
        )}

        {utilities.length > 0 && (
          <section className="lk-sec lk-rise" style={delay(240)}>
            <h2 className="lk-label mb-3.5">Find us</h2>
            <ul className="lk-list">
              {utilities.map((e) => (
                <li key={e.href}>
                  <a href={e.href} target="_blank" rel="noopener noreferrer" className="lk-row">
                    <span className="lk-ico"><Icon name={e.icon} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="lk-lbl">{e.label}</span>
                      <span className="lk-sub">{e.sub}</span>
                    </span>
                    <span className="lk-go"><Icon name="arrow" size={15} /></span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {STORE_LINKS_PAGE.visit.length > 0 && (
          <footer className="lk-foot lk-rise" style={delay(320)}>
            <Ornament />
            <p className={`${SERIF} lk-visit-title`}>Come and see us</p>
            <div className="lk-visit">
              {STORE_LINKS_PAGE.visit.map((row) => <p key={row}><Tappable text={row} /></p>)}
            </div>
          </footer>
        )}
      </div>
    </main>
  );
}

/** How many and where: "17 Google reviews", "138 reviews". */
const countLabel = (r: ReviewsSnapshot) => `${r.count.toLocaleString('en-US')} ${r.source === 'google' ? 'Google ' : ''}review${r.count === 1 ? '' : 's'}`;

/** The rating under the welcome: the first thing after the house's own words, and a way to read them all. */
function RatingBadge({ r }: { r: ReviewsSnapshot }) {
  return (
    <a href={r.readUrl} target="_blank" rel="noopener noreferrer" className="lk-rating"
       aria-label={`Rated ${ratingLabel(r.rating)} out of 5 from ${countLabel(r)}${r.source === 'judgeme' ? ' on our online shop' : ''}. Read them.`}>
      {r.source === 'google' && <Icon name="google" size={15} />}
      <span className={`${SERIF} lk-rating-n`}>{ratingLabel(r.rating)}</span>
      <Stars value={r.rating} />
      <span className="lk-rating-c">{countLabel(r)}</span>
    </a>
  );
}

/** Real reviews, as written, a phone's swipe wide. */
function Reviews({ r }: { r: ReviewsSnapshot }) {
  return (
    <section className="lk-sec lk-rise" style={delay(130)} aria-label="Reviews">
      <div className="lk-sechead">
        <h2 className="lk-label">What they say</h2>
        <a href={r.readUrl} target="_blank" rel="noopener noreferrer" className="lk-more">
          {/* Google lists every review; the shop has no page of them all, only its pieces' own. */}
          {r.source === 'google' ? `All ${r.count.toLocaleString('en-US')}` : 'More'} <Icon name="arrow" size={12} />
        </a>
      </div>
      <div className="lk-strip lk-quotes">
        {r.quotes.map((q) => (
          <figure key={`${q.author}-${q.text.slice(0, 24)}`} className="lk-quote">
            <Stars value={q.stars} size={11} />
            <blockquote className={`${SERIF} lk-qtext`}>{q.text}</blockquote>
            <figcaption className="lk-qby">
              {q.author}
              {q.about && <> · <a href={q.about.url} target="_blank" rel="noopener noreferrer">{q.about.name}</a></>}
            </figcaption>
          </figure>
        ))}
      </div>
      {r.writeUrl && (
        <a href={r.writeUrl} target="_blank" rel="noopener noreferrer" className="lk-write">
          <Icon name="star" size={14} /> Write a review
        </a>
      )}
    </section>
  );
}

/** Five stars filled to the rating (4.8 → the fifth four-fifths full), in the house's accent. */
function Stars({ value, size = 13 }: { value: number; size?: number }) {
  const fill = `${Math.max(0, Math.min(100, (value / 5) * 100))}%`;
  return (
    <span className="lk-stars" aria-hidden style={{ '--w': fill, fontSize: size } as React.CSSProperties}>
      <span className="lk-stars-on">★★★★★</span>★★★★★
    </span>
  );
}

/**
 * The newest pieces on the house's website. Its own boundary, so the links above and
 * below are in the first bytes and this arrives when the site answers — or not at all:
 * an unreachable site, or one slower than four seconds, leaves the section out rather
 * than hold the page.
 */
async function Showcase() {
  let pieces: Shown[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { getSitePieces } = await import('@/lib/website/site-pieces');
    const slow = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('slow')), 4000); });
    const { pieces: all } = await Promise.race([getSitePieces(), slow]);
    pieces = pickShowcase(all, 8).map(({ id, name, url, thumb, collection }) => ({ id, name, url, thumb, collection }));
  } catch {
    pieces = [];
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (pieces.length < 3) return null;

  return (
    <ShowcaseFrame>
      {pieces.map((p) => (
        <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="lk-piece">
          <span className="lk-shot">
            {/* eslint-disable-next-line @next/next/no-img-element -- the site's own thumbnail, already sized */}
            <img src={p.thumb} alt={p.name} width={272} height={272} loading="lazy" decoding="async" />
          </span>
          <span className="lk-name">{p.name}</span>
          {p.collection && <span className="lk-coll">{p.collection}</span>}
        </a>
      ))}
    </ShowcaseFrame>
  );
}

function ShowcaseFrame({ children }: { children: React.ReactNode }) {
  return (
    <section className="lk-sec lk-rise" style={delay(170)} aria-label="New pieces">
      <div className="lk-sechead">
        <h2 className="lk-label">Just in</h2>
        <a href={STORE_LINKS.website} target="_blank" rel="noopener noreferrer" className="lk-more">
          See all <Icon name="arrow" size={12} />
        </a>
      </div>
      <div className="lk-strip">{children}</div>
    </section>
  );
}

/** The strip's own shape while the site answers, so nothing below it moves when it does. */
function Skeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="lk-piece" aria-hidden>
          <span className="lk-shot lk-wait" />
          <span className="lk-name lk-wait-line" />
          <span className="lk-coll lk-wait-line lk-wait-short" />
        </span>
      ))}
    </>
  );
}

/** A hairline either side of a small diamond — the house's jewel, drawn in its accent. */
function Ornament() {
  return <span className="lk-orn" aria-hidden><i /></span>;
}

/** A visit line with its phone numbers made tappable. */
function Tappable({ text }: { text: string }) {
  const parts = text.split(/(\+?\d[\d\s-]{7,}\d)/g);
  return (
    <>
      {parts.map((part, i) => (i % 2
        ? <a key={i} href={`tel:${part.replace(/[^\d+]/g, '')}`}>{part}</a>
        : <React.Fragment key={i}>{part}</React.Fragment>))}
    </>
  );
}

/**
 * The marks, drawn rather than fetched: inline SVG is in the first paint, where an icon
 * font or sprite is a round-trip that can arrive late and shift the page under a thumb.
 * WhatsApp is filled because its glyph is only recognisable filled; the rest are
 * hairlines.
 */
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'shrink-0' } as const;
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

  switch (name) {
    case 'whatsapp':
      return (
        <svg {...common} fill="currentColor">
          <path d="M12.04 2A9.9 9.9 0 0 0 2.1 11.9a9.8 9.8 0 0 0 1.35 4.96L2 22l5.28-1.38a9.9 9.9 0 0 0 4.76 1.21h.01A9.9 9.9 0 0 0 22 11.94 9.9 9.9 0 0 0 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.05-.2-.31a8.2 8.2 0 0 1-1.26-4.38 8.24 8.24 0 1 1 8.25 8.25Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.12-1.05-.39-2-1.23a7.5 7.5 0 0 1-1.38-1.72c-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.41-.56-.42h-.47a.9.9 0 0 0-.66.31c-.22.25-.87.85-.87 2.07s.89 2.4 1.01 2.56c.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.1-.22-.17-.47-.29Z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg {...common} {...line}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common} {...line}>
          <path d="M13.5 3.5v11.25a3.75 3.75 0 1 1-3.75-3.75" />
          <path d="M13.5 3.5c.4 2.4 2.3 4.2 4.75 4.4" />
        </svg>
      );
    case 'bag':
      return (
        <svg {...common} {...line}>
          <path d="M5 8h14l-1 12.5H6L5 8Z" />
          <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...common} {...line}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 3.6 9A14 14 0 0 1 12 21a14 14 0 0 1-3.6-9A14 14 0 0 1 12 3Z" />
        </svg>
      );
    case 'google':
      // Google's G, in its own colours: the mark that says these are Google's reviews, not ours.
      return (
        <svg {...common}>
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.35Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.75-5.59-4.1H3.07v2.58A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.41 13.93a6 6 0 0 1 0-3.86V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.58Z" />
          <path fill="#EA4335" d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.58C7.2 7.73 9.4 5.98 12 5.98Z" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...common} {...line}>
          <path d="M7 17 17 7" />
          <path d="M8.5 7H17v8.5" />
        </svg>
      );
    default:
      return (
        <svg {...common} {...line}>
          <path d="m12 3.5 2.7 5.48 6.05.88-4.38 4.27 1.04 6.02L12 17.3l-5.41 2.85 1.04-6.02L3.25 9.86l6.05-.88L12 3.5Z" />
        </svg>
      );
  }
}

const CSS = `
  /* !important: globals.css paints <html> through .boot-light / .boot-dark, which
     outrank a bare html rule and know nothing about this page. */
  html, body { background-color: ${GROUND} !important; }

  .lk {
    min-height: 100vh; min-height: 100svh; padding: 0 20px 64px; color: #fff;
    background-color: ${GROUND};
    /* A warm light from above, as a piece in a case would have, and a trace of it at the foot. */
    background-image:
      radial-gradient(52rem 24rem at 50% -7rem, rgba(${ACC},.17), transparent 64%),
      radial-gradient(44rem 22rem at 50% 108%, rgba(${ACC},.07), transparent 62%);
    background-repeat: no-repeat;
    -webkit-font-smoothing: antialiased;
  }
  .lk-col { margin: 0 auto; max-width: 27rem; }
  @media (min-width: 640px) { .lk-col { max-width: 32rem; } }

  .lk-head { padding-top: 60px; text-align: center; }
  .lk-tag { margin-top: 18px; font-size: 10px; letter-spacing: .32em; text-transform: uppercase; color: ${ACCENT}; }
  .lk-orn { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 20px auto 0; }
  .lk-orn::before, .lk-orn::after { content: ''; width: 44px; height: 1px; background: linear-gradient(to right, transparent, rgba(${ACC},.6)); }
  .lk-orn::after { transform: scaleX(-1); }
  .lk-orn i { width: 5px; height: 5px; transform: rotate(45deg); border: 1px solid rgba(${ACC},.85); }
  .lk-welcome { margin: 18px auto 0; max-width: 21rem; font-size: 14px; line-height: 1.65; font-weight: 300; color: rgba(255,255,255,.68); }

  /* The rating, right under the welcome: a quiet pill, the figure in the house's serif. */
  .lk-rating {
    display: inline-flex; align-items: center; gap: 9px; margin-top: 20px; padding: 8px 15px 8px 13px;
    border-radius: 999px; border: 1px solid rgba(${ACC},.32); background: rgba(${ACC},.07);
    transition: border-color .3s ease, background-color .3s ease;
  }
  .lk-rating:hover { border-color: rgba(${ACC},.65); background: rgba(${ACC},.11); }
  .lk-rating-n { font-size: 19px; line-height: 1; color: #fff; }
  .lk-rating-c { font-size: 12px; color: rgba(255,255,255,.72); }
  .lk-stars { position: relative; display: inline-block; line-height: 1; letter-spacing: .12em; color: rgba(255,255,255,.2); white-space: nowrap; }
  .lk-stars-on { position: absolute; inset: 0 auto 0 0; width: var(--w); overflow: hidden; color: ${ACCENT}; }

  /* Reviews: a card each, swiped on a phone, the next one peeking in. */
  .lk-strip.lk-quotes { scroll-padding-left: 20px; }
  .lk-quote {
    flex: 0 0 82%; scroll-snap-align: start; margin: 0; padding: 18px 18px 16px; border-radius: 18px;
    display: flex; flex-direction: column; gap: 10px;
    border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.03);
  }
  @media (min-width: 640px) {
    .lk-strip.lk-quotes { display: flex; overflow-x: auto; margin: 0 -20px; padding: 0 20px 2px; }
    .lk-quote { flex-basis: 300px; }
  }
  .lk-qtext { margin: 0; flex: 1; font-size: 16px; line-height: 1.5; font-style: italic; color: rgba(255,255,255,.92); }
  .lk-qtext::before { content: '“'; color: ${ACCENT}; margin-right: 1px; }
  .lk-qtext::after { content: '”'; color: ${ACCENT}; margin-left: 1px; }
  .lk-qby { font-size: 11.5px; letter-spacing: .04em; color: rgba(255,255,255,.62); }
  .lk-qby a { color: ${ACCENT}; }
  .lk-write {
    margin-top: 14px; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px;
    border-radius: 999px; border: 1px solid rgba(${ACC},.45); color: ${ACCENT};
    font-size: 11px; font-weight: 500; letter-spacing: .18em; text-transform: uppercase;
    transition: border-color .3s ease, background-color .3s ease;
  }
  .lk-write:hover { border-color: rgba(${ACC},.8); background: rgba(${ACC},.08); }

  /* The one card that asks for something, and the one filled control on the page. */
  .lk-feat {
    display: block; margin-top: 36px; padding: 20px 20px 18px; border-radius: 22px;
    border: 1px solid rgba(${ACC},.4);
    background: linear-gradient(155deg, rgba(${ACC},.15), rgba(${ACC},.04) 55%, rgba(255,255,255,.015));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 24px 60px -34px rgba(${ACC},.55);
    transition: border-color .3s ease, box-shadow .3s ease;
  }
  .lk-feat:hover { border-color: rgba(${ACC},.75); box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 28px 70px -30px rgba(${ACC},.7); }
  .lk-pill { display: inline-flex; align-items: center; gap: 7px; font-size: 9.5px; letter-spacing: .22em; text-transform: uppercase; color: ${ACCENT}; }
  .lk-lead { font-size: 32px; line-height: 1.05; color: #fff; }
  .lk-tail { font-size: 9px; letter-spacing: .22em; text-transform: uppercase; color: rgba(255,255,255,.58); }
  .lk-line { display: block; margin-top: 8px; font-size: 13px; line-height: 1.55; font-weight: 300; color: rgba(255,255,255,.7); }
  .lk-cta {
    margin-top: 18px; height: 46px; display: flex; align-items: center; justify-content: center; gap: 8px;
    border-radius: 999px; background: ${ACCENT}; color: ${GROUND};
    font-size: 11px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase;
    transition: filter .3s ease;
  }
  .lk-feat:hover .lk-cta { filter: brightness(1.07); }

  .lk-sec { margin-top: 44px; }
  .lk-sechead { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
  .lk-label { font-size: 10px; letter-spacing: .26em; text-transform: uppercase; color: rgba(255,255,255,.58); font-weight: 400; }
  .lk-more { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: ${ACCENT}; }

  /* A phone swipes through the pieces, edge to edge; a wider screen sees them all. */
  .lk-strip {
    display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;
    margin: 0 -20px; padding: 0 20px 2px; -webkit-overflow-scrolling: touch;
  }
  .lk-strip::-webkit-scrollbar { display: none; }
  .lk-piece { flex: 0 0 138px; scroll-snap-align: start; scroll-margin-left: 20px; display: block; }
  @media (min-width: 640px) {
    .lk-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: visible; margin: 0; padding: 0; gap: 14px; }
  }
  .lk-shot {
    display: block; aspect-ratio: 1; overflow: hidden; border-radius: 14px;
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08);
  }
  .lk-shot img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .7s cubic-bezier(.2,.7,.2,1); }
  .lk-piece:hover .lk-shot img { transform: scale(1.045); }
  .lk-name {
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    margin-top: 9px; font-size: 12.5px; line-height: 1.35; color: rgba(255,255,255,.9);
  }
  .lk-coll { display: block; margin-top: 3px; font-size: 9px; letter-spacing: .18em; text-transform: uppercase; color: rgba(255,255,255,.52); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lk-wait { animation: lk-wait 1.6s ease-in-out infinite; }
  .lk-wait-line { height: 10px; width: 80%; border-radius: 4px; background: rgba(255,255,255,.06); animation: lk-wait 1.6s ease-in-out infinite; }
  .lk-wait-short { width: 45%; height: 7px; margin-top: 7px; }
  @keyframes lk-wait { 50% { opacity: .55; } }

  /* One list, hairlines between: the rows are one kind of thing, so they read as one group. */
  .lk-list { border-radius: 20px; border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.025); overflow: hidden; }
  .lk-list > li + li { border-top: 1px solid rgba(255,255,255,.07); }
  .lk-row { display: flex; align-items: center; gap: 14px; min-height: 68px; padding: 13px 16px; transition: background-color .25s ease; }
  .lk-row:hover { background-color: rgba(255,255,255,.035); }
  .lk-ico { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 999px; background: rgba(${ACC},.11); color: ${ACCENT}; }
  .lk-lbl { display: block; font-size: 15.5px; line-height: 1.25; color: #fff; }
  .lk-sub { display: block; margin-top: 3px; font-size: 12.5px; line-height: 1.4; font-weight: 300; color: rgba(255,255,255,.6); }
  .lk-go { flex: none; color: rgba(255,255,255,.5); transition: color .25s ease, transform .25s ease; }
  .lk-row:hover .lk-go { color: ${ACCENT}; transform: translate(2px, -2px); }

  .lk-foot { margin-top: 52px; text-align: center; }
  .lk-visit-title { margin-top: 22px; font-size: 22px; font-style: italic; color: rgba(255,255,255,.94); }
  .lk-visit { margin-top: 10px; font-size: 13px; line-height: 1.85; font-weight: 300; color: rgba(255,255,255,.66); }
  .lk-visit a { color: #fff; text-decoration: underline; text-decoration-color: rgba(${ACC},.55); text-underline-offset: 3px; }

  .lk a:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 3px; }

  @keyframes lk-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .lk-rise { animation: lk-rise .7s cubic-bezier(.2,.7,.2,1) both; animation-delay: var(--d, 0ms); }
  @media (prefers-reduced-motion: reduce) {
    .lk-rise, .lk-wait, .lk-wait-line { animation: none; }
    .lk *, .lk *::before, .lk *::after { transition: none !important; }
  }
`;
