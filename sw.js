// Service Worker for Anru Music & PLAYit 4K HDR Video Studio Pro v27.0 (100% Offline & Zero-Copy)
const CACHE_NAME = 'anru-studio-v27.0-music-video-master';
const STATIC_ASSETS = [
  './',
  './index.html',
  './video.html',
  './style.css?v=27.0',
  './video.css?v=27.0',
  './id3.js?v=27.0',
  './db.js?v=27.0',
  './player.js?v=27.0',
  './app.js?v=27.0',
  './video.js?v=27.0',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './icons/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
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
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => {
        const reqUrl = event.request.url || '';
        if (reqUrl.includes('video.html')) {
          return caches.match('./video.html', { ignoreSearch: true });
        }
        return caches.match('./index.html', { ignoreSearch: true }).then((cached) => {
          return cached || caches.match('./') || fetch(event.request);
        });
      })
    );
    return;
  }

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
