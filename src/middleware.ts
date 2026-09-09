/**
 * Two jobs, in order: keep the link page and the POS on separate hostnames, and keep
 * the POS behind the counter passcode.
 *
 * links.taheri.shop serves the link page at its root. The same App Hosting backend
 * answers on both hostnames, so without this the page would only exist at
 * links.taheri.shop/links — and a customer who types the domain off a receipt, or whose
 * scanner strips the path, lands on the POS instead of the shop's links.
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
 */

import { NextResponse, type NextRequest } from 'next/server';
import { PASSCODE, UNLOCK_COOKIE, unlockToken } from '@/lib/unlock';

const LINKS_HOSTS = new Set(['links.taheri.shop', 'www.links.taheri.shop']);

const bare = (v: string | null | undefined) =>
  (v || '').split(',')[0].trim().split(':')[0].toLowerCase();

/**
 * Left open deliberately.
 *
 * /links is the page the QR on every invoice prints, and it is meant for customers —
 * asking one of them for the counter passcode would be absurd. It carries nothing out
 * of the book. While links.taheri.shop is unpointed that QR resolves here, by path, so
 * this exemption is load-bearing rather than tidy.
 *
 * /view-invoice/<id> is what a customer opens from the WhatsApp link to see their own
 * bill, and /my-work is the karigar portal, which has its own sign-in — a karigar is
 * not counter staff and is never given the counter code. /~offline is the PWA's
 * fallback and has to render precisely when nothing else can.
 *
 * The API routes carry their own auth — a cron secret, an owner token, the karigar's
 * own link — and gating them on a browser cookie would break the scheduler and the
 * karigar pages, which have no browser to carry one.
 */
const UNGATED = ['/unlock', '/links', '/view-invoice', '/my-work', '/~offline', '/api', '/_next'];

export async function middleware(req: NextRequest) {
  const candidates = [
    bare(req.headers.get('x-forwarded-host')),
    bare(req.headers.get('host')),
    bare(req.nextUrl.hostname),
  ];
  const isLinks = candidates.some((h) => LINKS_HOSTS.has(h));
  const url = req.nextUrl.clone();

  const res = await (async () => {
    if (isLinks) {
      // Everything on this hostname is the link page. Nothing else there is meant for
      // customers, and the POS must not be reachable by a second name.
      if (url.pathname === '/links' || url.pathname.startsWith('/_next') || url.pathname.startsWith('/api')) {
        return NextResponse.next();
      }
      url.pathname = '/links';
      url.search = '';
      return NextResponse.redirect(url, 307);
    }

    if (UNGATED.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'))) {
      return NextResponse.next();
    }

    if (req.cookies.get(UNLOCK_COOKIE)?.value === await unlockToken(PASSCODE)) {
      return NextResponse.next();
    }

    // Rewrite, not redirect: the address the shop typed stays in the bar, so unlocking
    // lands them on the screen they asked for instead of the home page.
    const to = req.nextUrl.clone();
    to.pathname = '/unlock';
    to.searchParams.set('next', url.pathname + url.search);
    return NextResponse.rewrite(to);
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
