
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Just pass everything through to the network live —
  // no offline caching, so your data/chat/login always stay fresh.
  e.respondWith(fetch(e.request));
});
