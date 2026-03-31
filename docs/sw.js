const CACHE = 'temp-1092f2d';const STATIC = [
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

const DYNAMIC = [
  './index.html',
  './temperaments.md',
  './'
];

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(
        [...STATIC, ...DYNAMIC].map(async url => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (res.ok) await c.put(req, res);
          } catch (err) {
            console.warn('[SW] Failed to cache:', url, err);
          }
        })
      )
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // version.json: nunca cachear, siempre red — es el mecanismo de detección de actualizaciones
  if (url.includes('version.json')) {
    e.respondWith(fetch(new Request(url, { cache: 'no-cache' }))
      .catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  if (STATIC.some(s => url.includes(s.replace('./', '')))) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // HTML y MD: network-first con cache:'no-cache'
  e.respondWith(
    fetch(new Request(e.request, { cache: 'no-cache' }))
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
  );
});
