// Scanner Mode — camera scanning utilities.
// Bulletproof implementation for mobile browsers (esp. Chrome Android).
//
// Rendering strategy (multiple layers of fallback):
//   PRIMARY: <video> element displayed directly. Simple and works on most.
//   OVERLAY: <canvas> repainted via requestVideoFrameCallback (rVFC) — fires
//     when the video decoder actually delivers a new frame. This bypasses
//     compositor rendering bugs since canvas is drawn from decoded frame data.
//   FALLBACK: ImageCapture.grabFrame() if rVFC isn't available or fails.
//
// Decoding: @zxing/browser BrowserMultiFormatReader on the (hidden) video.
//
// This version fixes: iOS Safari (playsInline etc.), Chrome Android compositor
// black-screen, and off-screen video auto-pause issues.

let audioCtx = null;
let unlockAttached = false;

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

// Auto-unlock AudioContext on first user gesture — modern browsers block
// AudioContext.start() until user interacts. Without this, beep() silently
// fails on iOS/Android until the user's first tap.
function attachUnlock() {
  if (unlockAttached || typeof window === 'undefined') return;
  unlockAttached = true;
  const unlock = () => {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Play a silent (0 gain) tone to fully unlock on iOS Safari
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.02);
    } catch {}
  };
  const opts = { once: true, capture: true, passive: true };
  ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach((ev) => {
    try { document.addEventListener(ev, unlock, opts); } catch {}
  });
}

if (typeof window !== 'undefined') {
  // Attach unlock listener on module load (client-side only)
  attachUnlock();
}

/**
 * Play a beep — types:
 *   'ok'   → high double-chirp (successful scan)
 *   'warn' → mid two-tone (duplicate/warning)
 *   'err'  → low double-buzz (error)
 */
export function beep(type = 'ok') {
  const ctx = getCtx();
  if (!ctx) return;
  // Ensure unlock listener is attached (in case module was tree-shaken)
  attachUnlock();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;
  // Distinctive tone patterns — each type sounds clearly different so users
  // can distinguish outcomes by ear without looking at the screen.
  const tones =
    type === 'ok'
      ? [
          { f: 1400, d: 0.06, wave: 'sine' },
          { f: 1900, d: 0.09, delay: 0.06, wave: 'sine' },
        ]
      : type === 'warn'
      ? [
          { f: 660, d: 0.11, wave: 'triangle' },
          { f: 660, d: 0.11, delay: 0.16, wave: 'triangle' },
        ]
      : type === 'err'
      ? [
          { f: 260, d: 0.18, wave: 'square' },
          { f: 180, d: 0.24, delay: 0.20, wave: 'square' },
        ]
      : [{ f: 880, d: 0.08, wave: 'sine' }];

  tones.forEach((t) => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = t.wave || 'sine';
      const startAt = now + (t.delay || 0);
      const endAt = startAt + t.d;
      osc.frequency.setValueAtTime(t.f, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(endAt + 0.02);
    } catch {}
  });
}

export function vibrate(type = 'ok') {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  const patterns = { ok: [40], warn: [80, 60, 80], err: [140, 60, 140] };
  try {
    navigator.vibrate(patterns[type] || patterns.ok);
  } catch {}
}

export function feedback(type) {
  beep(type);
  vibrate(type);
}

export async function startCameraScanner(elementOrId, onDecode, onError) {
  if (typeof window === 'undefined') {
    throw new Error('Camera scanner requires browser environment');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      'Browser tidak mendukung akses kamera (getUserMedia). Gunakan Chrome/Safari terbaru & akses lewat HTTPS.'
    );
  }
  // Accept either a DOM element (preferred) or an id string (backward compat).
  const container =
    typeof elementOrId === 'string'
      ? document.getElementById(elementOrId)
      : elementOrId;
  if (!container || !container.appendChild) {
    throw new Error('Camera container tidak ditemukan');
  }

  // Clean any leftover DOM
  try {
    while (container.firstChild) container.removeChild(container.firstChild);
  } catch {}

  // ============================================================
  // Layer 1: <video> — PRIMARY visible surface.
  //   Displayed directly to user. Works on most browsers/devices.
  //   Contains all mobile-required attributes for iOS/Android inline playback.
  // ============================================================
  const video = document.createElement('video');
  video.id = 'om-scanner-video-hidden';
  // iOS + Android inline playback attributes (must be attributes, not just properties)
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  // NO object-fit — some Chrome Android GPUs render black with object-fit on
  // MediaStream video. Let it fit naturally (aspect preserved via CSS).
  video.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'display:block',
    'background:#000',
    'z-index:1',
  ].join(';');
  container.appendChild(video);

  // ============================================================
  // Layer 2: <canvas> — SECONDARY, painted from decoded video frames.
  //   Drawn ON TOP of the video via z-index. If the video happens to render
  //   correctly (best case), canvas covers it with identical content — user
  //   sees canvas. If video renders black (Chrome Android bug), canvas still
  //   shows frames from drawImage. Either way — pixels appear.
  // ============================================================
  const canvas = document.createElement('canvas');
  canvas.id = 'om-scanner-canvas';
  canvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'display:block',
    'z-index:2', // above video
    'pointer-events:none',
  ].join(';');
  container.appendChild(canvas);
  const ctx2d = canvas.getContext('2d', { alpha: true });

  // ============================================================
  // Layer 3: MediaStream setup (fallback constraint chain)
  // ============================================================
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
    try { container.removeChild(canvas); } catch {}
    try { container.removeChild(video); } catch {}
    throw new Error(
      'Tidak dapat mengakses kamera. Pastikan izin kamera diaktifkan di browser. (' +
        (lastErr?.name || 'unknown') + ': ' + (lastErr?.message || lastErr || '') + ')'
    );
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    await new Promise((r) => setTimeout(r, 100));
    try { await video.play(); } catch {}
  }

  // Wait for metadata (know video dimensions)
  if (video.readyState < 1) {
    await new Promise((resolve) => {
      const onMeta = () => { video.removeEventListener('loadedmetadata', onMeta); resolve(); };
      video.addEventListener('loadedmetadata', onMeta);
      setTimeout(resolve, 3000);
    });
  }

  // ============================================================
  // Layer 4: Canvas painting loop
  //   PREFER: requestVideoFrameCallback (rVFC) — fires exactly when a new
  //   frame is available from the decoder. Most reliable on Chrome/Edge/Safari.
  //   FALLBACK: rAF loop that reads from video (may work when rVFC unavailable).
  //   LAST RESORT: ImageCapture.grabFrame() every 100ms.
  // ============================================================
  let stopped = false;
  let framesDrawn = 0;
  let lastPaintMs = 0;
  let imageCaptureFallback = null;
  const supportsRVFC = typeof video.requestVideoFrameCallback === 'function';

  const resizeCanvasIfNeeded = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(1, Math.round(rect.width * dpr));
    const targetH = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    return { w: canvas.width, h: canvas.height };
  };

  const paintFrame = (source, sourceW, sourceH) => {
    if (stopped) return;
    const { w: cw, h: ch } = resizeCanvasIfNeeded();
    if (cw < 2 || ch < 2 || !sourceW || !sourceH) return;
    // 'cover' semantics — scale source to fill canvas, crop excess
    const vRatio = sourceW / sourceH;
    const cRatio = cw / ch;
    let sx, sy, sw, sh;
    if (vRatio > cRatio) {
      sh = sourceH;
      sw = Math.round(sourceH * cRatio);
      sx = Math.round((sourceW - sw) / 2);
      sy = 0;
    } else {
      sw = sourceW;
      sh = Math.round(sourceW / cRatio);
      sx = 0;
      sy = Math.round((sourceH - sh) / 2);
    }
    try {
      ctx2d.drawImage(source, sx, sy, sw, sh, 0, 0, cw, ch);
      framesDrawn += 1;
      lastPaintMs = performance.now();
    } catch (e) {
      // drawImage may throw if source is invalid on some Android
      // Fall back to ImageCapture next tick
      try { console.warn('[OM Camera] drawImage failed:', e?.message); } catch {}
    }

    // Small diagnostic in bottom-left corner
    try {
      const dpr = window.devicePixelRatio || 1;
      const fontPx = Math.max(10, Math.round(11 * dpr));
      ctx2d.font = `${fontPx}px monospace`;
      ctx2d.textBaseline = 'bottom';
      const label = `● ${framesDrawn}f ${sourceW}×${sourceH}`;
      ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
      const w = ctx2d.measureText(label).width + 12 * dpr;
      ctx2d.fillRect(4 * dpr, ch - (fontPx + 10 * dpr), w, fontPx + 8 * dpr);
      ctx2d.fillStyle = '#4ade80';
      ctx2d.fillText(label, 10 * dpr, ch - 6 * dpr);
    } catch {}
  };

  // ImageCapture fallback: try to init early so it's ready
  try {
    if (typeof ImageCapture !== 'undefined') {
      const track = stream.getVideoTracks()[0];
      if (track) imageCaptureFallback = new ImageCapture(track);
    }
  } catch {}

  const imageCaptureLoop = async () => {
    if (stopped) return;
    if (!imageCaptureFallback) return;
    try {
      const bitmap = await imageCaptureFallback.grabFrame();
      if (!stopped && bitmap) {
        paintFrame(bitmap, bitmap.width, bitmap.height);
        try { bitmap.close && bitmap.close(); } catch {}
      }
    } catch (e) {
      // grabFrame may fail; retry after delay
    }
    if (!stopped) setTimeout(imageCaptureLoop, 100);
  };

  // Choose paint strategy
  if (supportsRVFC) {
    const rvfcTick = (_now, meta) => {
      if (stopped) return;
      paintFrame(video, meta.width || video.videoWidth, meta.height || video.videoHeight);
      if (!stopped) video.requestVideoFrameCallback(rvfcTick);
    };
    try {
      video.requestVideoFrameCallback(rvfcTick);
    } catch {
      // rVFC failed to register — fall back to ImageCapture
      imageCaptureLoop();
    }
    // Additionally: if no paint happens within 1.5s, force ImageCapture fallback
    setTimeout(() => {
      if (!stopped && framesDrawn === 0 && imageCaptureFallback) {
        try { console.warn('[OM Camera] rVFC did not produce frames, falling back to ImageCapture'); } catch {}
        imageCaptureLoop();
      }
    }, 1500);
  } else if (imageCaptureFallback) {
    imageCaptureLoop();
  } else {
    // No rVFC and no ImageCapture — fall back to rAF loop reading video directly
    const rafTick = () => {
      if (stopped) return;
      if (!video.paused && video.readyState >= 2 && video.videoWidth > 0) {
        paintFrame(video, video.videoWidth, video.videoHeight);
      }
      if (!stopped) requestAnimationFrame(rafTick);
    };
    requestAnimationFrame(rafTick);
  }

  // ============================================================
  // Layer 5: zxing barcode decoder on the (hidden) video
  // ============================================================
  let codeReader = null;
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
        if (name && name !== 'NotFoundException' && name !== 'ChecksumException' && name !== 'FormatException') {
          try { onError(name + ': ' + (err?.message || '')); } catch {}
        }
      }
    });
  } catch (e) {
    stopped = true;
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { container.removeChild(canvas); } catch {}
    try { container.removeChild(video); } catch {}
    throw new Error('Gagal inisialisasi decoder: ' + (e?.message || e));
  }

  // Return stop function
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
      const c = container; // use captured element ref, not id-based lookup
      if (c) {
        while (c.firstChild) {
          try { c.removeChild(c.firstChild); } catch { break; }
        }
      }
    } catch {}
  };
}
