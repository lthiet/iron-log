// Unregister old caches on activate
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Always network, no caching
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request));
});
