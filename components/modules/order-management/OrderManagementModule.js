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
                const rate = e.packed ? Math.round((e.delivered / e.packed) * 100) : 0;
                return (
                  <div key={e.expedition_id} className="flex items-center gap-3 p-2 rounded-lg border border-white/5">
                    <div className="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center">
                      <Truck className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm">{e.expedition_name}</div>
                      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden mt-1.5">
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-blue-500" style={{ width: `${rate}%` }} />
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="text-sm font-semibold">{e.delivered}/{e.packed}</div>
                      <div className="text-[10px] text-muted-foreground">{rate}%</div>
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
// VIEW: Scan Mulai Packing
// ============================================================
function OMScanPackView() {
  const scanRef = useRef(null);
  const [tracking, setTracking] = useState('');
  const [step, setStep] = useState('scan'); // scan | form | saving
  const [expeditions, setExpeditions] = useState([]);
  const [form, setForm] = useState({
    tracking_number: '',
    expedition_id: '',
    sku_count: 1,
    item_count: 1,
    photo_data_url: null,
    photo_size: 0,
  });
  const [counter, setCounter] = useState(0);
  const [saving, setSaving] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const photoFileRef = useRef(null);

  async function loadExpeditions() {
    try {
      const d = await omApi('expeditions');
      setExpeditions(d.items || []);
    } catch (e) {
      toast.error(e.message);
    }
  }
  async function loadCounter() {
    try {
      const d = await omApi('dashboard');
      setCounter(d?.today?.packed || 0);
    } catch {}
  }

  useEffect(() => {
    loadExpeditions();
    loadCounter();
  }, []);

  // Autofocus scan input when in 'scan' step
  useEffect(() => {
    if (step === 'scan') {
      const t = setTimeout(() => {
        scanRef.current?.focus();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [step]);

  // Handle Enter/tab from USB barcode scanner
  function onScanKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = tracking.trim();
      if (!v) return;
      setForm((f) => ({
        ...f,
        tracking_number: v,
        expedition_id: expeditions.find((x) => x.active)?.id || '',
        sku_count: 1,
        item_count: 1,
        photo_data_url: null,
        photo_size: 0,
      }));
      setTracking('');
      setStep('form');
    }
  }

  async function onPhotoSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    try {
      const { dataUrl, sizeBytes } = await compressToWebp(file, { maxWidth: 900, targetKB: 220 });
      setForm((f) => ({ ...f, photo_data_url: dataUrl, photo_size: sizeBytes }));
    } catch (err) {
      toast.error('Gagal memproses foto: ' + err.message);
    } finally {
      setCompressing(false);
      // Reset input so same file can be reselected
      if (photoFileRef.current) photoFileRef.current.value = '';
    }
  }

  function resetToScan() {
    setForm({
      tracking_number: '',
      expedition_id: '',
      sku_count: 1,
      item_count: 1,
      photo_data_url: null,
      photo_size: 0,
    });
    setTracking('');
    setStep('scan');
  }

  async function submit() {
    if (!form.tracking_number) return toast.error('Nomor resi kosong');
    if (!form.expedition_id) return toast.error('Pilih ekspedisi');
    if (!form.photo_data_url) return toast.error('Foto isi paket wajib');
    if (form.sku_count < 1) return toast.error('Jumlah SKU minimal 1');
    if (form.item_count < 1) return toast.error('Jumlah item minimal 1');

    setSaving(true);
    try {
      const resp = await omApi('scan/pack', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      toast.success(resp.message || 'Berhasil disimpan');
      setCounter((c) => c + 1);
      resetToScan();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <ScanLine className="w-5 h-5 text-blue-400" />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Scan Mulai Packing</h1>
        </div>
        <p className="text-muted-foreground text-xs md:text-sm mt-1">
          Scan barcode resi kemudian lengkapi form packing.
        </p>
      </div>

      {/* Counter */}
      <div className="rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-transparent p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
          <PackageCheck className="w-6 h-6 text-blue-400" />
        </div>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Hari Ini</div>
          <div className="text-sm text-muted-foreground">Total Resi Dipacking</div>
        </div>
        <div className="text-4xl font-black tabular-nums text-blue-400">{counter}</div>
      </div>

      {step === 'scan' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-10"
        >
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <ScanLine className="w-8 h-8 text-blue-400 animate-pulse" />
            </div>
            <div>
              <div className="text-lg font-semibold">Scan Barcode Resi</div>
              <div className="text-xs text-muted-foreground mt-1">
                Arahkan scanner ke barcode resi, kemudian sistem akan menampilkan form.
              </div>
            </div>
            <Input
              ref={scanRef}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              onKeyDown={onScanKey}
              placeholder="Menunggu scan..."
              className="text-center text-lg font-mono tracking-wider max-w-md h-12"
              autoFocus
              inputMode="text"
              autoComplete="off"
            />
            <div className="text-[10px] text-muted-foreground">
              atau ketik manual lalu tekan <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[9px]">Enter</kbd>
            </div>
          </div>
        </motion.div>
      )}

      {step === 'form' && (
        <motion.div
          key="form"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground tracking-widest">Nomor Resi</div>
              <div className="font-mono text-lg md:text-xl font-bold">{form.tracking_number}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={resetToScan} title="Batal">
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Photo capture */}
          <div className="space-y-2">
            <Label className="text-xs">Foto Isi Paket <span className="text-rose-400">*</span></Label>
            {form.photo_data_url ? (
              <div className="relative">
                <img
                  src={form.photo_data_url}
                  alt="preview"
                  className="w-full max-h-64 object-cover rounded-lg border border-white/10"
                />
                <div className="absolute top-2 right-2 flex gap-1">
                  <Badge variant="outline" className="bg-black/60 text-[9px]">
                    {(form.photo_size / 1024).toFixed(0)} KB · WEBP
                  </Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => photoFileRef.current?.click()}
                    className="h-6 text-[10px]"
                  >
                    Ganti
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoFileRef.current?.click()}
                disabled={compressing}
                className="w-full aspect-video rounded-lg border-2 border-dashed border-white/10 hover:border-blue-500/40 hover:bg-blue-500/5 transition flex flex-col items-center justify-center gap-2 text-muted-foreground disabled:opacity-50"
              >
                {compressing ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <div className="text-xs">Memproses foto...</div>
                  </>
                ) : (
                  <>
                    <Camera className="w-6 h-6" />
                    <div className="text-xs">Ambil foto isi paket</div>
                    <div className="text-[10px]">Otomatis dikompres ke ~200KB WebP</div>
                  </>
                )}
              </button>
            )}
            <input
              ref={photoFileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onPhotoSelected}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5 md:col-span-1">
              <Label className="text-xs">Ekspedisi <span className="text-rose-400">*</span></Label>
              <Select
                value={form.expedition_id}
                onValueChange={(v) => setForm((f) => ({ ...f, expedition_id: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Pilih ekspedisi" /></SelectTrigger>
                <SelectContent>
                  {expeditions.filter((x) => x.active).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} {e.code && `(${e.code})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Jumlah SKU</Label>
              <Input
                type="number"
                min={1}
                value={form.sku_count}
                onChange={(e) => setForm((f) => ({ ...f, sku_count: Number(e.target.value) }))}
                className="h-11 text-lg tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Total Item</Label>
              <Input
                type="number"
                min={1}
                value={form.item_count}
                onChange={(e) => setForm((f) => ({ ...f, item_count: Number(e.target.value) }))}
                className="h-11 text-lg tabular-nums"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="ghost" onClick={resetToScan} className="flex-1" disabled={saving}>
              Batal
            </Button>
            <Button
              onClick={submit}
              disabled={saving || compressing}
              className="flex-1 gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Simpan
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ============================================================
// VIEW: Scan Serah Terima Kurir
// ============================================================
function OMScanDeliveryView() {
  const scanRef = useRef(null);
  const [tracking, setTracking] = useState('');
  const [counter, setCounter] = useState(0);
  const [lastResult, setLastResult] = useState(null); // { type: 'ok'|'err'|'already', ...}
  const [pending, setPending] = useState(0);
  const [processing, setProcessing] = useState(false);

  async function loadStats() {
    try {
      const d = await omApi('dashboard');
      setCounter(d?.today?.delivered || 0);
      setPending(d?.today?.pending || 0);
    } catch {}
  }

  useEffect(() => {
    loadStats();
    // Autofocus
    const t = setTimeout(() => scanRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  async function process(v) {
    if (!v || processing) return;
    setProcessing(true);
    setTracking('');
    try {
      const resp = await omApi('scan/deliver', {
        method: 'POST',
        body: JSON.stringify({ tracking_number: v }),
      });
      if (resp.already) {
        setLastResult({ type: 'already', message: resp.message, shipment: resp.shipment });
        toast.info(resp.message);
      } else {
        setLastResult({ type: 'ok', message: resp.message, shipment: resp.shipment });
        toast.success(resp.message);
        setCounter((c) => c + 1);
        setPending((p) => Math.max(0, p - 1));
      }
    } catch (e) {
      setLastResult({ type: 'err', message: e.message });
      toast.error(e.message);
    } finally {
      setProcessing(false);
      // Refocus for next scan
      setTimeout(() => scanRef.current?.focus(), 100);
    }
  }

  function onScanKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = tracking.trim();
      if (v) process(v);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-emerald-400" />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Scan Serah Terima Kurir</h1>
        </div>
        <p className="text-muted-foreground text-xs md:text-sm mt-1">
          Scan setiap resi saat menyerahkan ke kurir untuk memastikan tidak ada yang tertinggal.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Diserahkan Hari Ini" value={counter} tone="emerald" icon={CheckCircle2} />
        <StatCard label="Sisa Belum Diserahkan" value={pending} tone={pending > 0 ? 'amber' : 'emerald'} icon={Clock} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent p-6 md:p-10"
      >
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <ScanLine className="w-8 h-8 text-emerald-400 animate-pulse" />
          </div>
          <div>
            <div className="text-lg font-semibold">Scan Barcode Resi</div>
            <div className="text-xs text-muted-foreground mt-1">
              Scan setiap resi yang akan diserahkan ke kurir.
            </div>
          </div>
          <Input
            ref={scanRef}
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            onKeyDown={onScanKey}
            placeholder="Menunggu scan..."
            className="text-center text-lg font-mono tracking-wider max-w-md h-12"
            autoFocus
            inputMode="text"
            autoComplete="off"
            disabled={processing}
          />
          {processing && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Memproses...
            </div>
          )}
        </div>
      </motion.div>

      {/* Last result */}
      <AnimatePresence mode="wait">
        {lastResult && (
          <motion.div
            key={lastResult.type + (lastResult.shipment?.id || Math.random())}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`rounded-xl border p-4 ${
              lastResult.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : lastResult.type === 'already'
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-rose-500/40 bg-rose-500/10'
            }`}
          >
            <div className="flex items-start gap-3">
              {lastResult.type === 'ok' ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              ) : lastResult.type === 'already' ? (
                <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
              )}
              <div className="flex-1">
                <div className="font-semibold">
                  {lastResult.type === 'ok' && 'Berhasil Diserahkan'}
                  {lastResult.type === 'already' && 'Sudah Diserahkan Sebelumnya'}
                  {lastResult.type === 'err' && 'Gagal'}
                </div>
                <div className="text-sm text-muted-foreground mt-1">{lastResult.message}</div>
                {lastResult.shipment && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">Ekspedisi: {lastResult.shipment.expedition_name}</Badge>
                    <Badge variant="outline">Operator Packing: {lastResult.shipment.packed_by_name}</Badge>
                    <Badge variant="outline">
                      {lastResult.shipment.sku_count} SKU · {lastResult.shipment.item_count} item
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
// Main Module Entry
// ============================================================
export default function OrderManagementModule({ view, user }) {
  const isOwner = user?.role === 'owner';
  switch (view) {
    case 'om:dashboard': return <OMDashboardView />;
    case 'om:scan_pack': return <OMScanPackView />;
    case 'om:scan_deliver': return <OMScanDeliveryView />;
    case 'om:reports': return <OMReportsView user={user} />;
    case 'om:expeditions': return <OMExpeditionsView isOwner={isOwner} />;
    case 'om:settings': return <OMSettingsView isOwner={isOwner} />;
    default: return <OMDashboardView />;
  }
}
