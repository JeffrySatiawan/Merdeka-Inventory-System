// Scanner Mode — audio feedback, vibration, and camera scanning utilities.
// Uses native getUserMedia + @zxing/browser for maximum mobile compatibility.
// Client-only (uses browser APIs).

let audioCtx = null;
function getCtx() {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  } catch {
    return null;
  }
  return audioCtx;
}

/**
 * Play a beep according to type:
 *   'ok'   -> short high beep
 *   'warn' -> medium mid beep
 *   'err'  -> long low beep (double)
 */
export function beep(type = 'ok') {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;
  const tones =
    type === 'ok'
      ? [{ f: 1320, d: 0.08 }]
      : type === 'warn'
      ? [{ f: 700, d: 0.18 }]
      : type === 'err'
      ? [
          { f: 220, d: 0.18 },
          { f: 180, d: 0.22, delay: 0.22 },
        ]
      : [{ f: 880, d: 0.08 }];

  tones.forEach((t) => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(t.f, now + (t.delay || 0));
      gain.gain.setValueAtTime(0.0001, now + (t.delay || 0));
      gain.gain.exponentialRampToValueAtTime(0.28, now + (t.delay || 0) + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (t.delay || 0) + t.d);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + (t.delay || 0));
      osc.stop(now + (t.delay || 0) + t.d + 0.02);
    } catch {}
  });
}

/**
 * Trigger vibration if supported.
 */
export function vibrate(type = 'ok') {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  const patterns = { ok: [40], warn: [80], err: [120, 60, 120] };
  try {
    navigator.vibrate(patterns[type] || patterns.ok);
  } catch {}
}

export function feedback(type) {
  beep(type);
  vibrate(type);
}

/**
 * Start camera scanner using native getUserMedia + @zxing/browser.
 * We fully own the <video> element so we can set the iOS-required attributes
 * (playsInline, autoplay, muted) which html5-qrcode failed to set.
 *
 * @param {string} elementId - DOM id of container div
 * @param {(text:string)=>void} onDecode - called with barcode text
 * @param {(msg:string)=>void} onError - called with non-fatal error messages
 * @returns {Promise<() => Promise<void>>} stop function
 */
export async function startCameraScanner(elementId, onDecode, onError) {
  if (typeof window === 'undefined') {
    throw new Error('Camera scanner requires browser environment');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      'Browser tidak mendukung akses kamera (getUserMedia). Gunakan Chrome/Safari terbaru & akses lewat HTTPS.'
    );
  }
  const container = document.getElementById(elementId);
  if (!container) {
    throw new Error('Camera container tidak ditemukan');
  }

  // Clean any leftover DOM from previous session
  try {
    while (container.firstChild) container.removeChild(container.firstChild);
  } catch {}

  // Build video element with ALL mobile-required attributes.
  // These MUST be set as attributes (not just properties) for iOS Safari
  // to render the stream inline instead of showing a black screen.
  const video = document.createElement('video');
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', ''); // legacy iOS
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  video.style.display = 'block';
  video.style.background = '#000';
  container.appendChild(video);

  // Try rear camera first, then any camera. Constraints matter on mobile —
  // 'exact' will hard-fail on desktops with only user-facing camera; ideal is safer.
  const constraintAttempts = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false },
  ];

  let stream = null;
  let lastErr = null;
  for (const constraints of constraintAttempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!stream) {
    try { container.removeChild(video); } catch {}
    throw new Error(
      'Tidak dapat mengakses kamera. Pastikan izin kamera diaktifkan di browser. (' +
        (lastErr?.name || 'unknown') + ': ' + (lastErr?.message || lastErr || '') + ')'
    );
  }

  video.srcObject = stream;
  // Play must be called after srcObject set. On some Androids play() rejects
  // if not muted+playsinline, so we set both above.
  try {
    await video.play();
  } catch (e) {
    // If play fails, try one more time after tiny delay
    await new Promise((r) => setTimeout(r, 100));
    try { await video.play(); } catch (e2) {
      // Not fatal — some browsers autoplay via attribute; log for debug
      try { console.warn('[OM Camera] video.play() failed:', e2?.message); } catch {}
    }
  }

  // Lazy-load ZXing decoder
  let codeReader = null;
  let stopped = false;
  let controls = null;
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    codeReader = new BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 120,
      delayBetweenScanSuccess: 1200,
    });
    controls = await codeReader.decodeFromVideoElement(video, (result, err) => {
      if (stopped) return;
      if (result) {
        try { onDecode && onDecode(result.getText()); } catch {}
      } else if (err && onError) {
        const name = err?.name || '';
        // NotFoundException fires constantly when no barcode in frame; ignore
        if (name && name !== 'NotFoundException' && name !== 'ChecksumException' && name !== 'FormatException') {
          try { onError(name + ': ' + (err?.message || '')); } catch {}
        }
      }
    });
  } catch (e) {
    // Decoder failed to init — stop stream and throw
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { container.removeChild(video); } catch {}
    throw new Error('Gagal inisialisasi decoder: ' + (e?.message || e));
  }

  return async function stop() {
    stopped = true;
    try { controls && controls.stop && controls.stop(); } catch {}
    try { codeReader && codeReader.reset && codeReader.reset(); } catch {}
    try {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
    } catch {}
    try { video.pause(); } catch {}
    try { video.srcObject = null; } catch {}
    try {
      const c = document.getElementById(elementId);
      if (c) {
        while (c.firstChild) {
          try { c.removeChild(c.firstChild); } catch { break; }
        }
      }
    } catch {}
  };
}
