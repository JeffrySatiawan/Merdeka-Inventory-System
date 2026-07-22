// Scanner Mode — audio feedback, vibration, and camera scanning utilities.
// Isolated from Cycle Count. Client-only (uses browser APIs).

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
  // iOS unlock: audio can only start after user gesture
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
 * Load html5-qrcode lazily and start scanning.
 * Returns a stop() function. Safe against React unmount races and camera-init failures.
 */
export async function startCameraScanner(elementId, onDecode, onError) {
  if (typeof window === 'undefined') {
    throw new Error('Camera scanner requires browser environment');
  }
  const container = document.getElementById(elementId);
  if (!container) {
    throw new Error('Camera container not found');
  }
  // Clean any leftover nodes from previous session to give html5-qrcode a fresh slate
  try {
    while (container.firstChild) container.removeChild(container.firstChild);
  } catch {}

  const mod = await import('html5-qrcode');
  const { Html5Qrcode } = mod;
  let instance;
  try {
    instance = new Html5Qrcode(elementId, /* verbose */ false);
  } catch (e) {
    throw new Error('Gagal inisialisasi kamera: ' + (e?.message || e));
  }

  const config = {
    fps: 12,
    qrbox: { width: 260, height: 130 },
    aspectRatio: 1.6,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  };

  const safeDecode = (d) => {
    try { onDecode && onDecode(d); } catch {}
  };

  // Try rear-camera first, then generic environment, then any camera
  const attempts = [
    { facingMode: { exact: 'environment' } },
    { facingMode: 'environment' },
    { facingMode: 'user' },
  ];
  let started = false;
  let lastErr = null;
  for (const cam of attempts) {
    try {
      await instance.start(
        cam,
        config,
        safeDecode,
        (msg) => {
          if (onError && msg && !/NotFoundException|No MultiFormat Readers/.test(String(msg))) {
            try { onError(msg); } catch {}
          }
        }
      );
      started = true;
      break;
    } catch (e) {
      lastErr = e;
      // Ensure any partial DOM is cleared before retry
      try {
        while (container.firstChild) container.removeChild(container.firstChild);
      } catch {}
    }
  }
  if (!started) {
    // Give up — return a no-op stop and throw
    throw new Error(
      'Tidak dapat mengakses kamera. Pastikan izin kamera aktif & perangkat memiliki kamera. (' +
        (lastErr?.message || lastErr || 'unknown') +
        ')'
    );
  }

  // Return a robust stop function that never throws
  return async () => {
    try { await instance.stop(); } catch {}
    try { instance.clear(); } catch {}
    // Final cleanup — remove any leftover DOM the library added
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
