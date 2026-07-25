// Merdeka Inventory System - Service Worker (with Merdeka Share support)
// Cache only manifest + icons. NEVER cache app code (JS/CSS) so updates are always fresh.
const CACHE_VERSION = 'mis-v6-share-2026-07-25';
const DB_NAME = 'merdeka-share-db';
const DB_STORE_QUEUE = 'queue';   // pending shared PDFs waiting to be uploaded
const DB_STORE_AUTH = 'auth';     // token + base info (from main app handoff)

// ---------------- Lifecycle ----------------
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// ---------------- IndexedDB helpers ----------------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE_QUEUE)) {
        const s = db.createObjectStore(DB_STORE_QUEUE, { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(DB_STORE_AUTH)) {
        db.createObjectStore(DB_STORE_AUTH, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbPut(store, value) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function idbGet(store, key) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function idbGetAll(store) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}
function idbDelete(store, key) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// Generate a random UUID (fallback for old browsers)
function uid() {
  if (self.crypto?.randomUUID) return self.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------- Share target handler ----------------
// When Android shares a PDF to us, the browser POSTs multipart/form-data to /share.
// We intercept here, stash file(s) in IndexedDB, then redirect to /share (GET) so the
// client page can process the queue.
async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const files = [];
    // Collect any file entries; accept keys 'shared_files' (from our manifest) or any File
    for (const [key, value] of formData.entries()) {
      if (value && typeof value === 'object' && 'arrayBuffer' in value && value.size > 0) {
        files.push(value);
      }
    }
    for (const f of files) {
      const item = {
        id: uid(),
        blob: f,
        mime: f.type || 'application/pdf',
        size: f.size,
        original_name: f.name || 'shared.pdf',
        status: 'pending', // pending | uploading | success | failed
        error: null,
        attempts: 0,
        server_filename: null,
        server_id: null,
        received_at: Date.now(),
      };
      await idbPut(DB_STORE_QUEUE, item);
    }
    // Try to trigger background sync (best-effort)
    try {
      if ('sync' in self.registration) {
        await self.registration.sync.register('merdeka-share-upload');
      }
    } catch {}
  } catch (e) {
    // Even on error, still redirect so user sees /share page
    console.error('[MS SW] share target error', e);
  }
  return Response.redirect('/share', 303);
}

// ---------------- Fetch handler ----------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Share Target POST → intercept
  if (req.method === 'POST' && url.pathname === '/share') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  if (req.method !== 'GET') return;
  // Never intercept API — always fresh from network
  if (url.pathname.startsWith('/api/')) return;
  // Never intercept Next.js chunks / RSC / dev — always fresh
  if (url.pathname.startsWith('/_next/')) return;
  // Never intercept HTML documents — network-only so latest UI is always shown
  const accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || accept.includes('text/html')) return;

  // Only cache: manifest/webmanifest, /sw.js, /icons/*, /favicon.ico, /public assets
  const cacheableExt = /\.(png|jpg|jpeg|webp|svg|ico|json|webmanifest)$/i;
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

// ---------------- Background Sync ----------------
async function uploadOne(item, token, baseUrl) {
  const fd = new FormData();
  fd.append('file', item.blob, item.original_name || 'shared.pdf');
  const url = (baseUrl ? baseUrl.replace(/\/$/, '') : '') + '/api/om/pdfs/auto';
  const res = await fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.item || null;
}

async function processQueue() {
  const auth = await idbGet(DB_STORE_AUTH, 'main');
  const token = auth?.token || null;
  const baseUrl = auth?.base_url || '';
  if (!token) return { skipped: true, reason: 'no token' };

  const items = await idbGetAll(DB_STORE_QUEUE);
  const pending = items.filter((it) => it.status === 'pending' || it.status === 'failed');
  const results = [];
  for (const it of pending) {
    try {
      it.status = 'uploading';
      it.attempts = (it.attempts || 0) + 1;
      await idbPut(DB_STORE_QUEUE, { ...it, blob: it.blob });
      const serverItem = await uploadOne(it, token, baseUrl);
      it.status = 'success';
      it.server_filename = serverItem?.filename || null;
      it.server_id = serverItem?.id || null;
      it.error = null;
      it.completed_at = Date.now();
      await idbPut(DB_STORE_QUEUE, it);
      results.push({ id: it.id, ok: true });
    } catch (e) {
      it.status = 'failed';
      it.error = String(e?.message || e);
      await idbPut(DB_STORE_QUEUE, it);
      results.push({ id: it.id, ok: false, error: it.error });
    }
  }
  // Notify open clients
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const c of clients) {
    try { c.postMessage({ type: 'merdeka-share:queue-updated' }); } catch {}
  }
  return { processed: results.length };
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'merdeka-share-upload') {
    event.waitUntil(processQueue());
  }
});

// ---------------- Messages from clients ----------------
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'merdeka-share:set-auth') {
    // { token, base_url, user_id, user_name }
    idbPut(DB_STORE_AUTH, {
      key: 'main',
      token: msg.token || null,
      base_url: msg.base_url || '',
      user_id: msg.user_id || null,
      user_name: msg.user_name || null,
      updated_at: Date.now(),
    }).catch(() => {});
  } else if (msg.type === 'merdeka-share:process-queue') {
    event.waitUntil?.(processQueue());
    processQueue().catch(() => {});
  } else if (msg.type === 'merdeka-share:clear-auth') {
    idbDelete(DB_STORE_AUTH, 'main').catch(() => {});
  }
});
