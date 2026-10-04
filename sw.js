// Service Worker for Anru Music Studio Pro v22.1 (100% Offline Audiophile Master Edition)
const CACHE_NAME = 'anru-music-v22-1-clean-offline';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css?v=22.1',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/views.css',
  './css/player.css',
  './css/vector_icons.css',
  './id3.js?v=22.1',
  './db.js?v=22.1',
  './player.js?v=22.1',
  './app.js?v=22.1',
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
  // Navigation requests: NETWORK FIRST with robust offline fallback
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => {
        return caches.match('./index.html').then((cached) => {
          return cached || caches.match('/') || fetch(event.request);
        });
      })
    );
    return;
  }

  // Assets: Cache First with network background update
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
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
