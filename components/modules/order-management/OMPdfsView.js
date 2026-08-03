'use client';

// OM · PDF Resi — upload PDF label from HP, preview + print, auto-scan QR
// codes on each page and link to tracking numbers.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  FileText,
  Trash2,
  Printer,
  Loader2,
  QrCode,
  CheckCircle2,
  RefreshCw,
  Eye,
  Store,
  Copy,
  X,
  ArrowLeft,
  ShieldCheck,
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  MonitorSmartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { omApi } from './api';
import {
  loadNotifSettings,
  fetchGlobalNotifSettings,
  updateGlobalNotifSettings,
  requestBrowserPermission,
} from './useOMPdfNotifications';

function fmtBytes(n) {
  if (!n && n !== 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ---------- KETOKO PIN Verification helper ----------
// Set of "easy" PINs to avoid so a random one doesn't feel guessable.
const EASY_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '2345', '3456', '4567', '5678', '6789', '7890',
  '4321', '5432', '6543', '7654', '8765', '9876', '0987',
  '1212', '2121', '1010', '0101',
]);

// Generate a random 4-digit PIN, skipping "easy" ones.
function generatePin() {
  // Use crypto RNG when available for better randomness.
  const rand = () => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0] % 10000;
    }
    return Math.floor(Math.random() * 10000);
  };
  // Loop until we get a non-easy PIN (bounded to avoid infinite loop just in case).
  for (let i = 0; i < 50; i += 1) {
    const pin = String(rand()).padStart(4, '0');
    if (!EASY_PINS.has(pin)) return pin;
  }
  return '3617'; // deterministic fallback (extremely unlikely to reach here)
}

// ---------- API helper: upload multipart ----------
async function uploadPdf(file, onProgress) {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem('cc_token');
    const form = new FormData();
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/om/pdfs');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `HTTP ${xhr.status}`));
      } catch (e) {
        reject(new Error('Invalid response'));
      }
    };
    xhr.send(form);
  });
}

// ---------- Lazy-loaded PDF.js singleton ----------
let _pdfjsPromise = null;
function loadPdfJs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url
        ).toString();
      }
      return pdfjs;
    })();
  }
  return _pdfjsPromise;
}

// ---------- Module-level caches (survive modal remount) ----------
const _bufferCache = new Map();       // pdfId -> Uint8Array (owned copy)
const _pdfDocCache = new Map();       // pdfId -> PDFDocumentProxy promise
const _blobUrlCache = new Map();      // pdfId -> object URL string

// Fetch pdf as authenticated blob → return a Uint8Array (cached).
// We keep an owned Uint8Array copy in cache; consumers slice a fresh copy
// because pdf.js and Blob may take ownership (detach) of the buffer.
function fetchPdfBuffer(pdfId) {
  if (_bufferCache.has(pdfId)) return _bufferCache.get(pdfId);
  const p = (async () => {
    const token = localStorage.getItem('cc_token');
    const resp = await fetch(`/api/om/pdfs/${pdfId}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ab = await resp.arrayBuffer();
    // Copy into our own Uint8Array so we keep control
    return new Uint8Array(ab);
  })();
  _bufferCache.set(pdfId, p);
  p.catch(() => _bufferCache.delete(pdfId));
  return p;
}

// Slice a fresh copy of the buffer for a consumer (pdf.js / Blob).
async function getPdfBufferCopy(pdfId) {
  const u8 = await fetchPdfBuffer(pdfId);
  // Uint8Array#slice returns a copy with its own ArrayBuffer
  return u8.slice();
}

// Get (or create) a pdfDoc for a given id — cached.
// Uses a FRESH copy of the buffer so pdf.js can safely take ownership.
function getPdfDoc(pdfId) {
  if (_pdfDocCache.has(pdfId)) return _pdfDocCache.get(pdfId);
  const p = (async () => {
    const pdfjs = await loadPdfJs();
    const copy = await getPdfBufferCopy(pdfId);
    return pdfjs.getDocument({ data: copy }).promise;
  })();
  _pdfDocCache.set(pdfId, p);
  p.catch(() => _pdfDocCache.delete(pdfId));
  return p;
}

// Get (or create) an object URL for the PDF — used only for the in-app PREVIEW
// (canvas rendering via pdf.js) as a fallback. NEVER passed to window.open()
// for print anymore — see getPdfServerUrl() for that.
async function getPdfBlobUrl(pdfId) {
  if (_blobUrlCache.has(pdfId)) return _blobUrlCache.get(pdfId);
  const copy = await getPdfBufferCopy(pdfId);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  _blobUrlCache.set(pdfId, url);
  return url;
}

// Build the AUTHENTICATED direct server URL for a PDF — used by "Print" and
// "Buka di tab baru" so the browser opens the ACTUAL file with its native
// PDF viewer, not a blob:// wrapper. Prior implementation used a blob URL
// which on some browsers/environments rendered as an HTML "Blob Viewer" page
// (the whole PDF turned into a screenshot of the viewer chrome) — printing
// that page gave a cropped / non-identical result.
//
// The token is appended as ?token=<session> because window.open() cannot
// attach an Authorization header. Backend accepts URL-query tokens as a
// fallback for exactly this case (see getUserFromRequest).
function getPdfServerUrl(pdfId) {
  if (typeof window === 'undefined') return '';
  const token = window.localStorage.getItem('cc_token') || '';
  return `/api/om/pdfs/${encodeURIComponent(pdfId)}/file?token=${encodeURIComponent(token)}`;
}

// Invalidate all caches for a pdfId (call when file is deleted or replaced)
function invalidatePdfCache(pdfId) {
  _bufferCache.delete(pdfId);
  _pdfDocCache.delete(pdfId);
  const url = _blobUrlCache.get(pdfId);
  if (url) {
    try { URL.revokeObjectURL(url); } catch (_) { /* noop */ }
    _blobUrlCache.delete(pdfId);
  }
}

// Scan QR codes from a PDF (given pre-loaded pdf document instance)
// Returns { trackingNumbers: string[], pagesCount: number }
async function scanQrFromPdfDoc(pdfDoc) {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader();

  const found = new Set();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const scale = 2.0;
  for (let p = 1; p <= pdfDoc.numPages; p += 1) {
    try {
      const page = await pdfDoc.getPage(p);
      const vp = page.getViewport({ scale });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      try {
        const result = await reader.decodeFromCanvas(canvas);
        const text = result?.getText?.() || '';
        if (text && text.trim()) found.add(text.trim());
      } catch {
        /* NotFoundException — no QR on this page */
      }
    } catch (e) {
      /* Continue on per-page errors */
    }
  }
  return {
    trackingNumbers: Array.from(found),
    pagesCount: pdfDoc.numPages,
  };
}

// Convenience: scan PDF by id (fetches, parses, scans, posts result)
// Returns the updated pdf item from server. Uses cached pdfDoc.
async function autoScanPdfById(pdfId) {
  const pdfDoc = await getPdfDoc(pdfId);
  const { trackingNumbers, pagesCount } = await scanQrFromPdfDoc(pdfDoc);
  const updated = await omApi(`pdfs/${pdfId}/scan-result`, {
    method: 'POST',
    body: JSON.stringify({ tracking_numbers: trackingNumbers, pages_count: pagesCount }),
  });
  return updated.item;
}

// ---------- Main List View ----------
export default function OMPdfsView({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewItem, setPreviewItem] = useState(null);
  const [scanningIds, setScanningIds] = useState(() => new Set());
  const [newlyAddedIds, setNewlyAddedIds] = useState(() => new Set()); // green-highlight for 3s
  const [notifSettings, setNotifSettings] = useState(() => loadNotifSettings());
  const [notifOpen, setNotifOpen] = useState(false);
  const fileInputRef = useRef(null);
  const scanQueueRef = useRef(new Set()); // ids currently in-flight to avoid double-scan

  // Preload pdf.js library at list mount so that opening preview is fast
  useEffect(() => { loadPdfJs().catch(() => {}); }, []);

  // Listen for global 'om:new-pdf' events (fired by useOMPdfNotifications).
  // Prepends the new item to the list AND highlights the card for 3 seconds.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onNew = (e) => {
      const item = e?.detail;
      if (!item?.id) return;
      setItems((prev) => {
        // If item already exists (e.g. we just uploaded it locally), just refresh it.
        const idx = prev.findIndex((x) => x.id === item.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...item };
          return next;
        }
        return [item, ...prev];
      });
      setNewlyAddedIds((prev) => new Set(prev).add(item.id));
      // Remove highlight after 3s
      setTimeout(() => {
        setNewlyAddedIds((prev) => {
          if (!prev.has(item.id)) return prev;
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }, 3000);
    };
    window.addEventListener('om:new-pdf', onNew);
    return () => window.removeEventListener('om:new-pdf', onNew);
  }, []);

  // Fetch GLOBAL notification settings from server on mount so the toggles
  // shown to the owner always reflect the actual saved config. Also listens
  // for local 'om:notif-settings-changed' broadcasts so if another component
  // (e.g. the hook itself) refreshes state, we stay in sync.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchGlobalNotifSettings();
      if (!cancelled) setNotifSettings(s);
    })();
    const onChange = (e) => {
      if (e?.detail) setNotifSettings(e.detail);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('om:notif-settings-changed', onChange);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('om:notif-settings-changed', onChange);
      }
    };
  }, []);

  // Setting toggle helpers — OWNER ONLY. Reads/writes GLOBAL server settings.
  // Non-owners never see the toggle UI (button is wrapped in `{isOwner && ...}`)
  // and even if they somehow trigger this handler, the backend returns 403.
  const toggleNotifSetting = async (key) => {
    if (!isOwner) {
      toast.error('Hanya owner yang dapat mengubah pengaturan notifikasi.');
      return;
    }
    if (key === 'browser' && !notifSettings.browser) {
      // Turning ON — request permission from THIS browser first. Note the
      // browser permission is per-device, not global; the global toggle just
      // controls whether the app WILL fire browser notifications for anyone
      // whose browser has already granted permission.
      const p = await requestBrowserPermission();
      if (p !== 'granted') {
        toast.error(p === 'denied' ? 'Izin browser notif ditolak. Aktifkan lewat pengaturan browser.' : 'Izin browser notif tidak diberikan.');
        return;
      }
    }
    const nextValue = !notifSettings[key];
    // Optimistic UI
    setNotifSettings((prev) => ({ ...prev, [key]: nextValue }));
    try {
      const server = await updateGlobalNotifSettings({ [key]: nextValue });
      setNotifSettings(server);
    } catch (e) {
      // Rollback on failure
      const status = e?.status || e?.response?.status;
      toast.error(status === 403 ? 'Hanya owner yang boleh mengubah pengaturan.' : 'Gagal menyimpan pengaturan notifikasi.');
      try {
        const fresh = await fetchGlobalNotifSettings();
        setNotifSettings(fresh);
      } catch {}
    }
  };

  const setItemScanning = useCallback((id, on) => {
    setScanningIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const runAutoScan = useCallback(async (id) => {
    if (scanQueueRef.current.has(id)) return;
    scanQueueRef.current.add(id);
    setItemScanning(id, true);
    try {
      const updated = await autoScanPdfById(id);
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
      const n = updated.detected_tracking_numbers?.length || 0;
      if (n > 0) {
        toast.success(`${n} resi terdeteksi dari ${updated.filename}`);
      } else {
        toast.info(`Tidak ada QR code terbaca di ${updated.filename}`);
      }
    } catch (e) {
      toast.error(`Gagal scan QR: ${e?.message || e}`);
    } finally {
      setItemScanning(id, false);
      scanQueueRef.current.delete(id);
    }
  }, [setItemScanning]);

  async function load() {
    setLoading(true);
    try {
      const d = await omApi('pdfs');
      setItems(d.items || []);
    } catch (e) {
      toast.error(e.message || 'Gagal memuat daftar PDF');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Auto-scan any PDF that hasn't been scanned yet (once items loaded)
  useEffect(() => {
    if (!items.length) return;
    const pending = items.filter((x) => !x.scanned_at && !scanQueueRef.current.has(x.id));
    // Scan sequentially to avoid CPU thrash
    (async () => {
      for (const it of pending) {
        // eslint-disable-next-line no-await-in-loop
        await runAutoScan(it.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  async function handleFiles(files) {
    if (!files || !files.length) return;
    setUploading(true);
    const uploadedIds = [];
    let ok = 0;
    let fail = 0;
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} > 10 MB, dilewati`);
        fail += 1;
        continue;
      }
      if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
        toast.error(`${file.name} bukan PDF, dilewati`);
        fail += 1;
        continue;
      }
      try {
        setUploadProgress(0);
        // eslint-disable-next-line no-await-in-loop
        const res = await uploadPdf(file, setUploadProgress);
        if (res?.item?.id) uploadedIds.push(res.item.id);
        ok += 1;
      } catch (e) {
        toast.error(`${file.name}: ${e.message}`);
        fail += 1;
      }
    }
    setUploading(false);
    setUploadProgress(0);
    if (ok > 0) toast.success(`${ok} file berhasil diunggah`);
    // Refresh list — auto-scan will kick in via useEffect for any unscanned items
    await load();
  }

  async function del(id, name) {
    if (!confirm(`Hapus "${name}"?`)) return;
    try {
      await omApi(`pdfs/${id}`, { method: 'DELETE' });
      invalidatePdfCache(id);
      toast.success('PDF dihapus');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  }

  const totalDetected = useMemo(
    () => items.reduce((s, x) => s + (x.detected_tracking_numbers?.length || 0), 0),
    [items]
  );
  const printedCount = useMemo(() => items.filter((x) => x.printed_at).length, [items]);
  const ketokoCount = useMemo(() => items.filter((x) => x.ketoko_input_at).length, [items]);
  const isOwner = user?.role === 'owner';

  async function toggleKetoko(item, next) {
    // Optimistic update
    setItems((prev) =>
      prev.map((x) =>
        x.id === item.id
          ? {
              ...x,
              ketoko_input_at: next ? new Date().toISOString() : null,
              ketoko_input_by_name: next ? user?.name || 'You' : null,
              ketoko_input_by_id: next ? user?.id : null,
            }
          : x
      )
    );
    try {
      const r = await omApi(`pdfs/${item.id}/ketoko`, {
        method: 'POST',
        body: JSON.stringify({ input: !!next }),
      });
      setItems((prev) => prev.map((x) => (x.id === item.id ? r.item : x)));
    } catch (e) {
      toast.error(e.message || 'Gagal update POS KETOKO');
      load();
    }
  }

  // Open PDF preview + record the open event on the server (increments open_count,
  // updates last_open_at, first_open_at if first time).
  async function openPdf(item) {
    // Show preview immediately for speed.
    setPreviewItem(item);
    // Optimistic bump so the button turns red / status flips right away.
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((x) =>
        x.id === item.id
          ? {
              ...x,
              first_open_at: x.first_open_at || nowIso,
              first_open_by_id: x.first_open_by_id || user?.id || null,
              first_open_by_name: x.first_open_by_name || user?.name || 'You',
              last_open_at: nowIso,
              last_open_by_id: user?.id || null,
              last_open_by_name: user?.name || 'You',
              open_count: (x.open_count || 0) + 1,
            }
          : x
      )
    );
    try {
      const r = await omApi(`pdfs/${item.id}/open`, { method: 'POST' });
      if (r?.item) {
        setItems((prev) => prev.map((x) => (x.id === item.id ? r.item : x)));
      }
    } catch (e) {
      // Silent — the preview is already showing; just log.
      // eslint-disable-next-line no-console
      console.warn('[open] gagal catat event:', e?.message || e);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">PDF Resi</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">
            Kirim PDF label resi dari HP · auto-scan QR · buka & print di sini
          </p>
        </div>
        <div className="flex items-center gap-2 relative">
          {/* Notification settings toggle — owner only */}
          {isOwner && (
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNotifOpen((v) => !v)}
              className="gap-2 relative"
              title="Pengaturan Notifikasi PDF Baru"
            >
              {notifSettings.popup || notifSettings.sound || notifSettings.browser ? (
                <Bell className="w-4 h-4 text-emerald-400" />
              ) : (
                <BellOff className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="hidden sm:inline">Notifikasi</span>
            </Button>
            {notifOpen && (
              <>
                {/* Backdrop for outside-click */}
                <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-white/10 bg-neutral-950/95 backdrop-blur shadow-xl shadow-black/40 p-3 space-y-1">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-1 pb-1">
                    Notifikasi PDF Baru
                  </div>
                  {/* Popup toggle */}
                  <button
                    onClick={() => toggleNotifSetting('popup')}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${notifSettings.popup ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-muted-foreground'}`}>
                      📄
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">Popup In-App</div>
                      <div className="text-[10px] text-muted-foreground">Popup di pojok kanan bawah</div>
                    </div>
                    <div className={`w-9 h-5 rounded-full relative transition-colors ${notifSettings.popup ? 'bg-emerald-500' : 'bg-white/10'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${notifSettings.popup ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  {/* Sound toggle */}
                  <button
                    onClick={() => toggleNotifSetting('sound')}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${notifSettings.sound ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-muted-foreground'}`}>
                      {notifSettings.sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">Suara Ding-Dong</div>
                      <div className="text-[10px] text-muted-foreground">Bunyi ±0.5 detik saat PDF masuk</div>
                    </div>
                    <div className={`w-9 h-5 rounded-full relative transition-colors ${notifSettings.sound ? 'bg-emerald-500' : 'bg-white/10'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${notifSettings.sound ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  {/* Browser toggle */}
                  <button
                    onClick={() => toggleNotifSetting('browser')}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${notifSettings.browser ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-muted-foreground'}`}>
                      <MonitorSmartphone className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">Browser Notification</div>
                      <div className="text-[10px] text-muted-foreground">Muncul saat tab lain / minimized</div>
                    </div>
                    <div className={`w-9 h-5 rounded-full relative transition-colors ${notifSettings.browser ? 'bg-emerald-500' : 'bg-white/10'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${notifSettings.browser ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  <div className="text-[10px] text-muted-foreground text-center pt-1 border-t border-white/5 mt-1">
                    Polling tiap 5 detik · setelan tersimpan per browser
                  </div>
                </div>
              </>
            )}
          </div>
          )}
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {isOwner && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Mengunggah {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" /> Unggah PDF
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="pt-5 pb-4">
            <div className="text-xs text-muted-foreground">Total File</div>
            <div className="text-2xl font-bold mt-1">{items.length}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="pt-5 pb-4">
            <div className="text-xs text-emerald-300">Resi Terdeteksi</div>
            <div className="text-2xl font-bold mt-1 text-emerald-400">{totalDetected}</div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-5 pb-4">
            <div className="text-xs text-blue-300">Sudah Diprint</div>
            <div className="text-2xl font-bold mt-1 text-blue-400">
              {printedCount}<span className="text-sm text-muted-foreground">/{items.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-5 pb-4">
            <div className="text-xs text-amber-300 flex items-center gap-1">
              <Store className="w-3 h-3" /> Input KETOKO
            </div>
            <div className="text-2xl font-bold mt-1 text-amber-400">
              {ketokoCount}<span className="text-sm text-muted-foreground">/{items.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10">
              <FileText className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <div className="text-sm text-muted-foreground">Belum ada PDF diunggah.</div>
              <div className="text-xs text-muted-foreground/70 mt-1">
                {isOwner
                  ? 'Klik "Unggah PDF" untuk mulai — bisa pilih dari galeri / file HP.'
                  : 'Hanya owner (ADMIN) yang dapat mengunggah PDF resi.'}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((it) => (
                <PdfRow
                  key={it.id}
                  item={it}
                  isOwner={isOwner}
                  isScanning={scanningIds.has(it.id)}
                  isNew={newlyAddedIds.has(it.id)}
                  onOpen={() => openPdf(it)}
                  onDelete={() => del(it.id, it.filename)}
                  onToggleKetoko={(next) => toggleKetoko(it, next)}
                  onRescan={() => runAutoScan(it.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview modal */}
      {previewItem && (
        <PdfPreviewModal
          pdfId={previewItem.id}
          initialMeta={previewItem}
          onClose={() => setPreviewItem(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ---------- Row (with inline detected tracking numbers on the right) ----------
function PdfRow({ item, isOwner, isScanning, isNew, onOpen, onDelete, onToggleKetoko, onRescan }) {
  const detected = item.detected_tracking_numbers || [];
  const hasScan = !!item.scanned_at;
  const printed = !!item.printed_at;
  const ketokoChecked = !!item.ketoko_input_at;

  // ------ Dynamic PIN verification (inline, no modal) ------
  // pin === null → panel closed; string → panel open with that PIN.
  const [pin, setPin] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pendingChecked, setPendingChecked] = useState(null);
  const [shake, setShake] = useState(false);
  const pinInputRef = useRef(null);

  const focusPinInput = () => {
    // Delay so element is mounted after state change.
    setTimeout(() => {
      pinInputRef.current?.focus();
      pinInputRef.current?.select?.();
    }, 30);
  };

  const openPinPanel = (nextChecked) => {
    setPin(generatePin());
    setPinInput('');
    setPendingChecked(nextChecked);
    focusPinInput();
  };

  const closePinPanel = () => {
    setPin(null);
    setPinInput('');
    setPendingChecked(null);
    setShake(false);
  };

  const submitPin = () => {
    if (!pin) return;
    if (pinInput === pin) {
      // Correct — run the underlying toggle then close panel.
      const next = pendingChecked;
      closePinPanel();
      onToggleKetoko(next);
    } else {
      // Wrong — regenerate PIN, clear input, keep panel open, refocus.
      setPin(generatePin());
      setPinInput('');
      setShake(true);
      setTimeout(() => setShake(false), 400);
      focusPinInput();
    }
  };

  const copyAll = async () => {
    if (!detected.length) return;
    try {
      await navigator.clipboard.writeText(detected.join('\n'));
      toast.success('Nomor resi disalin');
    } catch {
      toast.error('Gagal menyalin');
    }
  };

  // ------ Dynamic PIN verification for "Buka Lagi" (re-open PDF) ------
  const openCount = item.open_count || 0;
  const hasBeenOpened = openCount > 0 || !!item.first_open_at;
  const [openPin, setOpenPin] = useState(null);
  const [openPinInput, setOpenPinInput] = useState('');
  const [openShake, setOpenShake] = useState(false);
  const openPinInputRef = useRef(null);

  const focusOpenPinInput = () => {
    setTimeout(() => {
      openPinInputRef.current?.focus();
      openPinInputRef.current?.select?.();
    }, 30);
  };

  const openOpenPinPanel = () => {
    setOpenPin(generatePin());
    setOpenPinInput('');
    focusOpenPinInput();
  };

  const closeOpenPinPanel = () => {
    setOpenPin(null);
    setOpenPinInput('');
    setOpenShake(false);
  };

  const submitOpenPin = () => {
    if (!openPin) return;
    if (openPinInput === openPin) {
      closeOpenPinPanel();
      // Correct — actually open PDF (this also increments open_count on server).
      onOpen();
    } else {
      // Wrong — regenerate PIN, clear input, keep panel open, refocus.
      setOpenPin(generatePin());
      setOpenPinInput('');
      setOpenShake(true);
      setTimeout(() => setOpenShake(false), 400);
      focusOpenPinInput();
    }
  };

  const handleBukaClick = () => {
    if (!hasBeenOpened) {
      // First open — go directly, no PIN.
      onOpen();
    } else {
      // Already opened before — require PIN inline.
      openOpenPinPanel();
    }
  };

  return (
    <div
      className={`rounded-lg border transition-all duration-300 ${
        isNew
          ? 'border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-500/30'
          : 'border-white/5 hover:bg-white/[0.02]'
      }`}
    >
      {/* Top row: file info + KETOKO + actions */}
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${printed ? 'bg-blue-500/10' : 'bg-white/[0.03]'}`}>
          <FileText className={`w-5 h-5 ${printed ? 'text-blue-400' : 'text-muted-foreground'}`} />
        </div>
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-medium text-sm truncate max-w-[280px]" title={item.filename}>
              {item.filename}
            </div>
            {printed && (
              <Badge variant="outline" className="border-blue-500/40 text-blue-300 text-[9px] gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" /> PRINTED
              </Badge>
            )}
            {isScanning ? (
              <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[9px] gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> SCANNING...
              </Badge>
            ) : hasScan ? (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[9px] gap-1">
                <QrCode className="w-2.5 h-2.5" /> {detected.length} RESI
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[9px]">
                BELUM SCAN
              </Badge>
            )}
            {/* PDF open status badge */}
            {hasBeenOpened ? (
              <Badge
                variant="outline"
                className="border-rose-500/40 text-rose-300 text-[9px] gap-1"
                title={`Terakhir dibuka oleh ${item.last_open_by_name || '-'} · ${fmtDate(item.last_open_at)}`}
              >
                <Eye className="w-2.5 h-2.5" /> SUDAH DIBUKA · {openCount}x
              </Badge>
            ) : (
              <Badge variant="outline" className="border-white/15 text-muted-foreground text-[9px]">
                BELUM DIBUKA
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{fmtBytes(item.size)}</span>
            {item.pages_count != null && <span>· {item.pages_count} hal.</span>}
            <span>· {fmtDate(item.uploaded_at)}</span>
            <span>· oleh {item.uploaded_by_name}</span>
            {hasBeenOpened && item.last_open_at && (
              <span className="text-rose-300/80">
                · buka: {item.last_open_by_name} · {fmtDate(item.last_open_at)}
              </span>
            )}
          </div>
        </div>

        {/* KETOKO POS input checkbox — with inline PIN verification */}
        <label
          className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors shrink-0 select-none ${
            pin !== null
              ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
              : ketokoChecked
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-white/10 hover:bg-white/[0.04] text-muted-foreground'
          }`}
          title={ketokoChecked ? `Diinput oleh ${item.ketoko_input_by_name} · ${fmtDate(item.ketoko_input_at)}` : 'Klik jika sudah input ke POS KETOKO'}
        >
          <input
            type="checkbox"
            checked={ketokoChecked}
            disabled={pin !== null}
            onChange={(e) => {
              // Do NOT run POS KETOKO immediately — open PIN panel first.
              if (pin !== null) return; // already verifying
              openPinPanel(e.target.checked);
            }}
            className="w-4 h-4 accent-amber-500 cursor-pointer"
          />
          <Store className="w-3.5 h-3.5" />
          <div className="text-xs leading-tight">
            <div className="font-medium">POS KETOKO</div>
            {ketokoChecked ? (
              <div className="text-[10px] opacity-80 truncate max-w-[130px]" title={item.ketoko_input_by_name}>
                {item.ketoko_input_by_name} · {fmtDate(item.ketoko_input_at)}
              </div>
            ) : (
              <div className="text-[10px] opacity-70">belum diinput</div>
            )}
          </div>
        </label>

        {/* Inline PIN verification panel — appears right below the KETOKO button (basis-full = wraps to new line inside the same flex row) */}
        {pin !== null && (
          <div
            className={`basis-full w-full mt-1 p-3 rounded-md border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-amber-500/5 ${
              shake ? 'animate-[shake_0.35s_ease-in-out]' : ''
            }`}
            style={shake ? { animation: 'ketoko-shake 0.35s ease-in-out' } : undefined}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-300 shrink-0" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-amber-200/70">Kode Verifikasi</div>
                  <div className="font-mono text-2xl font-bold tracking-[0.35em] text-amber-300 select-none leading-none mt-0.5">
                    {pin}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-w-[140px]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Input PIN</div>
                <input
                  ref={pinInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  value={pinInput}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setPinInput(v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitPin(); }
                    else if (e.key === 'Escape') { e.preventDefault(); closePinPanel(); }
                  }}
                  placeholder="••••"
                  maxLength={4}
                  className="w-full h-9 px-3 rounded-md bg-black/30 border border-amber-500/30 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/50 font-mono text-lg text-center tracking-[0.35em] text-amber-100"
                />
              </div>

              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={submitPin}
                  disabled={pinInput.length !== 4}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Konfirmasi
                </Button>
                <Button size="sm" variant="outline" onClick={closePinPanel}>
                  Batal
                </Button>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-2">
              Ketik ulang kode di atas untuk mengonfirmasi tindakan POS KETOKO. Enter = Konfirmasi · Esc = Batal.
            </div>
          </div>
        )}

        <div className="flex gap-1 shrink-0">
          {hasBeenOpened ? (
            <Button
              size="sm"
              onClick={handleBukaClick}
              disabled={openPin !== null}
              className="gap-1 bg-rose-500 hover:bg-rose-600 text-white border-rose-500 disabled:opacity-70"
              title={`Sudah dibuka ${openCount}x — verifikasi PIN diperlukan`}
            >
              <Eye className="w-3.5 h-3.5" /> Buka Lagi
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleBukaClick}
              className="gap-1 border-blue-500/40 text-blue-300 hover:bg-blue-500/10"
              title="Buka PDF pertama kali (tanpa PIN)"
            >
              <Eye className="w-3.5 h-3.5" /> Buka
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={onRescan}
            disabled={isScanning}
            title="Scan ulang QR"
          >
            {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
          </Button>
          {isOwner && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onDelete}
              className="text-rose-400 hover:text-rose-300"
              title="Hapus (owner)"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Inline PIN verification panel for "Buka Lagi" (re-open) — appears right below button row */}
        {openPin !== null && (
          <div
            className="basis-full w-full mt-1 p-3 rounded-md border border-rose-500/40 bg-gradient-to-br from-rose-500/10 to-rose-500/5"
            style={openShake ? { animation: 'ketoko-shake 0.35s ease-in-out' } : undefined}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-rose-300 shrink-0" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-rose-200/70">Kode Verifikasi (Buka Lagi)</div>
                  <div className="font-mono text-2xl font-bold tracking-[0.35em] text-rose-300 select-none leading-none mt-0.5">
                    {openPin}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-w-[140px]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Input PIN</div>
                <input
                  ref={openPinInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  value={openPinInput}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setOpenPinInput(v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitOpenPin(); }
                    else if (e.key === 'Escape') { e.preventDefault(); closeOpenPinPanel(); }
                  }}
                  placeholder="••••"
                  maxLength={4}
                  className="w-full h-9 px-3 rounded-md bg-black/30 border border-rose-500/30 focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400/50 font-mono text-lg text-center tracking-[0.35em] text-rose-100"
                />
              </div>

              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={submitOpenPin}
                  disabled={openPinInput.length !== 4}
                  className="bg-rose-500 hover:bg-rose-600 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Konfirmasi
                </Button>
                <Button size="sm" variant="outline" onClick={closeOpenPinPanel}>
                  Batal
                </Button>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-2">
              Ketik ulang kode di atas untuk membuka kembali PDF <span className="font-mono text-rose-200/80">{item.filename}</span>. Enter = Konfirmasi · Esc = Batal.
            </div>
          </div>
        )}
      </div>

      {/* Inline detected tracking numbers (chips) — shown right after upload / after auto-scan */}
      {(isScanning || hasScan) && (
        <div className="px-3 pb-3 pt-0 border-t border-white/5 mt-1">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5">
              <QrCode className="w-3 h-3 text-emerald-400" />
              Nomor Resi Terdeteksi
            </div>
            {detected.length > 0 && (
              <button
                type="button"
                onClick={copyAll}
                className="text-[10px] text-muted-foreground hover:text-white inline-flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> Salin semua
              </button>
            )}
          </div>
          {isScanning && detected.length === 0 ? (
            <div className="text-xs text-amber-300/80 flex items-center gap-2 py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Membaca QR pada tiap halaman...
            </div>
          ) : detected.length === 0 ? (
            <div className="text-xs text-muted-foreground/70 py-1">
              Tidak ada QR code terbaca. Pastikan PDF berisi label resi dengan barcode/QR.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detected.map((tn, i) => (
                <span
                  key={tn + i}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono"
                  title={tn}
                >
                  <QrCode className="w-3 h-3 opacity-70" />
                  {tn}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Preview Modal (renders PDF pages to canvas via pdf.js + Print) ----------
function PdfPreviewModal({ pdfId, initialMeta, onClose, onChanged }) {
  const [meta, setMeta] = useState(initialMeta || null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(initialMeta?.pages_count || 0);
  const [renderedPages, setRenderedPages] = useState(0);
  const [error, setError] = useState(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null); // for print / open-in-new-tab
  const canvasesRef = useRef([]);

  // Open pdf doc (uses module-level cache — instant if already scanned)
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPdfDoc(null);
    setRenderedPages(0);

    // Kick off blob URL creation in parallel (used only for print / fallback)
    getPdfBlobUrl(pdfId)
      .then((u) => { if (!cancelled) setPdfBlobUrl(u); })
      .catch((e) => console.error('[PDF preview] blob URL failed:', e));

    (async () => {
      try {
        const doc = await getPdfDoc(pdfId);
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      } catch (e) {
        console.error('[PDF preview] getPdfDoc failed:', e);
        if (!cancelled) setError(e?.message || String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [pdfId]);

  // Render pages progressively — first page first so user sees content ASAP
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      for (let p = 1; p <= pdfDoc.numPages; p += 1) {
        if (cancelled) return;
        // Wait for the canvas element to mount (up to ~500ms).
        // React may not have committed the new canvas array yet if numPages just grew.
        let c = canvasesRef.current[p - 1];
        for (let tries = 0; !c && tries < 30; tries += 1) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 20));
          if (cancelled) return;
          c = canvasesRef.current[p - 1];
        }
        if (!c) {
          console.warn(`[PDF preview] canvas ${p} not mounted, skipping`);
          continue;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const page = await pdfDoc.getPage(p);
          const parent = c.parentElement;
          const parentW = parent?.clientWidth || 700;
          const targetWidth = Math.min(1000, Math.max(320, parentW - 8));
          const initialVp = page.getViewport({ scale: 1 });
          const scale = targetWidth / initialVp.width;
          const vp = page.getViewport({ scale });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          c.width = Math.floor(vp.width * dpr);
          c.height = Math.floor(vp.height * dpr);
          c.style.width = `${Math.floor(vp.width)}px`;
          c.style.height = `${Math.floor(vp.height)}px`;
          const ctx = c.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          // eslint-disable-next-line no-await-in-loop
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          if (!cancelled) setRenderedPages((n) => Math.max(n, p));
        } catch (renderErr) {
          console.error(`[PDF preview] page ${p} render failed:`, renderErr);
          /* per-page render error, keep going */
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc]);

  const handlePrint = async () => {
    // Use the AUTHENTICATED direct server URL, NOT a blob URL.
    // - Server sends `Content-Disposition: inline` + `Content-Type: application/pdf`,
    //   so the browser opens its native PDF viewer (Chrome PDFium / Firefox
    //   pdf.js / Safari Preview) instead of the blob:// HTML wrapper.
    // - Native viewer prints byte-identical to the original file (2 pages
    //   stay 2 pages, no cropping, no HTML chrome).
    const serverUrl = getPdfServerUrl(pdfId);
    const w = window.open(serverUrl, '_blank');
    if (!w) {
      toast.error('Popup diblokir. Izinkan popup untuk print.');
      return;
    }
    // Attempt to trigger the print dialog automatically once the PDF finishes
    // loading in the new tab. Cross-origin/PDF-viewer nuances mean this may
    // silently no-op on some browsers — that's fine, user can Ctrl+P manually.
    // The critical outcome (native PDF viewer instead of Blob Viewer HTML) is
    // already achieved just by opening the direct URL.
    try {
      w.addEventListener('load', () => {
        try { w.focus(); w.print(); } catch (_) { /* print blocked or viewer handles it */ }
      });
    } catch (_) { /* new-tab window not accessible (cross-origin lockdown) */ }
    omApi(`pdfs/${pdfId}/mark-printed`, { method: 'POST' })
      .then((r) => {
        setMeta(r.item);
        onChanged?.();
      })
      .catch(() => {});
  };

  const detectedList = meta?.detected_tracking_numbers || [];
  // Skeleton page count: prefer meta.pages_count so canvases are placeholders even before pdf.js opens
  const skeletonCount = numPages || meta?.pages_count || 1;
  const pagesReady = pdfDoc != null;

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] p-0 gap-0 max-h-[92vh] flex flex-col">
        <DialogHeader className="p-4 pb-3 border-b border-white/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base truncate">
                {meta?.filename || 'PDF Preview'}
              </DialogTitle>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                {meta && (
                  <>
                    <span>{fmtBytes(meta.size)}</span>
                    {meta.pages_count != null && <span>· {meta.pages_count} hal.</span>}
                    <span className="flex items-center gap-1">
                      · <QrCode className="w-3 h-3" /> {detectedList.length} resi
                    </span>
                    {pagesReady && renderedPages < numPages && (
                      <span className="text-amber-300/80 flex items-center gap-1">
                        · <Loader2 className="w-3 h-3 animate-spin" /> merender {renderedPages}/{numPages}
                      </span>
                    )}
                    {meta.printed_at && (
                      <Badge variant="outline" className="border-blue-500/40 text-blue-300 text-[9px] gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> PRINTED · {fmtDate(meta.printed_at)}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap justify-end">
              {/* "Buka di tab baru" now points to the DIRECT server URL (not
                  blob). Browser opens the native PDF viewer, so the tab shows
                  the real PDF instead of a Blob Viewer HTML wrapper. */}
              <a
                href={getPdfServerUrl(pdfId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-white/10 text-xs hover:bg-white/[0.04] whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5" /> Buka di tab baru
              </a>
              {/* Print button is available immediately — the direct URL doesn't
                  need any blob preparation to be ready. */}
              <Button size="sm" onClick={handlePrint} className="gap-1">
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onClose}
                className="gap-1 border-white/20 hover:bg-white/10"
                title="Tutup preview (Esc)"
              >
                <X className="w-3.5 h-3.5" /> Tutup
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 grid md:grid-cols-[1fr_280px] min-h-0">
          {/* PDF viewer — pdf.js canvas render, no iframe */}
          <div className="bg-neutral-900 relative min-h-[400px] md:min-h-0 overflow-y-auto p-3">
            {error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-sm p-6 text-center gap-3">
                <div className="text-rose-400">Gagal memuat preview: {error}</div>
                <a
                  href={getPdfServerUrl(pdfId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-white"
                >
                  <Eye className="w-4 h-4" /> Buka di tab baru
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {Array.from({ length: skeletonCount }).map((_, i) => (
                  <div key={i} className="relative w-full flex justify-center">
                    <canvas
                      ref={(el) => { canvasesRef.current[i] = el; }}
                      className="bg-white shadow-lg rounded-sm max-w-full"
                      style={{ minHeight: pagesReady && i < renderedPages ? undefined : '260px', minWidth: '220px' }}
                    />
                    {(!pagesReady || i >= renderedPages) && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <div className="text-[10px]">Halaman {i + 1}</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {pdfBlobUrl && (
                  <a
                    href={getPdfServerUrl(pdfId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-white underline mt-2"
                  >
                    Buka di tab baru
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Detected tracking numbers panel */}
          <div className="border-t md:border-t-0 md:border-l border-white/10 p-3 space-y-2 overflow-y-auto max-h-[320px] md:max-h-none">
            <div className="text-xs font-medium text-muted-foreground">
              Resi terdeteksi ({detectedList.length})
            </div>
            {detectedList.length === 0 ? (
              <div className="text-xs text-muted-foreground/70 py-6 text-center">
                Belum ada resi terdeteksi. Auto-scan akan berjalan otomatis di halaman daftar.
              </div>
            ) : (
              <div className="space-y-1">
                {detectedList.map((tn, i) => (
                  <div
                    key={tn + i}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.03] border border-white/5 text-xs font-mono"
                  >
                    <QrCode className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate flex-1">{tn}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sticky footer — quick action to return to list & print the next resi */}
        <div className="border-t border-white/10 p-3 flex items-center justify-between gap-2 bg-neutral-950/60 backdrop-blur-sm">
          <div className="text-[11px] text-muted-foreground hidden sm:block">
            Tekan <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[10px] font-mono">Esc</kbd> untuk tutup, atau klik tombol di bawah.
          </div>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" onClick={handlePrint} className="gap-1">
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onClose}
              className="gap-1.5 border-white/20 hover:bg-white/10"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke Daftar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
