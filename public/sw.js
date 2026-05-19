const CACHE = 'speedchat-v5';

/** Shell files precached on install (relative to SW scope for base './'). */
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

/** index.html and manifest.json use cache-first; Vite hashed assets stay network-only. */
function isShellRequest(url) {
  try {
    const path = new URL(url, self.location.href).pathname;
    return (
      path.endsWith('/index.html') ||
      path.endsWith('index.html') ||
      path.endsWith('/manifest.json') ||
      path.endsWith('manifest.json')
    );
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (isLocalApi(request.url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() =>
          caches.match('./index.html').then((cached) => cached || caches.match('index.html'))
        )
    );
    return;
  }

  if (isShellRequest(request.url)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
