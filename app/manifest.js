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
    name: 'Merdeka Share',
    short_name: 'Merdeka Share',
    description:
      'Merdeka Inventory System — upload PDF resi lewat share dari HP + Cycle Count & Order Management',
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
    icons: [
      {
        src: '/icons/merdeka-share-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/merdeka-share-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/merdeka-share-maskable-512.png',
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
        name: 'Upload PDF (Merdeka Share)',
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
