// ---------------------------------------------------------------------------
// Fix: serve `/sw.js` via Next.js route handler so Service Worker registration
// works in production. Reason: Next.js `output: 'standalone'` build does NOT
// include the `public/` folder in the deployed artifact, so static files like
// `/public/sw.js` return HTTP 404 (text/html). That makes browsers unable to
// install/update the Service Worker — and users with a stale old SW get stuck
// (symptom: "Failed to fetch" on login).
//
// This route reads `/app/public/sw.js` at module init (cached in-memory) and
// serves it with the correct JS MIME type and proper SW cache headers so the
// browser always revalidates and installs the latest version.
//
// MINIMAL CHANGE — additive only:
//   - no change to UI, auth, database, modules
//   - no change to Next.js build config
//   - works both in `next dev` and in `output: 'standalone'` production
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Try a few candidate locations so this route works whether we're running
// from `next dev` (project root = /app) or from the standalone server where
// cwd/path layout may differ.
function loadSwContent() {
  const candidates = [
    // Primary source: outside `public/` so it never conflicts with a static
    // file during local dev AND is always included in the standalone build
    // artifact (Next.js bundles non-public files via its tracing).
    path.join(process.cwd(), 'lib', 'pwa', 'sw-source.js'),
    '/app/lib/pwa/sw-source.js',
    // Legacy fallback if `public/sw.js` still exists in some environment.
    path.join(process.cwd(), 'public', 'sw.js'),
    '/app/public/sw.js',
  ];
  for (const p of candidates) {
    try {
      const buf = fs.readFileSync(p);
      if (buf && buf.length > 0) return { buf, src: p };
    } catch { /* try next */ }
  }
  return { buf: null, src: null };
}

// Cache in-memory for the lifetime of the server process.
let CACHED = null;
function getSw() {
  if (CACHED) return CACHED;
  CACHED = loadSwContent();
  return CACHED;
}

export async function GET() {
  const { buf } = getSw();
  if (!buf) {
    // Should never happen in a correctly deployed artifact, but return a
    // minimal no-op SW so the browser doesn't choke on an HTML 404 page
    // (which was the root cause of the production MIME-type error).
    const noop = `// MIS SW fallback (public/sw.js not found at runtime)
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
`;
    return new Response(noop, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Service-Worker-Allowed': '/',
      },
    });
  }
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // SW spec: browsers bypass HTTP cache for the main SW script when
      // max-age <= 24h, but we add no-cache explicitly to force revalidation
      // on every page load so new SW versions ship immediately.
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
