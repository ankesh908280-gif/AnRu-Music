// Service Worker for Anru Music Studio Pro v22.0 (100% Offline Audiophile Master Edition)
const CACHE_NAME = 'anru-music-v22-clean-offline';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css?v=22.0',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/views.css',
  './css/player.css',
  './css/vector_icons.css',
  './id3.js?v=22.0',
  './db.js?v=22.0',
  './player.js?v=22.0',
  './app.js?v=22.0',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Anru SW] Pre-caching v22 pure offline studio shell');
      return cache.addAll(STATIC_ASSETS).catch(err => console.warn('Cache error:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Anru SW] Purging old cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Navigation requests: NETWORK FIRST so updates are immediately loaded
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => {
        return caches.match('./index.html') || caches.match('/');
      })
    );
    return;
  }

  // Assets: Cache First with network background update
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch((err) => {
        console.warn('Fetch error:', err);
      });
    })
  );
});
