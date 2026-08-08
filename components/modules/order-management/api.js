// Shared API helper for Order Management module
export async function omApi(path, opts = {}) {
  const token = localStorage.getItem('cc_token');
  const headers = {
    ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(`/api/om/${path}`, { ...opts, headers });
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch {}
    const e = new Error((data && data.error) || `HTTP ${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res;
}

// Client-side image compression: File/Blob -> WebP data URL (~150-250KB target)
// iOS fallback: if the browser doesn't actually produce WebP (Safari <14 or
// certain iOS versions silently return PNG), we fall back to JPEG so the
// quality knob works. Also enforces a HARD ceiling equal to the backend cap
// (500KB) — will progressively downscale until the payload fits, so iOS
// Dokumentasi Packing no longer fails with "ukuran foto terlalu besar".
// SIGNATURE UNCHANGED — same return shape { dataUrl, sizeBytes }.
export async function compressToWebp(fileOrBlob, opts = {}) {
  const maxWidth = opts.maxWidth || 900;
  const maxHeight = opts.maxHeight || 900;
  const targetKB = opts.targetKB || 220;
  // Backend rejects >500KB. Keep a small safety margin for base64 rounding.
  const HARD_CAP_BYTES = 490 * 1024;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(fileOrBlob);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });

  // Resize keeping aspect ratio
  let { width, height } = img;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  // Decide which encoder actually works on THIS device (WebP on Android/desktop,
  // JPEG fallback on iOS Safari where WebP silently degrades to PNG).
  // Probe a 1×1 canvas — cheap and reliable.
  const probe = document.createElement('canvas');
  probe.width = 1; probe.height = 1;
  const webpProbe = probe.toDataURL('image/webp');
  const supportsWebp = webpProbe.startsWith('data:image/webp');
  const encMime = supportsWebp ? 'image/webp' : 'image/jpeg';

  // Quality loop to hit target size (~150-250KB)
  let quality = 0.78;
  let out = canvas.toDataURL(encMime, quality);
  let bytes = Math.ceil((out.length * 3) / 4); // rough base64 -> bytes
  let iter = 0;
  while (bytes > targetKB * 1024 && quality > 0.35 && iter < 5) {
    quality -= 0.12;
    out = canvas.toDataURL(encMime, quality);
    bytes = Math.ceil((out.length * 3) / 4);
    iter++;
  }
  // If still too big, downscale further (existing behavior — one aggressive step)
  if (bytes > targetKB * 1024) {
    canvas.width = Math.round(width * 0.75);
    canvas.height = Math.round(height * 0.75);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL(encMime, 0.7);
    bytes = Math.ceil((out.length * 3) / 4);
  }

  // HARD CEILING LOOP (iOS-safety) — guarantees the final payload fits within
  // the backend 500KB cap. Progressive downscale + quality drop; the previous
  // code stopped at one downscale which was sometimes insufficient on iPhone.
  let safetyIter = 0;
  let curW = canvas.width;
  let curH = canvas.height;
  let curQ = 0.7;
  while (bytes > HARD_CAP_BYTES && safetyIter < 8) {
    // Alternate between quality drop and dimension drop for smooth degradation.
    if (safetyIter % 2 === 0 && curQ > 0.3) {
      curQ = Math.max(0.3, curQ - 0.1);
    } else {
      curW = Math.round(curW * 0.85);
      curH = Math.round(curH * 0.85);
      canvas.width = curW;
      canvas.height = curH;
      ctx.drawImage(img, 0, 0, curW, curH);
    }
    out = canvas.toDataURL(encMime, curQ);
    bytes = Math.ceil((out.length * 3) / 4);
    safetyIter++;
  }

  return { dataUrl: out, sizeBytes: bytes };
}
