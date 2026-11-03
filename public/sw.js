/*
 * The ERP's service worker (2026-11-03). Conservative on purpose: it makes a launch from the home screen paint
 * from the device instead of the network, and nothing else. Documented in docs/performance.md ("Service worker").
 *
 * WHAT IT DOES
 *   /_next/static/*        cache-first. Content-hashed and immutable, so a cached copy is never wrong.
 *   fonts, icons, brand,   stale-while-revalidate (answer from the cache, refresh it behind the scenes).
 *   root pictures, manifest
 *   every page             (the home-screen launch `/?source=pwa` included) network-first. If the network is silent for 3 s, or fails, the last good copy of that exact
 *                          URL (kept only if one was seen), else the offline page.
 *
 * WHAT IT NEVER TOUCHES (it does not call respondWith, so the browser does exactly what it would have done)
 *   - anything that is not a GET (every save), /api/* (every read and write of data, sign-in tokens, uploads),
 *     /__/* (Firebase's sign-in handler), other origins (Firestore, Google, Meta, Shopify), range requests,
 *     Next's own data requests (RSC, prefetch, /_next/image), /sw.js itself.
 *   - the customer's pages (/view-invoice, /links) and any address carrying a token, key, code or secret.
 *   Nothing in a cached page is the shop's data: pages are client-rendered and fetch their data after they load
 *   (Firestore, from its own IndexedDB cache). Responses that are redirects, errors or not HTML are never kept.
 *
 * TURNING IT OFF: set NEXT_PUBLIC_DISABLE_SW=1 (the page then unregisters it and clears its caches on the next
 * visit), or ship a /sw.js whose activate step calls registration.unregister(). Changing VERSION below drops every
 * cache it made. public/service-worker.js is the older kill-switch for the previous worker and stays as it is.
 */

const VERSION = 'erp-sw-v1';
const STATIC = VERSION + '-static';
const ASSETS = VERSION + '-assets';
const PAGES = VERSION + '-pages';
const OFFLINE_URL = '/~offline';

const KEEP = { [STATIC]: 600, [ASSETS]: 120, [PAGES]: 30 };
const NETWORK_WAIT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const pages = await caches.open(PAGES);
      await pages.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    } catch (e) { /* the offline page is a courtesy; the worker works without it */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC, ASSETS, PAGES]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const SENSITIVE = /[?&](?:[^=&]*(?:token|key|code|secret|auth|sig)[^=&]*)=/i;

function isHashedAsset(p) { return p.startsWith('/_next/static/'); }
function isPlainAsset(p) {
  return p.startsWith('/fonts/') || p.startsWith('/icons/') || p.startsWith('/brand/') ||
    p === '/manifest.webmanifest' || /^\/[^/]+\.(?:png|jpe?g|svg|ico|woff2)$/i.test(p);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/api/') || p.startsWith('/__/') || p === '/sw.js' || p === '/service-worker.js' || p.startsWith('/_next/image')) return;
  if (p.startsWith('/view-invoice') || p.startsWith('/links') || SENSITIVE.test(url.search)) return;
  // Next's own client-side navigation and prefetch requests ask for a data payload, not a page.
  if (url.searchParams.has('_rsc') || req.headers.get('RSC') || req.headers.get('Next-Router-State-Tree') || req.headers.get('Next-Router-Prefetch')) return;

  if (isHashedAsset(p)) { event.respondWith(cacheFirst(event, req, STATIC)); return; }
  if (isPlainAsset(p)) { event.respondWith(staleWhileRevalidate(event, req, ASSETS)); return; }
  if (req.mode === 'navigate') {
    // Every page, the home-screen launch included, is network-first: a kept shell names /_next/static chunks by hash,
    // and after a deploy those hashes are gone, so a shell served from the cache while online would open broken once
    // (the fate of the previous worker, see /service-worker.js). The hashed chunks are cached, so a fresh shell is
    // still a quick launch; the kept copy is for when the line is gone.
    event.respondWith(networkFirstPage(event, req));
  }
});

/** Worth keeping: a plain 200 that is not a redirect. */
const keepable = (res) => res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected;
const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');

async function prune(name) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    const over = keys.length - KEEP[name];
    // keys() is in insertion order: the oldest go first.
    for (let i = 0; i < over; i++) await cache.delete(keys[i]);
  } catch (e) { /* housekeeping only */ }
}

let puts = 0;
async function put(name, req, res) {
  try {
    const cache = await caches.open(name);
    await cache.put(req, res);
    if (++puts % 20 === 0) await prune(name);
  } catch (e) { /* storage full or blocked: the response was already served */ }
}

async function cacheFirst(event, req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (keepable(res)) event.waitUntil(put(name, req, res.clone()));
  return res;
}

async function staleWhileRevalidate(event, req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (keepable(res)) return put(name, req, res.clone()).then(() => res);
    return res;
  }).catch(() => undefined);
  if (hit) { event.waitUntil(refresh); return hit; }
  return (await refresh) || Response.error();
}

async function networkFirstPage(event, req) {
  const cache = await caches.open(PAGES);
  const network = fetch(req).then((res) => {
    if (keepable(res) && isHtml(res)) event.waitUntil(put(PAGES, req, res.clone()));
    return res;
  });
  const cached = await cache.match(req);
  if (!cached) {
    try { return await network; } catch (e) { return offline(); }
  }
  // A copy exists: the network gets 3 s, then the copy is shown while the network carries on and refreshes it.
  const late = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_WAIT_MS));
  try { return await Promise.race([network.catch(() => cached), late]); } catch (e) { return cached; }
}

async function offline() {
  try {
    const cache = await caches.open(PAGES);
    const page = await cache.match(OFFLINE_URL);
    if (page) return page;
  } catch (e) { /* fall through */ }
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font:16px system-ui;padding:2rem"><h1>You are offline</h1><p>Reconnect and reload.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
