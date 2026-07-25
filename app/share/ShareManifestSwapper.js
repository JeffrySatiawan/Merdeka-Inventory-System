'use client';

import { useEffect } from 'react';

// Swaps the <link rel="manifest"> to point at the Merdeka Share manifest
// when on /share so Chrome offers "Install Merdeka Share" instead of MIS.
export default function ShareManifestSwapper() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.querySelectorAll('link[rel="manifest"]');
    existing.forEach((el) => el.parentNode?.removeChild(el));
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/share-manifest.webmanifest';
    document.head.appendChild(link);
    return () => {
      // Restore MIS manifest when leaving /share (SPA navigation)
      try { link.parentNode?.removeChild(link); } catch { /* ignore */ }
      const restore = document.createElement('link');
      restore.rel = 'manifest';
      restore.href = '/manifest.json';
      document.head.appendChild(restore);
    };
  }, []);
  return null;
}
