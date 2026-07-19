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
export async function compressToWebp(fileOrBlob, opts = {}) {
  const maxWidth = opts.maxWidth || 900;
  const maxHeight = opts.maxHeight || 900;
  const targetKB = opts.targetKB || 220;

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

  // Quality loop to hit target size (~150-250KB)
  let quality = 0.78;
  let out = canvas.toDataURL('image/webp', quality);
  let bytes = Math.ceil((out.length * 3) / 4); // rough base64 -> bytes
  let iter = 0;
  while (bytes > targetKB * 1024 && quality > 0.35 && iter < 5) {
    quality -= 0.12;
    out = canvas.toDataURL('image/webp', quality);
    bytes = Math.ceil((out.length * 3) / 4);
    iter++;
  }
  // If still too big, downscale further
  if (bytes > targetKB * 1024) {
    canvas.width = Math.round(width * 0.75);
    canvas.height = Math.round(height * 0.75);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL('image/webp', 0.7);
    bytes = Math.ceil((out.length * 3) / 4);
  }
  return { dataUrl: out, sizeBytes: bytes };
}
