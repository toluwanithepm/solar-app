// Service worker: lets the app open with no connection (NFR-1).
// Same-origin GET requests only; data and files on Supabase are handled by the app's own offline queue.
const CACHE = 'solar-app-shell-v3';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page lists the scripts and styles it loaded before this worker took control, so the very first visit
// is enough to open offline afterwards.
self.addEventListener('message', (event) => {
  const urls = event.data && event.data.type === 'cache-urls' ? event.data.urls : null;
  if (!Array.isArray(urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(
        urls
          .filter((u) => typeof u === 'string' && new URL(u, self.location.origin).origin === self.location.origin)
          .map((u) => c.match(u).then((hit) => hit || c.add(u).catch(() => undefined))),
      ),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: try the network for the latest app, fall back to the saved shell (the app handles its own routes)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html', { ignoreVary: true })),
    );
    return;
  }

  // Scripts, styles and images are fingerprinted by the build: serve the saved copy, fetch and save if new
  event.respondWith(
    // ignoreVary: files saved by address on the first visit must match the page's own requests for them
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
