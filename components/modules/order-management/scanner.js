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
 * Returns a stop() function.
 */
export async function startCameraScanner(elementId, onDecode, onError) {
  const mod = await import('html5-qrcode');
  const { Html5Qrcode } = mod;
  const instance = new Html5Qrcode(elementId, /* verbose */ false);
  const config = {
    fps: 12,
    qrbox: { width: 260, height: 130 },
    aspectRatio: 1.6,
    // rememberLastUsedCamera: true, // not available in all versions
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  };
  // Prefer rear camera
  await instance.start(
    { facingMode: { exact: 'environment' } },
    config,
    (decoded) => {
      try { onDecode && onDecode(decoded); } catch {}
    },
    (msg) => {
      // per-frame decode fails; silence unless caller wants
      if (onError && msg && !/NotFoundException|No MultiFormat Readers/.test(String(msg))) {
        onError(msg);
      }
    }
  ).catch(async (e) => {
    // Fallback if `exact: environment` unsupported
    return instance.start(
      { facingMode: 'environment' },
      config,
      (d) => { try { onDecode && onDecode(d); } catch {} },
      () => {}
    );
  });
  return async () => {
    try { await instance.stop(); } catch {}
    try { await instance.clear(); } catch {}
  };
}
