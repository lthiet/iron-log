const CACHE = 'iron-log-v6';
const ASSETS = ['/iron-log/', '/iron-log/index.html', '/iron-log/iron-log.html', '/iron-log/manifest.json', '/iron-log/icon.svg', '/iron-log/app.css', '/iron-log/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network-first: always try to get fresh code, fall back to cache offline
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
