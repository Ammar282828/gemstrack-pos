import type { MetadataRoute } from 'next';
import { STORE_ICONS, STORE_THEME_COLOR } from '@/lib/store-config';
import { POS_LABEL } from '@/lib/notify-label';

/**
 * The installed app (home screen, desktop install), per house: its name ("Taheri ERP",
 * "House of Mina ERP"), its icons and colours. Served at /manifest.webmanifest, which Next links
 * from every page. Replaces public/manifest.json, which no page linked, said "Taheri ERP" for both
 * houses, and pointed at icons that did not exist.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: POS_LABEL,
    short_name: STORE_ICONS.short,
    description: `${POS_LABEL} — sales, orders, workshop and books.`,
    // The identity stays "/" (it was the start_url, so installed copies keep theirs); the launch address carries
    // ?source=pwa, which the service worker (public/sw.js) answers from the device before the network does.
    id: '/',
    start_url: '/?source=pwa',
    scope: '/',
    lang: 'en',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    categories: ['business', 'finance', 'productivity'],
    background_color: STORE_ICONS.ground,
    theme_color: STORE_THEME_COLOR,
    // Long-press on the home-screen icon (Android, desktop): the two things done most.
    shortcuts: [
      { name: 'New sale', short_name: 'New sale', url: '/invoices/new', icons: [{ src: `${STORE_ICONS.dir}/icon-192.png`, sizes: '192x192', type: 'image/png' }] },
      { name: 'Orders', short_name: 'Orders', url: '/orders', icons: [{ src: `${STORE_ICONS.dir}/icon-192.png`, sizes: '192x192', type: 'image/png' }] },
    ],
    icons: [
      { src: `${STORE_ICONS.dir}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${STORE_ICONS.dir}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${STORE_ICONS.dir}/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
