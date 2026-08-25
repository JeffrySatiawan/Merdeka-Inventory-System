'use client';

// ============================================================================
// AbsensiModule — isolated attendance module.
// Reuses existing helpers:
//   - startCameraScanner()  from OMS (QR code scanning via @zxing/browser)
//   - compressToWebp()      from OMS (client-side selfie compression)
//   - shadcn/ui components (Button, Card, Dialog, Select, Input, Badge, Skeleton)
//   - existing auth token from localStorage.cc_token
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import QRCodeLib from 'qrcode';
import {
  Clock,
  LogIn,
  LogOut,
  History,
  MapPin,
  Camera,
  QrCode,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Settings as SettingsIcon,
  Users,
  Timer,
  ClipboardCheck,
  Radio,
  Trophy,
  Coins,
  Plus,
  Minus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Reuse OMS helpers — do NOT duplicate.
import { startCameraScanner, feedback } from '@/components/modules/order-management/scanner';
import { compressToWebp } from '@/components/modules/order-management/api';

// ---- API helper (isolated) --------------------------------------------------
async function absApi(path, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null;
  const headers = {
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`/api/absensi${path ? `/${path}` : ''}`, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---- Utility formatters ----------------------------------------------------
function fmtMinutes(m) {
  if (m == null) return '-';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h > 0) return `${h}j ${mm}m`;
  return `${mm}m`;
}
function fmtDate(d) { try { return new Date(d).toLocaleString('id-ID'); } catch { return '-'; } }

// ---- Selfie capture (uses native camera picker — SAME pattern as OMS
//      "Dokumentasi Packing", which works reliably on every device we support:
//      iOS Safari, Android Chrome, PWA modes, and desktop Chrome fallback).
//      User can toggle front (user) / back (environment) — the `capture`
//      attribute is a hint to the OS camera app; on devices where the app
//      allows switching, the user can also flip from within the OS app.
function SelfieCapture({ open, onClose, onCaptured, title = 'Ambil Selfie' }) {
  const fileRef = useRef(null);
  const [facing, setFacing] = useState('user'); // 'user' = depan, 'environment' = belakang
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setPreview(null);
      setError('');
      setFacing('user');
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  const openPicker = () => {
    setError('');
    if (fileRef.current) fileRef.current.click();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      // Reuse OMS-proven compress helper — battle-tested across devices,
      // ~200KB WebP target, safe for iOS bugs.
      const { dataUrl, sizeBytes } = await compressToWebp(file, { maxWidth: 900, targetKB: 220 });
      setPreview({ dataUrl, sizeBytes });
    } catch (err) {
      setError(err?.message || 'Kompresi foto gagal');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirm = () => {
    if (!preview) return;
    onCaptured?.(preview.dataUrl);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose?.(); }}>
      <DialogContent className="sm:max-w-md bg-[#0a0a0b] border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-400" /> {title}
          </DialogTitle>
          <DialogDescription>
            Kamera perangkat aktif. Upload dari galeri tidak diizinkan (OS Camera dipaksa via <code>capture</code>).
          </DialogDescription>
        </DialogHeader>

        {/* Front / back toggle */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant={facing === 'user' ? 'default' : 'outline'}
            onClick={() => setFacing('user')}
            className="gap-1"
          >
            <Camera className="w-3.5 h-3.5" /> Kamera Depan
          </Button>
          <Button
            type="button"
            size="sm"
            variant={facing === 'environment' ? 'default' : 'outline'}
            onClick={() => setFacing('environment')}
            className="gap-1"
          >
            <Camera className="w-3.5 h-3.5" /> Kamera Belakang
          </Button>
        </div>

        {/* Preview or empty placeholder */}
        {preview ? (
          <div className="relative">
            <img src={preview.dataUrl} alt="preview" className="w-full max-h-72 object-cover rounded-lg border border-emerald-500/40" />
            <Badge variant="outline" className="absolute top-2 right-2 bg-black/60 text-[9px] border-emerald-500/40 text-emerald-300">
              ✓ {(preview.sizeBytes / 1024).toFixed(0)} KB · WEBP
            </Badge>
          </div>
        ) : (
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="w-full h-40 rounded-lg border border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.05] flex flex-col items-center justify-center gap-1 text-muted-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-8 h-8" />}
            <span className="text-sm">{busy ? 'Memproses foto…' : 'Ketuk untuk membuka kamera'}</span>
            <span className="text-[10px]">Otomatis dikompres ke WebP ~200 KB</span>
          </button>
        )}

        {error && (
          <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded p-3">
            {error}
          </div>
        )}

        {/* Native hidden file input — key changes when `facing` changes so the
            `capture` attribute is re-picked up by the browser. */}
        <input
          key={facing}
          ref={fileRef}
          type="file"
          accept="image/*"
          capture={facing}
          className="hidden"
          onChange={onFile}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose?.()} disabled={busy}>Batal</Button>
          {preview ? (
            <>
              <Button variant="outline" onClick={openPicker} disabled={busy}>
                Foto Ulang
              </Button>
              <Button onClick={confirm} disabled={busy} className="bg-emerald-600 hover:bg-emerald-500 gap-2">
                <CheckCircle2 className="w-4 h-4" /> Gunakan Foto
              </Button>
            </>
          ) : (
            <Button onClick={openPicker} disabled={busy} className="bg-emerald-600 hover:bg-emerald-500 gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              Ambil Foto
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- QR scanner (reuses OMS startCameraScanner) ----------------------------
function QrScanner({ open, onClose, onDecoded }) {
  // Use a callback ref so the effect only starts the scanner once the DOM
  // container is actually attached. Radix Dialog portals its content and
  // mounts it asynchronously — a plain useRef would still be null when the
  // effect fires on the same tick as `open` flipping to true, causing
  // "Camera container tidak ditemukan".
  const [containerEl, setContainerEl] = useState(null);
  const controllerRef = useRef(null);
  const onDecodedRef = useRef(onDecoded);
  const [error, setError] = useState('');

  // Keep the latest onDecoded without re-triggering the scanner effect.
  useEffect(() => { onDecodedRef.current = onDecoded; }, [onDecoded]);

  useEffect(() => {
    if (!open || !containerEl) return undefined;
    setError('');
    let stopped = false;
    (async () => {
      try {
        controllerRef.current = await startCameraScanner(
          containerEl,
          (text) => {
            if (stopped) return;
            try { feedback('ok'); } catch { /* audio may be blocked */ }
            onDecodedRef.current?.(String(text || '').trim());
          },
          (e) => setError(e?.message || String(e))
        );
      } catch (e) {
        if (!stopped) setError(e?.message || 'Tidak bisa mengaktifkan kamera untuk QR');
      }
    })();
    return () => {
      stopped = true;
      try { controllerRef.current?.stop?.(); } catch { /* ignore */ }
      controllerRef.current = null;
    };
  }, [open, containerEl]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="sm:max-w-md bg-[#0a0a0b] border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-emerald-400" /> Scan QR Absensi
          </DialogTitle>
          <DialogDescription>Arahkan kamera ke QR statis milik Owner.</DialogDescription>
        </DialogHeader>
        {/* IMPORTANT: keep the container mounted even when error is set so the
            scanner effect can still target it on subsequent retries. */}
        <div
          ref={setContainerEl}
          className="relative aspect-square w-full rounded-lg overflow-hidden bg-black border border-white/10"
        />
        {error && (
          <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded p-3">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose?.()}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Geolocation hook -------------------------------------------------------
function useGeolocation() {
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const acquire = () => new Promise((resolve, reject) => {
    if (!navigator?.geolocation) {
      const e = new Error('Perangkat tidak mendukung GPS');
      setError(e.message); reject(e); return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
        setCoords(c); setError(''); setBusy(false); resolve(c);
      },
      (err) => {
        setError(err?.message || 'Gagal mengambil GPS. Aktifkan izin lokasi.'); setBusy(false); reject(err);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
  return { coords, error, busy, acquire };
}

// ============================================================================
//  Sub-view: Staff Home (today's status + entry to check-in / check-out)
// ============================================================================
function StaffHomeView({ user, onNav }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setData(await absApi('today')); }
    catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />;
  const rec = data?.record;
  const hasIn = !!rec?.actual_check_in;
  const hasOut = !!rec?.actual_check_out;
  const displayName = String(user?.name || user?.username || 'Pengguna').toUpperCase();

  return (
    <div className="space-y-4">
      {/* Prominent name banner — matches "ABSENSI / CINDY" spec so the operator
          instantly sees WHICH account is signed in before submitting. */}
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.06] p-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-indigo-300/80">Anda login sebagai</div>
        <div className="mt-0.5 text-3xl md:text-4xl font-black tracking-wide text-white break-words">
          {displayName}
        </div>
      </div>

      <Card className="bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent border-indigo-500/20">
        <CardContent className="pt-5">
          <div className="text-xs text-muted-foreground">Hari ini · {data?.date}</div>
          <div className="text-3xl font-bold tabular-nums mt-1">{data?.now || '--:--'} WITA</div>

          {rec ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">{rec.shift_name}</Badge>
                <span className="text-muted-foreground">{rec.shift_start}–{rec.shift_end}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className={hasIn ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-white/5'}>
                  {hasIn ? <><CheckCircle2 className="w-3 h-3 mr-1"/>Masuk {rec.actual_check_in_wita}</> : 'Belum absen masuk'}
                </Badge>
                {rec.late_minutes > 0 && (
                  <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30">
                    Terlambat {fmtMinutes(rec.late_minutes)}
                  </Badge>
                )}
                <Badge className={hasOut ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-white/5'}>
                  {hasOut ? <><CheckCircle2 className="w-3 h-3 mr-1"/>Keluar {rec.actual_check_out_wita}</> : 'Belum absen keluar'}
                </Badge>
                {rec.overtime_minutes > 0 && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">
                    Lembur {fmtMinutes(rec.overtime_minutes)} · {rec.overtime_status}
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">Anda belum absen hari ini.</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Button
          onClick={() => onNav('abs:in')}
          disabled={hasIn}
          className="h-20 bg-emerald-600 hover:bg-emerald-500 gap-2 text-base"
        >
          <LogIn className="w-5 h-5" /> Absen Masuk
        </Button>
        <Button
          onClick={() => onNav('abs:out')}
          disabled={!hasIn || hasOut}
          className="h-20 bg-indigo-600 hover:bg-indigo-500 gap-2 text-base"
        >
          <LogOut className="w-5 h-5" /> Absen Keluar
        </Button>
      </div>

      <Button variant="outline" onClick={() => onNav('abs:history')} className="w-full gap-2">
        <History className="w-4 h-4" /> Riwayat Absensi
      </Button>
    </div>
  );
}

// ============================================================================
//  Sub-view: Check-In Flow (selfie → QR → GPS → submit)
// ============================================================================
function CheckInView({ onDone, onBack }) {
  const [today, setToday] = useState(null);
  const [shiftKey, setShiftKey] = useState('');
  const [selfie, setSelfie] = useState(null);
  const [qrValue, setQrValue] = useState('');
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const geo = useGeolocation();

  useEffect(() => {
    (async () => {
      try {
        const d = await absApi('today');
        setToday(d);
        if (d?.suggested_shift_key) setShiftKey(d.suggested_shift_key);
      } catch (e) { toast.error(e.message); }
    })();
  }, []);

  const submit = async () => {
    if (!selfie) { toast.error('Ambil selfie terlebih dahulu'); return; }
    if (!qrValue) { toast.error('Scan QR Absensi terlebih dahulu'); return; }
    if (!shiftKey) { toast.error('Pilih shift'); return; }
    if (!geo.coords) { toast.error('Ambil lokasi GPS terlebih dahulu'); return; }
    setSubmitting(true);
    try {
      await absApi('check-in', {
        method: 'POST',
        body: JSON.stringify({
          photo_data_url: selfie,
          qr_value: qrValue,
          lat: geo.coords.lat,
          lng: geo.coords.lng,
          shift_key: shiftKey,
        }),
      });
      toast.success('Absen masuk berhasil');
      onDone?.();
    } catch (e) {
      toast.error(e.message);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">← Kembali</Button>
        <div className="text-lg font-semibold">Absen Masuk</div>
      </div>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardContent className="pt-4 space-y-3">
          {/* Shift */}
          <div>
            <Label className="text-xs">Shift <span className="text-rose-400">*</span></Label>
            <Select value={shiftKey} onValueChange={setShiftKey}>
              <SelectTrigger><SelectValue placeholder="Pilih shift" /></SelectTrigger>
              <SelectContent>
                {(today?.shifts || []).map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.name} · {s.start}-{s.end}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* QR */}
          <StepButton
            done={!!qrValue}
            icon={QrCode}
            label="Scan QR Absensi"
            hint={qrValue ? 'QR terdeteksi' : 'Scan QR statis milik Owner'}
            onClick={() => setQrOpen(true)}
          />

          {/* Selfie */}
          <StepButton
            done={!!selfie}
            icon={Camera}
            label="Selfie"
            hint={selfie ? 'Selfie sudah diambil' : 'Ambil selfie via kamera depan (galeri tidak diizinkan)'}
            onClick={() => setSelfieOpen(true)}
          />
          {selfie && (
            <img src={selfie} alt="selfie" className="w-24 h-24 rounded-lg object-cover border border-white/10" />
          )}

          {/* GPS */}
          <StepButton
            done={!!geo.coords}
            icon={MapPin}
            label={geo.busy ? 'Mengambil GPS…' : 'Ambil Lokasi GPS'}
            hint={geo.coords
              ? `lat ${geo.coords.lat.toFixed(5)}, lng ${geo.coords.lng.toFixed(5)} (±${Math.round(geo.coords.acc || 0)}m)`
              : (geo.error || 'Izinkan akses lokasi')}
            onClick={() => geo.acquire().catch(() => {})}
          />

          <Button
            onClick={submit}
            disabled={submitting || !selfie || !qrValue || !shiftKey || !geo.coords}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Konfirmasi Absen Masuk
          </Button>
        </CardContent>
      </Card>

      <SelfieCapture
        open={selfieOpen}
        onClose={() => setSelfieOpen(false)}
        onCaptured={(url) => { setSelfie(url); setSelfieOpen(false); }}
      />
      <QrScanner
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onDecoded={(text) => { setQrValue(text); setQrOpen(false); }}
      />
    </div>
  );
}

// ============================================================================
//  Sub-view: Check-Out Flow (selfie → GPS → submit)
// ============================================================================
function CheckOutView({ onDone, onBack }) {
  const [selfie, setSelfie] = useState(null);
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const geo = useGeolocation();

  const submit = async () => {
    if (!selfie) { toast.error('Ambil selfie terlebih dahulu'); return; }
    if (!geo.coords) { toast.error('Ambil lokasi GPS terlebih dahulu'); return; }
    setSubmitting(true);
    try {
      await absApi('check-out', {
        method: 'POST',
        body: JSON.stringify({
          photo_data_url: selfie,
          lat: geo.coords.lat,
          lng: geo.coords.lng,
        }),
      });
      toast.success('Absen keluar berhasil');
      onDone?.();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">← Kembali</Button>
        <div className="text-lg font-semibold">Absen Keluar</div>
      </div>
      <Card className="bg-[#0a0a0b] border-white/10">
        <CardContent className="pt-4 space-y-3">
          <StepButton
            done={!!selfie}
            icon={Camera}
            label="Selfie"
            hint={selfie ? 'Selfie sudah diambil' : 'Ambil selfie via kamera depan'}
            onClick={() => setSelfieOpen(true)}
          />
          {selfie && (
            <img src={selfie} alt="selfie-out" className="w-24 h-24 rounded-lg object-cover border border-white/10" />
          )}
          <StepButton
            done={!!geo.coords}
            icon={MapPin}
            label={geo.busy ? 'Mengambil GPS…' : 'Ambil Lokasi GPS'}
            hint={geo.coords ? `lat ${geo.coords.lat.toFixed(5)}, lng ${geo.coords.lng.toFixed(5)}` : (geo.error || 'Izinkan akses lokasi')}
            onClick={() => geo.acquire().catch(() => {})}
          />
          <Button
            onClick={submit}
            disabled={submitting || !selfie || !geo.coords}
            className="w-full h-11 bg-indigo-600 hover:bg-indigo-500 gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            Konfirmasi Absen Keluar
          </Button>
        </CardContent>
      </Card>
      <SelfieCapture open={selfieOpen} onClose={() => setSelfieOpen(false)} onCaptured={(url) => { setSelfie(url); setSelfieOpen(false); }} />
    </div>
  );
}

function StepButton({ done, icon: Icon, label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 flex items-center gap-3 transition ${
        done
          ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10'
          : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
      }`}
    >
      <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-muted-foreground'}`}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{hint}</div>
      </div>
    </button>
  );
}

// ============================================================================
//  Sub-view: History (self)
// ============================================================================
function HistoryView({ onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { const d = await absApi('my-history'); setItems(d.items || []); }
      catch (e) { toast.error(e.message); }
      finally { setLoading(false); }
    })();
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">← Kembali</Button>
        <div className="text-lg font-semibold">Riwayat Absensi</div>
      </div>
      {loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">Belum ada riwayat.</div>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <Card key={r.id} className="bg-white/[0.02] border-white/10">
              <CardContent className="pt-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-semibold">{r.date}</div>
                  <Badge className="bg-indigo-500/15 text-indigo-300 border-indigo-500/30">{r.shift_name}</Badge>
                  {r.late_minutes > 0 && (
                    <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30">Terlambat {fmtMinutes(r.late_minutes)}</Badge>
                  )}
                  {r.overtime_minutes > 0 && (
                    <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                      Lembur {fmtMinutes(r.overtime_minutes)} · {r.overtime_status}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Masuk: {r.actual_check_in_wita || '-'} · Keluar: {r.actual_check_out_wita || '-'} · Kerja: {fmtMinutes(r.worked_minutes)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  Owner Dashboard
// ============================================================================
function OwnerDashboardView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try { setData(await absApi('dashboard')); }
    catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  if (loading) return <Skeleton className="h-60 w-full rounded-xl" />;
  const s = data?.summary || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric icon={Users} label="Total Staff" value={s.total_staff ?? 0} tone="default" />
        <Metric icon={LogIn} label="Sudah Masuk" value={s.checked_in ?? 0} tone="green" />
        <Metric icon={AlertCircle} label="Terlambat" value={s.late ?? 0} tone="red" />
        <Metric icon={Timer} label="Belum Absen" value={s.not_checked_in ?? 0} tone="orange" />
        <Metric icon={LogOut} label="Sudah Keluar" value={s.checked_out ?? 0} tone="default" />
        <Metric icon={Clock} label="Masih Bekerja" value={s.still_working ?? 0} tone="default" />
        <Metric icon={ClipboardCheck} label="Lembur Pending" value={s.overtime_pending ?? 0} tone="orange" />
        <Metric icon={Radio} label="Sekarang" value={data?.now || '--:--'} tone="default" />
      </div>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Absensi Hari Ini · {data?.date}</CardTitle>
          <CardDescription>Data auto-refresh setiap 15 detik</CardDescription>
        </CardHeader>
        <CardContent>
          {(data?.records || []).length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Belum ada yang absen.</div>
          ) : (
            <div className="space-y-2">
              {data.records.map((r) => (
                <div key={r.id} className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold">{r.user_name}</div>
                    <Badge className="bg-indigo-500/15 text-indigo-300 border-indigo-500/30">{r.shift_name}</Badge>
                    {r.late_minutes > 0 && <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30">Terlambat {fmtMinutes(r.late_minutes)}</Badge>}
                    {r.overtime_minutes > 0 && (
                      <Badge className={
                        r.overtime_status === 'approved' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                        r.overtime_status === 'rejected' ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' :
                        'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }>Lembur {fmtMinutes(r.overtime_minutes)} · {r.overtime_status}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Masuk: {r.actual_check_in_wita || '-'} · Keluar: {r.actual_check_out_wita || '-'} · Kerja: {fmtMinutes(r.worked_minutes)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(data?.not_checked_in || []).length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Belum Absen ({data.not_checked_in.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {data.not_checked_in.map((u) => (
                  <Badge key={u.user_id} variant="outline" className="border-white/10 text-muted-foreground">{u.user_name}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone = 'default' }) {
  const tones = {
    default: 'from-white/5 to-white/[0.02] border-white/10 text-white',
    green: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30 text-emerald-300',
    red: 'from-rose-500/20 to-rose-500/5 border-rose-500/30 text-rose-300',
    orange: 'from-amber-500/20 to-amber-500/5 border-amber-500/30 text-amber-300',
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${tones[tone]} p-4`}>
      <div className="flex items-center gap-2 text-xs opacity-80"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}

// ============================================================================
//  Owner: Laporan Absensi (filter + tabel + export Excel)
// ============================================================================
function OwnerReportView() {
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const firstOfMonthIso = () => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  };
  const [filters, setFilters] = useState({
    from: firstOfMonthIso(),
    to: todayIso(),
    user_id: 'all',
    shift_key: 'all',
    status: 'all',
  });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [staffOpts, setStaffOpts] = useState([]);
  const [shiftOpts, setShiftOpts] = useState([]);
  const [exporting, setExporting] = useState(false);

  const buildQS = () => {
    const p = new URLSearchParams();
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    if (filters.user_id && filters.user_id !== 'all') p.set('user_id', filters.user_id);
    if (filters.shift_key && filters.shift_key !== 'all') p.set('shift_key', filters.shift_key);
    if (filters.status && filters.status !== 'all') p.set('status', filters.status);
    return p.toString();
  };

  const load = async () => {
    setLoading(true);
    try {
      const d = await absApi(`report?${buildQS()}`);
      setItems(d.items || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  // Load filter options once: shifts from settings, employees from employees API.
  useEffect(() => {
    (async () => {
      try {
        const s = await absApi('settings');
        setShiftOpts(s?.settings?.shifts || []);
      } catch { /* ignore */ }
      try {
        // Reuse existing /api/employees endpoint (no changes to that route).
        const token = localStorage.getItem('cc_token');
        const res = await fetch('/api/employees', { headers: { Authorization: `Bearer ${token || ''}` }});
        if (res.ok) {
          const d = await res.json();
          const list = (Array.isArray(d?.employees) ? d.employees : Array.isArray(d) ? d : []).filter((e) => e.role !== 'owner');
          setStaffOpts(list);
        }
      } catch { /* ignore */ }
    })();
    load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('cc_token');
      const res = await fetch(`/api/absensi/report/export?${buildQS()}`, {
        headers: { Authorization: `Bearer ${token || ''}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-absensi_${filters.from || 'all'}_${filters.to || 'all'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast.success('Excel berhasil diunduh');
    } catch (e) { toast.error(e.message); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Filter Laporan</CardTitle>
          <CardDescription>Filter periode, staff, shift, dan status.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Dari</Label>
              <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Sampai</Label>
              <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Staff</Label>
              <Select value={filters.user_id} onValueChange={(v) => setFilters((f) => ({ ...f, user_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Semua Staff" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Staff</SelectItem>
                  {staffOpts.map((e) => (<SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Shift</Label>
              <Select value={filters.shift_key} onValueChange={(v) => setFilters((f) => ({ ...f, shift_key: v }))}>
                <SelectTrigger><SelectValue placeholder="Semua Shift" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Shift</SelectItem>
                  {shiftOpts.map((s) => (<SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="late">Terlambat</SelectItem>
                  <SelectItem value="ontime">Tepat Waktu</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={load} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Terapkan
            </Button>
            <Button size="sm" variant="outline" onClick={exportExcel} disabled={exporting || items.length === 0} className="gap-2 border-emerald-500/40 text-emerald-300">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
              Export Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Data Laporan · {items.length} record</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full rounded" />
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Tidak ada data untuk filter ini.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-white/10">
                  <tr>
                    {['Tanggal', 'Staff', 'Shift', 'Masuk', 'Keluar', 'Status', 'Terlambat', 'Lembur'].map((h) => (
                      <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const isLate = (r.late_minutes || 0) > 0;
                    return (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 px-2 tabular-nums">{r.date}</td>
                        <td className="py-2 px-2">{r.user_name}</td>
                        <td className="py-2 px-2">{r.shift_name}</td>
                        <td className="py-2 px-2 tabular-nums">{r.actual_check_in_wita || '-'}</td>
                        <td className="py-2 px-2 tabular-nums">{r.actual_check_out_wita || '-'}</td>
                        <td className="py-2 px-2">
                          {r.actual_check_in
                            ? (isLate
                              ? <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30">Terlambat</Badge>
                              : <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Tepat Waktu</Badge>)
                            : <Badge className="bg-white/5 text-muted-foreground border-white/10">Belum Masuk</Badge>}
                        </td>
                        <td className="py-2 px-2 tabular-nums">{isLate ? fmtMinutes(r.late_minutes) : '-'}</td>
                        <td className="py-2 px-2 tabular-nums">
                          {r.overtime_minutes > 0
                            ? <span>{fmtMinutes(r.overtime_minutes)} · <span className="capitalize text-muted-foreground">{r.overtime_status}</span></span>
                            : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
//  Owner: Overtime Approvals
// ============================================================================
function OwnerOvertimeView() {
  const [tab, setTab] = useState('pending');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const load = async () => {
    setLoading(true);
    try { const d = await absApi(`overtime?status=${tab}`); setItems(d.items || []); }
    catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id, kind) => {
    setBusyId(id);
    try {
      await absApi(`overtime/${id}/${kind}`, { method: 'POST', body: JSON.stringify({}) });
      toast.success(kind === 'approve' ? 'Lembur disetujui' : 'Lembur ditolak');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {['pending', 'approved', 'rejected'].map((k) => (
          <Button key={k} size="sm" variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)} className="capitalize">
            {k}
          </Button>
        ))}
      </div>
      {loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">Tidak ada data lembur {tab}.</div>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <div key={r.id} className="rounded-lg border border-white/10 p-3 bg-white/[0.02] flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-semibold">{r.user_name} · {r.date}</div>
                <div className="text-xs text-muted-foreground">
                  Shift {r.shift_name} ({r.shift_start}–{r.shift_end}) · Keluar {r.actual_check_out_wita} · Lembur {fmtMinutes(r.overtime_minutes)}
                </div>
                {r.overtime_reviewed_by_name && (
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                    Ditinjau oleh {r.overtime_reviewed_by_name} · {fmtDate(r.overtime_reviewed_at)}
                  </div>
                )}
              </div>
              {tab === 'pending' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => act(r.id, 'approve')} disabled={busyId === r.id} className="bg-emerald-600 hover:bg-emerald-500 gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Setujui
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => act(r.id, 'reject')} disabled={busyId === r.id} className="border-rose-500/40 text-rose-300 gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Tolak
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  Owner: QR Preview Panel — renders a real, scannable QR image inline so the
//  owner never needs an external QR generator. Includes print + download.
//  This is what the user asked for: "generete QR jadi siap pakai".
// ============================================================================
function QrPreviewPanel({ qrValue, onReveal, onRegenerate }) {
  const [dataUrl, setDataUrl] = useState('');
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!qrValue) { setDataUrl(''); return; }
    setRendering(true);
    // 512x512 PNG, high error-correction so printing on cheap paper still scans.
    QRCodeLib.toDataURL(qrValue, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 512,
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then((url) => setDataUrl(url))
      .catch((e) => toast.error(e?.message || 'Gagal render QR'))
      .finally(() => setRendering(false));
  }, [qrValue]);

  const downloadPng = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'qr-absensi-mis.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const printQr = () => {
    if (!dataUrl) return;
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) { toast.error('Popup diblokir browser'); return; }
    w.document.write(`
      <html>
        <head>
          <title>QR Absensi MIS</title>
          <style>
            @page { size: A4; margin: 20mm; }
            body { font-family: system-ui, sans-serif; text-align: center; padding: 32px; }
            h1 { font-size: 28px; margin: 0 0 4px; }
            .sub { color: #555; margin-bottom: 24px; }
            img { width: 320px; height: 320px; image-rendering: pixelated; border: 8px solid #000; }
            .code { font-family: ui-monospace, monospace; font-size: 11px; color: #666; margin-top: 16px; word-break: break-all; }
            .hint { font-size: 13px; color: #333; margin-top: 24px; max-width: 420px; margin-left: auto; margin-right: auto; }
          </style>
        </head>
        <body>
          <h1>QR ABSENSI MIS</h1>
          <div class="sub">Merdeka Inventory System</div>
          <img src="${dataUrl}" alt="QR Absensi" />
          <div class="hint">Tempel di lokasi absensi. Scan QR ini menggunakan menu Absensi → Absen Masuk → Scan QR Absensi.</div>
          <div class="code">${qrValue}</div>
          <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
        </body>
      </html>
    `);
    w.document.close();
  };

  if (!qrValue) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="outline" onClick={onReveal} className="gap-2 self-start">
          <QrCode className="w-4 h-4" /> Tampilkan QR
        </Button>
        <Button variant="outline" onClick={onRegenerate} className="gap-2 self-start border-amber-500/40 text-amber-300">
          <RefreshCw className="w-4 h-4" /> Regenerate QR
        </Button>
        <div className="text-[10px] text-muted-foreground">
          Tekan &quot;Tampilkan QR&quot; untuk memuat gambar QR siap cetak.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-white p-4 flex flex-col items-center gap-2">
        {rendering || !dataUrl ? (
          <div className="w-64 h-64 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-black" />
          </div>
        ) : (
          <img src={dataUrl} alt="QR Absensi MIS" className="w-64 h-64" style={{ imageRendering: 'pixelated' }} />
        )}
        <div className="text-[10px] font-mono text-black break-all text-center">{qrValue}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={printQr} disabled={!dataUrl} className="gap-2">
          <ClipboardCheck className="w-4 h-4" /> Cetak QR (A4)
        </Button>
        <Button variant="outline" onClick={downloadPng} disabled={!dataUrl} className="gap-2">
          <RefreshCw className="w-4 h-4" /> Download PNG
        </Button>
        <Button variant="outline" onClick={onRegenerate} className="gap-2 border-amber-500/40 text-amber-300">
          <RefreshCw className="w-4 h-4" /> Regenerate QR
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground">
        QR digenerate langsung oleh sistem — tidak perlu generator eksternal. Cetak / download lalu tempel di lokasi absensi.
      </div>
    </div>
  );
}

// ============================================================================
//  Owner: Settings (lokasi + shift + QR)
// ============================================================================
function OwnerSettingsView() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [qrValue, setQrValue] = useState(null);
  const geo = useGeolocation();

  const load = async () => {
    try { const d = await absApi('settings'); setSettings(d.settings); }
    catch (e) { toast.error(e.message); }
  };
  useEffect(() => {
    load();
    // Auto-load QR so owner sees a ready-to-print image immediately.
    (async () => {
      try { const q = await absApi('qr'); setQrValue(q.qr_value); } catch { /* ignore */ }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const d = await absApi('settings', { method: 'PUT', body: JSON.stringify({
        location: settings.location,
        shifts: settings.shifts,
        overtime_min_minutes: settings.overtime_min_minutes,
        photo_retention_days: settings.photo_retention_days,
      })});
      setSettings(d.settings);
      toast.success('Pengaturan tersimpan');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const regenQr = async () => {
    if (!window.confirm('Regenerate QR? QR lama tidak lagi valid. Cetak ulang QR baru untuk ditempel.')) return;
    try {
      const d = await absApi('settings', { method: 'PUT', body: JSON.stringify({ regenerate_qr: true })});
      setSettings(d.settings);
      const q = await absApi('qr');
      setQrValue(q.qr_value);
      toast.success('QR baru dibuat');
    } catch (e) { toast.error(e.message); }
  };

  const revealQr = async () => {
    try { const q = await absApi('qr'); setQrValue(q.qr_value); }
    catch (e) { toast.error(e.message); }
  };

  const setLocFromGps = async () => {
    try {
      const c = await geo.acquire();
      setSettings((s) => ({ ...s, location: { ...s.location, lat: c.lat, lng: c.lng } }));
      toast.success('Koordinat GPS diambil');
    } catch { /* toast already surfaced via geo.error */ }
  };

  if (!settings) return <Skeleton className="h-60 w-full rounded-xl" />;

  return (
    <div className="space-y-4">
      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4"/>Lokasi & Radius</CardTitle>
          <CardDescription>Staff hanya dapat absen bila berada dalam radius ini.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nama Lokasi</Label>
              <Input value={settings.location.name || ''} onChange={(e) => setSettings((s) => ({ ...s, location: { ...s.location, name: e.target.value }}))} />
            </div>
            <div>
              <Label className="text-xs">Radius (meter)</Label>
              <Input type="number" min={5} max={2000} value={settings.location.radius_m || 50}
                onChange={(e) => setSettings((s) => ({ ...s, location: { ...s.location, radius_m: Number(e.target.value) }}))} />
            </div>
            <div>
              <Label className="text-xs">Latitude</Label>
              <Input type="number" step="0.000001" value={settings.location.lat ?? 0}
                onChange={(e) => setSettings((s) => ({ ...s, location: { ...s.location, lat: Number(e.target.value) }}))} />
            </div>
            <div>
              <Label className="text-xs">Longitude</Label>
              <Input type="number" step="0.000001" value={settings.location.lng ?? 0}
                onChange={(e) => setSettings((s) => ({ ...s, location: { ...s.location, lng: Number(e.target.value) }}))} />
            </div>
          </div>
          <Button variant="outline" onClick={setLocFromGps} disabled={geo.busy} className="gap-2">
            {geo.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            Ambil dari GPS Saat Ini
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4"/>Shift</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {settings.shifts.map((sh, i) => (
            <div key={sh.key} className="grid grid-cols-6 gap-2 items-center">
              <Input value={sh.name} onChange={(e) => setSettings((s) => { const arr = [...s.shifts]; arr[i] = { ...sh, name: e.target.value }; return { ...s, shifts: arr };})} className="col-span-2" />
              <Input value={sh.category} onChange={(e) => setSettings((s) => { const arr = [...s.shifts]; arr[i] = { ...sh, category: e.target.value }; return { ...s, shifts: arr };})} />
              <Input type="time" value={sh.start} onChange={(e) => setSettings((s) => { const arr = [...s.shifts]; arr[i] = { ...sh, start: e.target.value }; return { ...s, shifts: arr };})} />
              <Input type="time" value={sh.end} onChange={(e) => setSettings((s) => { const arr = [...s.shifts]; arr[i] = { ...sh, end: e.target.value }; return { ...s, shifts: arr };})} />
              <div className="text-[10px] text-muted-foreground font-mono truncate">{sh.key}</div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <Label className="text-xs">Min. menit lembur</Label>
              <Input type="number" min={0} max={240} value={settings.overtime_min_minutes ?? 30}
                onChange={(e) => setSettings((s) => ({ ...s, overtime_min_minutes: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Retensi Foto Absensi (hari)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={settings.photo_retention_days ?? 30}
                onChange={(e) => setSettings((s) => ({ ...s, photo_retention_days: Number(e.target.value) }))}
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                Foto selfie akan dihapus otomatis setelah melewati periode ini. Data absensi tetap tersimpan.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><QrCode className="w-4 h-4"/>QR Absensi</CardTitle>
          <CardDescription>Owner tampilkan atau cetak QR di sini. Staff scan QR ini saat absen.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <QrPreviewPanel qrValue={qrValue} onReveal={revealQr} onRegenerate={regenQr} />
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        Simpan Pengaturan
      </Button>
    </div>
  );
}

// ============================================================================
//  Reward Poin Absen — Live Point Board
//  Auto-refreshes every 10s (reuses the same polling pattern as OwnerDashboardView).
// ============================================================================
function PointsBoardView({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('');
  const load = async () => {
    try {
      const qs = period ? `?period=${encodeURIComponent(period)}` : '';
      setData(await absApi(`points/leaderboard${qs}`));
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !data) return <Skeleton className="h-60 w-full rounded-xl" />;
  const items = data?.items || [];
  const myIndex = items.findIndex((r) => r.user_id === user?.id);
  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent border-amber-500/20">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <div>
              <div className="text-sm font-semibold">Live Point Board</div>
              <div className="text-[10px] text-muted-foreground">
                Periode {data?.period_key} · {data?.period_range?.from} → {data?.period_range?.to} · auto-refresh 10 detik
              </div>
            </div>
          </div>
          {myIndex >= 0 && (
            <div className="mt-3 text-sm">
              Ranking Anda: <b className="text-amber-300">#{items[myIndex].rank}</b>
              <span className="text-muted-foreground"> · Poin </span>
              <b className="tabular-nums">{items[myIndex].balance}</b>
              {items[myIndex].capped && <span className="text-[10px] text-muted-foreground ml-1">(capped)</span>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardContent className="pt-4">
          {items.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Belum ada data ranking.</div>
          ) : (
            <div className="space-y-1.5">
              {items.map((r) => {
                const isMe = r.user_id === user?.id;
                const medal = r.rank === 1 ? 'text-amber-300' : r.rank === 2 ? 'text-slate-300' : r.rank === 3 ? 'text-orange-300' : 'text-muted-foreground';
                return (
                  <div key={r.user_id} className={`rounded-lg border px-3 py-2 flex items-center gap-3 ${isMe ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}>
                    <div className={`w-8 text-center font-black tabular-nums ${medal}`}>#{r.rank}</div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${isMe ? 'font-semibold text-amber-200' : ''}`}>{r.user_name}</div>
                      {r.capped && <div className="text-[10px] text-muted-foreground">Capped di batas maks/min</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold tabular-nums">{r.balance}</div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {r.delta >= 0 ? '+' : ''}{r.delta} dari {r.initial_balance}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
//  Reward Poin Absen — Riwayat Poin
//  Staff: own history only. Owner: filterable by user.
// ============================================================================
function PointsHistoryView({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [staffOpts, setStaffOpts] = useState([]);
  const [userId, setUserId] = useState('all');
  const [period, setPeriod] = useState('');
  const isOwner = user?.role === 'owner';

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (period) params.set('period', period);
      if (isOwner && userId && userId !== 'all') params.set('user_id', userId);
      const d = await absApi(`points/history?${params.toString()}`);
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (isOwner) {
      (async () => {
        try {
          const token = localStorage.getItem('cc_token');
          const res = await fetch('/api/employees', { headers: { Authorization: `Bearer ${token || ''}` }});
          if (res.ok) {
            const d = await res.json();
            const list = (Array.isArray(d?.employees) ? d.employees : Array.isArray(d) ? d : []).filter((e) => e.role !== 'owner');
            setStaffOpts(list);
          }
        } catch { /* ignore */ }
      })();
    }
    load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, period]);

  return (
    <div className="space-y-3">
      <Card className="bg-[#0a0a0b] border-white/10">
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Periode</Label>
              <Input
                placeholder="Contoh: 2026-08 (26 Jul → 25 Agu). Kosongkan = periode aktif"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
              />
            </div>
            {isOwner && (
              <div>
                <Label className="text-xs">Staff</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger><SelectValue placeholder="Semua Staff" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Staff</SelectItem>
                    {staffOpts.map((e) => (<SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-end">
              <Button size="sm" onClick={load} disabled={loading} className="gap-2 w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Terapkan
              </Button>
            </div>
          </div>
          {data && (
            <div className="mt-3 text-xs text-muted-foreground">
              Periode <b className="text-white">{data.period_key}</b> · {data.period_range?.from} → {data.period_range?.to}
              {!isOwner && (
                <span> · Poin awal: {data.initial_balance} · Perubahan: <b className={data.total_delta >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{data.total_delta >= 0 ? '+' : ''}{data.total_delta}</b></span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardContent className="pt-4">
          {loading ? (
            <Skeleton className="h-40 w-full rounded" />
          ) : (data?.items?.length || 0) === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Belum ada riwayat poin di periode ini.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-white/10">
                  <tr>
                    {['Tanggal', ...(isOwner ? ['Staff'] : []), 'Event', 'Keterangan', 'Poin'].map((h) => (
                      <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.items || []).map((r) => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 px-2 tabular-nums">{r.event_date}</td>
                      {isOwner && <td className="py-2 px-2">{r.user_name}</td>}
                      <td className="py-2 px-2 capitalize">{r.event_type}</td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {r.reason}
                        {r.created_by_name && r.event_type === 'adjustment' && (
                          <div className="text-[10px] text-muted-foreground/70">oleh {r.created_by_name}</div>
                        )}
                      </td>
                      <td className={`py-2 px-2 text-right tabular-nums font-semibold ${r.points >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {r.points >= 0 ? '+' : ''}{r.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
//  Reward Poin Absen — Late tiers editor
//  Dynamic ladder of {max_late_minutes, points, label}. Last row is the
//  catch-all (>= tak-terhingga, `max_late_minutes: null`). Owner may add
//  or delete rows; on save the server normalizes & sorts them.
// ============================================================================
function LateTiersEditor({ tiers, onChange }) {
  const upd = (i, patch) => {
    const next = tiers.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i) => {
    if (tiers.length <= 1) return;
    const next = tiers.filter((_, idx) => idx !== i);
    // Force the (new) last row to be catch-all so backend never rejects.
    next[next.length - 1] = { ...next[next.length - 1], max_late_minutes: null };
    onChange(next);
  };
  const addRow = () => {
    // Insert a new tier BEFORE the catch-all last row.
    const last = tiers[tiers.length - 1] || { points: 0, label: 'Terlambat berat' };
    const prev = tiers[tiers.length - 2];
    const newMax = Number.isFinite(prev?.max_late_minutes) ? Number(prev.max_late_minutes) + 15 : 15;
    const inserted = { max_late_minutes: newMax, points: 3, label: `Terlambat <=${newMax} menit` };
    const next = [...tiers.slice(0, -1), inserted, last];
    onChange(next);
  };
  const isLast = (i) => i === tiers.length - 1;
  return (
    <div className="space-y-2">
      <div className="hidden md:grid md:grid-cols-12 text-[10px] uppercase tracking-wider text-muted-foreground px-1">
        <div className="md:col-span-5">Label</div>
        <div className="md:col-span-3">Maks. Menit</div>
        <div className="md:col-span-2">Poin</div>
        <div className="md:col-span-2 text-right">Aksi</div>
      </div>
      {tiers.map((t, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center border border-white/5 bg-white/[0.02] rounded-md p-2">
          <Input
            className="col-span-12 md:col-span-5"
            placeholder="Contoh: Terlambat 10–30 menit"
            value={t.label || ''}
            onChange={(e) => upd(i, { label: e.target.value })}
          />
          <div className="col-span-6 md:col-span-3">
            <Input
              type="number"
              min={0}
              max={1440}
              value={isLast(i) ? '' : (t.max_late_minutes ?? '')}
              placeholder={isLast(i) ? '∞ (tanpa batas)' : 'contoh 15'}
              disabled={isLast(i)}
              onChange={(e) => upd(i, {
                max_late_minutes: e.target.value === '' ? null : Number(e.target.value),
              })}
            />
            {isLast(i) && (
              <div className="text-[9px] text-muted-foreground mt-0.5">Baris ini otomatis catch-all.</div>
            )}
          </div>
          <Input
            className="col-span-4 md:col-span-2"
            type="number"
            value={t.points ?? 0}
            onChange={(e) => upd(i, { points: Number(e.target.value) })}
          />
          <div className="col-span-2 md:col-span-2 text-right">
            <Button
              size="icon"
              variant="ghost"
              className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
              onClick={() => remove(i)}
              disabled={tiers.length <= 1}
              title={tiers.length <= 1 ? 'Minimal 1 baris' : 'Hapus baris'}
            >
              <Minus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addRow} className="gap-2">
        <Plus className="w-4 h-4" /> Tambah Tingkat Keterlambatan
      </Button>
    </div>
  );
}

// ============================================================================
//  Reward Poin Absen — Owner Settings + Manual Adjustment
// ============================================================================
function PointsSettingsView() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [staffOpts, setStaffOpts] = useState([]);
  const [adj, setAdj] = useState({ user_id: '', points: '', reason: '' });
  const [adjBusy, setAdjBusy] = useState(false);

  const load = async () => {
    try { const d = await absApi('points/settings'); setSettings(d.settings); }
    catch (e) { toast.error(e.message); }
  };
  useEffect(() => {
    load();
    (async () => {
      try {
        const token = localStorage.getItem('cc_token');
        const res = await fetch('/api/employees', { headers: { Authorization: `Bearer ${token || ''}` }});
        if (res.ok) {
          const d = await res.json();
          setStaffOpts((Array.isArray(d?.employees) ? d.employees : Array.isArray(d) ? d : []).filter((e) => e.role !== 'owner'));
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const d = await absApi('points/settings', { method: 'PUT', body: JSON.stringify(settings) });
      setSettings(d.settings);
      toast.success('Pengaturan poin tersimpan');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const applyAdjustment = async (sign) => {
    if (!adj.user_id) { toast.error('Pilih staff'); return; }
    const raw = Number(adj.points);
    if (!Number.isFinite(raw) || raw === 0) { toast.error('Jumlah poin harus bukan nol'); return; }
    if (!adj.reason.trim()) { toast.error('Alasan wajib diisi'); return; }
    setAdjBusy(true);
    try {
      await absApi('points/adjustment', {
        method: 'POST',
        body: JSON.stringify({
          user_id: adj.user_id,
          points: sign * Math.abs(raw),
          reason: adj.reason.trim(),
        }),
      });
      toast.success(sign > 0 ? 'Poin ditambahkan' : 'Poin dikurangi');
      setAdj({ user_id: '', points: '', reason: '' });
    } catch (e) { toast.error(e.message); }
    finally { setAdjBusy(false); }
  };

  if (!settings) return <Skeleton className="h-60 w-full rounded-xl" />;
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  return (
    <div className="space-y-4">
      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Coins className="w-4 h-4"/>Aturan Poin Absensi</CardTitle>
          <CardDescription>
            Tambah / ubah tingkat keterlambatan sesuai kebutuhan. Baris terakhir otomatis jadi
            catch-all (tanpa batas atas). Kosongkan &quot;Maks. Menit&quot; untuk baris terakhir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <LateTiersEditor
            tiers={Array.isArray(settings.late_tiers) && settings.late_tiers.length
              ? settings.late_tiers
              : [
                  { max_late_minutes: 0, points: settings.points_ontime ?? 10, label: 'Tepat waktu' },
                  { max_late_minutes: 10, points: settings.points_late_lt_10 ?? 7, label: 'Terlambat <10 menit' },
                  { max_late_minutes: 30, points: settings.points_late_10_to_30 ?? 5, label: 'Terlambat 10–30 menit' },
                  { max_late_minutes: null, points: settings.points_late_gt_30 ?? 0, label: 'Terlambat >30 menit' },
                ]}
            onChange={(tiers) => setSettings((s) => ({ ...s, late_tiers: tiers }))}
          />
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Batas Saldo</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><Label className="text-xs">Saldo Awal</Label><Input type="number" value={settings.initial_balance} onChange={(e) => set('initial_balance', Number(e.target.value))} /></div>
          <div><Label className="text-xs">Maks. Positif</Label><Input type="number" value={settings.max_positive} onChange={(e) => set('max_positive', Number(e.target.value))} /></div>
          <div><Label className="text-xs">Maks. Negatif</Label><Input type="number" value={settings.max_negative} onChange={(e) => set('max_negative', Number(e.target.value))} /></div>
          <div>
            <Label className="text-xs">Nilai 1 poin (Rp)</Label>
            <Input type="number" value={settings.rupiah_per_point ?? 2500} onChange={(e) => set('rupiah_per_point', Number(e.target.value))} />
            <div className="text-[10px] text-muted-foreground mt-1">Tidak ditampilkan ke staff.</div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        Simpan Pengaturan
      </Button>

      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Plus className="w-4 h-4"/>Manual Adjustment</CardTitle>
          <CardDescription>Tambah atau kurangi poin dengan alasan. Tercatat sebagai transaksi baru — tidak mengedit riwayat.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Staff</Label>
              <Select value={adj.user_id} onValueChange={(v) => setAdj((a) => ({ ...a, user_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih staff" /></SelectTrigger>
                <SelectContent>
                  {staffOpts.map((e) => (<SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Jumlah Poin (positif)</Label>
              <Input type="number" min={1} value={adj.points} onChange={(e) => setAdj((a) => ({ ...a, points: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Alasan <span className="text-rose-400">*</span></Label>
              <Input value={adj.reason} onChange={(e) => setAdj((a) => ({ ...a, reason: e.target.value }))} placeholder="Contoh: Reward kinerja mingguan" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => applyAdjustment(1)} disabled={adjBusy} className="bg-emerald-600 hover:bg-emerald-500 gap-2">
              {adjBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Tambah Poin
            </Button>
            <Button onClick={() => applyAdjustment(-1)} disabled={adjBusy} variant="outline" className="border-rose-500/40 text-rose-300 gap-2">
              {adjBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minus className="w-4 h-4" />} Kurangi Poin
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
//  Root: AbsensiModule
// ============================================================================
export default function AbsensiModule({ user, initialView = 'abs:home' }) {
  const [view, setView] = useState(initialView);
  const isOwner = user?.role === 'owner';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
            <Clock className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="text-xl font-bold">Absensi</div>
            <div className="text-xs text-muted-foreground">Selfie · QR statis · Validasi radius GPS</div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant={view === 'abs:home' ? 'default' : 'outline'} onClick={() => setView('abs:home')}>Absensi</Button>
          <Button size="sm" variant={view === 'abs:points:board' ? 'default' : 'outline'} onClick={() => setView('abs:points:board')} className="gap-1"><Trophy className="w-3.5 h-3.5"/>Live Board</Button>
          <Button size="sm" variant={view === 'abs:points:history' ? 'default' : 'outline'} onClick={() => setView('abs:points:history')} className="gap-1"><Coins className="w-3.5 h-3.5"/>Riwayat Poin</Button>
          {isOwner && (
            <>
              <Button size="sm" variant={view === 'abs:owner:dashboard' ? 'default' : 'outline'} onClick={() => setView('abs:owner:dashboard')} className="gap-1"><Users className="w-3.5 h-3.5"/>Dashboard</Button>
              <Button size="sm" variant={view === 'abs:owner:report' ? 'default' : 'outline'} onClick={() => setView('abs:owner:report')} className="gap-1"><History className="w-3.5 h-3.5"/>Laporan</Button>
              <Button size="sm" variant={view === 'abs:owner:overtime' ? 'default' : 'outline'} onClick={() => setView('abs:owner:overtime')} className="gap-1"><ClipboardCheck className="w-3.5 h-3.5"/>Lembur</Button>
              <Button size="sm" variant={view === 'abs:points:settings' ? 'default' : 'outline'} onClick={() => setView('abs:points:settings')} className="gap-1"><Coins className="w-3.5 h-3.5"/>Pengaturan Poin</Button>
              <Button size="sm" variant={view === 'abs:owner:settings' ? 'default' : 'outline'} onClick={() => setView('abs:owner:settings')} className="gap-1"><SettingsIcon className="w-3.5 h-3.5"/>Pengaturan</Button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={view} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {view === 'abs:home' && <StaffHomeView user={user} onNav={setView} />}
          {view === 'abs:in' && <CheckInView onDone={() => setView('abs:home')} onBack={() => setView('abs:home')} />}
          {view === 'abs:out' && <CheckOutView onDone={() => setView('abs:home')} onBack={() => setView('abs:home')} />}
          {view === 'abs:history' && <HistoryView onBack={() => setView('abs:home')} />}
          {view === 'abs:owner:dashboard' && isOwner && <OwnerDashboardView />}
          {view === 'abs:owner:report' && isOwner && <OwnerReportView />}
          {view === 'abs:owner:overtime' && isOwner && <OwnerOvertimeView />}
          {view === 'abs:owner:settings' && isOwner && <OwnerSettingsView />}
          {view === 'abs:points:board' && <PointsBoardView user={user} />}
          {view === 'abs:points:history' && <PointsHistoryView user={user} />}
          {view === 'abs:points:settings' && isOwner && <PointsSettingsView />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
