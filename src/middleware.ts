/**
 * links.taheri.shop serves the link page, and nothing else.
 *
 * The same App Hosting backend answers on both hostnames, so without this the page
 * would only exist at links.taheri.shop/links — and a customer who types the domain
 * off a receipt, or whose scanner strips the path, lands on the POS instead of the
 * shop's links.
 *
 * A REDIRECT, not a rewrite. A rewrite was the obvious choice — it keeps the bare
 * domain in the address bar — and it does not work here. The rewrite produces correct
 * HTML for /links, then the App Router hydrates from the URL the browser actually has,
 * which is still "/", decides it is on the dashboard route, and replaces the page with
 * the POS. The markup served was right and the screen was wrong: x-taheri-links read 1
 * on exactly the responses that looked broken, which is what finally gave it away.
 * Redirecting costs one hop and a visible /links in the bar, and survives hydration.
 *
 * ON READING THE HOSTNAME: App Hosting puts a proxy in front of Cloud Run, and by the
 * time the request reaches here `host` can be the backend's own address rather than the
 * one the customer typed — which is why the first version of this file passed every
 * request straight through to the POS. The name the customer used survives in
 * `x-forwarded-host`, so all three sources are checked and any of them matching counts.
 * The header is spoofable, but the worst a forged one does is show a stranger the
 * public link page, which is public.
 *
 * There is no passcode here. One was built and removed at Ammar's request: the POS is
 * open, as it has been since sign-in was turned off. See firestore.rules.
 */

import { NextResponse, type NextRequest } from 'next/server';

const LINKS_HOSTS = new Set(['links.taheri.shop', 'www.links.taheri.shop']);

const bare = (v: string | null | undefined) =>
  (v || '').split(',')[0].trim().split(':')[0].toLowerCase();

export function middleware(req: NextRequest) {
  const candidates = [
    bare(req.headers.get('x-forwarded-host')),
    bare(req.headers.get('host')),
    bare(req.nextUrl.hostname),
  ];
  const isLinks = candidates.some((h) => LINKS_HOSTS.has(h));
  const url = req.nextUrl.clone();

  const res = (() => {
    if (!isLinks) return NextResponse.next();

    // /api is NOT let through on this hostname. The link page is a list of addresses
    // out of STORE_CONFIG and calls nothing, so allowing the routes only widened what
    // a customer-facing name could reach.
    if (url.pathname === '/links' || url.pathname.startsWith('/_next')) {
      return NextResponse.next();
    }
    url.pathname = '/links';
    url.search = '';
    return NextResponse.redirect(url, 307);
  })();

  // So this is checkable from a terminal instead of inferred from what rendered.
  res.headers.set('x-taheri-host', candidates.filter(Boolean).join('|') || 'none');
  res.headers.set('x-taheri-links', isLinks ? '1' : '0');
  return res;
}

export const config = {
  // Static assets and images are excluded so the wordmark still loads on the page.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
