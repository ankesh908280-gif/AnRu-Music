// Service Worker for Anru Music Studio Pro v10 Live
const CACHE_NAME = 'anru-music-v10.1-live';
const STATIC_SHELL = [
  './',
  './index.html',
  './style.css?v=10.1',
  './catalog.js?v=10.1',
  './db.js?v=10.1',
  './api.js?v=10.1',
  './player.js?v=10.1',
  './auth.js?v=10.1',
  './app.js?v=10.1',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Anru SW] Pre-caching v10 app shell');
      return cache.addAll(STATIC_SHELL).catch(err => console.warn('Cache addAll notice:', err));
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
  const reqUrl = new URL(event.request.url);

  // Bypass cache for audio streams & external API endpoints
  if (
    reqUrl.origin !== self.location.origin ||
    event.request.destination === 'audio' ||
    reqUrl.pathname.includes('/api/') ||
    reqUrl.pathname.includes('soundhelix')
  ) {
    return;
  }

  // Network-First strategy: Always fetch newest updates immediately, fallback to cache if offline
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
