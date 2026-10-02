// Service Worker for Anru Music Studio Pro v13 Live
const CACHE_NAME = 'anru-music-v14-live';
const STATIC_SHELL = [
  './',
  './index.html',
  './base.css?v=14.0',
  './auth.css?v=14.0',
  './home.css?v=14.0',
  './search.css?v=14.0',
  './player.css?v=14.0',
  './profile.css?v=14.0',
  './style.css?v=14.0',
  './catalog.js?v=14.0',
  './db.js?v=14.0',
  './api.js?v=14.0',
  './player.js?v=14.0',
  './auth.js?v=14.0',
  './app.js?v=14.0',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Anru SW] Pre-caching v13 app shell');
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
