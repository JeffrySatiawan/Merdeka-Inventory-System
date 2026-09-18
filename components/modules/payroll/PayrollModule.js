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

function nowMonthRange() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const fmt = (dd) => `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
  return { from: fmt(first), to: fmt(last) };
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
  const initRange = nowMonthRange();
  const [from, setFrom] = useState(initRange.from);
  const [to, setTo] = useState(initRange.to);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null); // { config, period, employees, breakdown }

  async function load(f = from, t = to) {
    if (!f || !t) return;
    if (f > t) { toast.error('Rentang tanggal tidak valid'); return; }
    setLoading(true);
    try {
      const d = await api(`period?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`);
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }
  // Load only when both dates set & user commits (via button); tapi initial
  // load pakai bulan berjalan supaya UX tidak kosong.
  useEffect(() => { load(from, to); /* eslint-disable-next-line */ }, []);

  // Local editable state.
  const [globals, setGlobals] = useState({});
  const [products, setProducts] = useState([]);
  const [perUser, setPerUser] = useState({}); // { user_id: { komisi_kebersihan, finals: {komponen: number} } }
  useEffect(() => {
    if (!data) return;
    setGlobals(data.period?.globals || {});
    setProducts(Array.isArray(data.period?.products) ? [...data.period.products] : []);
    // Migrasi transparan: kalau server masih menyimpan `adjustments` (legacy),
    // abaikan — hanya baca `finals`. Semua nilai final di UI dihitung dari
    // globals/N atau override.
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
    setSaving(true);
    try {
      const d = await api(`period`, {
        method: 'PUT',
        body: JSON.stringify({ from, to, globals, products, per_user: perUser }),
      });
      setData(d);
      toast.success('Payroll periode disimpan');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading || !data) return <div className="py-12 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;

  const employees = data.employees || [];
  const breakdown = data.breakdown?.items || [];

  // Recompute defaults lokal supaya perubahan globals langsung terlihat pada
  // sel-sel yang belum di-override. Sel dgn override menggunakan angka final
  // yang Owner sudah tulis.
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

  const finalOf = (uid, k) => {
    const f = perUser[uid]?.finals || {};
    return f[k] != null ? Number(f[k]) : (localDefaults[k] || 0);
  };
  const isOverride = (uid, k) => (perUser[uid]?.finals || {})[k] != null;

  const rowTotal = (row) => {
    const uid = row.user_id;
    const kebersihan = perUser[uid]?.komisi_kebersihan != null
      ? Number(perUser[uid].komisi_kebersihan)
      : Number(row.komponen.komisi_kebersihan || 0);
    return (
      Number(row.komponen.gaji_jam_kerja || 0) +
      finalOf(uid, 'komisi_penjualan') +
      finalOf(uid, 'komisi_produk_fokus') +
      kebersihan +
      finalOf(uid, 'apresiasi_so') +
      finalOf(uid, 'tunjangan_kinerja') +
      Number(row.komponen.reward_poin || 0) +
      finalOf(uid, 'bpjs_tk') +
      finalOf(uid, 'bpjs_kes')
    );
  };
  const grand = breakdown.reduce((s, r) => s + rowTotal(r), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Tanggal Mulai</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 max-w-[170px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tanggal Selesai</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 max-w-[170px]" />
        </div>
        <Button variant="outline" onClick={() => load(from, to)} disabled={loading} className="gap-1">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Muat Data
        </Button>
        <Button onClick={save} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Simpan Payroll
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
          <CardDescription>
            Nilai global otomatis menjadi default per karyawan. Kalau Owner mengubah nilai per baris di tabel bawah,
            baris itu menjadi override (tidak berubah walau global berubah). Angka negatif otomatis mengurangi total.
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
                <Input
                  type="number"
                  value={globals[k] ?? 0}
                  onChange={(e) => setGlobals((g) => ({ ...g, [k]: Number(e.target.value) || 0 }))}
                />
                <div className="text-[10px] text-muted-foreground">
                  ≈ {fmtIDR(localDefaults[k] || 0)} / karyawan (default)
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
                  Total produk = {fmtIDR(productTotal)} · default ≈ {fmtIDR(localDefaults.komisi_produk_fokus || 0)}/karyawan
                </div>
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

      {/* Tabel breakdown per karyawan — nilai FINAL, tanpa kolom Adjustment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breakdown per Karyawan</CardTitle>
          <CardDescription>
            Semua nilai di sel adalah <b>nilai final</b> yang benar-benar akan diterima karyawan. Ubah langsung angkanya.
            Sel dengan tanda <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle mx-0.5" /> berarti sudah di-override
            (tidak ikut berubah walau global berubah); klik &quot;reset&quot; untuk kembali ke default.
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
                  const uid = row.user_id;
                  const kebersihan = perUser[uid]?.komisi_kebersihan != null
                    ? perUser[uid].komisi_kebersihan
                    : Number(row.komponen.komisi_kebersihan || 0);
                  return (
                    <tr key={uid} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2 align-middle">
                      <td className="sticky left-0 bg-background z-10 font-medium">{row.name}</td>
                      <td className="text-muted-foreground">{row.jabatan || '-'}</td>
                      <td className="tabular-nums">{row.jam_kerja_diakui_hours} jam</td>
                      <td className="tabular-nums">{row.poin_periode}</td>
                      {/* Gaji Jam Kerja (auto) — non-editable */}
                      <td className="text-right tabular-nums text-muted-foreground">{fmtIDR(row.komponen.gaji_jam_kerja)}</td>
                      {/* 5 komponen global → editable final */}
                      <FinalCell value={finalOf(uid, 'komisi_penjualan')} override={isOverride(uid, 'komisi_penjualan')}
                        onChange={(v) => setFinal(setPerUser, uid, 'komisi_penjualan', v)}
                        onReset={() => setFinal(setPerUser, uid, 'komisi_penjualan', null)} />
                      <FinalCell value={finalOf(uid, 'komisi_produk_fokus')} override={isOverride(uid, 'komisi_produk_fokus')}
                        onChange={(v) => setFinal(setPerUser, uid, 'komisi_produk_fokus', v)}
                        onReset={() => setFinal(setPerUser, uid, 'komisi_produk_fokus', null)} />
                      {/* Komisi Kebersihan (manual per user) */}
                      <td className="text-right tabular-nums">
                        <Input
                          type="number"
                          value={kebersihan}
                          onChange={(e) => setKebersihan(setPerUser, uid, Number(e.target.value) || 0)}
                          className="h-7 text-xs text-right"
                        />
                      </td>
                      <FinalCell value={finalOf(uid, 'apresiasi_so')} override={isOverride(uid, 'apresiasi_so')}
                        onChange={(v) => setFinal(setPerUser, uid, 'apresiasi_so', v)}
                        onReset={() => setFinal(setPerUser, uid, 'apresiasi_so', null)} />
                      <FinalCell value={finalOf(uid, 'tunjangan_kinerja')} override={isOverride(uid, 'tunjangan_kinerja')}
                        onChange={(v) => setFinal(setPerUser, uid, 'tunjangan_kinerja', v)}
                        onReset={() => setFinal(setPerUser, uid, 'tunjangan_kinerja', null)} />
                      {/* Reward Poin (auto) */}
                      <td className="text-right tabular-nums text-muted-foreground">{fmtIDR(row.komponen.reward_poin)}</td>
                      <FinalCell value={finalOf(uid, 'bpjs_tk')} override={isOverride(uid, 'bpjs_tk')}
                        onChange={(v) => setFinal(setPerUser, uid, 'bpjs_tk', v)}
                        onReset={() => setFinal(setPerUser, uid, 'bpjs_tk', null)} />
                      <FinalCell value={finalOf(uid, 'bpjs_kes')} override={isOverride(uid, 'bpjs_kes')}
                        onChange={(v) => setFinal(setPerUser, uid, 'bpjs_kes', v)}
                        onReset={() => setFinal(setPerUser, uid, 'bpjs_kes', null)} />
                      <td className="text-right font-bold tabular-nums">{fmtIDR(rowTotal(row))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// setFinal: null → hapus override (revert ke default global/N).
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

// Editable "final value" cell — dengan tanda override & tombol reset kecil.
function FinalCell({ value, override, onChange, onReset }) {
  return (
    <td className="text-right tabular-nums">
      <div className="flex items-center gap-1 justify-end">
        {override && (
          <button
            type="button"
            onClick={onReset}
            title="Kembalikan ke default global"
            className="text-[9px] text-amber-400 hover:text-amber-300 uppercase tracking-wider"
          >
            reset
          </button>
        )}
        <Input
          type="number"
          value={Math.round(Number(value || 0))}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className={`h-7 text-xs text-right w-[120px] ${override ? 'border-amber-500/50 bg-amber-500/5' : ''}`}
        />
        {override && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />}
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
