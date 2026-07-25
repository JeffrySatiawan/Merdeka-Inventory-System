'use client';

// ============================================================
// Order Management Module — Frontend Entry
// Self-contained. Exposes 6 sub-views selectable via `view` prop.
// This file must NOT import anything from Cycle Count views.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine,
  PackageCheck,
  Truck,
  Camera,
  RefreshCw,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShoppingCart,
  Plus,
  Pencil,
  Trash2,
  Filter,
  Download,
  FileDown,
  Search,
  BarChart3,
  Clock,
  ChevronRight,
  Percent,
  Package,
  ArrowRight,
  X,
  ImageOff,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { omApi, compressToWebp } from './api';
import { feedback, startCameraScanner } from './scanner';

// ============================================================
// SHARED: Scanner Mode Layout
// ============================================================
function useRealtimeClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}
function formatTime(d) {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
function formatShort(d) {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function ScannerCounter({ label, value, tone = 'default' }) {
  const map = {
    default: 'text-white',
    blue: 'text-blue-400',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
  };
  return (
    <div className="flex-1 min-w-0 text-center">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={`text-2xl md:text-3xl font-black tabular-nums ${map[tone]}`}>{value}</div>
    </div>
  );
}

function LiveScanQueue({ items }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Live Scan Queue
        </div>
        <div className="ml-auto text-[10px] text-muted-foreground tabular-nums">{items.length}/10</div>
      </div>
      {items.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          Belum ada scan. Arahkan scanner ke barcode.
        </div>
      ) : (
        <ul className="divide-y divide-white/5 max-h-[42vh] overflow-y-auto">
          <AnimatePresence initial={false}>
            {items.map((it) => {
              const tone =
                it.type === 'ok'
                  ? 'bg-emerald-500/5 border-l-emerald-500'
                  : it.type === 'warn'
                  ? 'bg-amber-500/5 border-l-amber-500'
                  : it.type === 'err'
                  ? 'bg-rose-500/5 border-l-rose-500'
                  : 'bg-white/[0.02] border-l-blue-500';
              const dot =
                it.type === 'ok' ? '🟢' : it.type === 'warn' ? '🟡' : it.type === 'err' ? '🔴' : '🔵';
              return (
                <motion.li
                  key={it.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`px-3 py-2 border-l-2 ${tone}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{dot}</span>
                    <span className="font-mono text-xs font-semibold truncate">{it.tracking || '-'}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{it.time}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground ml-6 truncate">{it.message}</div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

/**
 * ScannerShell — reusable scanner-mode layout.
 * CAMERA-ONLY INPUT for tracking numbers (no manual typing, no keyboard popup).
 * Props:
 *   pageName, moduleName, user, stats (array), children (form area), queue,
 *   onScanDecoded (fn), disabled (bool — auto-pauses camera when true).
 */
function ScannerShell({
  moduleName = 'Order Management',
  pageName,
  user,
  stats = [],
  disabled = false,
  queue = [],
  children,
  onScanDecoded, // called when camera decodes a barcode
}) {
  const clock = useRealtimeClock();
  const [cameraErr, setCameraErr] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null); // { w, h, playing }
  const [retryTick, setRetryTick] = useState(0);
  const stopCameraRef = useRef(null);
  const lastDecodeRef = useRef({ code: '', ts: 0 });
  // Keep latest onScanDecoded without restarting camera on every render
  const decodedCbRef = useRef(onScanDecoded);
  useEffect(() => {
    decodedCbRef.current = onScanDecoded;
  }, [onScanDecoded]);

  // Camera auto-start / auto-stop (paused when disabled=true)
  useEffect(() => {
    if (disabled) return; // camera paused while wizard is processing an item
    let mounted = true;
    setCameraErr(null);
    setCameraReady(false);

    // Give the DOM 2 frames to render #om-camera, then start.
    // We no longer require a specific size — since we own the <video> element
    // (see scanner.js), the container will grow with its child regardless of
    // initial measurement quirks. This avoids infinite retry loops.
    const startWhenReady = (attempt = 0) => {
      if (!mounted) return;
      const el = document.getElementById('om-camera');
      if (!el) {
        // element not mounted yet; try again on next frame (max ~120 frames)
        if (attempt < 120) requestAnimationFrame(() => startWhenReady(attempt + 1));
        else setCameraErr('Kamera container tidak muncul. Coba refresh halaman.');
        return;
      }

      // Environment sanity check
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraErr('Browser tidak mendukung akses kamera (getUserMedia). Gunakan Chrome / Safari terbaru dan buka lewat HTTPS.');
        return;
      }

      startCameraScanner(
        'om-camera',
        (decoded) => {
          if (!mounted) return;
          const now = Date.now();
          if (lastDecodeRef.current.code === decoded && now - lastDecodeRef.current.ts < 1200) return;
          lastDecodeRef.current = { code: decoded, ts: now };
          if (decodedCbRef.current) decodedCbRef.current(decoded);
        },
        (msg) => { try { console.warn('[OM Camera]', msg); } catch {} }
      )
        .then((stopFn) => {
          if (!mounted) {
            try { stopFn && stopFn(); } catch {}
            return;
          }
          stopCameraRef.current = stopFn;
          setCameraReady(true);
        })
        .catch((e) => {
          if (!mounted) return;
          const msg = String(e?.message || e || 'Tidak dapat mengakses kamera');
          setCameraErr(msg);
          try { console.error('[OM Camera] Init failed:', e); } catch {}
        });
    };
    // Use rAF-based wait so React finishes rendering the container first
    requestAnimationFrame(() => requestAnimationFrame(() => startWhenReady(0)));

    return () => {
      mounted = false;
      setCameraReady(false);
      setVideoInfo(null);
      if (stopCameraRef.current) {
        stopCameraRef.current().catch(() => {});
        stopCameraRef.current = null;
      }
    };
  }, [disabled, retryTick]);

  // Periodically read actual video dimensions so we can display them.
  // If cameraReady=true but video dimensions stay 0x0 → strong signal that
  // stream never rendered (e.g., missing playsInline on unpatched libs).
  useEffect(() => {
    if (!cameraReady || disabled) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const el = document.getElementById('om-camera');
      const v = el && el.querySelector('video');
      if (v) {
        setVideoInfo({
          w: v.videoWidth || 0,
          h: v.videoHeight || 0,
          playing: !v.paused && !v.ended && v.readyState >= 2,
          readyState: v.readyState,
        });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [cameraReady, disabled, retryTick]);

  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      {/* Compact scanner header */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-blue-500/5 to-transparent p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="border-blue-500/40 text-blue-300 text-[9px] py-0 h-4">
            SCANNER MODE
          </Badge>
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
            {moduleName}
          </div>
          <div className="ml-auto text-xs font-mono tabular-nums text-muted-foreground">
            {formatTime(clock)}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <div className="font-semibold text-base leading-tight">{pageName}</div>
          <div className="text-[11px] text-muted-foreground">👤 {user?.name}</div>
        </div>
      </div>

      {/* Counter row */}
      {stats.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground text-center pb-1">
            Hari Ini
          </div>
          <div className="flex items-stretch divide-x divide-white/5">
            {stats.map((s) => (
              <ScannerCounter key={s.label} {...s} />
            ))}
          </div>
        </div>
      )}

      {/* Camera-only scan area — no text input, no keyboard popup */}
      <div className="rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
        <div
          className={`relative w-full border border-white/10 ${disabled ? 'opacity-40' : ''}`}
          style={{ aspectRatio: '16 / 10', minHeight: 220 }}
        >
          {/* Camera container — video element is directly appended here by scanner.js.
              No border-radius / overflow:hidden on wrapper to avoid Chrome Android
              compositing bug where video renders black inside rounded clip. */}
          <div id="om-camera" />
          {/* Overlays are siblings, positioned absolutely — never mixed with camera DOM */}
          {!cameraErr && !cameraReady && !disabled && (
            <div className="absolute inset-0 flex items-center justify-center text-blue-200/80 text-xs gap-2 pointer-events-none z-10 bg-black/40">
              <Loader2 className="w-4 h-4 animate-spin" /> Mengaktifkan kamera...
            </div>
          )}
          {disabled && (
            <div className="absolute inset-0 flex items-center justify-center text-amber-200/90 text-[11px] font-semibold uppercase tracking-widest pointer-events-none bg-black/60 z-10">
              Kamera dijeda
            </div>
          )}
          {cameraErr && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center bg-black/85 z-10">
              <AlertTriangle className="w-6 h-6 text-rose-400" />
              <div className="text-[11px] text-rose-300 max-w-xs break-words">{cameraErr}</div>
              <div className="text-[10px] text-muted-foreground">Izinkan akses kamera di browser / device.</div>
              <button
                type="button"
                onClick={() => setRetryTick((v) => v + 1)}
                className="mt-1 px-3 py-1.5 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 text-xs flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Coba Lagi
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Camera className="w-3 h-3" />
            {disabled
              ? 'Menunggu proses resi sebelumnya...'
              : cameraReady
              ? 'Arahkan barcode / QR resi ke kamera'
              : cameraErr
              ? 'Kamera tidak aktif'
              : 'Menyiapkan kamera...'}
          </span>
          {cameraReady && !disabled && (
            <span className="flex items-center gap-1 text-emerald-300 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
              {videoInfo && videoInfo.w > 0 && (
                <span className="text-emerald-400/70 ml-1">
                  {videoInfo.w}×{videoInfo.h}
                </span>
              )}
              {videoInfo && videoInfo.w === 0 && (
                <span className="text-amber-400 ml-1" title="Stream aktif tapi belum ada frame">
                  ⚠ 0×0
                </span>
              )}
              {videoInfo && !videoInfo.playing && videoInfo.w > 0 && (
                <span className="text-rose-400 ml-1" title="Video paused">
                  ⏸
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Optional inline form (children) */}
      {children}

      {/* Live scan queue */}
      <LiveScanQueue items={queue} />
    </div>
  );
}

function useScanQueue(max = 10) {
  const [items, setItems] = useState([]);
  const add = (entry) => {
    setItems((prev) => [
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, time: formatShort(new Date()), ...entry },
      ...prev,
    ].slice(0, max));
  };
  return { items, add };
}

// ---------- Small components ----------
function StatCard({ label, value, sub, tone = 'default', icon: Icon }) {
  const tones = {
    default: 'from-white/5 to-transparent border-white/10',
    blue: 'from-blue-500/10 to-transparent border-blue-500/20',
    emerald: 'from-emerald-500/10 to-transparent border-emerald-500/20',
    amber: 'from-amber-500/10 to-transparent border-amber-500/20',
    rose: 'from-rose-500/10 to-transparent border-rose-500/20',
    purple: 'from-purple-500/10 to-transparent border-purple-500/20',
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${tones[tone]} p-4`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className="text-3xl font-bold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ============================================================
// VIEW: Dashboard
// ============================================================
function OMDashboardView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPending, setShowPending] = useState(false);
  const [pending, setPending] = useState([]);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const d = await omApi('dashboard');
      setData(d);
    } catch (e) {
      toast.error(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 8000);
    return () => clearInterval(t);
  }, []);

  async function openPending() {
    try {
      const d = await omApi('pending');
      setPending(d.items || []);
      setShowPending(true);
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const t = data?.today || {};
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-400" />
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Order Management</h1>
            <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
              MODULE 2
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">
            Dashboard hari ini · {data?.date} · Pastikan semua resi diserahkan ke kurir.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Resi Dipacking" value={t.packed || 0} tone="blue" icon={PackageCheck} />
        <StatCard label="Resi Diserahkan" value={t.delivered || 0} tone="emerald" icon={Truck} />
        <StatCard
          label="Selisih"
          value={t.difference || 0}
          tone={t.difference > 0 ? 'rose' : 'emerald'}
          sub={t.difference > 0 ? 'Belum diserahkan' : 'Tidak ada selisih'}
          icon={AlertTriangle}
        />
        <StatCard
          label="Success Rate"
          value={`${t.success_rate || 0}%`}
          tone={t.success_rate === 100 ? 'emerald' : t.success_rate >= 80 ? 'amber' : 'rose'}
          icon={Percent}
        />
        <StatCard
          label="Pending Total"
          value={data?.pending_total || 0}
          sub="All-time belum diserahkan"
          tone="amber"
          icon={Clock}
        />
      </div>

      {t.difference > 0 && (
        <button
          onClick={openPending}
          className="w-full text-left rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 flex items-center gap-3 hover:bg-rose-500/10 transition"
        >
          <AlertTriangle className="w-5 h-5 text-rose-400" />
          <div className="flex-1">
            <div className="font-semibold text-rose-300">
              {t.difference} resi belum diserahkan hari ini
            </div>
            <div className="text-xs text-rose-300/70">Klik untuk lihat daftar</div>
          </div>
          <ChevronRight className="w-4 h-4 text-rose-400" />
        </button>
      )}

      {/* By Expedition */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Truck className="w-4 h-4 text-blue-400" /> Breakdown per Ekspedisi (Hari Ini)
          </div>
          {(data?.by_expedition || []).length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">Belum ada data hari ini</div>
          ) : (
            <div className="space-y-2">
              {data.by_expedition.map((e) => {
                const cetak = e.printed || 0;
                const packing = e.packed || 0;
                const kirim = e.delivered || 0;
                const selisih = e.diff !== undefined ? e.diff : (Math.max(cetak, packing) - kirim);
                return (
                  <div key={e.expedition_id} className="p-3 rounded-lg border border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-blue-400" />
                      <div className="font-semibold text-sm">{e.expedition_name}</div>
                      {selisih > 0 && (
                        <Badge variant="outline" className="ml-auto border-rose-500/40 text-rose-400 text-[9px]">
                          Selisih {selisih}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1 text-center">
                      <div><div className="text-[9px] text-muted-foreground uppercase">Cetak</div><div className="text-lg font-bold tabular-nums">{cetak}</div></div>
                      <div><div className="text-[9px] text-muted-foreground uppercase">Packing</div><div className="text-lg font-bold tabular-nums text-blue-400">{packing}</div></div>
                      <div><div className="text-[9px] text-muted-foreground uppercase">Kirim</div><div className="text-lg font-bold tabular-nums text-emerald-400">{kirim}</div></div>
                      <div><div className="text-[9px] text-muted-foreground uppercase">Selisih</div><div className={`text-lg font-bold tabular-nums ${selisih > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{selisih}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* By Operator */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-400" /> Breakdown per Operator (Hari Ini)
          </div>
          {(data?.by_operator || []).length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">Belum ada data hari ini</div>
          ) : (
            <div className="space-y-2">
              {data.by_operator.map((o) => (
                <div key={o.operator_id} className="flex items-center gap-3 p-2 rounded-lg border border-white/5">
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-xs font-bold">
                    {o.operator?.[0] || '?'}
                  </div>
                  <div className="flex-1 font-medium text-sm">{o.operator}</div>
                  <div className="text-right tabular-nums">
                    <div className="text-sm font-semibold">{o.delivered}/{o.packed}</div>
                    <div className="text-[10px] text-muted-foreground">Deliv / Pack</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showPending} onOpenChange={setShowPending}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Daftar Resi Belum Diserahkan Hari Ini</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {pending.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6">Tidak ada</div>
            )}
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 p-2 border border-white/10 rounded-lg text-xs">
                <div className="font-mono">{p.tracking_number}</div>
                <Badge variant="outline" className="text-[9px]">{p.expedition_name}</Badge>
                <span className="text-muted-foreground">{p.packed_by_name}</span>
                <span className="ml-auto text-muted-foreground">
                  {new Date(p.packed_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ============================================================
// SHARED: Duplicate message formatter (for queue entries)
// ============================================================
function fmtDuplicateMsg(prefix, dup) {
  if (!dup) return prefix;
  const dt = dup.at
    ? new Date(dup.at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '-';
  return `${prefix} · ${dup.operator || '-'} · ${dt}`;
}

// ============================================================
// VIEW: Scan Cetak Resi (Phase 1)
// - Batch mode: pilih ekspedisi sekali, scan banyak resi
// ============================================================
function OMScanPrintView({ user }) {
  const [expeditions, setExpeditions] = useState([]);
  const [expeditionId, setExpeditionId] = useState('');
  const [stats, setStats] = useState({ printed: 0, packed: 0, delivered: 0, diff_pack_deliver: 0 });
  const { items: queue, add: addQueue } = useScanQueue(10);
  const processingRef = useRef(false);

  useEffect(() => {
    omApi('expeditions').then((d) => {
      const list = d.items || [];
      setExpeditions(list);
      if (list[0]) setExpeditionId(list[0].id);
    }).catch(() => {});
    refreshStats();
    const t = setInterval(refreshStats, 8000);
    return () => clearInterval(t);
  }, []);

  async function refreshStats() {
    try {
      const d = await omApi('dashboard');
      setStats(d.today || {});
    } catch {}
  }

  async function process(value) {
    if (processingRef.current) return;
    const v = String(value || '').trim();
    if (!v) return;
    if (!expeditionId) {
      feedback('warn');
      addQueue({ type: 'warn', tracking: v, message: 'Pilih ekspedisi terlebih dahulu' });
      return;
    }
    processingRef.current = true;
    try {
      const resp = await omApi('scan/print', {
        method: 'POST',
        body: JSON.stringify({ tracking_number: v, expedition_id: expeditionId }),
      });
      feedback('ok');
      addQueue({
        type: 'ok',
        tracking: v,
        message: `Cetak · ${resp.shipment.expedition_name}`,
      });
      setStats((s) => ({ ...s, printed: (s.printed || 0) + 1 }));
    } catch (e) {
      const dup = e?.data?.duplicate || (typeof e === 'object' && e.duplicate);
      if (e.status === 409) {
        feedback('warn');
        addQueue({
          type: 'warn',
          tracking: v,
          message: fmtDuplicateMsg('Sudah dicetak', dup),
        });
      } else {
        feedback('err');
        addQueue({ type: 'err', tracking: v, message: e.message || 'Error' });
      }
    } finally {
      processingRef.current = false;
    }
  }

  return (
    <ScannerShell
      moduleName="Order Management"
      pageName="Scan Cetak Resi"
      user={user}
      stats={[
        { label: 'Cetak', value: stats.printed || 0, tone: 'blue' },
        { label: 'Packing', value: stats.packed || 0, tone: 'default' },
        { label: 'Kirim', value: stats.delivered || 0, tone: 'emerald' },
        { label: 'Selisih', value: stats.diff_pack_deliver || 0, tone: (stats.diff_pack_deliver || 0) > 0 ? 'rose' : 'emerald' },
      ]}
      onScanDecoded={(v) => process(v)}
      disabled={!expeditionId}
      queue={queue}
    >
      {/* Batch expedition selector */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Ekspedisi (pilih sekali, scan banyak resi)
        </Label>
        <Select value={expeditionId} onValueChange={setExpeditionId}>
          <SelectTrigger className="h-12 text-base font-semibold">
            <SelectValue placeholder="Pilih ekspedisi" />
          </SelectTrigger>
          <SelectContent>
            {expeditions.filter((e) => e.active).map((e) => (
              <SelectItem key={e.id} value={e.id} className="text-base py-3">
                {e.name} {e.code && `· ${e.code}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ScannerShell>
  );
}

// ============================================================
// VIEW: Scan Mulai Packing (Phase 2) — STEP-BY-STEP WIZARD
// SCAN → SKU → ITEM → FOTO → SIMPAN (sequential, auto-focus)
// ============================================================
function OMScanPackView({ user }) {
  const [pending, setPending] = useState(null); // { shipment }
  const [step, setStep] = useState('sku'); // sku | item | photo | ready
  const [form, setForm] = useState({ sku_count: '', item_count: '', photo_data_url: null, photo_size: 0 });
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);
  const photoRef = useRef(null);
  const skuRef = useRef(null);
  const itemRef = useRef(null);
  const saveBtnRef = useRef(null);
  const [stats, setStats] = useState({ printed: 0, packed: 0, delivered: 0, diff_pack_deliver: 0 });
  const { items: queue, add: addQueue } = useScanQueue(10);
  const processingRef = useRef(false);

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, 8000);
    return () => clearInterval(t);
  }, []);
  async function refreshStats() {
    try {
      const d = await omApi('dashboard');
      setStats(d.today || {});
    } catch {}
  }

  // Auto-focus per step
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      if (step === 'sku') { skuRef.current?.focus(); skuRef.current?.select(); }
      else if (step === 'item') { itemRef.current?.focus(); itemRef.current?.select(); }
      else if (step === 'photo') { photoRef.current?.click(); }
      else if (step === 'ready') { saveBtnRef.current?.focus(); }
    }, 200);
    return () => clearTimeout(timer);
  }, [step, pending]);

  async function lookup(value) {
    if (processingRef.current) return;
    const v = String(value || '').trim();
    if (!v) return;
    if (pending) {
      addQueue({ type: 'warn', tracking: v, message: 'Selesaikan resi sebelumnya dulu' });
      feedback('warn');
      return;
    }
    processingRef.current = true;
    try {
      const d = await omApi(`shipments?q=${encodeURIComponent(v)}&limit=1`);
      const s = (d.items || []).find((x) => x.tracking_number === v);
      if (!s || !s.printed_at) {
        feedback('err');
        addQueue({ type: 'err', tracking: v, message: 'Resi belum terdaftar pada proses Scan Cetak Resi.' });
      } else if (s.status === 'packed' || s.status === 'delivered') {
        feedback('warn');
        addQueue({
          type: 'warn',
          tracking: v,
          message: fmtDuplicateMsg('Sudah dipacking', {
            operator: s.packed_by_name,
            at: s.packed_at,
          }),
        });
      } else {
        feedback('ok');
        setPending({ shipment: s });
        setForm({ sku_count: '', item_count: '', photo_data_url: null, photo_size: 0 });
        setStep('sku'); // start wizard at SKU input
      }
    } catch (e) {
      feedback('err');
      addQueue({ type: 'err', tracking: v, message: e.message || 'Error' });
    } finally {
      processingRef.current = false;
    }
  }

  function nextFromSku() {
    const n = Number(form.sku_count);
    if (!Number.isFinite(n) || n < 1) { feedback('warn'); return; }
    setStep('item');
  }
  function nextFromItem() {
    const n = Number(form.item_count);
    if (!Number.isFinite(n) || n < 1) { feedback('warn'); return; }
    setStep('photo'); // will auto-open camera
  }

  async function onPhotoSelected(e) {
    const file = e.target.files?.[0];
    if (!file) {
      // User cancelled camera — allow retry manually
      return;
    }
    setCompressing(true);
    try {
      const { dataUrl, sizeBytes } = await compressToWebp(file, { maxWidth: 900, targetKB: 220 });
      setForm((f) => ({ ...f, photo_data_url: dataUrl, photo_size: sizeBytes }));
      feedback('ok');
      setStep('ready');
    } catch (err) {
      feedback('err');
      addQueue({ type: 'err', tracking: pending?.shipment?.tracking_number, message: 'Kompresi foto gagal' });
    } finally {
      setCompressing(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  }

  async function save() {
    if (!pending) return;
    const s = pending.shipment;
    setSaving(true);
    try {
      const resp = await omApi('scan/pack', {
        method: 'POST',
        body: JSON.stringify({
          tracking_number: s.tracking_number,
          sku_count: Number(form.sku_count),
          item_count: Number(form.item_count),
          photo_data_url: form.photo_data_url,
        }),
      });
      feedback('ok');
      addQueue({ type: 'ok', tracking: s.tracking_number, message: `Packing selesai · ${resp.shipment.expedition_name}` });
      setStats((st) => ({ ...st, packed: (st.packed || 0) + 1 }));
      setPending(null);
      setStep('sku');
    } catch (e) {
      feedback('err');
      addQueue({ type: 'err', tracking: s.tracking_number, message: e.message || 'Error' });
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setPending(null);
    setStep('sku');
    setForm({ sku_count: '', item_count: '', photo_data_url: null, photo_size: 0 });
  }

  const stepIdx = { sku: 0, item: 1, photo: 2, ready: 3 }[step] || 0;

  return (
    <ScannerShell
      moduleName="Order Management"
      pageName="Scan Mulai Packing"
      user={user}
      stats={[
        { label: 'Cetak', value: stats.printed || 0, tone: 'default' },
        { label: 'Packing', value: stats.packed || 0, tone: 'blue' },
        { label: 'Kirim', value: stats.delivered || 0, tone: 'emerald' },
        { label: 'Selisih', value: stats.diff_pack_deliver || 0, tone: (stats.diff_pack_deliver || 0) > 0 ? 'rose' : 'emerald' },
      ]}
      onScanDecoded={(v) => lookup(v)}
      disabled={!!pending}
      queue={queue}
    >
      {pending && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border-2 border-blue-500/40 bg-blue-500/5 p-3 space-y-3"
        >
          {/* Info resi + ekspedisi (auto-inherit) */}
          <div className="flex items-start justify-between gap-2 pb-2 border-b border-white/10">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-blue-300">Resi Siap Packing</div>
              <div className="font-mono text-lg font-bold">{pending.shipment.tracking_number}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                <span className="text-white font-semibold">{pending.shipment.expedition_name}</span>
                <span className="mx-1.5">·</span>
                Dicetak: {pending.shipment.printed_by_name}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={cancel} disabled={saving}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1">
            {['SKU', 'ITEM', 'FOTO', 'SIMPAN'].map((label, i) => (
              <div
                key={label}
                className={`flex-1 h-1.5 rounded-full transition-all ${
                  i <= stepIdx ? 'bg-blue-500' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {['1 · SKU', '2 · ITEM', '3 · FOTO', '4 · SIMPAN'].map((label, i) => (
              <div key={label} className={`flex-1 text-center ${i === stepIdx ? 'text-blue-300 font-bold' : ''}`}>
                {label}
              </div>
            ))}
          </div>

          {/* STEP 1: SKU */}
          <AnimatePresence mode="wait">
            {step === 'sku' && (
              <motion.div
                key="sku"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <Label className="text-xs">Langkah 1 · Isi Jumlah SKU</Label>
                <Input
                  ref={skuRef}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="Jumlah SKU"
                  value={form.sku_count}
                  onChange={(e) => setForm({ ...form, sku_count: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), nextFromSku())}
                  className="h-14 text-2xl text-center tabular-nums font-bold"
                />
                <Button onClick={nextFromSku} className="w-full h-12 gap-2" disabled={!form.sku_count || Number(form.sku_count) < 1}>
                  Lanjut ke Item <ArrowRight className="w-4 h-4" />
                </Button>
              </motion.div>
            )}

            {/* STEP 2: ITEM */}
            {step === 'item' && (
              <motion.div
                key="item"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <div className="text-[10px] text-muted-foreground">
                  ✓ SKU: <span className="font-bold text-white">{form.sku_count}</span>
                </div>
                <Label className="text-xs">Langkah 2 · Isi Total Item</Label>
                <Input
                  ref={itemRef}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="Total Item"
                  value={form.item_count}
                  onChange={(e) => setForm({ ...form, item_count: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), nextFromItem())}
                  className="h-14 text-2xl text-center tabular-nums font-bold"
                />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('sku')} className="flex-1 h-12">
                    Kembali
                  </Button>
                  <Button onClick={nextFromItem} className="flex-1 h-12 gap-2" disabled={!form.item_count || Number(form.item_count) < 1}>
                    Lanjut Foto <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP 3: FOTO */}
            {step === 'photo' && (
              <motion.div
                key="photo"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <div className="text-[10px] text-muted-foreground">
                  ✓ SKU: <span className="font-bold text-white">{form.sku_count}</span> · Item: <span className="font-bold text-white">{form.item_count}</span>
                </div>
                <Label className="text-xs">Langkah 3 · Foto Isi Paket</Label>
                <button
                  type="button"
                  onClick={() => photoRef.current?.click()}
                  disabled={compressing}
                  className="w-full aspect-[16/9] rounded-lg border-2 border-dashed border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10 transition flex flex-col items-center justify-center gap-2 text-blue-300 disabled:opacity-50"
                >
                  {compressing ? (
                    <><Loader2 className="w-6 h-6 animate-spin" /><span className="text-xs">Kompres foto...</span></>
                  ) : (
                    <>
                      <Camera className="w-8 h-8" />
                      <span className="text-sm font-semibold">Aktifkan Kamera</span>
                      <span className="text-[10px] text-muted-foreground">Otomatis dikompres · WebP ~200KB · disimpan 10 hari</span>
                    </>
                  )}
                </button>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onPhotoSelected}
                />
                <Button variant="outline" onClick={() => setStep('item')} className="w-full h-12">
                  Kembali
                </Button>
              </motion.div>
            )}

            {/* STEP 4: SIMPAN */}
            {step === 'ready' && (
              <motion.div
                key="ready"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <div className="text-[10px] text-muted-foreground">
                  ✓ SKU: <span className="font-bold text-white">{form.sku_count}</span> · Item: <span className="font-bold text-white">{form.item_count}</span>
                </div>
                <Label className="text-xs">Langkah 4 · Cek Foto & Simpan</Label>
                {form.photo_data_url && (
                  <div className="relative">
                    <img src={form.photo_data_url} alt="preview" className="w-full max-h-56 object-cover rounded-lg border border-emerald-500/40" />
                    <div className="absolute top-2 right-2 flex gap-1">
                      <Badge variant="outline" className="bg-black/60 text-[9px] border-emerald-500/40 text-emerald-300">
                        ✓ {(form.photo_size / 1024).toFixed(0)} KB · WEBP
                      </Badge>
                      <Button size="sm" variant="secondary" onClick={() => photoRef.current?.click()} className="h-6 text-[10px]">
                        Foto Ulang
                      </Button>
                    </div>
                  </div>
                )}
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onPhotoSelected}
                />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('photo')} className="flex-1 h-12" disabled={saving}>
                    Kembali
                  </Button>
                  <Button ref={saveBtnRef} onClick={save} disabled={saving} className="flex-[2] h-14 gap-2 bg-emerald-600 hover:bg-emerald-500 text-base font-bold">
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    SIMPAN PACKING
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </ScannerShell>
  );
}

// ============================================================
// VIEW: Scan Serah Terima Kurir (Phase 3)
// ============================================================
function OMScanDeliveryView({ user }) {
  const [stats, setStats] = useState({ printed: 0, packed: 0, delivered: 0, diff_pack_deliver: 0 });
  const { items: queue, add: addQueue } = useScanQueue(10);
  const processingRef = useRef(false);

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, 8000);
    return () => clearInterval(t);
  }, []);
  async function refreshStats() {
    try {
      const d = await omApi('dashboard');
      setStats(d.today || {});
    } catch {}
  }

  async function process(value) {
    if (processingRef.current) return;
    const v = String(value || '').trim();
    if (!v) return;
    processingRef.current = true;
    try {
      const resp = await omApi('scan/deliver', {
        method: 'POST',
        body: JSON.stringify({ tracking_number: v }),
      });
      feedback('ok');
      addQueue({ type: 'ok', tracking: v, message: `Diserahkan · ${resp.shipment.expedition_name}` });
      setStats((s) => ({ ...s, delivered: (s.delivered || 0) + 1 }));
    } catch (e) {
      if (e.status === 409) {
        feedback('warn');
        const dup = e?.data?.duplicate;
        addQueue({
          type: 'warn',
          tracking: v,
          message: dup ? fmtDuplicateMsg('Sudah diserahkan', dup) : (e.message || 'Belum melalui Packing'),
        });
      } else if (e.status === 404) {
        feedback('err');
        addQueue({ type: 'err', tracking: v, message: e.message || 'Resi tidak ditemukan' });
      } else {
        feedback('err');
        addQueue({ type: 'err', tracking: v, message: e.message || 'Error' });
      }
    } finally {
      processingRef.current = false;
    }
  }

  return (
    <ScannerShell
      moduleName="Order Management"
      pageName="Scan Serah Terima Kurir"
      user={user}
      stats={[
        { label: 'Cetak', value: stats.printed || 0, tone: 'default' },
        { label: 'Packing', value: stats.packed || 0, tone: 'default' },
        { label: 'Kirim', value: stats.delivered || 0, tone: 'emerald' },
        { label: 'Selisih', value: stats.diff_pack_deliver || 0, tone: (stats.diff_pack_deliver || 0) > 0 ? 'rose' : 'emerald' },
      ]}
      onScanDecoded={(v) => process(v)}
      queue={queue}
    />
  );
}


// ============================================================
// VIEW: Master Ekspedisi
// ============================================================
function OMExpeditionsView({ isOwner }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const d = await omApi('expeditions?include_inactive=1');
      setItems(d.items || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function del(id) {
    if (!confirm('Hapus ekspedisi?')) return;
    try {
      await omApi(`expeditions/${id}`, { method: 'DELETE' });
      toast.success('Ekspedisi dihapus');
      load();
    } catch (e) { toast.error(e.message); }
  }
  async function toggleActive(item) {
    try {
      await omApi(`expeditions/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !item.active }),
      });
      load();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Master Ekspedisi</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">
            Daftar ekspedisi yang tersedia untuk packing
          </p>
        </div>
        {isOwner && (
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> Tambah
          </Button>
        )}
      </div>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-white/5 hover:bg-white/[0.02]">
                  <div className="w-10 h-10 rounded-md bg-blue-500/10 flex items-center justify-center">
                    <Truck className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold">{e.name}</div>
                      {e.code && <Badge variant="outline" className="text-[9px]">{e.code}</Badge>}
                      {!e.active && <Badge variant="outline" className="border-rose-500/40 text-rose-400 text-[9px]">NON-AKTIF</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">Sort: {e.sort_order}</div>
                  </div>
                  {isOwner && (
                    <div className="flex gap-1">
                      <Button size="sm" variant={e.active ? 'ghost' : 'outline'} onClick={() => toggleActive(e)}>
                        {e.active ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setShowForm(true); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => del(e.id)} className="text-rose-400 hover:text-rose-300">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ExpeditionForm
        open={showForm}
        onClose={() => setShowForm(false)}
        editing={editing}
        onSaved={() => { setShowForm(false); load(); }}
      />
    </div>
  );
}

function ExpeditionForm({ open, onClose, editing, onSaved }) {
  const [form, setForm] = useState({ name: '', code: '', active: true, sort_order: 99 });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(editing
        ? { name: editing.name, code: editing.code || '', active: editing.active, sort_order: editing.sort_order || 99 }
        : { name: '', code: '', active: true, sort_order: 99 });
    }
  }, [open, editing]);
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await omApi(`expeditions/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
        toast.success('Ekspedisi diperbarui');
      } else {
        await omApi('expeditions', { method: 'POST', body: JSON.stringify(form) });
        toast.success('Ekspedisi ditambahkan');
      }
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Edit Ekspedisi' : 'Ekspedisi Baru'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>Nama</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Kode</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Sort Order</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-blue-500" />
            Aktif
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// VIEW: Laporan (with PDF export)
// ============================================================
function OMReportsView({ user }) {
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({
    date_from: today,
    date_to: today,
    operator_id: '',
    expedition_id: '',
    status: '',
    q: '',
  });
  const [expeditions, setExpeditions] = useState([]);
  const [operators, setOperators] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ex, emps] = await Promise.all([
          omApi('expeditions?include_inactive=1'),
          fetch('/api/employees', { headers: { Authorization: `Bearer ${localStorage.getItem('cc_token')}` } }).then((r) => r.json()),
        ]);
        setExpeditions(ex.items || []);
        setOperators(emps.items || []);
      } catch {}
    })();
    apply();
    // eslint-disable-next-line
  }, []);

  async function apply() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const d = await omApi(`shipments?${params.toString()}`);
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  async function downloadPdf() {
    if (!data) return;
    setDownloading(true);
    try {
      const [{ default: jsPDF }, autoTableMod] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const autoTable = autoTableMod.default;
      const doc = new jsPDF();
      // Header
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 0, 210, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.text('MIS · Merdeka Inventory System', 14, 12);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.text('Laporan Harian — Order Management', 14, 30);
      doc.setFontSize(9);
      const rangeText = filters.date_from === filters.date_to
        ? `Tanggal: ${filters.date_from}`
        : `Periode: ${filters.date_from} s/d ${filters.date_to}`;
      doc.text(rangeText, 14, 37);
      doc.text(`Dibuat: ${new Date().toLocaleString('id-ID')}`, 14, 42);
      doc.text(`Oleh: ${user?.name || '-'}`, 14, 47);

      // Summary
      const s = data.summary || {};
      autoTable(doc, {
        startY: 54,
        head: [['Metrik', 'Nilai']],
        body: [
          ['Total Resi Dipacking', String(s.packed || 0)],
          ['Total Resi Diserahkan', String(s.delivered || 0)],
          ['Selisih', String(s.difference || 0)],
          ['Success Rate', `${s.success_rate || 0}%`],
        ],
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235] },
        styles: { fontSize: 9 },
      });

      // By Expedition
      const byExp = {};
      const byOp = {};
      (data.items || []).forEach((it) => {
        const ek = it.expedition_name || '-';
        if (!byExp[ek]) byExp[ek] = { packed: 0, delivered: 0 };
        byExp[ek].packed++;
        if (it.status === 'delivered') byExp[ek].delivered++;
        const ok = it.packed_by_name || '-';
        if (!byOp[ok]) byOp[ok] = { packed: 0, delivered: 0 };
        byOp[ok].packed++;
        if (it.status === 'delivered') byOp[ok].delivered++;
      });
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 6,
        head: [['Rekap per Ekspedisi', 'Dipacking', 'Diserahkan', 'Selisih']],
        body: Object.entries(byExp).map(([k, v]) => [k, v.packed, v.delivered, v.packed - v.delivered]),
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129] },
        styles: { fontSize: 9 },
      });
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 6,
        head: [['Rekap per Operator', 'Dipacking', 'Diserahkan', 'Selisih']],
        body: Object.entries(byOp).map(([k, v]) => [k, v.packed, v.delivered, v.packed - v.delivered]),
        theme: 'striped',
        headStyles: { fillColor: [147, 51, 234] },
        styles: { fontSize: 9 },
      });

      // Belum diserahkan
      const belum = (data.items || []).filter((x) => x.status === 'packed');
      if (belum.length > 0) {
        doc.addPage();
        doc.setFillColor(239, 68, 68);
        doc.rect(0, 0, 210, 14, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12);
        doc.text(`DAFTAR RESI BELUM DISERAHKAN (${belum.length})`, 14, 10);
        doc.setTextColor(0, 0, 0);
        autoTable(doc, {
          startY: 20,
          head: [['No. Resi', 'Ekspedisi', 'Operator', 'Jam Packing']],
          body: belum.map((b) => [
            b.tracking_number,
            b.expedition_name,
            b.packed_by_name,
            new Date(b.packed_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
          ]),
          theme: 'grid',
          headStyles: { fillColor: [239, 68, 68] },
          styles: { fontSize: 8 },
        });
      }

      // Detail list (limited to first 200 rows to keep PDF sane)
      const items = (data.items || []).slice(0, 200);
      if (items.length > 0) {
        doc.addPage();
        doc.setFontSize(12);
        doc.text(`Detail Transaksi (${items.length}${(data.items || []).length > 200 ? ' dari ' + data.items.length : ''})`, 14, 14);
        autoTable(doc, {
          startY: 20,
          head: [['No. Resi', 'Ekspedisi', 'Operator', 'SKU', 'Item', 'Status', 'Packing']],
          body: items.map((x) => [
            x.tracking_number,
            x.expedition_name,
            x.packed_by_name,
            x.sku_count,
            x.item_count,
            x.status === 'delivered' ? 'Diserahkan' : 'Menunggu Pickup',
            new Date(x.packed_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
          ]),
          theme: 'grid',
          headStyles: { fillColor: [37, 99, 235] },
          styles: { fontSize: 7 },
        });
      }

      doc.save(`OM_Laporan_${filters.date_from}${filters.date_from !== filters.date_to ? '_sd_' + filters.date_to : ''}.pdf`);
    } catch (e) {
      toast.error('Gagal membuat PDF: ' + e.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Laporan Order Management</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">Filter transaksi packing & serah terima kurir</p>
        </div>
        <Button onClick={downloadPdf} disabled={downloading || !data} className="gap-2" size="sm">
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          Download PDF
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div><Label className="text-xs">Dari</Label><Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Sampai</Label><Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Operator</Label>
              <Select value={filters.operator_id || 'all'} onValueChange={(v) => setFilters({ ...filters, operator_id: v === 'all' ? '' : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Operator</SelectItem>
                  {operators.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Ekspedisi</Label>
              <Select value={filters.expedition_id || 'all'} onValueChange={(v) => setFilters({ ...filters, expedition_id: v === 'all' ? '' : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Ekspedisi</SelectItem>
                  {expeditions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Status</Label>
              <Select value={filters.status || 'all'} onValueChange={(v) => setFilters({ ...filters, status: v === 'all' ? '' : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="packed">Menunggu Pickup</SelectItem>
                  <SelectItem value="delivered">Sudah Diserahkan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 md:col-span-1 flex items-end">
              <Button onClick={apply} disabled={loading} className="w-full gap-2 h-9">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />} Terapkan
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Dipacking" value={data.summary.packed} tone="blue" />
          <StatCard label="Diserahkan" value={data.summary.delivered} tone="emerald" />
          <StatCard label="Selisih" value={data.summary.difference} tone={data.summary.difference > 0 ? 'rose' : 'emerald'} />
          <StatCard label="Success Rate" value={`${data.summary.success_rate}%`} tone={data.summary.success_rate === 100 ? 'emerald' : 'amber'} />
        </div>
      )}

      {/* Table */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (data?.items || []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Tidak ada transaksi pada filter ini.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3">No. Resi</th>
                    <th className="py-2 pr-3">Ekspedisi</th>
                    <th className="py-2 pr-3">Operator</th>
                    <th className="py-2 pr-3 text-right">SKU/Item</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Packing</th>
                    <th className="py-2 pr-3">Serah Terima</th>
                    <th className="py-2 pr-3">Foto</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.items || []).map((x) => (
                    <tr key={x.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 pr-3 font-mono">{x.tracking_number}</td>
                      <td className="py-2 pr-3">{x.expedition_name}</td>
                      <td className="py-2 pr-3">{x.packed_by_name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{x.sku_count}/{x.item_count}</td>
                      <td className="py-2 pr-3">
                        {x.status === 'delivered' ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[9px]">Diserahkan</Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[9px]">Menunggu Pickup</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{new Date(x.packed_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {x.delivered_at ? new Date(x.delivered_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        {!x.photo_deleted ? (
                          <a href={`/api/om/photos/${x.id}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-[10px]">Lihat</a>
                        ) : (
                          <ImageOff className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
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

// ============================================================
// VIEW: Pengaturan Module
// ============================================================
function OMSettingsView({ isOwner }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const d = await omApi('settings');
      setSettings(d.settings);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function save() {
    setSaving(true);
    try {
      await omApi('settings', { method: 'PUT', body: JSON.stringify(settings) });
      toast.success('Pengaturan disimpan');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }
  if (loading) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Pengaturan Module</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-1">Retensi foto & data Order Management</p>
      </div>
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6 space-y-4">
          <div>
            <Label>Retensi Foto (hari)</Label>
            <Input type="number" min={1} max={365} value={settings?.photo_retention_days || 10}
              onChange={(e) => setSettings({ ...settings, photo_retention_days: Number(e.target.value) })}
              disabled={!isOwner} />
            <div className="text-xs text-muted-foreground mt-1">Foto akan dihapus otomatis setelah lewat jumlah hari ini. Data transaksi tetap tersimpan.</div>
          </div>
          <div>
            <Label>Retensi Data Transaksi (hari)</Label>
            <Input type="number" min={1} max={3650} value={settings?.record_retention_days || 90}
              onChange={(e) => setSettings({ ...settings, record_retention_days: Number(e.target.value) })}
              disabled={!isOwner} />
            <div className="text-xs text-muted-foreground mt-1">Transaksi lebih tua dari ini akan dihapus otomatis.</div>
          </div>
          <div className="pt-2 border-t border-white/10">
            <Label>Cutoff Pindah ke Tab Selesai (jam WITA)</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input type="number" min={0} max={23} step={1} value={settings?.archive_cutoff_hour ?? 6}
                onChange={(e) => setSettings({ ...settings, archive_cutoff_hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })}
                disabled={!isOwner} className="w-24 text-center tabular-nums" />
              <span className="text-sm text-muted-foreground">:00 WITA</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Setiap hari pada jam ini, resi yang <span className="text-white">sudah dikirim</span> pindah otomatis dari tab <span className="text-blue-300">Kirim</span> ke tab <span className="text-emerald-300">Selesai</span>. Data tetap tersimpan lengkap (siapa cetak/packing/kirim + jam).
            </div>
          </div>
          {isOwner && (
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Simpan
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// VIEW: SELESAI (Archived shipments)
// Menampilkan resi yang sudah dikirim & lewat cutoff (default 06:00 WITA)
// Data lengkap: cetak, packing, kirim (nama + jam masing-masing) + foto
// ============================================================
function OMCompletedView({ user }) {
  const isOwner = user?.role === 'owner';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ cetak: 0, packing: 0, kirim: 0, selesai: 0 });
  const [cutoffInfo, setCutoffInfo] = useState(null);
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [photoModal, setPhotoModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      params.set('limit', '500');
      const d = await omApi(`tab/selesai?${params.toString()}`);
      setItems(d.items || []);
      setCounts(d.counts || {});
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }
  async function loadCutoff() {
    try { setCutoffInfo(await omApi('cutoff-info')); } catch {}
  }
  useEffect(() => {
    load();
    loadCutoff();
    // Refresh every 30s so newly-archived resi appear automatically after cutoff moment
    const t = setInterval(() => { load(); loadCutoff(); }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fmtDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('id-ID', {
      timeZone: 'Asia/Makassar',
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  function fmtDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('id-ID', {
      timeZone: 'Asia/Makassar', day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  const nextCutoffLabel = cutoffInfo?.next_cutoff
    ? new Date(cutoffInfo.next_cutoff).toLocaleString('id-ID', {
        timeZone: 'Asia/Makassar', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : '-';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" /> Selesai
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">
            Arsip resi yang telah melewati proses <span className="text-white">Cetak → Packing → Kirim</span> dan lewat batas cutoff harian.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Cutoff Aktif</div>
          <div className="text-lg font-bold tabular-nums">
            {String(cutoffInfo?.cutoff_hour ?? 6).padStart(2, '0')}:00 <span className="text-xs text-muted-foreground">WITA</span>
          </div>
          <div className="text-[10px] text-muted-foreground">Berikutnya: {nextCutoffLabel}</div>
        </div>
      </div>

      {/* Tab counter summary — helps user see full workflow numbers */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 text-center">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Cetak</div>
          <div className="text-lg font-bold tabular-nums">{counts.cetak || 0}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 text-center">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Packing</div>
          <div className="text-lg font-bold tabular-nums text-blue-300">{counts.packing || 0}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 text-center">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Kirim</div>
          <div className="text-lg font-bold tabular-nums text-amber-300">{counts.kirim || 0}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-center">
          <div className="text-[9px] uppercase tracking-widest text-emerald-300">Selesai</div>
          <div className="text-lg font-bold tabular-nums text-emerald-300">{counts.selesai || 0}</div>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">Cari No. Resi</Label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && load()}
                  placeholder="Cari..." className="h-9 pl-8" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Tanggal Kirim Dari</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Sampai</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <Button onClick={load} size="sm" className="gap-1">
              <Filter className="w-3 h-3" /> Terapkan Filter
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setQ(''); setDateFrom(''); setDateTo(''); setTimeout(load, 50); }}>
              Reset
            </Button>
            <div className="ml-auto text-xs text-muted-foreground flex items-center">
              Total: <span className="ml-1 font-bold text-white">{items.length}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-4 pb-4">
          {loading ? (
            <Skeleton className="h-40" />
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
              Belum ada resi yang masuk arsip Selesai.
              <div className="text-xs mt-1">Resi otomatis pindah ke sini setelah lewat jam cutoff ({String(cutoffInfo?.cutoff_hour ?? 6).padStart(2, '0')}:00 WITA).</div>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left border-b border-white/10">
                  <tr>
                    <th className="py-2 px-3">No. Resi</th>
                    <th className="py-2 px-3">Ekspedisi</th>
                    <th className="py-2 px-3">Cetak</th>
                    <th className="py-2 px-3">Packing</th>
                    <th className="py-2 px-3">Kirim</th>
                    <th className="py-2 px-3 text-center">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {items.map((x) => (
                    <tr key={x.id} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-3 font-mono font-semibold">{x.tracking_number}</td>
                      <td className="py-2 px-3">
                        <div className="font-semibold">{x.expedition_name}</div>
                        {x.expedition_code && <div className="text-[10px] text-muted-foreground">{x.expedition_code}</div>}
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-semibold">{x.printed_by_name || '-'}</div>
                        <div className="text-[10px] text-muted-foreground">{fmtDateTime(x.printed_at)}</div>
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-semibold">{x.packed_by_name || '-'}</div>
                        <div className="text-[10px] text-muted-foreground">{fmtDateTime(x.packed_at)}</div>
                        {x.sku_count > 0 && (
                          <div className="text-[10px] text-muted-foreground">{x.sku_count} SKU · {x.item_count} item</div>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-semibold text-emerald-300">{x.delivered_by_name || '-'}</div>
                        <div className="text-[10px] text-muted-foreground">{fmtDateTime(x.delivered_at)}</div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Button size="sm" variant="ghost" onClick={() => setDetailModal(x)} className="h-7 gap-1">
                          <Search className="w-3 h-3" /> Lihat
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail modal */}
      <Dialog open={!!detailModal} onOpenChange={(o) => !o && setDetailModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Detail Resi {detailModal?.tracking_number}
            </DialogTitle>
          </DialogHeader>
          {detailModal && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-white/5">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Ekspedisi</div>
                  <div className="font-semibold">{detailModal.expedition_name}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Kode</div>
                  <div className="font-semibold">{detailModal.expedition_code || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Jumlah SKU</div>
                  <div className="font-semibold">{detailModal.sku_count || 0}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Total Item</div>
                  <div className="font-semibold">{detailModal.item_count || 0}</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="p-2 rounded border-l-2 border-blue-500 bg-blue-500/5">
                  <div className="text-[10px] uppercase text-blue-300 flex items-center gap-1"><Package className="w-3 h-3" /> Cetak</div>
                  <div className="font-semibold text-sm">{detailModal.printed_by_name || '-'}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtDateTime(detailModal.printed_at)}</div>
                </div>
                <div className="p-2 rounded border-l-2 border-indigo-500 bg-indigo-500/5">
                  <div className="text-[10px] uppercase text-indigo-300 flex items-center gap-1"><PackageCheck className="w-3 h-3" /> Packing</div>
                  <div className="font-semibold text-sm">{detailModal.packed_by_name || '-'}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtDateTime(detailModal.packed_at)}</div>
                </div>
                <div className="p-2 rounded border-l-2 border-emerald-500 bg-emerald-500/5">
                  <div className="text-[10px] uppercase text-emerald-300 flex items-center gap-1"><Truck className="w-3 h-3" /> Kirim (Serah Terima)</div>
                  <div className="font-semibold text-sm">{detailModal.delivered_by_name || '-'}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtDateTime(detailModal.delivered_at)}</div>
                </div>
                {detailModal.archived_at && (
                  <div className="p-2 rounded border-l-2 border-white/20 bg-white/[0.02]">
                    <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Diarsipkan</div>
                    <div className="text-[11px] text-muted-foreground">{fmtDateTime(detailModal.archived_at)}</div>
                  </div>
                )}
              </div>
              {detailModal.photo_path !== undefined && !detailModal.photo_deleted && (
                <Button variant="outline" onClick={() => setPhotoModal(detailModal)} className="w-full gap-2">
                  <ImageOff className="w-4 h-4" /> Lihat Foto Packing
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Photo modal */}
      <Dialog open={!!photoModal} onOpenChange={(o) => !o && setPhotoModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">{photoModal?.tracking_number}</DialogTitle>
          </DialogHeader>
          {photoModal && (
            <img
              src={`/api/om/photos/${photoModal.id}`}
              alt="packing"
              className="w-full max-h-[60vh] object-contain rounded-lg"
              onError={(e) => { e.target.style.display = 'none'; toast.error('Foto sudah kadaluarsa atau tidak ditemukan'); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Main Module Entry
// ============================================================
export default function OrderManagementModule({ view, user }) {
  const isOwner = user?.role === 'owner';
  switch (view) {
    case 'om:dashboard': return <OMDashboardView />;
    case 'om:scan_print': return <OMScanPrintView user={user} />;
    case 'om:scan_pack': return <OMScanPackView user={user} />;
    case 'om:scan_deliver': return <OMScanDeliveryView user={user} />;
    case 'om:completed': return <OMCompletedView user={user} />;
    case 'om:reports': return <OMReportsView user={user} />;
    case 'om:expeditions': return <OMExpeditionsView isOwner={isOwner} />;
    case 'om:settings': return <OMSettingsView isOwner={isOwner} />;
    default: return <OMDashboardView />;
  }
}
