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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Save, Wallet, Users, Settings as SettingsIcon, ShieldAlert } from 'lucide-react';

const fmtIDR = (n) => 'Rp ' + (Math.round(Number(n || 0))).toLocaleString('id-ID');

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

function nowPeriod() {
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
  const [period, setPeriod] = useState(nowPeriod());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null); // { config, period, employees, breakdown }

  async function load(pk = period) {
    setLoading(true);
    try {
      const d = await api(`period?period=${encodeURIComponent(pk)}`);
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(period); /* eslint-disable-next-line */ }, [period]);

  // Local editable state (mirroring server for save).
  const [globals, setGlobals] = useState({});
  const [products, setProducts] = useState([]);
  const [perUser, setPerUser] = useState({}); // { user_id: { komisi_kebersihan, adjustments } }
  useEffect(() => {
    if (!data) return;
    setGlobals(data.period?.globals || {});
    setProducts(Array.isArray(data.period?.products) ? [...data.period.products] : []);
    setPerUser({ ...(data.period?.per_user || {}) });
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      const d = await api(`period/${encodeURIComponent(period)}`, {
        method: 'PUT',
        body: JSON.stringify({ globals, products, per_user: perUser }),
      });
      setData(d);
      toast.success('Payroll periode disimpan');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading || !data) return <div className="py-12 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;

  const employees = data.employees || [];
  const breakdown = data.breakdown?.items || [];
  const perHead = data.breakdown?.per_head || {};

  const gTotal =
    Number(globals.komisi_penjualan || 0) +
    products.reduce((s, p) => s + Number(p.nilai || 0), 0) +
    Number(globals.apresiasi_so || 0) +
    Number(globals.tunjangan_kinerja || 0) +
    Number(globals.bpjs_tk || 0) +
    Number(globals.bpjs_kes || 0);
  const grand = breakdown.reduce((s, x) => s + Number(x.total || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Periode</Label>
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 max-w-[180px]"
          />
        </div>
        <Button onClick={save} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Simpan Payroll Periode
        </Button>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Payroll</div>
          <div className="font-bold text-lg tabular-nums">{fmtIDR(grand)}</div>
        </div>
      </div>

      {/* Komponen global */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Komponen Global (dibagi rata ke {employees.length || 0} karyawan)</CardTitle>
          <CardDescription>Angka negatif otomatis mengurangi total. Adjustment per karyawan di tabel bawah.</CardDescription>
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
                <Input
                  type="number"
                  value={globals[k] ?? 0}
                  onChange={(e) => setGlobals((g) => ({ ...g, [k]: Number(e.target.value) || 0 }))}
                />
                <div className="text-[10px] text-muted-foreground">
                  ≈ {fmtIDR((Number(globals[k] || 0)) / Math.max(1, employees.length))} / karyawan
                </div>
              </div>
            ))}
          </div>
          {/* Komisi Produk Fokus */}
          <div className="pt-2 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-semibold">Komisi Produk Fokus</div>
                <div className="text-[11px] text-muted-foreground">Total semua produk dibagi rata ke {employees.length || 0} karyawan.</div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setProducts((p) => [...p, { nama: '', nilai: 0 }])}
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Produk
              </Button>
            </div>
            <div className="space-y-2">
              {products.length === 0 && <div className="text-xs text-muted-foreground italic">Belum ada produk fokus.</div>}
              {products.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr,140px,40px] gap-2 items-center">
                  <Input
                    placeholder="Nama produk"
                    value={p.nama}
                    onChange={(e) => setProducts((arr) => { const c = [...arr]; c[i] = { ...c[i], nama: e.target.value }; return c; })}
                  />
                  <Input
                    type="number"
                    placeholder="Nilai komisi (Rp)"
                    value={p.nilai}
                    onChange={(e) => setProducts((arr) => { const c = [...arr]; c[i] = { ...c[i], nilai: Number(e.target.value) || 0 }; return c; })}
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setProducts((arr) => arr.filter((_, j) => j !== i))} className="text-rose-400">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabel breakdown per karyawan */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breakdown per Karyawan</CardTitle>
          <CardDescription>
            Gaji Jam Kerja = Jam Diakui × Tarif · Reward Poin = Poin Periode × Nilai Rp/Poin ({fmtIDR(data.config?.poin_rupiah_per_point || 0)}/poin) ·
            Komisi Kebersihan diatur manual per baris · Kolom kosong pada Adjustment berarti 0.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {employees.length === 0 && <div className="py-8 text-center text-xs text-muted-foreground">Belum ada data karyawan. Isi di tab &quot;Data Karyawan&quot;.</div>}
          {employees.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-[10px] [&>th]:text-muted-foreground">
                  <th className="min-w-[140px] sticky left-0 bg-background z-10">Nama</th>
                  <th>Jabatan</th>
                  <th>Jam Diakui</th>
                  <th>Poin</th>
                  {KOMPONEN_ORDER.map((k) => (
                    <th key={k} className="text-right">{KOMPONEN_LABELS[k]}</th>
                  ))}
                  <th className="text-right">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => {
                  const puAdj = (perUser[row.user_id]?.adjustments) || {};
                  const kebersihan = perUser[row.user_id]?.komisi_kebersihan ?? row.komponen.komisi_kebersihan ?? 0;
                  return (
                    <tr key={row.user_id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2 align-middle">
                      <td className="sticky left-0 bg-background z-10 font-medium">{row.name}</td>
                      <td className="text-muted-foreground">{row.jabatan || '-'}</td>
                      <td className="tabular-nums">{row.jam_kerja_diakui_hours} jam</td>
                      <td className="tabular-nums">{row.poin_periode}</td>
                      {/* Gaji Jam Kerja (computed) */}
                      <td className="text-right tabular-nums">{fmtIDR(row.komponen.gaji_jam_kerja)}</td>
                      {/* Komisi Penjualan (global + adj) */}
                      <td className="text-right tabular-nums">
                        <AdjInput
                          computed={row.komponen.komisi_penjualan - Number(puAdj.komisi_penjualan || 0)}
                          adj={puAdj.komisi_penjualan || 0}
                          onChangeAdj={(v) => setAdj(setPerUser, row.user_id, 'komisi_penjualan', v)}
                        />
                      </td>
                      {/* Komisi Produk Fokus (global + adj) */}
                      <td className="text-right tabular-nums">
                        <AdjInput
                          computed={row.komponen.komisi_produk_fokus - Number(puAdj.komisi_produk_fokus || 0)}
                          adj={puAdj.komisi_produk_fokus || 0}
                          onChangeAdj={(v) => setAdj(setPerUser, row.user_id, 'komisi_produk_fokus', v)}
                        />
                      </td>
                      {/* Komisi Kebersihan (manual per user) */}
                      <td className="text-right tabular-nums">
                        <Input
                          type="number"
                          value={kebersihan}
                          onChange={(e) => setKebersihan(setPerUser, row.user_id, Number(e.target.value) || 0)}
                          className="h-7 text-xs text-right"
                        />
                      </td>
                      {/* Apresiasi SO (global + adj) */}
                      <td className="text-right tabular-nums">
                        <AdjInput
                          computed={row.komponen.apresiasi_so - Number(puAdj.apresiasi_so || 0)}
                          adj={puAdj.apresiasi_so || 0}
                          onChangeAdj={(v) => setAdj(setPerUser, row.user_id, 'apresiasi_so', v)}
                        />
                      </td>
                      {/* Tunjangan Kinerja (global + adj) */}
                      <td className="text-right tabular-nums">
                        <AdjInput
                          computed={row.komponen.tunjangan_kinerja - Number(puAdj.tunjangan_kinerja || 0)}
                          adj={puAdj.tunjangan_kinerja || 0}
                          onChangeAdj={(v) => setAdj(setPerUser, row.user_id, 'tunjangan_kinerja', v)}
                        />
                      </td>
                      {/* Reward Poin (computed) */}
                      <td className="text-right tabular-nums">{fmtIDR(row.komponen.reward_poin)}</td>
                      {/* BPJS Ketenagakerjaan (global + adj) */}
                      <td className="text-right tabular-nums">
                        <AdjInput
                          computed={row.komponen.bpjs_tk - Number(puAdj.bpjs_tk || 0)}
                          adj={puAdj.bpjs_tk || 0}
                          onChangeAdj={(v) => setAdj(setPerUser, row.user_id, 'bpjs_tk', v)}
                        />
                      </td>
                      {/* BPJS Kesehatan (global + adj) */}
                      <td className="text-right tabular-nums">
                        <AdjInput
                          computed={row.komponen.bpjs_kes - Number(puAdj.bpjs_kes || 0)}
                          adj={puAdj.bpjs_kes || 0}
                          onChangeAdj={(v) => setAdj(setPerUser, row.user_id, 'bpjs_kes', v)}
                        />
                      </td>
                      <td className="text-right font-bold tabular-nums">{fmtIDR(row.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="text-[10px] text-muted-foreground mt-2">
            *Adjustment (± Rp) di setiap kolom global menambah/mengurangi nilai default individual. Simpan untuk menerapkan.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function setAdj(setPerUser, uid, key, value) {
  setPerUser((pu) => {
    const cur = pu[uid] || {};
    const adj = cur.adjustments || {};
    return { ...pu, [uid]: { ...cur, adjustments: { ...adj, [key]: value } } };
  });
}
function setKebersihan(setPerUser, uid, value) {
  setPerUser((pu) => {
    const cur = pu[uid] || {};
    return { ...pu, [uid]: { ...cur, komisi_kebersihan: value } };
  });
}

// Small inline widget for editable "computed + adjustment" cells.
function AdjInput({ computed, adj, onChangeAdj }) {
  return (
    <div className="flex items-center gap-1 justify-end">
      <span className="text-[10px] text-muted-foreground">{fmtIDR(computed)}</span>
      <span className="text-muted-foreground">+</span>
      <Input
        type="number"
        value={adj}
        onChange={(e) => onChangeAdj(Number(e.target.value) || 0)}
        className="h-7 text-xs text-right w-[90px]"
        placeholder="0"
      />
    </div>
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
                    <Input
                      type="number"
                      value={tarif}
                      onChange={(v) => setDrafts((p) => ({ ...p, [e.user_id]: { ...(p[e.user_id] || { jabatan: e.jabatan, tarif_per_jam: e.tarif_per_jam }), tarif_per_jam: Number(v.target.value) || 0 } }))}
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
          <Input
            type="number"
            value={poin}
            onChange={(e) => setPoin(Number(e.target.value) || 0)}
            placeholder="mis. 5000"
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
