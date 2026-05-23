const CACHE = 'minnow-v7';

/** Shell files precached on install for offline fallback only (not served stale when online). */
const SHELL = ['./index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

/** LM Studio runs on localhost; never intercept those requests. */
function isLocalApi(url) {
  return url.includes('localhost') || url.includes('127.0.0.1');
}

/** Resolve shell cache key for index.html or manifest.json requests. */
function shellCacheKey(url) {
  try {
    const path = new URL(url, self.location.href).pathname;
    if (path.endsWith('/manifest.json') || path.endsWith('manifest.json')) {
      return './manifest.json';
    }
    if (path.endsWith('/index.html') || path.endsWith('index.html')) {
      return './index.html';
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Network-first for shell assets: always try the network when online so deploys
 * pick up fresh index.html; update cache on success; use precache only offline.
 */
function networkFirstShell(request, cacheKey) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
      }
      return response;
    })
    .catch(() =>
      caches.match(cacheKey).then((cached) => cached || caches.match(cacheKey.replace('./', '')))
    );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (isLocalApi(request.url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request, './index.html'));
    return;
  }

  const cacheKey = shellCacheKey(request.url);
  if (cacheKey) {
    event.respondWith(networkFirstShell(request, cacheKey));
  }
});
