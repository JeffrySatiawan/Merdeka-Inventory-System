// Merdeka Inventory System - Service Worker
// Cache only manifest + icons. NEVER cache app code (JS/CSS) so updates are always fresh.
const CACHE_VERSION = 'mis-v5-2026-07-19';

self.addEventListener('install', (event) => {
  // Activate immediately, replace old worker
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete ALL old caches to guarantee fresh code on updates
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
      // Force all open pages to reload to pick up new HTML/JS
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) {
        try { c.navigate(c.url); } catch {}
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API — always fresh from network
  if (url.pathname.startsWith('/api/')) return;
  // Never intercept Next.js chunks / RSC / dev — always fresh
  if (url.pathname.startsWith('/_next/')) return;
  // Never intercept HTML documents — network-only so latest UI is always shown
  const accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || accept.includes('text/html')) return;

  // Only cache: manifest.json, /sw.js, /icons/*, /favicon.ico, /public assets
  const cacheableExt = /\.(png|jpg|jpeg|webp|svg|ico|json)$/i;
  if (!cacheableExt.test(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((resp) => {
          if (resp.ok && resp.type === 'basic') {
            try { cache.put(req, resp.clone()); } catch {}
          }
          return resp;
        }).catch(() => cached);
      })
    )
  );
});
