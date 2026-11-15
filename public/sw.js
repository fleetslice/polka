/* ПОЛКА. — service worker: оболочка приложения доступна офлайн. Книги и заметки лежат в IndexedDB и сети не требуют. */
const CACHE = 'polka-v1';
// Сайт может жить в подпапке (GitHub Pages: /polka) — префикс берём из области действия воркера.
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const SHELL = ['/', '/reader', '/notes', '/book', '/cloud', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/pdf.worker.min.mjs'].map((p) => BASE + p);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(BASE + '/api/')) return;

  // Статика со хешем в имени неизменна: сначала кеш.
  if (url.pathname.startsWith(BASE + '/_next/static/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // Страницы и остальное: сеть, при неудаче — кеш (для навигации без учёта параметров ?id=).
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        const key = req.mode === 'navigate' ? url.pathname : req;
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    }).catch(async () => {
      const hit = (await caches.match(req)) || (req.mode === 'navigate' ? (await caches.match(url.pathname)) || (await caches.match(BASE + '/')) : undefined);
      return hit || new Response('Нет сети', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }),
  );
});
