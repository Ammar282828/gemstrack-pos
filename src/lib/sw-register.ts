/**
 * Registers the service worker (public/sw.js, described at the top of that file) once the page has settled.
 *
 * Production only (a worker in `next dev` serves stale code and is a worse bug than a slow start), never inside
 * the iPhone app's web view, and never on the customer's pages (the caller skips them). `NEXT_PUBLIC_DISABLE_SW=1`
 * is the off switch: instead of registering, every worker this origin has is unregistered and the caches the
 * worker made are cleared. Every step is best effort: a browser without workers, or one that refuses, loses nothing.
 */
import { whenIdle } from '@/lib/idle';
import { inNativeApp } from '@/lib/native-app';

export function registerServiceWorker(): () => void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;

  if (process.env.NEXT_PUBLIC_DISABLE_SW === '1') {
    navigator.serviceWorker.getRegistrations()
      .then(rs => Promise.all(rs.map(r => r.unregister())))
      .then(() => caches.keys())
      .then(names => Promise.all(names.filter(n => n.startsWith('erp-sw-')).map(n => caches.delete(n))))
      .catch(() => undefined);
    return () => undefined;
  }

  if (process.env.NODE_ENV !== 'production' || inNativeApp()) return () => undefined;

  const register = () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined); };
  // After `load`, in an idle moment: the worker's first install must never compete with the page's own start.
  let cancel: () => void = () => undefined;
  if (document.readyState === 'complete') cancel = whenIdle(register, 5000);
  else {
    const onLoad = () => { cancel = whenIdle(register, 5000); };
    window.addEventListener('load', onLoad, { once: true });
    return () => { window.removeEventListener('load', onLoad); cancel(); };
  }
  return () => cancel();
}
