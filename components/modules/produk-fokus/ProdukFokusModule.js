/**
 * Module UI: Produk Fokus.
 * ============================================================================
 * View keys:
 *  - pf:dashboard      : Dashboard (staff sendiri | owner full) — Fase 2
 *  - pf:pengajuan      : Pengajuan Produk Fokus (all staff can submit)
 *  - pf:penjualan      : Input Penjualan (all staff) — Fase 2
 *  - pf:master         : Master Produk (owner only)
 *  - pf:rekonsiliasi   : Rekonsiliasi POS (owner only) — Fase 3
 *  - pf:histori        : Histori (owner only) — Fase 3
 *
 * Periode 26→25 (mirror Payroll). Client-side helper untuk dropdown periode.
 * TIDAK menyentuh modul/collection lain.
 */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Target, Loader2, RefreshCw, Plus, Trash2, Pencil, Copy, Check, X, Send, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

// ---- Periode helpers (26 bulan sebelumnya → 25 bulan berjalan) ----
const PF_FIRST_PERIOD_KEY = '2026-09';
function pfPeriodRange(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  if (key < PF_FIRST_PERIOD_KEY) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  const toStr = `${m[1]}-${m[2]}-25`;
  const prev = new Date(Date.UTC(y, mo - 1, 1));
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const py = prev.getUTCFullYear();
  const pm = prev.getUTCMonth() + 1;
  const fromStr = `${py}-${String(pm).padStart(2, '0')}-26`;
  return { from: fromStr, to: toStr };
}
function pfActivePeriodKey(now = new Date()) {
  const y = now.getFullYear(); const m = now.getMonth() + 1; const d = now.getDate();
  if (d >= 26) {
    const nm = m === 12 ? 1 : m + 1; const ny = m === 12 ? y + 1 : y;
    return `${ny}-${String(nm).padStart(2, '0')}`;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function pfPrevPeriodKey(key) {
  const [y, m] = key.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, '0')}`;
}
function listPfPeriods() {
  const latest = pfActivePeriodKey();
  if (latest < PF_FIRST_PERIOD_KEY) return [];
  const out = [];
  let k = latest;
  for (let i = 0; i < 240 && k >= PF_FIRST_PERIOD_KEY; i++) {
    const r = pfPeriodRange(k); if (!r) break;
    out.push({ period_key: k, from: r.from, to: r.to });
    k = pfPrevPeriodKey(k);
  }
  return out;
}
const MO_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
function fmtPeriodLabel(from, to) {
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MO_SHORT[m - 1]} ${y}`;
  };
  return `${fmt(from)} → ${fmt(to)}`;
}
const fmtIDR = (v) => `Rp ${Math.round(Number(v || 0)).toLocaleString('id-ID')}`;

// ---- API helper ----
async function pfApi(path, opts = {}) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null;
  const r = await fetch(`${base}/api/pf/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ============================================================================
// Root Module
// ============================================================================
export default function ProdukFokusModule({ user, initialView = 'pf:dashboard' }) {
  const isOwner = user?.role === 'owner';
  const [view, setView] = useState(initialView);
  useEffect(() => { setView(initialView); }, [initialView]);

  // Periode aktif (default) — shared across views.
  const periods = useMemo(() => listPfPeriods(), []);
  const [periodKey, setPeriodKey] = useState(periods[0]?.period_key || '');

  const range = useMemo(() => periods.find((p) => p.period_key === periodKey), [periodKey, periods]);
  const isPeriodEmpty = periods.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <Target className="w-4 h-4 text-orange-400" />
        </div>
        <div className="flex-1">
          <div className="text-lg font-semibold">Produk Fokus</div>
          <div className="text-xs text-muted-foreground">Master produk fokus per periode, pengajuan tim ED, input penjualan, dan rekonsiliasi POS.</div>
        </div>
      </div>

      {/* Period selector — shared */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]">
            <Label className="text-xs">Periode</Label>
            {isPeriodEmpty ? (
              <div className="h-8 flex items-center text-xs text-muted-foreground italic">Belum ada periode aktif</div>
            ) : (
              <Select value={periodKey} onValueChange={setPeriodKey}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Pilih periode" /></SelectTrigger>
                <SelectContent>
                  {periods.map((p, i) => (
                    <SelectItem key={p.period_key} value={p.period_key}>
                      {fmtPeriodLabel(p.from, p.to)}{i === 0 ? ' · Aktif' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sub-view tabs (fallback when browsing without sidebar) */}
      <div className="flex flex-wrap gap-2">
        <NavBtn cur={view} set={setView} k="pf:dashboard" label="Dashboard" />
        <NavBtn cur={view} set={setView} k="pf:pengajuan" label="Pengajuan" />
        <NavBtn cur={view} set={setView} k="pf:penjualan" label="Input Penjualan" />
        {isOwner && <NavBtn cur={view} set={setView} k="pf:master" label="Master Produk" />}
        {isOwner && <NavBtn cur={view} set={setView} k="pf:rekonsiliasi" label="Rekonsiliasi POS" />}
        {isOwner && <NavBtn cur={view} set={setView} k="pf:histori" label="Histori" />}
      </div>

      {isPeriodEmpty && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-1">
            <div className="text-base text-foreground font-semibold">Belum ada periode Produk Fokus</div>
            <div>Periode pertama otomatis dimulai <b>26 Agustus 2026</b>.</div>
          </CardContent>
        </Card>
      )}

      {!isPeriodEmpty && view === 'pf:master' && isOwner && <MasterView periodKey={periodKey} range={range} />}
      {!isPeriodEmpty && view === 'pf:pengajuan' && <PengajuanView periodKey={periodKey} range={range} isOwner={isOwner} user={user} />}
      {!isPeriodEmpty && view === 'pf:penjualan' && <PenjualanView periodKey={periodKey} activePeriodKey={periods[0]?.period_key} range={range} isOwner={isOwner} user={user} />}
      {!isPeriodEmpty && view === 'pf:dashboard' && <DashboardView periodKey={periodKey} range={range} isOwner={isOwner} user={user} />}
      {!isPeriodEmpty && view === 'pf:rekonsiliasi' && isOwner && <RekonsiliasiView periodKey={periodKey} range={range} />}
      {!isPeriodEmpty && view === 'pf:histori' && isOwner && <HistoriView periodKey={periodKey} range={range} />}
    </div>
  );
}

function NavBtn({ cur, set, k, label }) {
  return (
    <Button size="sm" variant={cur === k ? 'default' : 'outline'} onClick={() => set(k)}>{label}</Button>
  );
}
function Placeholder({ title, desc }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        <div className="text-base text-foreground font-semibold mb-1">{title}</div>
        <div>{desc}</div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// MASTER PRODUK (Owner Only)
// ============================================================================
function MasterView({ periodKey, range }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | itemObj
  const [copyOpen, setCopyOpen] = useState(false);

  const load = async () => {
    if (!periodKey) return;
    setLoading(true);
    try {
      const d = await pfApi(`masters?period=${periodKey}`);
      setItems(d.items || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [periodKey]);

  const removeItem = async (id, nama) => {
    if (!confirm(`Hapus master "${nama}"?`)) return;
    try {
      await pfApi(`masters/${id}`, { method: 'DELETE' });
      toast.success('Master dihapus');
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" /> Master Produk Fokus</CardTitle>
            <CardDescription>Daftar master produk fokus untuk periode <b>{range ? fmtPeriodLabel(range.from, range.to) : periodKey}</b>. Reset setiap periode.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setCopyOpen(true)}>
              <Copy className="w-3.5 h-3.5" /> Copy Periode Sebelumnya
            </Button>
            <Button size="sm" className="gap-1" onClick={() => setEditing('new')}>
              <Plus className="w-3.5 h-3.5" /> Tambah
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Belum ada master. Tambahkan produk atau copy dari periode sebelumnya.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:font-semibold">
                    <th>Kode</th>
                    <th>Nama Produk</th>
                    <th>Satuan</th>
                    <th>Jumlah</th>
                    <th className="text-right">Bonus/Unit</th>
                    <th>Keterangan</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2 align-middle">
                      <td className="font-mono">{it.kode}</td>
                      <td className="font-medium">{it.nama}</td>
                      <td className="text-muted-foreground">{it.satuan}</td>
                      <td>
                        {it.jumlah_type === 'limited'
                          ? <Badge variant="outline" className="border-amber-500/30 text-amber-300">{it.jumlah_max} {it.satuan}</Badge>
                          : <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">Tidak Terbatas</Badge>}
                      </td>
                      <td className="text-right tabular-nums">{fmtIDR(it.bonus)}</td>
                      <td className="text-muted-foreground text-[11px] max-w-[240px] truncate" title={it.keterangan || ''}>{it.keterangan || '—'}</td>
                      <td className="text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(it)} title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400" onClick={() => removeItem(it.id, it.nama)} title="Hapus">
                          <Trash2 className="w-3.5 h-3.5" />
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

      {editing && (
        <MasterEditor
          open={!!editing}
          initial={editing === 'new' ? null : editing}
          periodKey={periodKey}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {copyOpen && (
        <CopyPreviousDialog
          open={copyOpen}
          periodKey={periodKey}
          onClose={() => setCopyOpen(false)}
          onDone={() => { setCopyOpen(false); load(); }}
        />
      )}
    </>
  );
}

function MasterEditor({ open, initial, periodKey, onClose, onSaved }) {
  const isEdit = !!initial;
  const [kode, setKode] = useState(initial?.kode || '');
  const [nama, setNama] = useState(initial?.nama || '');
  const [satuan, setSatuan] = useState(initial?.satuan || 'pcs');
  const [jumlahType, setJumlahType] = useState(initial?.jumlah_type || 'limited');
  const [jumlahMax, setJumlahMax] = useState(initial?.jumlah_max ?? '');
  const [bonus, setBonus] = useState(initial?.bonus ?? '');
  const [keterangan, setKeterangan] = useState(initial?.keterangan || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!kode.trim() || !nama.trim()) { toast.error('Kode dan Nama wajib diisi'); return; }
    if (jumlahType === 'limited' && !(Number(jumlahMax) > 0)) { toast.error('Jumlah harus > 0'); return; }
    setSaving(true);
    try {
      const body = {
        period_key: periodKey,
        kode: kode.trim(),
        nama: nama.trim(),
        satuan: satuan.trim() || 'pcs',
        jumlah_type: jumlahType,
        jumlah_max: jumlahType === 'limited' ? Math.floor(Number(jumlahMax) || 0) : null,
        bonus: Math.max(0, Number(bonus) || 0),
        keterangan: keterangan.trim(),
      };
      if (isEdit) {
        await pfApi(`masters/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success('Master diperbarui');
      } else {
        await pfApi('masters', { method: 'POST', body: JSON.stringify(body) });
        toast.success('Master ditambahkan');
      }
      onSaved?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Master Produk' : 'Tambah Master Produk'}</DialogTitle>
          <DialogDescription>Periode {periodKey}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Kode Produk</Label>
              <Input value={kode} onChange={(e) => setKode(e.target.value.toUpperCase())} className="h-8 font-mono" maxLength={40} />
            </div>
            <div>
              <Label className="text-xs">Satuan</Label>
              <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} className="h-8" placeholder="pcs / box / dus" maxLength={20} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Nama Produk</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} className="h-8" maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Jumlah</Label>
              <Select value={jumlahType} onValueChange={setJumlahType}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="limited">Terbatas</SelectItem>
                  <SelectItem value="unlimited">Tidak Terbatas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{jumlahType === 'limited' ? 'Qty Maks' : '—'}</Label>
              <Input
                type="number" min={1} step={1}
                value={jumlahType === 'limited' ? jumlahMax : ''}
                onChange={(e) => setJumlahMax(e.target.value)}
                disabled={jumlahType !== 'limited'}
                className="h-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Bonus / Unit Terjual (Rp)</Label>
            <Input type="number" min={0} step={100} value={bonus} onChange={(e) => setBonus(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-xs">Keterangan (opsional)</Label>
            <Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} maxLength={500} rows={2} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={save} disabled={saving} className="gap-1">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyPreviousDialog({ open, periodKey, onClose, onDone }) {
  const prevKey = pfPrevPeriodKey(periodKey);
  const [prevItems, setPrevItems] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    (async () => {
      if (prevKey < PF_FIRST_PERIOD_KEY) return;
      setLoading(true);
      try {
        const d = await pfApi(`masters?period=${prevKey}`);
        setPrevItems(d.items || []);
        setSelected(new Set((d.items || []).map((x) => x.id))); // default all selected
      } catch (e) { toast.error(e.message); }
      finally { setLoading(false); }
    })();
  }, [prevKey]);

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const doCopy = async () => {
    if (selected.size === 0) { toast.error('Pilih minimal 1 produk'); return; }
    setCopying(true);
    try {
      const d = await pfApi('masters/copy-previous', {
        method: 'POST',
        body: JSON.stringify({ period_key: periodKey, source_ids: Array.from(selected) }),
      });
      toast.success(`Copied ${d.copied}, skipped ${d.skipped} (duplikat kode)`);
      onDone?.();
    } catch (e) { toast.error(e.message); }
    finally { setCopying(false); }
  };

  const isBeforeFirst = prevKey < PF_FIRST_PERIOD_KEY;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy dari Periode Sebelumnya</DialogTitle>
          <DialogDescription>Sumber: periode <b>{prevKey}</b> → target: <b>{periodKey}</b>. Kode duplikat akan di-skip.</DialogDescription>
        </DialogHeader>
        {isBeforeFirst ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Belum ada periode sebelumnya untuk di-copy.</div>
        ) : loading ? (
          <div className="py-6 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>
        ) : prevItems.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Periode {prevKey} tidak memiliki master untuk di-copy.</div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto space-y-1 border border-white/10 rounded-lg p-2">
            {prevItems.map((it) => (
              <label key={it.id} className="flex items-center gap-2 p-2 hover:bg-white/5 rounded cursor-pointer">
                <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} className="cursor-pointer" />
                <div className="flex-1">
                  <div className="text-xs font-medium"><span className="font-mono text-muted-foreground">{it.kode}</span> · {it.nama}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {it.jumlah_type === 'limited' ? `${it.jumlah_max} ${it.satuan}` : 'Tidak Terbatas'} · Bonus {fmtIDR(it.bonus)}/unit
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={copying}>Tutup</Button>
          {!isBeforeFirst && prevItems.length > 0 && (
            <Button onClick={doCopy} disabled={copying || selected.size === 0} className="gap-1">
              {copying && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Copy {selected.size} Produk
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// PENGAJUAN
// ============================================================================
function PengajuanView({ periodKey, range, isOwner, user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const load = async () => {
    if (!periodKey) return;
    setLoading(true);
    try {
      const d = await pfApi(`pengajuan?period=${periodKey}`);
      setItems(d.items || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [periodKey]);

  const review = async (id, action) => {
    try {
      const d = await pfApi(`pengajuan/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
      toast.success(action === 'accept' ? 'Pengajuan diterima & master dibuat' : 'Pengajuan ditolak');
      load();
    } catch (e) { toast.error(e.message); }
  };
  const remove = async (id, nama) => {
    if (!confirm(`Hapus pengajuan "${nama}"?`)) return;
    try {
      await pfApi(`pengajuan/${id}`, { method: 'DELETE' });
      toast.success('Pengajuan dihapus');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const statusBadge = (st) => {
    if (st === 'diterima') return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px]">Diterima</Badge>;
    if (st === 'ditolak') return <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30 text-[10px]">Ditolak</Badge>;
    return <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px]">Menunggu</Badge>;
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Send className="w-4 h-4" /> Pengajuan Produk Fokus</CardTitle>
            <CardDescription>
              {isOwner
                ? `Seluruh pengajuan pada periode ${range ? fmtPeriodLabel(range.from, range.to) : periodKey}. Diterima → otomatis jadi Master.`
                : `Pengajuan Anda pada periode ${range ? fmtPeriodLabel(range.from, range.to) : periodKey}.`}
            </CardDescription>
          </div>
          <Button size="sm" className="gap-1" onClick={() => setNewOpen(true)}><Plus className="w-3.5 h-3.5" /> Ajukan</Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Belum ada pengajuan.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:font-semibold">
                    <th>Tgl</th>
                    <th>Pengaju</th>
                    <th>Kode</th>
                    <th>Nama Produk</th>
                    <th className="text-right">Jumlah</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2 align-middle">
                      <td className="text-muted-foreground whitespace-nowrap text-[11px]">
                        {new Date(it.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                      </td>
                      <td>{it.submitted_by_name || it.submitted_by}</td>
                      <td className="font-mono">{it.kode}</td>
                      <td className="font-medium">{it.nama}</td>
                      <td className="text-right tabular-nums">{it.jumlah} {it.satuan}</td>
                      <td>{statusBadge(it.status)}</td>
                      <td className="text-right whitespace-nowrap">
                        {isOwner && it.status === 'menunggu' && (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400" onClick={() => review(it.id, 'accept')} title="Terima">
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400" onClick={() => review(it.id, 'reject')} title="Tolak">
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                        {(isOwner || it.submitted_by === user?.id) && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400" onClick={() => remove(it.id, it.nama)} title="Hapus">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
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

      {newOpen && (
        <PengajuanEditor
          open={newOpen}
          periodKey={periodKey}
          onClose={() => setNewOpen(false)}
          onSaved={() => { setNewOpen(false); load(); }}
        />
      )}
    </>
  );
}

function PengajuanEditor({ open, periodKey, onClose, onSaved }) {
  const [kode, setKode] = useState('');
  const [nama, setNama] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [satuan, setSatuan] = useState('pcs');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!kode.trim() || !nama.trim()) { toast.error('Kode dan Nama wajib'); return; }
    if (!(Number(jumlah) > 0)) { toast.error('Jumlah harus > 0'); return; }
    setSaving(true);
    try {
      await pfApi('pengajuan', {
        method: 'POST',
        body: JSON.stringify({
          period_key: periodKey,
          kode: kode.trim(),
          nama: nama.trim(),
          jumlah: Math.floor(Number(jumlah)),
          satuan: satuan.trim() || 'pcs',
        }),
      });
      toast.success('Pengajuan terkirim');
      onSaved?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajukan Produk Fokus</DialogTitle>
          <DialogDescription>Periode {periodKey}. Owner akan review pengajuan Anda.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Kode Produk</Label>
              <Input value={kode} onChange={(e) => setKode(e.target.value.toUpperCase())} className="h-8 font-mono" maxLength={40} />
            </div>
            <div>
              <Label className="text-xs">Satuan</Label>
              <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} className="h-8" maxLength={20} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Nama Produk</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} className="h-8" maxLength={200} />
          </div>
          <div>
            <Label className="text-xs">Jumlah</Label>
            <Input type="number" min={1} step={1} value={jumlah} onChange={(e) => setJumlah(e.target.value)} className="h-8" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={save} disabled={saving} className="gap-1">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Kirim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// INPUT PENJUALAN — hanya untuk periode aktif berjalan.
// - Dropdown Nama Staff: reuse /api/pf/staff-list (dari `employees`).
// - Dropdown Produk: hanya master yg masih punya sisa (limited & sisa>0) atau unlimited.
// - Qty: bilangan bulat positif. Tolak 0/negatif/desimal (juga di backend).
// - Immutable — setelah simpan, tidak bisa diubah/hapus.
// ============================================================================
function PenjualanView({ periodKey, activePeriodKey, range, isOwner, user }) {
  const isActive = periodKey === activePeriodKey;
  const [staffList, setStaffList] = useState([]);
  const [dashboard, setDashboard] = useState(null); // reuse /dashboard/staff untuk info sisa
  const [items, setItems] = useState([]); // list penjualan periode
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [staffId, setStaffId] = useState(user?.id || '');
  const [masterId, setMasterId] = useState('');
  const [qty, setQty] = useState('');

  const load = async () => {
    if (!periodKey) return;
    setLoading(true);
    try {
      // Selalu ambil master + sisa via dashboard/staff (works for all users).
      // Bila owner, `staff_id` di dashboard tetap pakai default (owner sendiri),
      // yang penting adalah `total_qty` & `sisa` (agregat) untuk validasi.
      const [staffRes, dashRes, listRes] = await Promise.all([
        pfApi('staff-list'),
        pfApi(`dashboard/staff?period=${periodKey}`),
        pfApi(`penjualan?period=${periodKey}`),
      ]);
      setStaffList(staffRes.items || []);
      setDashboard(dashRes);
      setItems(listRes.items || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [periodKey]);

  // Dropdown produk: hanya master yang masih punya kuota sisa.
  const availableMasters = useMemo(() => {
    const rows = dashboard?.rows || [];
    return rows.filter((r) => r.jumlah_type === 'unlimited' || (r.sisa || 0) > 0);
  }, [dashboard]);

  // Info sisa untuk master terpilih (untuk placeholder qty).
  const pickedMaster = availableMasters.find((m) => m.master_id === masterId);

  const submit = async () => {
    if (!isActive) { toast.error('Hanya periode aktif berjalan yang boleh input penjualan'); return; }
    if (!staffId) { toast.error('Pilih Nama Staff'); return; }
    if (!masterId) { toast.error('Pilih Produk'); return; }
    const q = Number(qty);
    if (!(q > 0) || !Number.isInteger(q)) { toast.error('Qty harus bilangan bulat positif (>0)'); return; }
    if (pickedMaster && pickedMaster.jumlah_type === 'limited' && q > (pickedMaster.sisa || 0)) {
      toast.error(`Sisa kuota hanya ${pickedMaster.sisa}. Silakan input maks ${pickedMaster.sisa}.`);
      return;
    }
    setSaving(true);
    try {
      await pfApi('penjualan', {
        method: 'POST',
        body: JSON.stringify({ staff_id: staffId, master_id: masterId, qty: q }),
      });
      toast.success('Penjualan tersimpan (immutable)');
      setMasterId(''); setQty('');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4" /> Input Penjualan</CardTitle>
          <CardDescription>
            Periode aktif: <b>{activePeriodKey || '—'}</b>.
            {!isActive && (
              <span className="text-amber-300"> Periode yang dipilih ({periodKey}) BUKAN periode aktif — hanya bisa lihat, tidak bisa input.</span>
            )}
            {isActive && ' Transaksi TIDAK bisa diedit / dihapus setelah disimpan.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isActive && (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,120px,100px] gap-2 items-end">
              <div>
                <Label className="text-xs">Nama Staff</Label>
                <Select value={staffId} onValueChange={setStaffId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Pilih Nama Staff" /></SelectTrigger>
                  <SelectContent>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Produk (hanya yang bersisa)</Label>
                <Select value={masterId} onValueChange={setMasterId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={availableMasters.length ? 'Pilih Produk' : 'Belum ada produk'} /></SelectTrigger>
                  <SelectContent>
                    {availableMasters.map((m) => (
                      <SelectItem key={m.master_id} value={m.master_id}>
                        {m.kode} · {m.nama} {m.jumlah_type === 'limited' ? `(sisa ${m.sisa})` : '(unlimited)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number" min={1} step={1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="h-9"
                  placeholder={pickedMaster?.jumlah_type === 'limited' ? `maks ${pickedMaster.sisa}` : 'jumlah'}
                />
              </div>
              <Button onClick={submit} disabled={saving} className="gap-1 h-9">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Simpan
              </Button>
            </div>
          )}
          {loading ? (
            <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:font-semibold">
                    <th>Tgl</th>
                    <th>Staff</th>
                    <th>Kode</th>
                    <th>Nama Produk</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Est. Bonus</th>
                    {isOwner && <th>Input oleh</th>}
                    {isOwner && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={isOwner ? 8 : 6} className="py-6 text-center text-muted-foreground">Belum ada transaksi.</td></tr>
                  ) : items.map((it) => (
                    <tr key={it.id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2">
                      <td className="text-muted-foreground text-[11px] whitespace-nowrap">
                        {new Date(it.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>{it.staff_name}</td>
                      <td className="font-mono">{it.kode}</td>
                      <td className="font-medium">{it.nama}</td>
                      <td className="text-right tabular-nums">{it.qty} {it.satuan}</td>
                      <td className="text-right tabular-nums">{fmtIDR(it.qty * (it.bonus_unit || 0))}</td>
                      {isOwner && <td className="text-muted-foreground text-[11px]">{it.input_by_name || it.input_by}</td>}
                      {isOwner && (
                        <td className="text-right">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400"
                            title="Hapus transaksi (Owner only)"
                            onClick={async () => {
                              if (!confirm(`Hapus transaksi ${it.staff_name} · ${it.nama} · ${it.qty} ${it.satuan}?\nAksi ini permanen dan akan membebaskan kuota master.`)) return;
                              try {
                                await pfApi(`penjualan/${it.id}`, { method: 'DELETE' });
                                toast.success('Transaksi dihapus');
                                load();
                              } catch (e) { toast.error(e.message); }
                            }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ============================================================================
// DASHBOARD — Staff (per-diri) & Owner (agregat).
// ============================================================================
function DashboardView({ periodKey, range, isOwner, user }) {
  return isOwner
    ? <OwnerDashboard periodKey={periodKey} range={range} />
    : <StaffDashboard periodKey={periodKey} range={range} />;
}

function StaffDashboard({ periodKey, range }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (!periodKey) return;
    setLoading(true);
    try {
      const d = await pfApi(`dashboard/staff?period=${periodKey}`);
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [periodKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" /> Dashboard Saya</CardTitle>
        <CardDescription>Periode <b>{range ? fmtPeriodLabel(range.from, range.to) : periodKey}</b>. Anda hanya melihat data penjualan diri sendiri.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total Qty Saya" value={data.total_my_qty || 0} />
              <Stat label="Estimasi Bonus Saya" value={fmtIDR(data.total_my_bonus)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:font-semibold">
                    <th>Produk</th>
                    <th>Limit</th>
                    <th className="text-right">Bonus/Unit</th>
                    <th className="text-right">Qty Saya</th>
                    <th className="text-right">Est. Bonus</th>
                    <th>Progress Total (Semua Staff)</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.rows || []).length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Belum ada Master Produk pada periode ini.</td></tr>
                  ) : (data.rows || []).map((r) => (
                    <tr key={r.master_id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2">
                      <td><span className="font-mono text-[11px] text-muted-foreground">{r.kode}</span> · <b>{r.nama}</b></td>
                      <td className="text-[11px]">
                        {r.jumlah_type === 'limited' ? `${r.limit} ${r.satuan}` : <span className="text-emerald-300">Tidak Terbatas</span>}
                      </td>
                      <td className="text-right tabular-nums">{fmtIDR(r.bonus_unit)}</td>
                      <td className="text-right tabular-nums font-medium">{r.my_qty}</td>
                      <td className="text-right tabular-nums">{fmtIDR(r.my_bonus)}</td>
                      <td className="min-w-[140px]">
                        {r.jumlah_type === 'limited' ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-white/10 rounded overflow-hidden">
                              <div className="h-full bg-orange-400" style={{ width: `${r.progress || 0}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">{Math.round(r.progress || 0)}% · sisa {r.sisa}</span>
                          </div>
                        ) : <span className="text-[10px] text-muted-foreground">total {r.total_qty}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OwnerDashboard({ periodKey, range }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (!periodKey) return;
    setLoading(true);
    try {
      const d = await pfApi(`dashboard/owner?period=${periodKey}`);
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [periodKey]);

  if (loading || !data) return <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;

  const st = data.pengajuan_stats || { menunggu: 0, diterima: 0, ditolak: 0 };
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" /> Dashboard Owner</CardTitle>
          <CardDescription>Periode <b>{range ? fmtPeriodLabel(range.from, range.to) : periodKey}</b>.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total Penjualan (Qty)" value={data.grand_qty} />
          <Stat label="Total Estimasi Bonus" value={fmtIDR(data.grand_bonus)} />
          <Stat label="Pengajuan Menunggu" value={st.menunggu} highlight={st.menunggu > 0} />
          <Stat label="Pengajuan Diterima" value={st.diterima} />
        </CardContent>
      </Card>

      {/* Per Produk */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Penjualan per Produk</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:font-semibold">
                <th>Produk</th>
                <th>Limit</th>
                <th className="text-right">Terjual</th>
                <th className="text-right">Sisa</th>
                <th>Progress</th>
                <th className="text-right">Est. Bonus</th>
              </tr>
            </thead>
            <tbody>
              {(data.per_produk || []).length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Belum ada master pada periode ini.</td></tr>
              ) : (data.per_produk || []).map((r) => (
                <tr key={r.master_id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2">
                  <td><span className="font-mono text-[11px] text-muted-foreground">{r.kode}</span> · <b>{r.nama}</b></td>
                  <td className="text-[11px]">{r.jumlah_type === 'limited' ? `${r.limit} ${r.satuan}` : 'Unlimited'}</td>
                  <td className="text-right tabular-nums">{r.qty}</td>
                  <td className="text-right tabular-nums">{r.sisa ?? '—'}</td>
                  <td className="min-w-[140px]">
                    {r.jumlah_type === 'limited' ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-white/10 rounded overflow-hidden">
                          <div className="h-full bg-orange-400" style={{ width: `${r.progress || 0}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">{Math.round(r.progress || 0)}%</span>
                      </div>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </td>
                  <td className="text-right tabular-nums">{fmtIDR(r.bonus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Per Staff */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Penjualan per Staff</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:font-semibold">
                <th>Staff</th>
                <th className="text-right">Total Qty</th>
                <th className="text-right">Estimasi Bonus</th>
              </tr>
            </thead>
            <tbody>
              {(data.per_staff || []).length === 0 ? (
                <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">Belum ada transaksi.</td></tr>
              ) : (data.per_staff || []).map((r) => (
                <tr key={r.staff_id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2">
                  <td className="font-medium">{r.staff_name}</td>
                  <td className="text-right tabular-nums">{r.qty}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtIDR(r.bonus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${highlight ? 'text-amber-300' : ''}`}>{value}</div>
    </div>
  );
}

// ============================================================================
// REKONSILIASI POS (Owner only)
// - Owner input `pos_total` per produk. Kapan saja (termasuk periode aktif).
// - Aturan: POS ≥ MIS → adjustment_pct=1 (tidak ada penyesuaian).
//           POS <  MIS → adjustment_pct = pos/mis; qty_diakui = floor per row,
//           sisa dibulatkan naik untuk staff qty_input terbesar.
// - Kosongkan input untuk reset (hapus rekonsiliasi produk itu).
// ============================================================================
function RekonsiliasiView({ periodKey, range }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [posInputs, setPosInputs] = useState({}); // master_id -> string
  const load = async () => {
    if (!periodKey) return;
    setLoading(true);
    try {
      const d = await pfApi(`rekonsiliasi?period=${periodKey}`);
      setData(d);
      const init = {};
      (d.items || []).forEach((it) => { init[it.master_id] = it.pos_total != null ? String(it.pos_total) : ''; });
      setPosInputs(init);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [periodKey]);

  const save = async () => {
    setSaving(true);
    try {
      const entries = (data?.items || []).map((it) => ({
        master_id: it.master_id,
        pos_total: posInputs[it.master_id] === '' ? null : Math.max(0, Math.floor(Number(posInputs[it.master_id]) || 0)),
      }));
      await pfApi('rekonsiliasi', { method: 'PUT', body: JSON.stringify({ period_key: periodKey, entries }) });
      toast.success('Rekonsiliasi disimpan');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  if (loading || !data) return <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;
  const items = data.items || [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Rekonsiliasi POS</CardTitle>
          <CardDescription>
            Periode <b>{range ? fmtPeriodLabel(range.from, range.to) : periodKey}</b>. Input total POS per produk.
            <span className="block text-[11px] mt-1">Aturan: POS ≥ MIS → tanpa penyesuaian · POS &lt; MIS → distribusi proporsional (staff qty terbesar dapat sisa pembulatan). Kosongkan untuk reset.</span>
          </CardDescription>
        </div>
        <Button size="sm" onClick={save} disabled={saving} className="gap-1">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Simpan
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Belum ada Master Produk pada periode ini.</div>
        ) : items.map((it) => {
          const posStr = posInputs[it.master_id] ?? '';
          const posNum = Number(posStr);
          const hasPos = posStr !== '' && Number.isFinite(posNum);
          const showAdj = hasPos && posNum < it.mis_total;
          const pct = showAdj && it.mis_total > 0 ? (posNum / it.mis_total) : 1;
          return (
            <div key={it.master_id} className="border border-white/10 rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-medium"><span className="font-mono text-[11px] text-muted-foreground">{it.kode}</span> · {it.nama}</div>
                  <div className="text-[11px] text-muted-foreground">Bonus/unit: {fmtIDR(it.bonus_unit)} · Jumlah: {it.jumlah_type === 'limited' ? `${it.jumlah_max} ${it.satuan}` : 'Unlimited'}</div>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">MIS Total</Label>
                    <div className="h-8 flex items-center px-2 rounded-md border border-white/10 bg-white/[0.03] text-sm tabular-nums font-semibold min-w-[80px]">{it.mis_total}</div>
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">POS Total</Label>
                    <Input
                      type="number" min={0} step={1}
                      value={posStr}
                      onChange={(e) => setPosInputs((p) => ({ ...p, [it.master_id]: e.target.value }))}
                      className="h-8 min-w-[100px] text-sm tabular-nums"
                      placeholder="—"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Penyesuaian</Label>
                    <div className={`h-8 flex items-center px-2 rounded-md border text-xs tabular-nums min-w-[80px] ${
                      !hasPos ? 'border-white/10 text-muted-foreground bg-white/[0.02]' :
                      showAdj ? 'border-amber-500/30 text-amber-300 bg-amber-500/5' : 'border-emerald-500/30 text-emerald-300 bg-emerald-500/5'
                    }`}>
                      {!hasPos ? '—' : showAdj ? `${(pct * 100).toFixed(1)}%` : 'Sesuai'}
                    </div>
                  </div>
                </div>
              </div>
              {it.per_staff.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left border-b border-white/10 [&>th]:py-1 [&>th]:px-2 [&>th]:text-[10px] [&>th]:text-muted-foreground [&>th]:font-semibold">
                        <th>Staff</th>
                        <th className="text-right">Qty Input</th>
                        <th className="text-right">Qty Diakui</th>
                        <th className="text-right">Est. Bonus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {it.per_staff.map((s) => (
                        <tr key={s.staff_id} className="[&>td]:py-1 [&>td]:px-2">
                          <td>{s.staff_name}</td>
                          <td className="text-right tabular-nums">{s.qty_input}</td>
                          <td className="text-right tabular-nums font-medium">{s.qty_diakui}</td>
                          <td className="text-right tabular-nums">{fmtIDR(s.bonus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// HISTORI (Owner only) — gabungan read-only per periode.
// ============================================================================
function HistoriView({ periodKey, range }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (!periodKey) return;
    setLoading(true);
    try {
      const d = await pfApi(`histori?period=${periodKey}`);
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [periodKey]);

  if (loading || !data) return <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" /> Histori Periode</CardTitle>
          <CardDescription>Periode <b>{range ? fmtPeriodLabel(range.from, range.to) : periodKey}</b>. Read-only snapshot lengkap.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <Stat label="Qty Input" value={data.totals?.qty || 0} />
          <Stat label="Qty Diakui (POS)" value={data.totals?.qty_diakui || 0} />
          <Stat label="Total Bonus Final" value={fmtIDR(data.totals?.bonus || 0)} />
        </CardContent>
      </Card>

      {/* Rekap per staff */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Rekap Bonus per Staff</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:text-muted-foreground [&>th]:font-semibold">
                <th>Staff</th>
                <th className="text-right">Qty Input</th>
                <th className="text-right">Qty Diakui</th>
                <th className="text-right">Est. Bonus</th>
              </tr>
            </thead>
            <tbody>
              {(data.rekap_per_staff || []).length === 0 ? (
                <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">Belum ada transaksi.</td></tr>
              ) : data.rekap_per_staff.map((s) => (
                <tr key={s.staff_id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2">
                  <td className="font-medium">{s.staff_name}</td>
                  <td className="text-right tabular-nums">{s.qty}</td>
                  <td className="text-right tabular-nums">{s.qty_diakui}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtIDR(s.bonus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Master Produk ({(data.masters || []).length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:text-muted-foreground [&>th]:font-semibold">
                <th>Kode</th><th>Nama</th><th>Jumlah</th><th className="text-right">Bonus/Unit</th>
              </tr>
            </thead>
            <tbody>
              {(data.masters || []).map((m) => (
                <tr key={m.id} className="border-b border-white/5 [&>td]:py-1 [&>td]:px-2">
                  <td className="font-mono">{m.kode}</td><td>{m.nama}</td>
                  <td>{m.jumlah_type === 'limited' ? `${m.jumlah_max} ${m.satuan}` : 'Unlimited'}</td>
                  <td className="text-right tabular-nums">{fmtIDR(m.bonus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Pengajuan ({(data.pengajuan || []).length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:text-muted-foreground [&>th]:font-semibold">
                <th>Pengaju</th><th>Kode</th><th>Nama</th><th className="text-right">Jumlah</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data.pengajuan || []).length === 0 ? (
                <tr><td colSpan={5} className="py-3 text-center text-muted-foreground">—</td></tr>
              ) : data.pengajuan.map((p) => (
                <tr key={p.id} className="border-b border-white/5 [&>td]:py-1 [&>td]:px-2">
                  <td>{p.submitted_by_name}</td>
                  <td className="font-mono">{p.kode}</td>
                  <td>{p.nama}</td>
                  <td className="text-right tabular-nums">{p.jumlah} {p.satuan}</td>
                  <td className="text-[11px]">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Transaksi Penjualan ({(data.penjualan || []).length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:text-muted-foreground [&>th]:font-semibold">
                <th>Tgl</th><th>Staff</th><th>Kode</th><th>Nama</th>
                <th className="text-right">Qty Input</th><th className="text-right">Qty Diakui</th><th className="text-right">Bonus</th>
              </tr>
            </thead>
            <tbody>
              {(data.penjualan || []).length === 0 ? (
                <tr><td colSpan={7} className="py-3 text-center text-muted-foreground">—</td></tr>
              ) : data.penjualan.map((t) => (
                <tr key={t.id} className="border-b border-white/5 [&>td]:py-1 [&>td]:px-2">
                  <td className="text-muted-foreground text-[10px] whitespace-nowrap">{new Date(t.createdAt).toLocaleDateString('id-ID')}</td>
                  <td>{t.staff_name}</td>
                  <td className="font-mono">{t.kode}</td>
                  <td>{t.nama}</td>
                  <td className="text-right tabular-nums">{t.qty}</td>
                  <td className="text-right tabular-nums font-medium">{t.qty_diakui}</td>
                  <td className="text-right tabular-nums">{fmtIDR(t.bonus_estimate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
