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
  Barcode,
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
  ZoomIn,
  ZoomOut,
  Lock,
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
//
// A `_ts=<now>` cache-buster is added on every call so the browser never
// serves a stale 404 (or any cached bytes) from a previous request. This
// matters when a pod-restart/route-shift briefly returned 404 for a PDF
// before the DB-backed fix kicked in — the user should be able to just
// click "Buka" again without a hard reload.
function getPdfServerUrl(pdfId) {
  if (typeof window === 'undefined') return '';
  const token = window.localStorage.getItem('cc_token') || '';
  const ts = Date.now();
  return `/api/om/pdfs/${encodeURIComponent(pdfId)}/file?token=${encodeURIComponent(token)}&_ts=${ts}`;
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

// Scan codes from a PDF (given pre-loaded pdf document instance)
// Returns { trackingNumbers: string[], pagesCount: number, detectedVia: 'qr'|'barcode'|null }
//
// READ ORDER (spec — sequential, QR wins):
//   1) Full pass over every page trying QR_CODE only. If ANY QR is found
//      across the whole PDF, return those results immediately with
//      detectedVia='qr'.
//   2) Only if pass 1 returned zero QR codes: full pass over every page
//      trying common 1D barcodes (Code128, Code39, EAN, UPC, ITF, Codabar).
//      Returns detectedVia='barcode' when anything is found.
//   3) If both passes find nothing, return empty + detectedVia=null (existing
//      "belum terdeteksi" flow kicks in on the server side).
//
// The QR-only first pass preserves 100% backward compatibility: PDFs that
// already worked continue to produce identical results, and the barcode
// pass never fires. Barcode fallback only ever runs when the previous
// implementation would have returned an empty array anyway.
async function scanQrFromPdfDoc(pdfDoc) {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');

  // Reader restricted to QR only — this is the identical logic the parser
  // used before this patch, just wrapped in an explicit hint so it can't
  // accidentally match a 1D barcode on a page that also has a QR.
  const qrHints = new Map();
  qrHints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  const qrReader = new BrowserMultiFormatReader(qrHints);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  // Turn off canvas image smoothing so barcode bars stay crisp when
  // scaled — anti-aliasing turns thin black bars into gray gradient which
  // ZXing struggles to threshold correctly on Code128 labels.
  if (ctx && 'imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
  const scale = 2.0;

  // ---- PASS 1: QR only ----
  // For each page, try scale 2.0 first (proven-good for 4/5 pages in production
  // test PDF). If ZXing throws NotFoundException on that page, retry with an
  // additional larger scale — SAME parser, SAME algorithm, only the render
  // resolution changes. This unblocks pages whose QR was slightly out of the
  // decoder's sweet spot at scale 2.0 (e.g. page 5 of the test PDF).
  const qrScales = [2.0, 3.5];
  const foundQr = new Set();
  for (let p = 1; p <= pdfDoc.numPages; p += 1) {
    let decoded = false;
    for (let si = 0; si < qrScales.length && !decoded; si += 1) {
      const s = qrScales[si];
      try {
        const page = await pdfDoc.getPage(p);
        const vp = page.getViewport({ scale: s });
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        try {
          const result = await qrReader.decodeFromCanvas(canvas);
          const text = result?.getText?.() || '';
          if (text && text.trim()) {
            foundQr.add(text.trim());
            decoded = true;
          }
        } catch {
          /* NotFoundException — try next scale, else move to next page */
        }
      } catch (_e) {
        /* Continue on per-page errors */
      }
    }
  }
  if (foundQr.size > 0) {
    return {
      trackingNumbers: Array.from(foundQr),
      pagesCount: pdfDoc.numPages,
      detectedVia: 'qr',
    };
  }

  // ---- PASS 2a: PDF TEXT EXTRACTION (fast, high-precision fallback) ----
  //
  // Most shipping labels print the tracking number as SELECTABLE TEXT next
  // to the barcode (e.g. "No. Pesanan: 260805H9PWBVJ2" on Grab Instant,
  // "Nomor Resi:" on JNE etc.). pdf.js exposes this via getTextContent()
  // without any image processing — much more reliable than trying to
  // decode a possibly-antialiased raster barcode.
  //
  // Strategy: pull every text item on every page, look for lines that
  // start with one of the well-known Indonesian label keywords, then take
  // the alphanumeric identifier that follows. Labeled as barcode source
  // (`detectedVia = 'barcode'`) so the UI still says "NOMOR BARCODE
  // TERDETEKSI" — from the operator's perspective this IS the barcode
  // number, just captured from the embedded text stream instead of by
  // decoding the raster bars.
  const TRACKING_LABEL_RX = /(?:no\.?\s*pesanan|nomor?\s*(?:resi|pesanan|awb)|no\.?\s*resi|awb|tracking\s*number|order\s*(?:id|no|number)|shipping\s*id|receipt\s*no)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{6,29})/gi;
  const CANDIDATE_RX = /^[A-Z0-9][A-Z0-9\-]{7,29}$/;
  const foundText = new Set();
  for (let p = 1; p <= pdfDoc.numPages; p += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const page = await pdfDoc.getPage(p);
      // eslint-disable-next-line no-await-in-loop
      const tc = await page.getTextContent();
      // Concatenate text items into a single string per page for regex search.
      const text = (tc?.items || [])
        .map((it) => (typeof it?.str === 'string' ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ');
      // Match labeled tracking numbers
      let m;
      TRACKING_LABEL_RX.lastIndex = 0;
      while ((m = TRACKING_LABEL_RX.exec(text)) !== null) {
        const candidate = String(m[1] || '').trim().toUpperCase();
        if (candidate && CANDIDATE_RX.test(candidate)) foundText.add(candidate);
      }
    } catch (_e) {
      /* per-page text extraction failure — continue */
    }
  }
  if (foundText.size > 0) {
    return {
      trackingNumbers: Array.from(foundText),
      pagesCount: pdfDoc.numPages,
      detectedVia: 'barcode',
    };
  }

  // ---- PASS 2b: 1D BARCODE image decode (fires when text extraction
  //               didn't find anything either — labels with no embedded
  //               text or where text uses different keywords).
  const barcodeHints = new Map();
  barcodeHints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
  ]);
  // TRY_HARDER makes ZXing scan the image more thoroughly (rotations,
  // partial regions) — necessary for 1D barcodes that sit inside a
  // dense label layout. It's slower but only runs when we've already
  // failed to find a QR, so the average cost is negligible.
  barcodeHints.set(DecodeHintType.TRY_HARDER, true);
  const barcodeReader = new BrowserMultiFormatReader(barcodeHints);

  // 1D barcodes need MORE pixels-per-bar than QR codes to decode reliably.
  // At scale 2.0 (the QR pass) narrow bars often alias into a single blur,
  // producing a NotFoundException. We retry each page at progressively
  // higher scales AND — for expedition labels that put the barcode near
  // the top of the label — we also try a cropped top-third of the page
  // to remove noisy background from the decode. Only runs when QR failed.
  const barcodeScales = [3.5, 5.0, 2.5];
  const foundBarcode = new Set();
  for (let p = 1; p <= pdfDoc.numPages; p += 1) {
    let decodedThisPage = false;
    for (const s of barcodeScales) {
      if (decodedThisPage) break;
      try {
        const page = await pdfDoc.getPage(p);
        const vp = page.getViewport({ scale: s });
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        // Render page at this scale
        // eslint-disable-next-line no-await-in-loop
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        // Attempt 1: full page at this scale
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await barcodeReader.decodeFromCanvas(canvas);
          const text = result?.getText?.() || '';
          if (text && text.trim()) {
            foundBarcode.add(text.trim());
            decodedThisPage = true;
            continue;
          }
        } catch { /* nothing on full page — try cropped attempts */ }

        // Attempt 2: crop to top-half (many labels have barcode near top).
        // We reuse the same canvas by copying its top region to a scratch
        // canvas of matching dimensions.
        try {
          const scratch = document.createElement('canvas');
          const cropH = Math.max(1, Math.floor(canvas.height * 0.55));
          scratch.width = canvas.width;
          scratch.height = cropH;
          const sctx = scratch.getContext('2d');
          sctx.drawImage(canvas, 0, 0, canvas.width, cropH, 0, 0, canvas.width, cropH);
          // eslint-disable-next-line no-await-in-loop
          const result = await barcodeReader.decodeFromCanvas(scratch);
          const text = result?.getText?.() || '';
          if (text && text.trim()) {
            foundBarcode.add(text.trim());
            decodedThisPage = true;
            continue;
          }
        } catch { /* try bottom half next */ }

        // Attempt 3: crop to bottom-half (barcodes sometimes at bottom).
        try {
          const scratch = document.createElement('canvas');
          const cropH = Math.max(1, Math.floor(canvas.height * 0.55));
          scratch.width = canvas.width;
          scratch.height = cropH;
          const sctx = scratch.getContext('2d');
          sctx.drawImage(
            canvas,
            0, canvas.height - cropH, canvas.width, cropH,
            0, 0, canvas.width, cropH
          );
          // eslint-disable-next-line no-await-in-loop
          const result = await barcodeReader.decodeFromCanvas(scratch);
          const text = result?.getText?.() || '';
          if (text && text.trim()) {
            foundBarcode.add(text.trim());
            decodedThisPage = true;
          }
        } catch { /* still nothing — move to next scale */ }
      } catch (_e) {
        /* Continue on per-page/per-scale errors */
      }
    }
  }
  return {
    trackingNumbers: Array.from(foundBarcode),
    pagesCount: pdfDoc.numPages,
    detectedVia: foundBarcode.size > 0 ? 'barcode' : null,
  };
}

// Convenience: scan PDF by id (fetches, parses, scans, posts result)
// Returns the updated pdf item from server. Uses cached pdfDoc.
async function autoScanPdfById(pdfId) {
  const pdfDoc = await getPdfDoc(pdfId);
  const { trackingNumbers, pagesCount, detectedVia } = await scanQrFromPdfDoc(pdfDoc);
  const updated = await omApi(`pdfs/${pdfId}/scan-result`, {
    method: 'POST',
    // detected_via is an OPTIONAL additive field — servers that ignore it
    // still work exactly as before. When present, it lets the list UI show
    // "NOMOR QR TERDETEKSI" vs "NOMOR BARCODE TERDETEKSI" so operators know
    // which parser pass produced the reading.
    body: JSON.stringify({
      tracking_numbers: trackingNumbers,
      pages_count: pagesCount,
      detected_via: detectedVia,
    }),
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
      // Request MAX limit supported by backend (500) so all PDFs within
      // pdf_retention_days (default 7) are visible — not just today's ~100.
      // Prior default of 100 caused "list mentok H+1" when daily PDF volume
      // exceeded 100. Backend still returns only non-deleted items.
      const d = await omApi('pdfs?limit=500');
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

  // ---- Filter state (frontend-only, uses existing fields) ----
  const [periodFilter, setPeriodFilter] = useState('week'); // 'today' | 'week' | 'range'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredItems = useMemo(() => {
    const now = new Date();
    let start = null, end = null;
    if (periodFilter === 'today') {
      start = new Date(now); start.setHours(0, 0, 0, 0);
      end = new Date(now); end.setHours(23, 59, 59, 999);
    } else if (periodFilter === 'week') {
      start = new Date(now.getTime() - 7 * 86400000);
      end = new Date(now); end.setHours(23, 59, 59, 999);
    } else if (periodFilter === 'range' && (dateFrom || dateTo)) {
      if (dateFrom) { start = new Date(dateFrom); start.setHours(0, 0, 0, 0); }
      if (dateTo)   { end   = new Date(dateTo);   end.setHours(23, 59, 59, 999); }
    }
    return items.filter((x) => {
      const t = x.uploaded_at ? new Date(x.uploaded_at) : null;
      if (start && t && t < start) return false;
      if (end   && t && t > end)   return false;
      const printed = !!x.printed_at;
      const ketokoDone = !!x.ketoko_input_at || (x.ketoko_total_count > 0 && x.ketoko_checked_count >= x.ketoko_total_count);
      switch (statusFilter) {
        case 'not_printed':          return !printed;
        case 'printed':              return printed;
        case 'not_ketoko':           return !ketokoDone;
        case 'ketoko':               return ketokoDone;
        case 'printed_not_ketoko':   return printed && !ketokoDone;
        default:                     return true;
      }
    });
  }, [items, periodFilter, dateFrom, dateTo, statusFilter]);

  const totalDetected = useMemo(
    () => filteredItems.reduce((s, x) => s + (x.detected_tracking_numbers?.length || 0), 0),
    [filteredItems]
  );
  const printedCount = useMemo(() => filteredItems.filter((x) => x.printed_at).length, [filteredItems]);
  // KETOKO progress is now counted by RESI (tracking numbers), NOT by PDF files.
  const ketokoResiChecked = useMemo(
    () => filteredItems.reduce((s, x) => s + (x.ketoko_checked_count || 0), 0),
    [filteredItems]
  );
  // Alert: PDFs sudah diprint tapi ketoko belum lengkap (dari periode aktif).
  const belumKetokoCount = useMemo(
    () => filteredItems.filter((x) => {
      const printed = !!x.printed_at;
      const ketokoDone = !!x.ketoko_input_at || (x.ketoko_total_count > 0 && x.ketoko_checked_count >= x.ketoko_total_count);
      return printed && !ketokoDone;
    }).length,
    [filteredItems]
  );
  const isOwner = user?.role === 'owner';

  // Item currently open in the per-resi KETOKO panel. Set after PIN is verified
  // (see PdfRow.submitPin), cleared when the panel is closed.
  const [ketokoResiTarget, setKetokoResiTarget] = useState(null);

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
                      <div className="text-[10px] text-muted-foreground">Popup di pojok kanan atas</div>
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
            <div className="text-2xl font-bold mt-1">{filteredItems.length}</div>
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
              {printedCount}<span className="text-sm text-muted-foreground">/{filteredItems.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-5 pb-4">
            <div className="text-xs text-amber-300 flex items-center gap-1">
              <Store className="w-3 h-3" /> Input KETOKO
            </div>
            <div className="text-2xl font-bold mt-1 text-amber-400">
              {ketokoResiChecked}<span className="text-sm text-muted-foreground">/{totalDetected}</span>
            </div>
            <div className="text-[10px] text-amber-300/70 mt-0.5">
              per resi (bukan per PDF)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter toolbar + Alert Ketoko */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white [&>option]:bg-zinc-800 [&>option]:text-white">
            <option value="today">Hari Ini</option>
            <option value="week">Minggu Ini (7 hari)</option>
            <option value="range">Range Tanggal</option>
          </select>
          {periodFilter === 'range' && (
            <>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white" />
              <span className="text-muted-foreground">→</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white" />
            </>
          )}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white [&>option]:bg-zinc-800 [&>option]:text-white">
            <option value="all">Semua Status</option>
            <option value="not_printed">Belum Diprint</option>
            <option value="printed">Sudah Diprint</option>
            <option value="not_ketoko">Belum Input Ketoko</option>
            <option value="ketoko">Sudah Input Ketoko</option>
            <option value="printed_not_ketoko">Sudah Diprint + Belum Input Ketoko</option>
          </select>
        </div>
        {belumKetokoCount > 0 ? (
          <button onClick={() => setStatusFilter('printed_not_ketoko')}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 transition text-sm text-left">
            <span>⚠️</span>
            <span><b>{belumKetokoCount} RESI</b> BELUM INPUT KETOKO</span>
            <span className="text-xs text-red-300/70 ml-2">(klik untuk filter)</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
            <span>✓</span>
            <span>Semua Resi Sudah Input Ketoko</span>
          </div>
        )}
      </div>

      {/* List */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-10">
              <FileText className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <div className="text-sm text-muted-foreground">
                {items.length === 0 ? 'Belum ada PDF diunggah.' : 'Tidak ada PDF pada filter ini.'}
              </div>
              <div className="text-xs text-muted-foreground/70 mt-1">
                {items.length === 0 ? (isOwner
                  ? 'Klik "Unggah PDF" untuk mulai — bisa pilih dari galeri / file HP.'
                  : 'Hanya owner (ADMIN) yang dapat mengunggah PDF resi.') : 'Coba ubah periode atau status filter.'}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((it) => (
                <PdfRow
                  key={it.id}
                  item={it}
                  isOwner={isOwner}
                  isScanning={scanningIds.has(it.id)}
                  isNew={newlyAddedIds.has(it.id)}
                  onOpen={() => openPdf(it)}
                  onDelete={() => del(it.id, it.filename)}
                  onOpenKetokoPanel={() => setKetokoResiTarget(it)}
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
          user={user}
          onClose={() => setPreviewItem(null)}
          onChanged={load}
        />
      )}

      {/* KETOKO per-resi panel — opens after PIN verified on a row */}
      {ketokoResiTarget && (
        <KetokoResiPanel
          initialItem={ketokoResiTarget}
          user={user}
          onClose={() => setKetokoResiTarget(null)}
          onChanged={(updated) => {
            // Merge server response into local list — do NOT close the panel
            // (operator may check several resi in sequence).
            setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            setKetokoResiTarget(updated);
          }}
        />
      )}
    </div>
  );
}

// ---------- Row (with inline detected tracking numbers on the right) ----------
function PdfRow({ item, isOwner, isScanning, isNew, onOpen, onDelete, onOpenKetokoPanel, onRescan }) {
  const detected = item.detected_tracking_numbers || [];
  const hasScan = !!item.scanned_at;
  const printed = !!item.printed_at;
  // Per-resi KETOKO progress (new). ketokoChecked (overall) is true only when
  // every resi in this PDF is checked — used for the row-level styling badge.
  const resiChecked = item.ketoko_checked_count || 0;
  const resiTotal = item.ketoko_total_count || detected.length || 0;
  const ketokoChecked = resiTotal > 0 && resiChecked >= resiTotal;
  const ketokoPartial = resiChecked > 0 && !ketokoChecked;

  // ------ Dynamic PIN verification (inline, no modal) ------
  // pin === null → panel closed; string → panel open with that PIN.
  // After PIN is verified, we OPEN THE KETOKO RESI PANEL — we do NOT toggle
  // the flag directly. The panel lets the operator check each resi one by
  // one and add notes for the unchecked ones.
  const [pin, setPin] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [shake, setShake] = useState(false);
  const pinInputRef = useRef(null);

  const focusPinInput = () => {
    setTimeout(() => {
      pinInputRef.current?.focus();
      pinInputRef.current?.select?.();
    }, 30);
  };

  const openPinPanel = () => {
    setPin(generatePin());
    setPinInput('');
    focusPinInput();
  };

  const closePinPanel = () => {
    setPin(null);
    setPinInput('');
    setShake(false);
  };

  const submitPin = () => {
    if (!pin) return;
    if (pinInput === pin) {
      // Correct — close PIN panel then open the KETOKO resi panel.
      closePinPanel();
      onOpenKetokoPanel();
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

        {/* KETOKO POS input — button opens PIN, then resi panel.
            The old single-checkbox has been replaced with a progress button
            (e.g. "3/8") so the operator sees at a glance how many resi in
            this PDF have already been input to KETOKO. Clicking triggers
            the (unchanged) dynamic PIN verification. On correct PIN, the
            KetokoResiPanel opens with the resi list. */}
        <button
          type="button"
          onClick={() => { if (pin === null) openPinPanel(); }}
          disabled={pin !== null || resiTotal === 0}
          className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors shrink-0 select-none text-left ${
            pin !== null
              ? 'border-amber-400/60 bg-amber-500/15 text-amber-200 cursor-wait'
              : ketokoChecked
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                : ketokoPartial
                  ? 'border-amber-500/30 bg-amber-500/5 text-amber-300/90 hover:bg-amber-500/10'
                  : resiTotal === 0
                    ? 'border-white/10 text-muted-foreground/50 cursor-not-allowed'
                    : 'border-white/10 hover:bg-white/[0.04] text-muted-foreground hover:text-white'
          }`}
          title={
            resiTotal === 0
              ? 'Belum ada resi terdeteksi di PDF ini'
              : ketokoChecked
                ? `Semua ${resiTotal} resi sudah diinput ke KETOKO`
                : 'Klik untuk buka daftar resi + input ke KETOKO'
          }
        >
          <Store className="w-3.5 h-3.5" />
          <div className="text-xs leading-tight">
            <div className="font-medium">POS KETOKO</div>
            {resiTotal === 0 ? (
              <div className="text-[10px] opacity-70">— resi belum terdeteksi</div>
            ) : (
              <div className="text-[10px] opacity-80 tabular-nums">
                {resiChecked}/{resiTotal} resi{ketokoChecked ? ' ✓' : ''}
              </div>
            )}
          </div>
        </button>

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
              {/* Label follows the parser result: QR → "Nomor QR Terdeteksi",
                  1D fallback → "Nomor Barcode Terdeteksi". Legacy PDFs (scanned
                  before detected_via existed) keep the generic label. */}
              {item.detected_via === 'barcode' ? (
                <>
                  <Barcode className="w-3 h-3 text-emerald-400" />
                  Nomor Barcode Terdeteksi
                </>
              ) : item.detected_via === 'qr' ? (
                <>
                  <QrCode className="w-3 h-3 text-emerald-400" />
                  Nomor QR Terdeteksi
                </>
              ) : (
                <>
                  <QrCode className="w-3 h-3 text-emerald-400" />
                  Nomor Resi Terdeteksi
                </>
              )}
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
              <Loader2 className="w-3 h-3 animate-spin" /> Membaca QR / Barcode pada tiap halaman...
            </div>
          ) : detected.length === 0 ? (
            <div className="text-xs text-muted-foreground/70 py-1">
              Tidak ada QR code maupun barcode terbaca. Pastikan PDF berisi label resi yang jelas.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detected.map((tn, i) => (
                <span
                  key={tn + i}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono"
                  title={tn}
                >
                  {item.detected_via === 'barcode' ? (
                    <Barcode className="w-3 h-3 opacity-70" />
                  ) : (
                    <QrCode className="w-3 h-3 opacity-70" />
                  )}
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
function PdfPreviewModal({ pdfId, initialMeta, user, onClose, onChanged }) {
  const [meta, setMeta] = useState(initialMeta || null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(initialMeta?.pages_count || 0);
  const [renderedPages, setRenderedPages] = useState(0);
  const [error, setError] = useState(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null); // for print / open-in-new-tab
  const canvasesRef = useRef([]);
  // Zoom control lives OUTSIDE the PDF renderer — it only applies a CSS
  // transform to the pages container, so pdf.js render logic is untouched.
  const [zoom, setZoom] = useState(1);
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.5;
  const ZOOM_STEP = 0.25;

  // Role-aware toolbar rules (staff = non-owner):
  //  - Staff can Print ONLY ONCE per PDF (backend enforces + frontend disables)
  //  - Staff has no "Buka di tab baru" (interpreted as Download/Save/Share)
  //  - Owner: unlimited print, sees all controls (unchanged)
  const isOwner = user?.role === 'owner';
  const alreadyPrinted = !!meta?.printed_at;
  const printLocked = !isOwner && alreadyPrinted;

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
    // Staff (non-owner): once printed, block subsequent print attempts even
    // if the button is somehow clicked (defense against stale UI). Owner
    // remains unlimited — no change.
    if (printLocked) {
      toast.error('PDF ini sudah pernah dicetak. Karyawan hanya boleh cetak satu kali.');
      return;
    }
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
      .catch((e) => {
        // Backend returns 403 if staff already printed (defense in depth).
        // Sync local meta by refetching + surface friendly message.
        const msg = e?.message || String(e || '');
        if (msg.includes('sudah pernah dicetak') || msg.includes('403')) {
          toast.error('PDF ini sudah pernah dicetak. Karyawan hanya boleh cetak satu kali.');
          // Optimistic local lock — mark printed so button disables immediately.
          setMeta((m) => (m && !m.printed_at ? { ...m, printed_at: new Date().toISOString() } : m));
          onChanged?.();
        }
      });
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
              {/* Zoom controls (kontrol di SEKITAR viewer — tidak menyentuh
                  pdf.js render logic; hanya CSS transform pada wrapper). */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
                disabled={zoom <= ZOOM_MIN}
                className="gap-1 border-white/20 hover:bg-white/10"
                title="Zoom out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <div className="inline-flex items-center px-2 text-xs tabular-nums text-muted-foreground min-w-[3rem] justify-center">
                {Math.round(zoom * 100)}%
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
                disabled={zoom >= ZOOM_MAX}
                className="gap-1 border-white/20 hover:bg-white/10"
                title="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>

              {/* "Buka di tab baru" hanya untuk owner. Untuk karyawan disembunyikan
                  karena membuka di tab baru memungkinkan Download/Save/Share via browser. */}
              {isOwner && (
                <a
                  href={getPdfServerUrl(pdfId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-white/10 text-xs hover:bg-white/[0.04] whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5" /> Buka di tab baru
                </a>
              )}
              {/* Print button — locked for karyawan after first successful print. */}
              <Button
                size="sm"
                onClick={handlePrint}
                disabled={printLocked}
                className="gap-1"
                title={printLocked ? 'PDF sudah dicetak. Karyawan hanya boleh cetak satu kali.' : 'Print PDF'}
              >
                {printLocked ? <Lock className="w-3.5 h-3.5" /> : <Printer className="w-3.5 h-3.5" />}
                {printLocked ? 'Sudah Dicetak' : 'Print'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onClose}
                className="gap-1 border-white/20 hover:bg-white/10"
                title="Kembali ke daftar (Esc)"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
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
              <div
                className="flex flex-col items-center gap-3"
                style={{
                  // CSS-only zoom applied to wrapper — pdf.js render logic
                  // is untouched. transformOrigin keeps the top edge fixed so
                  // scroll behavior remains predictable.
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                  width: zoom < 1 ? `${100 / zoom}%` : '100%',
                }}
              >
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
                {pdfBlobUrl && isOwner && (
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
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={printLocked}
              className="gap-1"
              title={printLocked ? 'PDF sudah dicetak. Karyawan hanya boleh cetak satu kali.' : 'Print PDF'}
            >
              {printLocked ? <Lock className="w-3.5 h-3.5" /> : <Printer className="w-3.5 h-3.5" />}
              {printLocked ? 'Sudah Dicetak' : 'Print'}
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


// ============================================================
// KETOKO Resi Panel — modal with per-resi checkbox + note
// ============================================================
// Shown after PIN verified on a PDF row. Lists each detected tracking number
// as a checkbox row. Unchecked rows can carry an optional note (dropdown:
// "Barang Kosong" / "Lainnya"; "Lainnya" reveals a free-text field).
//
// Notes are AUTO-SAVED on change (per-field POST /pdfs/:id/ketoko-resi). No
// "Save" button — the operator can close whenever they want.
//
// Business rules (also enforced server-side):
//   • checked=true clears any note on that resi.
//   • notes only editable/visible while checked=false.
//   • one PDF may be processed partially — checked resi finalize immediately,
//     don't block other resi in the same PDF or other PDFs.
function KetokoResiPanel({ initialItem, user, onClose, onChanged }) {
  const [item, setItem] = useState(initialItem);
  const [savingTn, setSavingTn] = useState(null); // tracking number currently syncing
  // Draft state for free-text "Lainnya" notes. Persist keystroke buffer here so
  // typing doesn't fight the server response. On blur or dropdown-change we
  // flush the draft to the server.
  const [draftText, setDraftText] = useState({}); // { tn: text }

  // Keep local item in sync with any external merges (parent may pass a fresh
  // copy after other actions).
  useEffect(() => {
    setItem(initialItem);
  }, [initialItem]);

  // Close on Esc
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resi = useMemo(
    () => (Array.isArray(item?.ketoko_resi) ? item.ketoko_resi : []),
    [item]
  );
  const checkedCount = resi.filter((r) => r.checked).length;
  const totalCount = resi.length;
  const progressPct = totalCount === 0 ? 0 : Math.round((checkedCount / totalCount) * 100);

  async function updateResi(tn, patch) {
    setSavingTn(tn);
    try {
      const r = await omApi(`pdfs/${item.id}/ketoko-resi`, {
        method: 'POST',
        body: JSON.stringify({ tracking_number: tn, ...patch }),
      });
      // r.item is the fresh doc. Merge into local + propagate up.
      setItem(r.item);
      onChanged?.(r.item);
    } catch (e) {
      toast.error(e.message || 'Gagal update resi KETOKO');
    } finally {
      setSavingTn(null);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-gradient-to-br from-amber-500/10 to-transparent">
          <DialogTitle className="text-base flex items-center gap-2">
            <Store className="w-4 h-4 text-amber-400" />
            Input POS KETOKO
          </DialogTitle>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span className="font-mono truncate max-w-[200px]" title={item.filename}>{item.filename}</span>
            <span>·</span>
            <span className="text-amber-300 tabular-nums font-semibold">{checkedCount}/{totalCount} resi</span>
            <span>·</span>
            <span>{progressPct}%</span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 w-full rounded-full bg-white/[0.05] mt-2 overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Resi list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {resi.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              Belum ada resi terdeteksi. Coba klik scan ulang pada halaman daftar.
            </div>
          ) : (
            resi.map((r) => {
              const isSaving = savingTn === r.tracking_number;
              const draftKey = r.tracking_number;
              const currentText = draftText[draftKey] !== undefined
                ? draftText[draftKey]
                : (r.note_text || '');
              return (
                <div
                  key={r.tracking_number}
                  className={`p-3 rounded-md border transition-colors ${
                    r.checked
                      ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
                      : 'border-white/10 bg-white/[0.02]'
                  } ${isSaving ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      disabled={isSaving}
                      onChange={(e) => updateResi(r.tracking_number, { checked: e.target.checked })}
                      className="w-5 h-5 accent-emerald-500 cursor-pointer mt-0.5 shrink-0"
                      title={r.checked ? 'Sudah input KETOKO' : 'Belum input KETOKO'}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-mono text-sm truncate">{r.tracking_number}</div>
                        {r.checked ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[9px]">
                            ✓ Sudah Input
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/30 text-amber-300/80 text-[9px]">
                            Belum Input
                          </Badge>
                        )}
                        {isSaving && (
                          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {r.checked && r.checked_by_name && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          oleh {r.checked_by_name} · {fmtDate(r.checked_at)}
                        </div>
                      )}

                      {/* Note controls — only when UNCHECKED */}
                      {!r.checked && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <select
                            value={r.note_type || ''}
                            disabled={isSaving}
                            onChange={(e) => {
                              const nt = e.target.value || null;
                              // Clear the draft text if switching away from 'lainnya'
                              if (nt !== 'lainnya') {
                                setDraftText((d) => ({ ...d, [draftKey]: '' }));
                              }
                              updateResi(r.tracking_number, {
                                note_type: nt,
                                note_text: nt === 'lainnya' ? (draftText[draftKey] || r.note_text || '') : null,
                              });
                            }}
                            className="h-8 px-2 rounded-md bg-black/30 border border-white/10 text-xs focus:border-amber-400 focus:outline-none"
                          >
                            <option value="">— Catatan (opsional) —</option>
                            <option value="kosong">Barang Kosong</option>
                            <option value="lainnya">Lainnya</option>
                          </select>
                          {r.note_type === 'lainnya' && (
                            <input
                              type="text"
                              value={currentText}
                              disabled={isSaving}
                              placeholder="Ketik catatan…"
                              maxLength={500}
                              onChange={(e) =>
                                setDraftText((d) => ({ ...d, [draftKey]: e.target.value }))
                              }
                              onBlur={() => {
                                const txt = draftText[draftKey];
                                if (txt !== undefined && txt !== (r.note_text || '')) {
                                  updateResi(r.tracking_number, {
                                    note_type: 'lainnya',
                                    note_text: txt,
                                  });
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                              className="h-8 flex-1 min-w-[160px] px-2 rounded-md bg-black/30 border border-white/10 text-xs focus:border-amber-400 focus:outline-none"
                            />
                          )}
                          {r.note_type && r.note_type !== 'lainnya' && (
                            <span className="text-[10px] text-amber-300/70">
                              {r.note_type === 'kosong' ? 'Ditandai: Barang Kosong' : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 p-3 flex items-center justify-between gap-2 bg-neutral-950/60">
          <div className="text-[11px] text-muted-foreground hidden sm:block">
            Perubahan tersimpan otomatis. Tekan <kbd className="px-1 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[10px] font-mono">Esc</kbd> untuk tutup.
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="ml-auto gap-1.5 border-white/20 hover:bg-white/10"
          >
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
