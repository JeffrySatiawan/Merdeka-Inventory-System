'use client';

// OM · PDF Resi — upload PDF label from HP, preview + print, auto-scan QR
// codes on each page and link to tracking numbers.

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  FileText,
  Trash2,
  Printer,
  Loader2,
  QrCode,
  CheckCircle2,
  X,
  RefreshCw,
  Eye,
  Clock,
  Store,
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

// ---------- Main List View ----------
export default function OMPdfsView({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewId, setPreviewId] = useState(null);
  const fileInputRef = useRef(null);

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

  async function handleFiles(files) {
    if (!files || !files.length) return;
    setUploading(true);
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
        await uploadPdf(file, setUploadProgress);
        ok += 1;
      } catch (e) {
        toast.error(`${file.name}: ${e.message}`);
        fail += 1;
      }
    }
    setUploading(false);
    setUploadProgress(0);
    if (ok > 0) toast.success(`${ok} file berhasil diunggah`);
    load();
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
      // Sync with server state
      setItems((prev) => prev.map((x) => (x.id === item.id ? r.item : x)));
    } catch (e) {
      toast.error(e.message || 'Gagal update POS KETOKO');
      load(); // revert on error
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
            <div className="space-y-2">
              {items.map((it) => (
                <PdfRow
                  key={it.id}
                  item={it}
                  isOwner={isOwner}
                  onOpen={() => setPreviewId(it.id)}
                  onDelete={() => del(it.id, it.filename)}
                  onToggleKetoko={(next) => toggleKetoko(it, next)}
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
          user={user}
        />
      )}
    </div>
  );
}

// ---------- Row ----------
function PdfRow({ item, isOwner, onOpen, onDelete, onToggleKetoko }) {
  const detected = item.detected_tracking_numbers || [];
  const hasScan = !!item.scanned_at;
  const printed = !!item.printed_at;
  const ketokoChecked = !!item.ketoko_input_at;
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-white/5 hover:bg-white/[0.02]">
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
          {!hasScan && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[9px]">
              BELUM SCAN
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
          <span>{fmtBytes(item.size)}</span>
          {item.pages_count != null && <span>· {item.pages_count} hal.</span>}
          {hasScan && (
            <span className="flex items-center gap-1">
              · <QrCode className="w-3 h-3" /> {detected.length} resi
            </span>
          )}
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
  );
}

// ---------- Preview Modal (renders PDF pages + auto-scans QR + Print) ----------
function PdfPreviewModal({ pdfId, onClose, onChanged, user }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [detectedList, setDetectedList] = useState([]);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const iframeRef = useRef(null);

  // Load metadata
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await omApi('pdfs');
        if (cancelled) return;
        const found = (d.items || []).find((x) => x.id === pdfId);
        setMeta(found || null);
        setDetectedList(found?.detected_tracking_numbers || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [pdfId]);

  // Fetch PDF file (as authenticated blob → so iframe can load without extra auth)
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem('cc_token');
        const resp = await fetch(`/api/om/pdfs/${pdfId}/file`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setPdfBlobUrl(objectUrl);
      } catch (e) {
        if (!cancelled) toast.error('Gagal memuat PDF: ' + (e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdfId]);

  // Auto-run QR scan once if not scanned yet OR button clicked
  const runQrScan = async () => {
    if (scanning || !pdfBlobUrl) return;
    setScanning(true);
    try {
      // Lazy-load pdfjs
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      // Configure worker — use bundled worker via ESM
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url
        ).toString();
      }
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();

      const resp = await fetch(pdfBlobUrl);
      const buf = await resp.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;

      const found = new Set();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const scale = 2.0; // higher scale → better QR read
      for (let p = 1; p <= pdf.numPages; p += 1) {
        try {
          const page = await pdf.getPage(p);
          const vp = page.getViewport({ scale });
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          // Try decode from canvas
          try {
            const result = await reader.decodeFromCanvas(canvas);
            const text = result?.getText?.() || '';
            if (text && text.trim()) found.add(text.trim());
          } catch {
            /* NotFoundException — no QR on this page */
          }
        } catch (e) {
          // Continue on per-page errors
        }
      }

      // Persist to backend
      const trackingNumbers = Array.from(found);
      const updated = await omApi(`pdfs/${pdfId}/scan-result`, {
        method: 'POST',
        body: JSON.stringify({
          tracking_numbers: trackingNumbers,
          pages_count: pdf.numPages,
        }),
      });
      setDetectedList(updated.item.detected_tracking_numbers || []);
      setMeta(updated.item);
      onChanged?.();
      if (trackingNumbers.length > 0) {
        toast.success(`${trackingNumbers.length} resi terdeteksi dari ${pdf.numPages} halaman`);
      } else {
        toast.info(`Tidak ada QR code terbaca pada ${pdf.numPages} halaman`);
      }
    } catch (e) {
      toast.error('Gagal scan QR: ' + (e?.message || e));
    } finally {
      setScanning(false);
    }
  };

  // Auto-scan on first open if not scanned yet
  useEffect(() => {
    if (!meta) return;
    if (!pdfBlobUrl) return;
    if (meta.scanned_at) return; // already scanned
    // Fire and forget
    runQrScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.id, pdfBlobUrl]);

  const handlePrint = async () => {
    if (!iframeRef.current) {
      toast.error('Viewer PDF belum siap');
      return;
    }
    try {
      const win = iframeRef.current.contentWindow;
      if (win) {
        // Browser will open its own print dialog for the PDF
        win.focus();
        win.print();
      } else {
        // Fallback: open in new tab and use browser print
        window.open(pdfBlobUrl, '_blank');
      }
      // Mark printed asynchronously (don't wait)
      omApi(`pdfs/${pdfId}/mark-printed`, { method: 'POST' })
        .then((r) => {
          setMeta(r.item);
          onChanged?.();
        })
        .catch(() => {});
    } catch (e) {
      // Fallback to opening in new tab
      window.open(pdfBlobUrl, '_blank');
    }
  };

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl w-[95vw] p-0 gap-0 max-h-[92vh] flex flex-col">
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
              <Button size="sm" variant="outline" onClick={runQrScan} disabled={scanning || !pdfBlobUrl} className="gap-1">
                {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                {scanning ? 'Scanning...' : 'Scan QR'}
              </Button>
              <Button size="sm" onClick={handlePrint} disabled={!pdfBlobUrl} className="gap-1">
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 grid md:grid-cols-[1fr_260px] min-h-0">
          {/* PDF viewer */}
          <div className="bg-black relative min-h-[400px] md:min-h-0">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : pdfBlobUrl ? (
              <iframe
                ref={iframeRef}
                src={pdfBlobUrl}
                title="PDF Preview"
                className="w-full h-full min-h-[400px] md:min-h-[600px] border-0"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                Gagal memuat PDF
              </div>
            )}
          </div>

          {/* Detected tracking numbers panel */}
          <div className="border-t md:border-t-0 md:border-l border-white/10 p-3 space-y-2 overflow-y-auto max-h-[300px] md:max-h-none">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                Resi terdeteksi ({detectedList.length})
              </div>
              {scanning && (
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> scan...
                </span>
              )}
            </div>
            {detectedList.length === 0 && !scanning ? (
              <div className="text-xs text-muted-foreground/70 py-6 text-center">
                Belum ada resi terdeteksi. Tekan tombol <b>Scan QR</b> di atas.
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
