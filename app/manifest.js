// Next.js App Router dynamic manifest — served at /manifest.webmanifest.
// Uses absolute URLs for share_target.action so Android WebAPK reliably registers
// the share target (relative URLs are known to fail silently on some Chrome versions).

export const dynamic = 'force-static';

function getBaseUrl() {
  // Prefer explicit env; fall back to a safe default (works locally for dev)
  const raw = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, ''); // strip trailing slash
}

export default function manifest() {
  const base = getBaseUrl();
  return {
    // App identity — matches the actual product name so when users install MIS
    // as a PWA from the main page, the home-screen shortcut shows "MIS" with
    // the correct logo. The share target is still registered so sharing PDFs
    // from other Android apps continues to work — Android surfaces this app
    // in the share sheet as "MIS" (via share target params below).
    name: 'Merdeka Inventory System',
    short_name: 'MIS',
    description:
      'Merdeka Inventory System — Cycle Count, Order Management, dan share PDF resi dari HP.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui', 'browser'],
    orientation: 'portrait',
    background_color: '#09090b',
    theme_color: '#09090b',
    dir: 'ltr',
    lang: 'id-ID',
    prefer_related_applications: false,
    categories: ['business', 'productivity', 'utilities'],
    // Icon set. Include BOTH `any` (regular) and `maskable` (safe-zone for
    // Android launcher). The regular 192/512 pair is what most browsers pick
    // for the home-screen icon. Absolute URLs prevent the "empty/broken icon"
    // symptom seen when a webview resolves the relative path against a
    // different origin (e.g. some Chrome PWA install flows).
    icons: [
      {
        src: `${base}/icons/mis-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${base}/icons/mis-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${base}/icons/mis-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Android Share Target API — absolute URL is critical for reliable registration
    share_target: {
      action: `${base}/share`,
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [
          {
            name: 'shared_files',
            accept: ['application/pdf', '.pdf'],
          },
        ],
      },
    },
    shortcuts: [
      {
        name: 'Upload PDF Resi (Merdeka Share)',
        short_name: 'Share PDF',
        url: '/share',
      },
      {
        name: 'Scan Mulai Packing',
        short_name: 'Packing',
        url: '/?view=om:scan_pack',
      },
      {
        name: 'Scan Serah Terima Kurir',
        short_name: 'Kurir',
        url: '/?view=om:scan_deliver',
      },
    ],
  };
}
