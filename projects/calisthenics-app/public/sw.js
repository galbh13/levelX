// Minimal service worker — exists to satisfy PWA installability criteria.
// Deliberately does NOT cache app code: a stale cache would lock users onto an
// old build with no easy way to update. Network passthrough only.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  // Pass through to the network. (Handler presence is what makes the app installable.)
  e.respondWith(fetch(e.request));
});
