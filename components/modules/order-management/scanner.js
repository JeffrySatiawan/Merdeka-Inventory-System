// Scanner Mode — audio feedback, vibration, and camera scanning utilities.
// Uses native getUserMedia + a CANVAS MIRROR approach:
//   - <video> element receives MediaStream but stays hidden.
//   - <canvas> in the DOM is repainted from the video each frame via rAF.
// This bypasses Chrome Android bugs where <video> with a MediaStream renders
// black inside CSS-clipped/composited containers. Canvas rendering is
// deterministic — if we call drawImage, the frame appears.
//
// Decoding: @zxing/browser BrowserMultiFormatReader operates on the video
// element (which still receives frames even when hidden).

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
 * Start camera scanner with canvas mirror.
 * Container will show a <canvas> that mirrors the camera feed.
 * A hidden <video> receives the stream; zxing decodes off it.
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

  // Clean any leftover DOM
  try {
    while (container.firstChild) container.removeChild(container.firstChild);
  } catch {}

  // 1) <video> element — receives MediaStream, drives zxing decoder.
  //    IMPORTANT: We keep video INSIDE the container (not off-screen), because
  //    Chrome Android auto-pauses videos that are off-screen or opacity:0
  //    even when we call .play(). We visually mask it by overlaying a canvas
  //    with a higher z-index — user sees canvas frames, not the raw <video>.
  const video = document.createElement('video');
  video.id = 'om-scanner-video-hidden';
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'object-fit:cover',
    'display:block',
    'z-index:1',
    // Keep video on-screen so Chrome doesn't auto-pause it. We rely on the
    // canvas overlay (z-index:2) to hide it from the user. This works even
    // if the <video> itself renders black (Chrome Android compositor bug).
  ].join(';');
  container.appendChild(video);

  // 2) <canvas> overlay — the ACTUAL visible surface.
  //    Repainted from the video each frame. Full control over rendering,
  //    no compositor issues. Even if the <video> below renders black,
  //    we still get frames because drawImage(video) reads pixel data
  //    directly from the media pipeline, not the composited layer.
  const canvas = document.createElement('canvas');
  canvas.id = 'om-scanner-canvas';
  canvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'display:block',
    'background:#000',
    'z-index:2', // above video
  ].join(';');
  container.appendChild(canvas);
  const ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true });

  // 3) getUserMedia with fallback chain
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
  // play() is required on many mobile browsers even with autoplay attribute
  try {
    await video.play();
  } catch (e) {
    await new Promise((r) => setTimeout(r, 100));
    try { await video.play(); } catch (e2) {
      try { console.warn('[OM Camera] video.play() failed:', e2?.message); } catch {}
    }
  }

  // Wait until metadata loaded so we know real video dimensions
  if (video.readyState < 1) {
    await new Promise((resolve) => {
      const onMeta = () => { video.removeEventListener('loadedmetadata', onMeta); resolve(); };
      video.addEventListener('loadedmetadata', onMeta);
      setTimeout(resolve, 3000); // safety timeout
    });
  }

  // 4) Canvas mirror loop — repaint canvas from video each frame.
  //    Uses rAF for smooth ~60fps rendering.
  let stopped = false;
  let frameCount = 0;
  let framesDrawn = 0;
  const paint = () => {
    if (stopped) return;
    frameCount += 1;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const canDraw = vw > 0 && vh > 0 && !video.paused && video.readyState >= 2;

    // Adjust canvas backing store to match visible size (device pixels)
    // for crisp rendering. Only resize when needed.
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(1, Math.round(rect.width * dpr));
    const targetH = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;

    if (canDraw) {
      // Draw with 'cover' semantics — scale video to fill canvas, crop excess
      const cw = canvas.width;
      const ch = canvas.height;
      const vRatio = vw / vh;
      const cRatio = cw / ch;
      let sx, sy, sw, sh;
      if (vRatio > cRatio) {
        sh = vh;
        sw = Math.round(vh * cRatio);
        sx = Math.round((vw - sw) / 2);
        sy = 0;
      } else {
        sw = vw;
        sh = Math.round(vw / cRatio);
        sx = 0;
        sy = Math.round((vh - sh) / 2);
      }
      try {
        ctx2d.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
        framesDrawn += 1;
      } catch {}
    } else {
      // No frame available yet — fill black
      try {
        ctx2d.fillStyle = '#000';
        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      } catch {}
    }

    // Diagnostic overlay in bottom-left corner (small text).
    // Green if drawing, amber if not. Confirms paint loop is alive.
    try {
      const dprLbl = dpr;
      const fontPx = Math.max(10, Math.round(11 * dprLbl));
      ctx2d.font = `${fontPx}px monospace`;
      ctx2d.textBaseline = 'bottom';
      const label = canDraw
        ? `● ${framesDrawn}f  ${vw}×${vh}`
        : `⚠ ready=${video.readyState} paused=${video.paused ? 'Y' : 'N'}`;
      ctx2d.fillStyle = 'rgba(0,0,0,0.6)';
      const w = ctx2d.measureText(label).width + 12 * dprLbl;
      ctx2d.fillRect(4 * dprLbl, canvas.height - (fontPx + 10 * dprLbl), w, fontPx + 8 * dprLbl);
      ctx2d.fillStyle = canDraw ? '#4ade80' : '#fbbf24';
      ctx2d.fillText(label, 10 * dprLbl, canvas.height - 6 * dprLbl);
    } catch {}

    if (!stopped) requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);

  // 5) Attach zxing decoder to the hidden video element
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

  // 6) Expose a stop() function that tears down EVERYTHING cleanly
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
