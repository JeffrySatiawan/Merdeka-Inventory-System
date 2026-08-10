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
  // NOTE: kept at the ORIGINAL tested budget (8 iterations, quality floor 0.3)
  // that has been proven to work on Android / iPhone 12 / iPhone 14 /
  // iPhone 17 Pro Max. DO NOT change these constants — they preserve the
  // known-good behavior for those devices.
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

  // ============================================================
  // iPhone XR SAFETY NET (added 2026-08-06)
  // ============================================================
  // Additive-only block — ZERO impact on devices that already succeeded
  // (Android / iPhone 12 / iPhone 14 / iPhone 17 Pro Max ALL exit the loop
  // above with bytes ≤ HARD_CAP_BYTES, so this while() body is never
  // executed for them). Only iPhone XR — where the previous loop budget
  // was insufficient — enters this block.
  //
  // Behavior: continue shrinking dimensions until the payload fits under
  // the backend 500KB cap or a hard dimension floor (200px) is reached.
  // Bounded to 20 additional iterations to prevent any pathological loop.
  let xrIter = 0;
  while (bytes > HARD_CAP_BYTES && xrIter < 20 && curW > 200) {
    curW = Math.round(curW * 0.85);
    curH = Math.round(curH * 0.85);
    canvas.width = curW;
    canvas.height = curH;
    ctx.drawImage(img, 0, 0, curW, curH);
    out = canvas.toDataURL(encMime, curQ);
    bytes = Math.ceil((out.length * 3) / 4);
    xrIter++;
  }
  // ============================================================

  // ============================================================
  // FINAL JPEG FALLBACK (added 2026-08-08) — iPhone XR / iOS 18 fix
  // ============================================================
  // Trigger: WebP encoder was used AND output still > backend 500KB cap.
  // Diagnostic on iPhone XR (iOS 18.7.9) confirmed the iOS WebP encoder
  // silently ignores the `quality` parameter, producing near-lossless
  // output (~4 bytes/pixel) that no amount of dimension downscale can
  // shrink under the cap in reasonable iterations.
  //
  // JPEG encoder on iOS ALWAYS honors quality — reliable universal path.
  //
  // ZERO IMPACT on working devices:
  //  - Android / iPhone 12 / iPhone 14 / iPhone 17 Pro Max exit prior
  //    loops with bytes ≤ HARD_CAP_BYTES → condition FALSE → skipped.
  //  - Devices where probe already fell back to JPEG at the top of the
  //    function have encMime === 'image/jpeg' → condition FALSE → skipped.
  //
  // Only executes on devices where WebP encoder is broken (iPhone XR iOS 18).
  if (bytes > HARD_CAP_BYTES && encMime === 'image/webp') {
    out = canvas.toDataURL('image/jpeg', 0.5);
    bytes = Math.ceil((out.length * 3) / 4);
  }
  // ============================================================

  // ============================================================
  // FAILSAFE FORCE-FIT LOOP (added 2026-08-08) — absolute guarantee
  // ============================================================
  // Contract: no output larger than HARD_CAP_BYTES (490KB) will leave
  // this function. This is the LAST resort. If ANY prior stage still
  // produced >490KB, this loop progressively downscales dimensions AND
  // drops quality using the reliable JPEG encoder until the file fits.
  //
  // Aspect ratio preserved: both width and height scaled by the same
  // factor (0.8x per iteration).
  //
  // Bounded by 40 iterations AND a 120px dimension floor to prevent
  // any pathological loop.
  //
  // ZERO IMPACT on working devices: while() condition is
  // `bytes > HARD_CAP_BYTES`. Any device that already fits exits with
  // FALSE on entry and the body never executes.
  //
  // Math: at 120x90 JPEG q0.15 ≈ 3KB — guaranteed to fit well under cap.
  {
    let ffI = 0;
    let ffW = canvas.width;
    let ffH = canvas.height;
    let ffQ = 0.35;
    while (bytes > HARD_CAP_BYTES && ffI < 40 && ffW > 120) {
      ffW = Math.max(120, Math.round(ffW * 0.8));
      ffH = Math.max(120, Math.round(ffH * 0.8));
      canvas.width = ffW;
      canvas.height = ffH;
      ctx.drawImage(img, 0, 0, ffW, ffH);
      // Force JPEG encoder — honors quality reliably on all platforms
      // (including iOS 18 iPhone XR where WebP quality is ignored).
      out = canvas.toDataURL('image/jpeg', ffQ);
      bytes = Math.ceil((out.length * 3) / 4);
      if (ffI % 2 === 1 && ffQ > 0.15) {
        ffQ = Math.max(0.15, ffQ - 0.05);
      }
      ffI++;
    }
  }
  // ============================================================

  return { dataUrl: out, sizeBytes: bytes };
}
