// Remix Nexus service worker
// Pages and files are fetched live first, so website updates show in the app automatically.
// If there is no internet (or the server is slow to wake up), the last saved copy is shown instead.

const CACHE_NAME = "remix-nexus-v1";
const NETWORK_TIMEOUT = 4000; // milliseconds to wait before falling back to the saved copy

// Saved when the service worker installs. Add more page paths here if you want them ready offline.
const PRECACHE = ["/", "/offline.html", "/manifest.json"];


self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
    )
  );

  self.skipWaiting();
});


self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );

  self.clients.claim();
});


self.addEventListener("fetch", (e) => {
  const request = e.request;
  const url = new URL(request.url);

  // Only handle normal page and file requests from your own website.
  // Chat, login, calls, uploads and other live data always go straight to the network.
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/socket.io/")) return;

  e.respondWith(networkFirst(request));
});


async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  // Start the live request. When it finishes, keep a fresh copy for offline use.
  const live = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  });

  try {
    // Wait for the live response, but not forever (Render can be slow to wake up).
    return await withTimeout(live, NETWORK_TIMEOUT);
  } catch (error) {
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;

    // Nothing saved for this exact request: if it is a page, wait for the live request or show the offline page.
    if (request.mode === "navigate") {
      try {
        return await live;
      } catch (err) {
        return (await cache.match("/offline.html")) || Response.error();
      }
    }

    return Response.error();
  }
}


function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}
