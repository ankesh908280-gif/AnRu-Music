// Service Worker for Anru Music Studio Pro v20.0 (Offline + Online Streaming)
const CACHE_NAME = 'anru-music-v20-offline-online';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/views.css',
  './css/player.css',
  './css/online.css',
  './id3.js?v=20.0',
  './db.js?v=20.0',
  './player.js?v=20.0',
  './online_music.js?v=20.0',
  './app.js?v=20.0',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Anru SW] Pre-caching v20 app shell');
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
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass online audio streaming requests directly to network
  if (event.request.url.includes('saavn') || event.request.url.includes('itunes') || event.request.url.includes('audius') || event.request.url.includes('audio-ssl')) {
    return;
  }

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
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
