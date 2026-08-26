'use client';

// =============================================================================
// Global Real-Time PDF Resi Notification
// =============================================================================
// Polls the MIS backend every N seconds for newly uploaded PDF Resi and, when
// new items appear, fires:
//   • In-page toast popup (bottom-right, 5s) — via sonner
//   • Ding-dong sound (~0.5s) — Web Audio
//   • Browser Notification API — when tab is hidden/minimized
//   • Global window event 'om:new-pdf' — for other components to react
//     (e.g. OMPdfsView prepends the new item and highlights the card)
//
// User settings (persisted in localStorage):
//   • popup   ON/OFF
//   • sound   ON/OFF
//   • browser ON/OFF (also needs Notification.permission === 'granted')
//
// Design notes:
//   - Polling not WebSocket — Next.js API routes are short-lived so SSE/WS
//     are unreliable in this deployment. Polling every 4-5s is more than
//     enough for a warehouse workflow.
//   - First poll after mount ONLY snapshots existing IDs so users don't get
//     bombarded with popups for items uploaded before they opened the page.
//   - Multiple new items in one tick → each one triggers its own popup +
//     sound (stagger 300ms) as required by the spec.
// =============================================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { omApi } from './api';

// ---------- Settings persistence (GLOBAL, server-side) ----------
// Notification settings are stored server-side in om_settings and shared by
// ALL users. Only the OWNER account is allowed to modify them via PUT.
// Non-owner users still receive notifications, they just can't change the
// configuration.
//
// A short-lived localStorage cache keeps the first render responsive before
// the server responds (and covers offline reloads). It is NOT the source of
// truth — the polled server response always overwrites it.
const SETTINGS_CACHE_KEY = 'om.pdf.notif.settings.cache.v1';
const DEFAULT_SETTINGS = { popup: true, sound: true, browser: true };

function readCache() {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_CACHE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeCache(next) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(next));
  } catch {}
}

// Exposed helpers so views (e.g. OMPdfsView) can read the cached snapshot
// synchronously for their initial render.
export function loadNotifSettings() {
  return readCache();
}

// Legacy no-op kept for backward-compat with any existing imports.
// Persistence now goes through the API (owner-only), not localStorage.
export function saveNotifSettings(_next) {
  /* no-op — moved to server (see updateGlobalNotifSettings) */
}

// Fetch current global settings from the server. Returns DEFAULT_SETTINGS on
// any failure (network, unauth, etc.) so the caller always has valid values.
export async function fetchGlobalNotifSettings() {
  try {
    const resp = await omApi('notif-settings');
    const s = resp?.settings || {};
    const merged = {
      popup: s.popup !== undefined ? !!s.popup : DEFAULT_SETTINGS.popup,
      sound: s.sound !== undefined ? !!s.sound : DEFAULT_SETTINGS.sound,
      browser: s.browser !== undefined ? !!s.browser : DEFAULT_SETTINGS.browser,
    };
    writeCache(merged);
    return merged;
  } catch {
    return readCache();
  }
}

// Owner-only. Sends PUT and returns the server's authoritative response.
// The API guard will return 403 for non-owners; caller should handle that.
export async function updateGlobalNotifSettings(patch) {
  const resp = await omApi('notif-settings', {
    method: 'PUT',
    body: JSON.stringify(patch || {}),
  });
  const s = resp?.settings || {};
  const merged = {
    popup: s.popup !== undefined ? !!s.popup : DEFAULT_SETTINGS.popup,
    sound: s.sound !== undefined ? !!s.sound : DEFAULT_SETTINGS.sound,
    browser: s.browser !== undefined ? !!s.browser : DEFAULT_SETTINGS.browser,
  };
  writeCache(merged);
  // Broadcast so other components (hook + view) refresh immediately without
  // waiting for their next poll tick.
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('om:notif-settings-changed', { detail: merged }));
    }
  } catch {}
  return merged;
}

// ---------- Notification sound (MP3 with Web Audio fallback) ----------
// Default notification sound is a bell tone (mixkit-bell-notification-933.mp3),
// served from /public/sounds/pdf-notification.mp3.
const NOTIFICATION_SOUND_URL = '/sounds/pdf-notification.mp3';

let cachedAudio = null;
function getAudioElement() {
  if (typeof window === 'undefined') return null;
  if (cachedAudio) return cachedAudio;
  try {
    const a = new Audio(NOTIFICATION_SOUND_URL);
    a.preload = 'auto';
    a.volume = 0.9;
    cachedAudio = a;
    return a;
  } catch {
    return null;
  }
}

// Web Audio fallback (used only if MP3 playback fails, e.g. autoplay blocked).
let cachedCtx = null;
function getCtx() {
  if (typeof window === 'undefined') return null;
  if (cachedCtx) return cachedCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    cachedCtx = new AC();
    return cachedCtx;
  } catch {
    return null;
  }
}

// Try to unlock audio on the first user gesture — required by mobile browsers.
let unlockAttached = false;
function attachAudioUnlock() {
  if (typeof window === 'undefined' || unlockAttached) return;
  unlockAttached = true;
  const unlock = () => {
    // Unlock Web Audio context
    const ctx = getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Unlock HTMLAudioElement — play a muted no-op so mobile browsers allow
    // subsequent programmatic play() calls.
    const a = getAudioElement();
    if (a) {
      try {
        a.muted = true;
        const p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            try { a.pause(); a.currentTime = 0; a.muted = false; } catch {}
          }).catch(() => {
            try { a.muted = false; } catch {}
          });
        }
      } catch {}
    }
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('click', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
}

/**
 * Play the default PDF notification sound (bell — mixkit-bell-notification-933).
 * Falls back to a synthesized ding-dong via Web Audio if MP3 playback fails.
 */
function playWebAudioFallback() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const tones = [
    { f: 830, delay: 0, dur: 0.22, peak: 0.35 },
    { f: 660, delay: 0.24, dur: 0.35, peak: 0.30 },
  ];
  tones.forEach(({ f, delay, dur, peak }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, now + delay);
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(peak, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + delay);
    osc.stop(now + delay + dur + 0.02);
  });
}

export function playDingDong() {
  if (typeof window === 'undefined') return;
  attachAudioUnlock();
  const a = getAudioElement();
  if (!a) {
    playWebAudioFallback();
    return;
  }
  try {
    // Rewind so overlapping notifications always play from the start.
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.catch(() => {
        // Autoplay likely blocked (no user gesture yet) — use synthesized fallback.
        try { playWebAudioFallback(); } catch {}
      });
    }
  } catch {
    try { playWebAudioFallback(); } catch {}
  }
}

// ---------- Browser Notification API ----------
export async function requestBrowserPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'default';
  }
}

function showBrowserNotification(item) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const count = (item.detected_tracking_numbers || []).length;
    const n = new Notification('PDF Resi Baru', {
      body: `${item.filename}\n${count} resi terdeteksi`,
      icon: '/favicon.ico',
      tag: `om-pdf-${item.id}`, // dedupe if same item retried
      renotify: false,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    // Auto close after 6s just in case OS keeps it open longer
    setTimeout(() => { try { n.close(); } catch {} }, 6000);
  } catch {}
}

// ---------- Helper: format WITA time from ISO ----------
function fmtWitaTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Makassar',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// ---------- The Popup ----------
function popupNewPdf(item) {
  const count = (item.detected_tracking_numbers || []).length;
  const time = fmtWitaTime(item.uploaded_at);
  toast.custom(
    () => (
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-950/95 to-black/95 backdrop-blur shadow-xl shadow-emerald-500/20 min-w-[280px]"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="w-10 h-10 rounded-lg bg-emerald-500/25 flex items-center justify-center text-xl shrink-0">
          📄
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">
            PDF Resi Baru
          </div>
          <div className="font-mono text-sm font-bold text-white truncate">{item.filename}</div>
          <div className="text-[11px] text-muted-foreground">
            {count} resi · {time || '-'} WITA
          </div>
        </div>
      </div>
    ),
    { duration: 5000, position: 'top-right' }
  );
}

// =============================================================================
// Hook: useOMPdfNotifications
// =============================================================================
export function useOMPdfNotifications({ enabled = true, intervalMs = 5000, settingsPollMs = 15000 } = {}) {
  const [settings, setSettings] = useState(loadNotifSettings);
  const seenIdsRef = useRef(new Set());
  const lastCursorRef = useRef(null); // ISO string
  const initializedRef = useRef(false);
  const settingsRef = useRef(settings);

  // Keep ref current so async polling loop reads latest settings
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Update setting via server (owner-only — API will 403 for non-owners).
  // Local state updates optimistically; server response reconciles final state.
  const updateSettings = useCallback(async (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      const server = await updateGlobalNotifSettings(patch);
      setSettings(server);
      return server;
    } catch (e) {
      // Rollback if the API rejected the change (403 non-owner, network error, …).
      const fresh = await fetchGlobalNotifSettings();
      setSettings(fresh);
      throw e;
    }
  }, []);

  // Prime audio unlock on mount so first ding-dong can play
  useEffect(() => {
    attachAudioUnlock();
  }, []);

  // Poll GLOBAL notification settings from the server. All users share the
  // same config so any change made by the owner propagates to everyone on
  // their next poll tick (typically within ~15s). Also refreshes immediately
  // when the local tab dispatches 'om:notif-settings-changed' (owner just
  // toggled).
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    let cancelled = false;
    let firstDone = false;

    const refresh = async () => {
      if (cancelled) return;
      const s = await fetchGlobalNotifSettings();
      if (cancelled) return;
      setSettings(s);
      firstDone = true;
    };

    refresh();
    const id = setInterval(refresh, settingsPollMs);
    const onLocalChange = (e) => {
      if (e?.detail) setSettings(e.detail);
      else refresh();
    };
    window.addEventListener('om:notif-settings-changed', onLocalChange);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('om:notif-settings-changed', onLocalChange);
      // Silence lint on unused firstDone
      void firstDone;
    };
  }, [enabled, settingsPollMs]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    let cancelled = false;

    const trigger = (item) => {
      const s = settingsRef.current;
      const hidden = typeof document !== 'undefined' && document.hidden;

      // Broadcast to any listeners (OMPdfsView will insert + highlight the card)
      try {
        window.dispatchEvent(new CustomEvent('om:new-pdf', { detail: item }));
      } catch {}

      // In-page popup — only when tab visible (spec: tab lain → browser notif)
      if (s.popup && !hidden) {
        try { popupNewPdf(item); } catch {}
      }
      // Sound — always if enabled
      if (s.sound) {
        try { playDingDong(); } catch {}
      }
      // Browser Notification — when tab is hidden OR user explicitly wants it
      if (s.browser && hidden) {
        try { showBrowserNotification(item); } catch {}
      }
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        // Use `?since=` to only fetch items uploaded after our cursor.
        const cursor = lastCursorRef.current;
        const path = cursor ? `pdfs?since=${encodeURIComponent(cursor)}&limit=50` : 'pdfs?limit=100';
        const resp = await omApi(path);
        const items = resp?.items || [];

        if (!initializedRef.current) {
          // First run — mark everything as seen so we don't spam existing items.
          items.forEach((it) => seenIdsRef.current.add(it.id));
          lastCursorRef.current = resp?.server_time || new Date().toISOString();
          initializedRef.current = true;
        } else if (items.length > 0) {
          // Latest items are sorted DESC by uploaded_at → reverse so they
          // appear in chronological order (oldest new one first popup).
          const newOnes = items.filter((it) => !seenIdsRef.current.has(it.id)).reverse();
          newOnes.forEach((it, idx) => {
            seenIdsRef.current.add(it.id);
            // Stagger by 300ms so popups appear one after another as required
            setTimeout(() => trigger(it), idx * 300);
          });
          // Advance cursor
          lastCursorRef.current = resp?.server_time || items[0].uploaded_at || lastCursorRef.current;
        } else {
          // No new items — still advance cursor
          lastCursorRef.current = resp?.server_time || lastCursorRef.current;
        }
      } catch {
        // silent — network hiccup, will retry next tick
      }
    };

    // Kick off immediately, then interval
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, intervalMs]);

  return { settings, updateSettings };
}
