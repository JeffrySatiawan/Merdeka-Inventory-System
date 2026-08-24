'use client';

// ============================================================================
// FakturModule — MIS Faktur (isolated feature)
// Upload PDF invoices → forwarded to a private Telegram channel by the backend.
// MIS keeps only metadata + Telegram references.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Receipt,
  Upload,
  Search,
  Loader2,
  Download,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Send,
  UserCircle2,
  Calendar,
  ShieldCheck,
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

// ---- API helper (isolated from module-1/2 helpers) --------------------------
async function fakturApi(path, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null;
  const isForm = options.body instanceof FormData;
  const headers = {
    ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`/api/faktur${path ? `/${path}` : ''}`, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---- Dynamic 4-digit PIN verification (mirrors OMS KETOKO / Buka PDF) -------
// A random non-trivial 4-digit PIN is displayed on-screen; the operator must
// re-type it to confirm intent. Regenerates + shakes on wrong input. Used for
// both "Buka PDF" and "Hapus" actions in MIS Faktur.
const _EASY_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '2345', '3456', '4567', '5678', '6789', '7890',
  '4321', '5432', '6543', '7654', '8765', '9876', '0987',
  '1212', '2121', '1010', '0101',
]);
function generatePin() {
  const rand = () => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0] % 10000;
    }
    return Math.floor(Math.random() * 10000);
  };
  for (let i = 0; i < 50; i += 1) {
    const pin = String(rand()).padStart(4, '0');
    if (!_EASY_PINS.has(pin)) return pin;
  }
  return '3617';
}

function PinChallengeDialog({
  open,
  onOpenChange,
  title,
  description,
  faktur,
  actionLabel,
  actionTone = 'primary', // 'primary' | 'danger'
  busy,
  onVerified,
}) {
  const [pin, setPin] = useState('');
  const [input, setInput] = useState('');
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);

  // (Re)generate PIN whenever the dialog opens; clear on close.
  useEffect(() => {
    if (open) {
      setPin(generatePin());
      setInput('');
      setShake(false);
      // focus input after the dialog animation
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setPin('');
      setInput('');
    }
  }, [open]);

  const submit = () => {
    if (busy) return;
    if (input === pin) {
      onVerified?.();
    } else {
      // Wrong: regenerate, clear input, shake, refocus.
      setPin(generatePin());
      setInput('');
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const btnClass =
    actionTone === 'danger'
      ? 'bg-rose-600 hover:bg-rose-500'
      : 'bg-emerald-600 hover:bg-emerald-500';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-sm bg-[#0a0a0b] border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" /> {title || 'Verifikasi PIN'}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {faktur && (
          <div className="text-xs bg-white/5 rounded p-2 border border-white/10">
            <div><b>{faktur.no_faktur || 'Tanpa nomor'}</b></div>
            <div className="text-muted-foreground truncate">{faktur.nama_pelanggan || '-'}</div>
            <div className="text-muted-foreground truncate">{faktur.filename}</div>
          </div>
        )}

        <motion.div
          animate={shake ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-3"
        >
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">PIN Verifikasi</div>
            <div className="font-mono text-2xl font-bold tracking-[0.35em] text-amber-300 select-none">
              {pin}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Ketik PIN</div>
            <Input
              ref={inputRef}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              className="font-mono text-center text-lg tracking-[0.35em]"
              placeholder="----"
            />
          </div>
        </motion.div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Batal
          </Button>
          <Button
            className={`${btnClass} gap-2`}
            disabled={busy || input.length !== 4}
            onClick={submit}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {actionLabel || 'Verifikasi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Status badge -----------------------------------------------------------
function StatusBadge({ status }) {
  if (status === 'sent') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 gap-1">
        <CheckCircle2 className="w-3 h-3" /> Tersimpan
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30 gap-1">
        <XCircle className="w-3 h-3" /> Gagal
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 gap-1">
      <Clock className="w-3 h-3" /> Pending
    </Badge>
  );
}

// ---- Upload dialog ----------------------------------------------------------
function UploadDialog({ open, onOpenChange, onDone }) {
  const [file, setFile] = useState(null);
  const [noKetoko, setNoKetoko] = useState('');
  const [noFaktur, setNoFaktur] = useState('');
  const [namaPelanggan, setNamaPelanggan] = useState('');
  const [tanggalFaktur, setTanggalFaktur] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [nominal, setNominal] = useState('');
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  function reset() {
    setFile(null);
    setNoKetoko('');
    setNoFaktur('');
    setNamaPelanggan('');
    setTanggalFaktur(new Date().toISOString().slice(0, 10));
    setNominal('');
    setCatatan('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function submit() {
    if (!file) {
      toast.error('Pilih file PDF terlebih dahulu');
      return;
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast.error('File harus berupa PDF');
      return;
    }
    if (!noKetoko.trim()) {
      toast.error('No. Transaksi KETOKO wajib diisi');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('no_ketoko', noKetoko.trim());
      if (noFaktur) fd.append('no_faktur', noFaktur);
      if (namaPelanggan) fd.append('nama_pelanggan', namaPelanggan);
      if (tanggalFaktur) fd.append('tanggal_faktur', tanggalFaktur);
      if (nominal) fd.append('nominal', nominal);
      if (catatan) fd.append('catatan', catatan);
      const resp = await fakturApi('', { method: 'POST', body: fd });
      if (resp?.ok) {
        toast.success('Faktur berhasil dikirim ke Telegram');
      } else {
        toast.warning(`Faktur tersimpan tapi Telegram gagal: ${resp?.telegram?.error || 'unknown'}. Bisa retry.`);
      }
      reset();
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg bg-[#0a0a0b] border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-400" /> Upload Faktur
          </DialogTitle>
          <DialogDescription>
            PDF akan dikirim ke Private Telegram Channel. MIS hanya menyimpan metadata & referensi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1 block">File PDF <span className="text-rose-400">*</span></Label>
            <Input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="cursor-pointer"
            />
            {file && (
              <div className="text-[11px] text-muted-foreground mt-1">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs mb-1 block">
              No. Transaksi KETOKO <span className="text-rose-400">*</span>
            </Label>
            <Input
              placeholder="Contoh: KTK-20260224-001"
              value={noKetoko}
              onChange={(e) => setNoKetoko(e.target.value)}
              className={!noKetoko.trim() ? 'border-rose-500/40 focus-visible:ring-rose-500/40' : ''}
              autoComplete="off"
            />
            <div className="text-[10px] text-muted-foreground mt-1">Wajib diisi. Referensi transaksi di sistem KETOKO.</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Nomor Faktur</Label>
              <Input
                placeholder="Contoh: INV-2026-001"
                value={noFaktur}
                onChange={(e) => setNoFaktur(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Tanggal</Label>
              <Input
                type="date"
                value={tanggalFaktur}
                onChange={(e) => setTanggalFaktur(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1 block">Nama Pelanggan</Label>
            <Input
              placeholder="Contoh: Apotek Sehat"
              value={namaPelanggan}
              onChange={(e) => setNamaPelanggan(e.target.value)}
            />
          </div>

          <div>
            <Label className="text-xs mb-1 block">Nominal (opsional)</Label>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="Contoh: 1500000"
              value={nominal}
              onChange={(e) => setNominal(e.target.value)}
            />
          </div>

          <div>
            <Label className="text-xs mb-1 block">Catatan (opsional)</Label>
            <Input
              placeholder="Catatan singkat"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => { reset(); onOpenChange(false); }}>
            Batal
          </Button>
          <Button disabled={busy || !file || !noKetoko.trim()} onClick={submit} className="bg-emerald-600 hover:bg-emerald-500 gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {busy ? 'Mengirim…' : 'Upload & Kirim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main component --------------------------------------------------------
export default function FakturModule({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // PIN challenge: { kind: 'open'|'delete', item }
  const [pinChallenge, setPinChallenge] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (status && status !== 'all') p.set('status', status);
      p.set('limit', '500');
      const d = await fakturApi(`?${p.toString()}`);
      setItems(d.items || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openPdf(id) {
    // Stream via backend proxy (uses same session token via ?token= for new-tab open).
    const token = localStorage.getItem('cc_token');
    const url = `/api/faktur/${id}/download?token=${encodeURIComponent(token || '')}`;
    window.open(url, '_blank');
  }

  // Called after PIN verified in the challenge dialog.
  async function handleVerifiedAction() {
    if (!pinChallenge) return;
    const { kind, item } = pinChallenge;
    if (kind === 'open') {
      setPinChallenge(null);
      openPdf(item.id);
      return;
    }
    if (kind === 'delete') {
      setBusyId(item.id);
      try {
        await fakturApi(item.id, { method: 'DELETE' });
        toast.success('Faktur dihapus');
        setPinChallenge(null);
        load();
      } catch (e) {
        toast.error(e.message);
      } finally {
        setBusyId(null);
      }
    }
  }

  async function retry(id) {
    setBusyId(id);
    try {
      const d = await fakturApi(`${id}/retry`, { method: 'POST' });
      if (d?.ok) {
        toast.success('Berhasil dikirim ulang ke Telegram');
      } else {
        toast.error(`Masih gagal: ${d?.telegram?.error || 'unknown'}`);
      }
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const stats = useMemo(() => {
    const sent = items.filter((i) => i.telegram_status === 'sent').length;
    const failed = items.filter((i) => i.telegram_status === 'failed').length;
    const pending = items.filter((i) => i.telegram_status === 'pending').length;
    return { total: items.length, sent, failed, pending };
  }, [items]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-xl font-bold">MIS Faktur</div>
            <div className="text-xs text-muted-foreground">
              Arsip PDF faktur pelanggan · disimpan otomatis di Telegram
            </div>
          </div>
        </div>
        <Button
          onClick={() => setUploadOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-500 gap-2"
        >
          <Upload className="w-4 h-4" /> Upload Faktur
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatMini label="Total" value={stats.total} tone="default" icon={FileText} />
        <StatMini label="Tersimpan" value={stats.sent} tone="green" icon={CheckCircle2} />
        <StatMini label="Gagal" value={stats.failed} tone="red" icon={XCircle} />
        <StatMini label="Pending" value={stats.pending} tone="orange" icon={Clock} />
      </div>

      {/* Filters */}
      <Card className="bg-[#0a0a0b] border-white/10">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[220px] relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari No. KETOKO / nomor faktur / pelanggan / nama file…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
                className="pl-9"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="sent">Tersimpan</SelectItem>
                <SelectItem value="failed">Gagal</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" onClick={load} className="gap-2">
              <RefreshCw className="w-4 h-4" /> Cari
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <Card className="bg-[#0a0a0b] border-white/10">
        <CardHeader>
          <CardTitle className="text-sm">Daftar Faktur</CardTitle>
          <CardDescription>Diurutkan dari yang terbaru</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Belum ada faktur. Klik <b>Upload Faktur</b> untuk mulai.
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {items.map((it) => (
                  <motion.div
                    key={it.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex flex-col md:flex-row md:items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold truncate">
                          {it.no_faktur || <span className="text-muted-foreground italic">Tanpa nomor</span>}
                        </div>
                        <StatusBadge status={it.telegram_status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {it.no_ketoko && (
                          <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                            KETOKO: {it.no_ketoko}
                          </span>
                        )}
                        {it.nama_pelanggan && (
                          <span className="inline-flex items-center gap-1"><UserCircle2 className="w-3 h-3" />{it.nama_pelanggan}</span>
                        )}
                        {it.tanggal_faktur && (
                          <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{it.tanggal_faktur}</span>
                        )}
                        {it.nominal != null && (
                          <span>Rp {Number(it.nominal).toLocaleString('id-ID')}</span>
                        )}
                        <span className="truncate">{it.filename}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                        oleh {it.uploaded_by_name || '-'} · {new Date(it.uploaded_at).toLocaleString('id-ID')}
                        {it.telegram_status === 'failed' && it.telegram_error && (
                          <span className="ml-2 text-rose-400">· {it.telegram_error}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1"
                        onClick={() => setPinChallenge({ kind: 'open', item: it })}
                        disabled={it.telegram_status !== 'sent' && !it.has_local_file}
                      >
                        <Download className="w-3.5 h-3.5" /> Buka
                      </Button>
                      {it.telegram_status !== 'sent' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                          onClick={() => retry(it.id)}
                          disabled={busyId === it.id || !it.has_local_file}
                          title={!it.has_local_file ? 'Buffer lokal sudah tidak ada' : ''}
                        >
                          {busyId === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          Retry
                        </Button>
                      )}
                      {(user?.role === 'owner' || user?.id === it.uploaded_by_id) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => setPinChallenge({ kind: 'delete', item: it })}
                          disabled={busyId === it.id}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onDone={load} />

      {/* Dynamic 4-digit PIN verification — same pattern as OMS KETOKO / Buka PDF.
          Reused for both "Buka" and "Hapus" so every sensitive action requires
          the operator to re-type an on-screen challenge. */}
      <PinChallengeDialog
        open={!!pinChallenge}
        onOpenChange={(v) => { if (!v) setPinChallenge(null); }}
        title={pinChallenge?.kind === 'delete' ? 'Verifikasi PIN — Hapus Faktur' : 'Verifikasi PIN — Buka Faktur'}
        description={
          pinChallenge?.kind === 'delete'
            ? 'Metadata akan dihapus dari MIS. File di Telegram tetap ada. Ketik ulang PIN untuk konfirmasi.'
            : 'Ketik ulang PIN di layar untuk membuka PDF faktur.'
        }
        faktur={pinChallenge?.item}
        actionLabel={pinChallenge?.kind === 'delete' ? 'Hapus' : 'Buka PDF'}
        actionTone={pinChallenge?.kind === 'delete' ? 'danger' : 'primary'}
        busy={busyId === pinChallenge?.item?.id}
        onVerified={handleVerifiedAction}
      />
    </div>
  );
}

// ---- Small stat card (local to this module) --------------------------------
function StatMini({ icon: Icon, label, value, tone = 'default' }) {
  const tones = {
    default: 'from-white/5 to-white/[0.02] border-white/10 text-white',
    green: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30 text-emerald-300',
    red: 'from-rose-500/20 to-rose-500/5 border-rose-500/30 text-rose-300',
    orange: 'from-amber-500/20 to-amber-500/5 border-amber-500/30 text-amber-300',
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${tones[tone]} p-4`}>
      <div className="flex items-center gap-2 text-xs opacity-80">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
