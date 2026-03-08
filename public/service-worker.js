// Kill-switch service worker: clears all stale Workbox/Firebase caches from previous builds.
// Old versions cached HTML containing Firebase Hosting SDK injection which caused
// /__/firebase/ 404 errors. This SW clears those caches and unregisters itself.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', async () => {
  // Delete all old Workbox caches (start-url, pages, next-static-js-assets, etc.)
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  // Unregister this service worker so the browser goes back to normal network requests
  await self.registration.unregister();
  // Reload all open tabs to get fresh uncached HTML
  const allClients = await self.clients.matchAll({ includeUncontrolled: true });
  allClients.forEach(c => c.navigate(c.url));
});
