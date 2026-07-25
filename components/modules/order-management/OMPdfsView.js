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

// Fetch pdf as authenticated blob → return ArrayBuffer
async function fetchPdfBuffer(pdfId) {
  const token = localStorage.getItem('cc_token');
  const resp = await fetch(`/api/om/pdfs/${pdfId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.arrayBuffer();
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
// Returns the updated pdf item from server
async function autoScanPdfById(pdfId) {
  const pdfjs = await loadPdfJs();
  const buf = await fetchPdfBuffer(pdfId);
  const pdfDoc = await pdfjs.getDocument({ data: buf }).promise;
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
  const [previewId, setPreviewId] = useState(null);
  const [scanningIds, setScanningIds] = useState(() => new Set());
  const fileInputRef = useRef(null);
  const scanQueueRef = useRef(new Set()); // ids currently in-flight to avoid double-scan

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">PDF Resi</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">
            Kirim PDF label resi dari HP · auto-scan QR · buka & print di sini
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
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
                Klik &quot;Unggah PDF&quot; untuk mulai — bisa pilih dari galeri / file HP.
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
                  onOpen={() => setPreviewId(it.id)}
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
      {previewId && (
        <PdfPreviewModal
          pdfId={previewId}
          onClose={() => setPreviewId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ---------- Row (with inline detected tracking numbers on the right) ----------
function PdfRow({ item, isOwner, isScanning, onOpen, onDelete, onToggleKetoko, onRescan }) {
  const detected = item.detected_tracking_numbers || [];
  const hasScan = !!item.scanned_at;
  const printed = !!item.printed_at;
  const ketokoChecked = !!item.ketoko_input_at;

  const copyAll = async () => {
    if (!detected.length) return;
    try {
      await navigator.clipboard.writeText(detected.join('\n'));
      toast.success('Nomor resi disalin');
    } catch {
      toast.error('Gagal menyalin');
    }
  };

  return (
    <div className="rounded-lg border border-white/5 hover:bg-white/[0.02] transition-colors">
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
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{fmtBytes(item.size)}</span>
            {item.pages_count != null && <span>· {item.pages_count} hal.</span>}
            <span>· {fmtDate(item.uploaded_at)}</span>
            <span>· oleh {item.uploaded_by_name}</span>
          </div>
        </div>

        {/* KETOKO POS input checkbox */}
        <label
          className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors shrink-0 select-none ${
            ketokoChecked
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-white/10 hover:bg-white/[0.04] text-muted-foreground'
          }`}
          title={ketokoChecked ? `Diinput oleh ${item.ketoko_input_by_name} · ${fmtDate(item.ketoko_input_at)}` : 'Klik jika sudah input ke POS KETOKO'}
        >
          <input
            type="checkbox"
            checked={ketokoChecked}
            onChange={(e) => onToggleKetoko(e.target.checked)}
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

        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="outline" onClick={onOpen} className="gap-1">
            <Eye className="w-3.5 h-3.5" /> Buka
          </Button>
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
function PdfPreviewModal({ pdfId, onClose, onChanged }) {
  const [meta, setMeta] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null); // for print fallback
  const canvasesRef = useRef([]);

  // Fetch meta + open pdf via pdf.js
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // meta lookup
        const d = await omApi('pdfs');
        if (cancelled) return;
        const found = (d.items || []).find((x) => x.id === pdfId);
        setMeta(found || null);

        // fetch buffer + open
        const token = localStorage.getItem('cc_token');
        const resp = await fetch(`/api/om/pdfs/${pdfId}/file`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        // Also create a blob URL for the print fallback (open in new tab)
        const blob = new Blob([buf.slice(0)], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setPdfBlobUrl(objectUrl);

        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
      } catch (e) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdfId]);

  // Render each page to its canvas
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      for (let p = 1; p <= pdfDoc.numPages; p += 1) {
        if (cancelled) return;
        const canvas = canvasesRef.current[p - 1];
        if (!canvas) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const page = await pdfDoc.getPage(p);
          const parent = canvas.parentElement;
          const parentW = parent?.clientWidth || 700;
          const targetWidth = Math.min(1000, parentW - 8);
          const initialVp = page.getViewport({ scale: 1 });
          const scale = targetWidth / initialVp.width;
          const vp = page.getViewport({ scale });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(vp.width * dpr);
          canvas.height = Math.floor(vp.height * dpr);
          canvas.style.width = `${Math.floor(vp.width)}px`;
          canvas.style.height = `${Math.floor(vp.height)}px`;
          const ctx = canvas.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          // eslint-disable-next-line no-await-in-loop
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        } catch {
          /* per-page render error, keep going */
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc]);

  const handlePrint = async () => {
    if (!pdfBlobUrl) {
      toast.error('PDF belum siap');
      return;
    }
    // Open PDF in new tab — browser will render it and user can print from there
    // Use noopener to be safe. This avoids iframe printing quirks.
    const w = window.open(pdfBlobUrl, '_blank');
    if (!w) {
      toast.error('Popup diblokir. Izinkan popup untuk print.');
      return;
    }
    try {
      // Try to trigger print after PDF loads. Chrome may block until user gestures.
      w.addEventListener('load', () => {
        try { w.print(); } catch (_) { /* print blocked */ }
      });
    } catch (_) { /* window not accessible */ }
    // Mark printed asynchronously
    omApi(`pdfs/${pdfId}/mark-printed`, { method: 'POST' })
      .then((r) => {
        setMeta(r.item);
        onChanged?.();
      })
      .catch(() => {});
  };

  const detectedList = meta?.detected_tracking_numbers || [];

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
                    {meta.printed_at && (
                      <Badge variant="outline" className="border-blue-500/40 text-blue-300 text-[9px] gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> PRINTED · {fmtDate(meta.printed_at)}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" onClick={handlePrint} disabled={!pdfBlobUrl} className="gap-1">
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 grid md:grid-cols-[1fr_280px] min-h-0">
          {/* PDF viewer — pdf.js canvas render, no iframe */}
          <div className="bg-neutral-900 relative min-h-[400px] md:min-h-0 overflow-y-auto p-3">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <div className="text-xs">Memuat PDF...</div>
                </div>
              </div>
            ) : error ? (
              <div className="absolute inset-0 flex items-center justify-center text-rose-400 text-sm p-6 text-center">
                Gagal memuat PDF: {error}
              </div>
            ) : pdfDoc ? (
              <div className="flex flex-col items-center gap-3">
                {Array.from({ length: pdfDoc.numPages }).map((_, i) => (
                  <canvas
                    key={i}
                    ref={(el) => { canvasesRef.current[i] = el; }}
                    className="bg-white shadow-lg rounded-sm max-w-full"
                  />
                ))}
                {pdfBlobUrl && (
                  <a
                    href={pdfBlobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-white underline mt-2"
                  >
                    Buka di tab baru
                  </a>
                )}
              </div>
            ) : null}
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
      </DialogContent>
    </Dialog>
  );
}
