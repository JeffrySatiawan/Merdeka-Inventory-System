'use client';

// ============================================================
// Payroll Module — OWNER ONLY (defense-in-depth di 3 layer:
//   1. Router `/api/payroll/*` menolak non-owner (403).
//   2. `userModules()` di page.js drop ownerOnly modules dari staff.
//   3. Komponen ini juga assert `user.role === 'owner'` sebagai fallback.
// Sumber data BACA-SAJA: Absensi, Reward Poin, Data Staff.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Save, Wallet, Users, Settings as SettingsIcon, ShieldAlert, Lock, FileText, CheckCircle2, Printer } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const fmtIDR = (n) => 'Rp ' + (Math.round(Number(n || 0))).toLocaleString('id-ID');

// ============================================================
// RupiahInput — text input dengan format pemisah ribuan id-ID.
// - Tampilan berformat: 10.000.000, -1.428.571.
// - Nilai internal (via onChange) tetap `number` sehingga logic perhitungan
//   Payroll tidak berubah.
// - Aman untuk angka negatif (leading `-`).
// - Sinkron dengan parent saat value berubah dari luar (mis. default dari
//   perubahan globals) — via useEffect.
// ============================================================
function formatRupiahDisplay(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '';
  return Number(n).toLocaleString('id-ID');
}
function parseRupiahInput(raw) {
  const s = String(raw || '');
  // Deteksi minus di depan; sisanya ambil digit saja.
  const isNeg = s.trim().startsWith('-');
  const digits = s.replace(/\D+/g, '');
  if (digits === '') return isNeg ? 0 : 0;
  const num = Number(digits);
  return isNeg ? -num : num;
}
function RupiahInput({ value, onChange, disabled, className = '', placeholder, ...rest }) {
  const [display, setDisplay] = React.useState(formatRupiahDisplay(value));
  React.useEffect(() => {
    // Sync ketika parent men-set nilai baru (mis. default berubah karena
    // globals di-edit). Hanya update display kalau angka underlying berbeda
    // dari yg sedang diketik, biar cursor tidak melompat waktu user ketik.
    const current = parseRupiahInput(display);
    if (Number(value || 0) !== current) {
      setDisplay(formatRupiahDisplay(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      type="text"
      inputMode="numeric"
      value={display}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        const raw = e.target.value;
        // Izinkan state "-" atau "" sebagai intermediate typing supaya user
        // dapat mengetik angka negatif secara natural (ketik `-` dulu).
        if (raw === '' || raw === '-') {
          setDisplay(raw);
          onChange?.(0);
          return;
        }
        const num = parseRupiahInput(raw);
        setDisplay(formatRupiahDisplay(num));
        onChange?.(num);
      }}
      {...rest}
    />
  );
}

async function api(path, opts = {}) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null;
  const r = await fetch(`${base}/api/payroll/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || `HTTP ${r.status}`);
    e.status = r.status;
    e.data = j;
    throw e;
  }
  return j;
}

const KOMPONEN_LABELS = {
  gaji_jam_kerja: 'Gaji Jam Kerja',
  komisi_penjualan: 'Komisi Penjualan',
  komisi_produk_fokus: 'Komisi Produk Fokus',
  komisi_kebersihan: 'Komisi Kebersihan',
  apresiasi_so: 'Apresiasi Stock Opname',
  tunjangan_kinerja: 'Tunjangan Kinerja',
  reward_poin: 'Reward Poin',
  bpjs_tk: 'BPJS Ketenagakerjaan',
  bpjs_kes: 'BPJS Kesehatan',
};
const KOMPONEN_ORDER = Object.keys(KOMPONEN_LABELS);

function nowCycleKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollModule({ user, initialView = 'pay:period' }) {
  // Extra client-side guard supaya bila staff berhasil menembus sampai ke sini
  // (mustahil dgn 2 lapisan sebelumnya), tetap ditolak visually.
  if (!user || user.role !== 'owner') {
    return (
      <div className="p-6 text-center text-rose-300 text-sm flex flex-col items-center gap-2">
        <ShieldAlert className="w-8 h-8" />
        Akses ditolak — Payroll hanya untuk Owner.
      </div>
    );
  }
  const tab = initialView === 'pay:employees'
    ? 'employees'
    : initialView === 'pay:config'
      ? 'config'
      : 'period';

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-emerald-300" />
        <h1 className="text-lg md:text-xl font-bold">Payroll</h1>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground ml-2">Private · Owner</div>
      </div>
      <Tabs value={tab} className="w-full">
        <TabsList className="grid grid-cols-3 max-w-xl">
          <TabsTrigger value="period">Payroll Periode</TabsTrigger>
          <TabsTrigger value="employees">Data Karyawan</TabsTrigger>
          <TabsTrigger value="config">Pengaturan</TabsTrigger>
        </TabsList>
        <TabsContent value="period"><PeriodView /></TabsContent>
        <TabsContent value="employees"><EmployeesTab /></TabsContent>
        <TabsContent value="config"><ConfigTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Tab 1 — Payroll Periode
// ============================================================
function PeriodView() {
  const [cycles, setCycles] = useState([]);
  const [cycle, setCycle] = useState(nowCycleKey());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null); // { from, to, config, period, employees, breakdown }
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [kitirFor, setKitirFor] = useState(null); // row object

  async function loadCycles() {
    try {
      const d = await api('cycles');
      setCycles(d.cycles || []);
    } catch (e) { toast.error(e.message); }
  }
  async function load(ck = cycle) {
    if (!ck) return;
    setLoading(true);
    try {
      const d = await api(`period?cycle=${encodeURIComponent(ck)}`);
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadCycles(); }, []);
  useEffect(() => { load(cycle); /* eslint-disable-next-line */ }, [cycle]);

  const isFinal = data?.period?.status === 'final';

  // Local editable state.
  const [globals, setGlobals] = useState({});
  const [products, setProducts] = useState([]);
  const [perUser, setPerUser] = useState({});
  useEffect(() => {
    if (!data) return;
    setGlobals(data.period?.globals || {});
    setProducts(Array.isArray(data.period?.products) ? [...data.period.products] : []);
    const src = data.period?.per_user || {};
    const pu = {};
    for (const [uid, v] of Object.entries(src)) {
      pu[uid] = {
        komisi_kebersihan: Number(v?.komisi_kebersihan || 0),
        finals: (v?.finals && typeof v.finals === 'object') ? { ...v.finals } : {},
      };
    }
    setPerUser(pu);
  }, [data]);

  async function save() {
    if (isFinal) { toast.error('Payroll sudah FINAL — tidak dapat diubah'); return; }
    setSaving(true);
    try {
      const d = await api(`period`, {
        method: 'PUT',
        body: JSON.stringify({ cycle, globals, products, per_user: perUser }),
      });
      setData(d);
      toast.success('Payroll periode disimpan (DRAFT)');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function finalize() {
    setFinalizing(true);
    try {
      const d = await api('period/finalize', {
        method: 'POST',
        body: JSON.stringify({ cycle }),
      });
      setData(d);
      setConfirmFinal(false);
      toast.success('Payroll periode ini telah difinalisasi (FINAL, terkunci)');
    } catch (e) { toast.error(e.message); }
    finally { setFinalizing(false); }
  }

  if (loading || !data) return <div className="py-12 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;

  const employees = data.employees || [];
  const breakdown = data.breakdown?.items || [];

  // Untuk baris FINAL: tampilkan angka snapshot apa adanya (dari
  // data.breakdown, tidak ada override lokal). Untuk DRAFT: pakai finals
  // + defaults lokal spy responsive terhadap perubahan globals.
  const N = Math.max(1, employees.length);
  const productTotal = products.reduce((s, p) => s + Number(p.nilai || 0), 0);
  const localDefaults = {
    komisi_penjualan: Number(globals.komisi_penjualan || 0) / N,
    komisi_produk_fokus: productTotal / N,
    apresiasi_so: Number(globals.apresiasi_so || 0) / N,
    tunjangan_kinerja: Number(globals.tunjangan_kinerja || 0) / N,
    bpjs_tk: Number(globals.bpjs_tk || 0) / N,
    bpjs_kes: Number(globals.bpjs_kes || 0) / N,
  };
  const finalOf = (uid, k, snapshotVal) => {
    if (isFinal) return snapshotVal;
    const f = perUser[uid]?.finals || {};
    return f[k] != null ? Number(f[k]) : (localDefaults[k] || 0);
  };
  const isOverride = (uid, k) => !isFinal && (perUser[uid]?.finals || {})[k] != null;

  const rowTotal = (row) => {
    if (isFinal) return Number(row.total || 0);
    const uid = row.user_id;
    const kebersihan = perUser[uid]?.komisi_kebersihan != null
      ? Number(perUser[uid].komisi_kebersihan)
      : Number(row.komponen.komisi_kebersihan || 0);
    return (
      Number(row.komponen.gaji_jam_kerja || 0) +
      finalOf(uid, 'komisi_penjualan', row.komponen.komisi_penjualan) +
      finalOf(uid, 'komisi_produk_fokus', row.komponen.komisi_produk_fokus) +
      kebersihan +
      finalOf(uid, 'apresiasi_so', row.komponen.apresiasi_so) +
      finalOf(uid, 'tunjangan_kinerja', row.komponen.tunjangan_kinerja) +
      Number(row.komponen.reward_poin || 0) +
      finalOf(uid, 'bpjs_tk', row.komponen.bpjs_tk) +
      finalOf(uid, 'bpjs_kes', row.komponen.bpjs_kes)
    );
  };
  const grand = breakdown.reduce((s, r) => s + rowTotal(r), 0);

  const dateLabel = data.from && data.to
    ? `${new Date(data.from).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} → ${new Date(data.to).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1 min-w-[240px]">
          <Label className="text-xs">Periode Payroll (25 bulan sebelum → 26 bulan berjalan)</Label>
          <Select value={cycle} onValueChange={setCycle}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {cycles.map((c) => (
                <SelectItem key={c.cycle_key} value={c.cycle_key}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isFinal ? (
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs">
            <Lock className="w-3.5 h-3.5" />
            <span>FINAL — Terkunci</span>
            {data?.period?.finalized_at && <span className="text-emerald-300/70">· {new Date(data.period.finalized_at).toLocaleString('id-ID')}</span>}
          </div>
        ) : (
          <>
            <Button onClick={save} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Simpan (Draft)
            </Button>
            <Button onClick={() => setConfirmFinal(true)} variant="outline" className="gap-1 border-amber-500/40 text-amber-200">
              <CheckCircle2 className="w-4 h-4" /> Finalisasi Payroll
            </Button>
          </>
        )}
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Total Payroll · {dateLabel}
          </div>
          <div className="font-bold text-lg tabular-nums">{fmtIDR(grand)}</div>
        </div>
      </div>

      {/* Komponen global — dikunci saat FINAL */}
      <Card className={isFinal ? 'opacity-90' : ''}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Komponen Global (dibagi rata ke {employees.length || 0} karyawan)
            {isFinal && <Lock className="w-3.5 h-3.5 text-emerald-300" />}
          </CardTitle>
          <CardDescription>
            {isFinal
              ? 'Payroll FINAL: nilai yang ditampilkan adalah SNAPSHOT terkunci dari periode ini.'
              : 'Nilai global otomatis menjadi default per karyawan. Ubah per-baris di tabel bawah untuk override.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['komisi_penjualan', 'Komisi Penjualan'],
              ['apresiasi_so', 'Apresiasi Stock Opname'],
              ['tunjangan_kinerja', 'Tunjangan Kinerja'],
              ['bpjs_tk', 'BPJS Ketenagakerjaan'],
              ['bpjs_kes', 'BPJS Kesehatan'],
            ].map(([k, label]) => (
              <div key={k} className="space-y-1">
                <Label className="text-xs">{label} (Rp, total periode)</Label>
                <RupiahInput
                  value={globals[k] ?? 0}
                  onChange={(v) => setGlobals((g) => ({ ...g, [k]: v }))}
                  disabled={isFinal}
                />
                <div className="text-[10px] text-muted-foreground">
                  ≈ {fmtIDR(localDefaults[k] || 0)} / karyawan
                </div>
              </div>
            ))}
          </div>
          {/* Komisi Produk Fokus */}
          <div className="pt-2 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-semibold">Komisi Produk Fokus</div>
                <div className="text-[11px] text-muted-foreground">
                  Total {fmtIDR(productTotal)} · default ≈ {fmtIDR(localDefaults.komisi_produk_fokus || 0)}/karyawan
                </div>
              </div>
              {!isFinal && (
                <Button
                  type="button" size="sm" variant="outline" className="gap-1"
                  onClick={() => setProducts((p) => [...p, { nama: '', nilai: 0 }])}
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah Produk
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {products.length === 0 && <div className="text-xs text-muted-foreground italic">Belum ada produk fokus.</div>}
              {products.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr,140px,40px] gap-2 items-center">
                  <Input placeholder="Nama produk" value={p.nama} disabled={isFinal}
                    onChange={(e) => setProducts((arr) => { const c=[...arr]; c[i]={...c[i],nama:e.target.value}; return c;})} />
                  <RupiahInput value={p.nilai} disabled={isFinal} placeholder="Nilai (Rp)"
                    onChange={(v) => setProducts((arr) => { const c=[...arr]; c[i]={...c[i],nilai:v}; return c;})} />
                  {!isFinal && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setProducts((arr) => arr.filter((_, j) => j !== i))} className="text-rose-400">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabel breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Breakdown per Karyawan
            {isFinal && <Lock className="w-3.5 h-3.5 text-emerald-300" />}
          </CardTitle>
          <CardDescription>
            {isFinal
              ? 'FINAL: nilai di bawah adalah snapshot terkunci. Perubahan Absensi/SO/Poin setelah finalisasi TIDAK mempengaruhi angka ini.'
              : 'Semua nilai di sel adalah nilai final yang akan diterima karyawan. Ubah langsung angkanya. Klik "Kitir" untuk generate PDF slip gaji.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {employees.length === 0 && <div className="py-8 text-center text-xs text-muted-foreground">Belum ada data karyawan.</div>}
          {employees.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-[10px] [&>th]:text-muted-foreground">
                  <th className="min-w-[130px] sticky left-0 bg-background z-10">Nama</th>
                  <th>Jabatan</th>
                  <th title="Jam Kerja + Jam SO + Jam Lembur (approved)">Jam Diakui Payroll</th>
                  <th>Sisa Poin</th>
                  {KOMPONEN_ORDER.map((k) => (
                    <th key={k} className="text-right">{KOMPONEN_LABELS[k]}</th>
                  ))}
                  <th className="text-right">TOTAL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => {
                  const uid = row.user_id;
                  const kebersihan = isFinal
                    ? Number(row.komponen.komisi_kebersihan || 0)
                    : (perUser[uid]?.komisi_kebersihan != null ? perUser[uid].komisi_kebersihan : Number(row.komponen.komisi_kebersihan || 0));
                  return (
                    <tr key={uid} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2 align-middle">
                      <td className="sticky left-0 bg-background z-10 font-medium">{row.name}</td>
                      <td className="text-muted-foreground">{row.jabatan || '-'}</td>
                      <td className="tabular-nums" title={`Kerja ${row.jam_kerja_diakui_hours ?? 0} + SO ${row.jam_so_hours ?? 0} + Lembur ${row.jam_lembur_hours ?? 0}`}>
                        {row.jam_diakui_payroll_hours ?? row.jam_kerja_diakui_hours ?? 0} jam
                      </td>
                      <td className="tabular-nums">{row.sisa_poin ?? row.poin_periode ?? 0}</td>
                      <td className="text-right tabular-nums text-muted-foreground">{fmtIDR(row.komponen.gaji_jam_kerja)}</td>
                      <FinalCell value={finalOf(uid, 'komisi_penjualan', row.komponen.komisi_penjualan)} override={isOverride(uid, 'komisi_penjualan')}
                        disabled={isFinal}
                        onChange={(v) => setFinal(setPerUser, uid, 'komisi_penjualan', v)}
                        onReset={() => setFinal(setPerUser, uid, 'komisi_penjualan', null)} />
                      <FinalCell value={finalOf(uid, 'komisi_produk_fokus', row.komponen.komisi_produk_fokus)} override={isOverride(uid, 'komisi_produk_fokus')}
                        disabled={isFinal}
                        onChange={(v) => setFinal(setPerUser, uid, 'komisi_produk_fokus', v)}
                        onReset={() => setFinal(setPerUser, uid, 'komisi_produk_fokus', null)} />
                      <td className="text-right tabular-nums">
                        <RupiahInput
                          value={Math.round(Number(kebersihan || 0))}
                          disabled={isFinal}
                          onChange={(v) => setKebersihan(setPerUser, uid, v)}
                          className="h-7 text-xs text-right"
                        />
                      </td>
                      <FinalCell value={finalOf(uid, 'apresiasi_so', row.komponen.apresiasi_so)} override={isOverride(uid, 'apresiasi_so')}
                        disabled={isFinal}
                        onChange={(v) => setFinal(setPerUser, uid, 'apresiasi_so', v)}
                        onReset={() => setFinal(setPerUser, uid, 'apresiasi_so', null)} />
                      <FinalCell value={finalOf(uid, 'tunjangan_kinerja', row.komponen.tunjangan_kinerja)} override={isOverride(uid, 'tunjangan_kinerja')}
                        disabled={isFinal}
                        onChange={(v) => setFinal(setPerUser, uid, 'tunjangan_kinerja', v)}
                        onReset={() => setFinal(setPerUser, uid, 'tunjangan_kinerja', null)} />
                      <td className="text-right tabular-nums text-muted-foreground">{fmtIDR(row.komponen.reward_poin)}</td>
                      <FinalCell value={finalOf(uid, 'bpjs_tk', row.komponen.bpjs_tk)} override={isOverride(uid, 'bpjs_tk')}
                        disabled={isFinal}
                        onChange={(v) => setFinal(setPerUser, uid, 'bpjs_tk', v)}
                        onReset={() => setFinal(setPerUser, uid, 'bpjs_tk', null)} />
                      <FinalCell value={finalOf(uid, 'bpjs_kes', row.komponen.bpjs_kes)} override={isOverride(uid, 'bpjs_kes')}
                        disabled={isFinal}
                        onChange={(v) => setFinal(setPerUser, uid, 'bpjs_kes', v)}
                        onReset={() => setFinal(setPerUser, uid, 'bpjs_kes', null)} />
                      <td className="text-right font-bold tabular-nums">{fmtIDR(rowTotal(row))}</td>
                      <td className="text-right whitespace-nowrap">
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-[10px]"
                          onClick={() => setKitirFor({ row, kebersihan })}>
                          <Printer className="w-3 h-3" /> Kitir
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Konfirmasi Finalisasi */}
      <Dialog open={confirmFinal} onOpenChange={(o) => !o && setConfirmFinal(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Finalisasi Payroll</DialogTitle>
            <DialogDescription>
              Setelah difinalisasi, seluruh nilai Payroll periode <b>{data.from} → {data.to}</b> akan
              disimpan sebagai <b>SNAPSHOT</b> dan <b>TERKUNCI</b>. Perubahan Absensi/SO/Lembur/Reward
              Poin setelahnya tidak akan mengubah Payroll ini. Aksi ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmFinal(false)} disabled={finalizing}>Batal</Button>
            <Button onClick={finalize} disabled={finalizing} className="bg-emerald-600 hover:bg-emerald-500 gap-1">
              {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Ya, Finalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview & Cetak Kitir */}
      {kitirFor && (
        <KitirDialog
          open={!!kitirFor}
          row={kitirFor.row}
          kebersihanOverride={kitirFor.kebersihan}
          rowTotal={rowTotal(kitirFor.row)}
          finalOf={finalOf}
          isFinal={isFinal}
          periodLabel={dateLabel}
          periodFrom={data.from}
          periodTo={data.to}
          onClose={() => setKitirFor(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Kitir Gaji Dialog + PDF generator (jsPDF).
// PDF di-render dari data yang sudah tampil di UI (drafts atau snapshot final).
// PENTING: generate PDF TIDAK memodifikasi state atau memanggil API tulis
// apapun, sehingga tidak akan mengubah data Payroll.
// ============================================================
function KitirDialog({ open, row, kebersihanOverride, rowTotal, finalOf, isFinal, periodLabel, periodFrom, periodTo, onClose }) {
  const rows = [
    // "Gaji Jam Kerja" → "Gaji". Perhitungan internal tidak berubah.
    ['Gaji', row.komponen.gaji_jam_kerja],
    ['Komisi Penjualan', finalOf(row.user_id, 'komisi_penjualan', row.komponen.komisi_penjualan)],
    ['Komisi Produk Fokus', finalOf(row.user_id, 'komisi_produk_fokus', row.komponen.komisi_produk_fokus)],
    ['Komisi Kebersihan', kebersihanOverride],
    ['Apresiasi Stock Opname', finalOf(row.user_id, 'apresiasi_so', row.komponen.apresiasi_so)],
    ['Tunjangan Kinerja', finalOf(row.user_id, 'tunjangan_kinerja', row.komponen.tunjangan_kinerja)],
    ['Reward Poin', row.komponen.reward_poin],
    ['BPJS Ketenagakerjaan', finalOf(row.user_id, 'bpjs_tk', row.komponen.bpjs_tk)],
    ['BPJS Kesehatan', finalOf(row.user_id, 'bpjs_kes', row.komponen.bpjs_kes)],
  ];
  // Format tanggal PLAIN ASCII utk jsPDF (default helvetica tidak render
  // baik unicode "→" & bisa memunculkan `!` / non-breaking space aneh).
  // Contoh: "25 Agustus 2026 - 26 September 2026".
  function fmtDatePlain(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '-';
    const [y, m, d] = iso.split('-').map((n) => Number(n));
    const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  const periodPlain = periodFrom && periodTo ? `${fmtDatePlain(periodFrom)} - ${fmtDatePlain(periodTo)}` : '-';

  function print() {
    const doc = new jsPDF({ unit: 'mm', format: 'a5' });
    const pageW = doc.internal.pageSize.getWidth();
    const marginX = 12;
    let y = 14;

    // Title.
    doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text('KITIR GAJI', marginX, y); y += 6;
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    doc.text('Merdeka Inventory System', marginX, y); y += 6;
    doc.setDrawColor(180); doc.line(marginX, pageW ? y : y, pageW - marginX, y); y += 6;

    // Header info — kolom rapi & titik dua sejajar.
    doc.setFontSize(10);
    const labelX = marginX;
    const colonX = marginX + 22; // posisi tanda ":" konsisten
    const valueX = marginX + 26; // posisi awal nilai
    const line = (label, value) => {
      doc.setFont(undefined, 'normal');
      doc.text(label, labelX, y);
      doc.text(':', colonX, y);
      doc.setFont(undefined, 'bold');
      doc.text(String(value ?? '-'), valueX, y);
      y += 6;
    };
    line('Nama', row.name || '-');
    line('Jabatan', (row.jabatan && row.jabatan.trim()) ? row.jabatan : '-');
    line('Periode', periodPlain);
    line('Status', isFinal ? 'FINAL' : 'DRAFT');

    doc.setFont(undefined, 'normal');
    autoTable(doc, {
      startY: y + 2,
      head: [['Komponen', 'Nominal (Rp)']],
      body: rows.map(([k, v]) => [k, Math.round(Number(v || 0)).toLocaleString('id-ID')]),
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255 },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: marginX, right: marginX },
      foot: [['TOTAL PAYROLL', Math.round(Number(rowTotal || 0)).toLocaleString('id-ID')]],
      footStyles: { fillColor: [230, 230, 230], textColor: 0, fontStyle: 'bold', halign: 'right' },
    });
    const safeName = (row.name || 'staff').replace(/\s+/g, '_');
    const safeDate = (periodTo || '').replace(/-/g, '');
    doc.save(`Kitir_${safeName}_${safeDate}.pdf`);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="w-4 h-4" /> Kitir Gaji · {row.name}</DialogTitle>
          <DialogDescription>{periodLabel} · Status: <b>{isFinal ? 'FINAL' : 'DRAFT'}</b></DialogDescription>
        </DialogHeader>
        <div className="text-xs space-y-1">
          <div className="grid grid-cols-2 gap-1">
            <div className="text-muted-foreground">Nama</div><div className="font-medium">{row.name}</div>
            <div className="text-muted-foreground">Jabatan</div><div className="font-medium">{row.jabatan || '-'}</div>
          </div>
          <div className="border-t border-white/10 mt-2 pt-2 space-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span className="tabular-nums">{fmtIDR(v)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 mt-2 pt-2 flex justify-between font-bold">
            <span>TOTAL PAYROLL</span><span className="tabular-nums">{fmtIDR(rowTotal)}</span>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          <Button onClick={print} className="gap-1"><Printer className="w-4 h-4" /> Cetak PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function setFinal(setPerUser, uid, key, value) {
  setPerUser((pu) => {
    const cur = pu[uid] || {};
    const finals = { ...(cur.finals || {}) };
    if (value == null) delete finals[key];
    else finals[key] = value;
    return { ...pu, [uid]: { ...cur, finals } };
  });
}
function setKebersihan(setPerUser, uid, value) {
  setPerUser((pu) => {
    const cur = pu[uid] || {};
    return { ...pu, [uid]: { ...cur, komisi_kebersihan: value } };
  });
}

function FinalCell({ value, override, disabled, onChange, onReset }) {
  return (
    <td className="text-right tabular-nums">
      <div className="flex items-center gap-1 justify-end">
        {override && !disabled && (
          <button
            type="button"
            onClick={onReset}
            title="Kembalikan ke default global"
            className="text-[9px] text-amber-400 hover:text-amber-300 uppercase tracking-wider"
          >
            reset
          </button>
        )}
        <RupiahInput
          value={Math.round(Number(value || 0))}
          disabled={disabled}
          onChange={(v) => onChange(v)}
          className={`h-7 text-xs text-right w-[130px] ${override && !disabled ? 'border-amber-500/50 bg-amber-500/5' : ''}`}
        />
        {override && !disabled && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />}
      </div>
    </td>
  );
}

// ============================================================
// Tab 2 — Data Karyawan (jabatan + tarif_per_jam)
// ============================================================
function EmployeesTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({}); // { user_id: { jabatan, tarif_per_jam } }
  const [savingId, setSavingId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api('employees');
      setItems(d.items || []);
      setDrafts({});
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveRow(uid) {
    const d = drafts[uid];
    if (!d) return;
    setSavingId(uid);
    try {
      const res = await api(`employees/${encodeURIComponent(uid)}`, {
        method: 'PUT',
        body: JSON.stringify(d),
      });
      setItems(res.items || []);
      setDrafts((p) => { const c = { ...p }; delete c[uid]; return c; });
      toast.success('Tersimpan');
    } catch (e) { toast.error(e.message); }
    finally { setSavingId(null); }
  }

  if (loading) return <div className="py-12 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Data Karyawan Payroll</CardTitle>
        <CardDescription>Jabatan & Tarif Per Jam khusus untuk perhitungan Payroll. Tidak mengubah User Management.</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:text-muted-foreground">
              <th>Nama Karyawan</th>
              <th className="w-[220px]">Jabatan</th>
              <th className="w-[220px]">Tarif Per Jam (Rp)</th>
              <th className="w-[100px]"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const d = drafts[e.user_id];
              const dirty = !!d;
              const jab = d?.jabatan ?? e.jabatan;
              const tarif = d?.tarif_per_jam ?? e.tarif_per_jam;
              return (
                <tr key={e.user_id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2">
                  <td className="font-medium">{e.name}</td>
                  <td>
                    <Input
                      value={jab}
                      onChange={(v) => setDrafts((p) => ({ ...p, [e.user_id]: { ...(p[e.user_id] || { jabatan: e.jabatan, tarif_per_jam: e.tarif_per_jam }), jabatan: v.target.value } }))}
                      placeholder="mis. Apoteker"
                      className="h-8 text-xs"
                    />
                  </td>
                  <td>
                    <RupiahInput
                      value={tarif}
                      onChange={(v) => setDrafts((p) => ({ ...p, [e.user_id]: { ...(p[e.user_id] || { jabatan: e.jabatan, tarif_per_jam: e.tarif_per_jam }), tarif_per_jam: v } }))}
                      placeholder="0"
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant={dirty ? 'default' : 'ghost'}
                      disabled={!dirty || savingId === e.user_id}
                      onClick={() => saveRow(e.user_id)}
                      className="h-8 gap-1"
                    >
                      {savingId === e.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Simpan
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Tab 3 — Pengaturan (poin rupiah/point)
// ============================================================
function ConfigTab() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [poin, setPoin] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const d = await api('config');
        setConfig(d.config);
        setPoin(Number(d.config?.poin_rupiah_per_point || 0));
      } catch (e) { toast.error(e.message); }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const d = await api('config', { method: 'PUT', body: JSON.stringify({ poin_rupiah_per_point: poin }) });
      setConfig(d.config);
      toast.success('Pengaturan disimpan');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (!config) return <div className="py-12 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><SettingsIcon className="w-4 h-4" /> Pengaturan Payroll</CardTitle>
        <CardDescription>Nilai Rupiah per satu poin Reward. Digunakan untuk menghitung kolom &quot;Reward Poin&quot; di Payroll Periode.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 max-w-md">
        <div className="space-y-1">
          <Label className="text-xs">Nilai Rupiah per 1 Poin</Label>
          <RupiahInput
            value={poin}
            onChange={(v) => setPoin(v)}
            placeholder="mis. 5.000"
          />
          <div className="text-[10px] text-muted-foreground">1 poin = {fmtIDR(poin)}</div>
        </div>
        <Button onClick={save} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Simpan Pengaturan
        </Button>
      </CardContent>
    </Card>
  );
}
