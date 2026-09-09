/**
 * links.taheri.shop serves the link page at its root.
 *
 * The same App Hosting backend answers on both hostnames, so without this the page
 * would only exist at links.taheri.shop/links — and a customer who types the domain
 * off a receipt, or whose scanner strips the path, lands on the POS sign-in instead
 * of the shop's links.
 *
 * A rewrite rather than a redirect: the address bar keeps saying links.taheri.shop,
 * which is the whole reason for having the subdomain.
 */

import { NextResponse, type NextRequest } from 'next/server';

const LINKS_HOSTS = new Set(['links.taheri.shop', 'www.links.taheri.shop']);

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();
  if (!LINKS_HOSTS.has(host)) return NextResponse.next();

  // Everything on this hostname is the link page. Nothing else there is meant for
  // customers, and the POS should not be reachable by a second name.
  const url = req.nextUrl.clone();
  if (url.pathname === '/links' || url.pathname.startsWith('/_next') || url.pathname.startsWith('/api')) {
    return NextResponse.next();
  }
  url.pathname = '/links';
  return NextResponse.rewrite(url);
}

export const config = {
  // Static assets and images are excluded so the wordmark still loads on the page.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
