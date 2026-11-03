// BENA — Service Worker v5 : réseau d'abord, cache en secours (hors API)
const CACHE = 'bena-v9';
const STATIC = ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(event.request, copy)); return res; })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
