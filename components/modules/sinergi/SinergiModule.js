'use client';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Truck, Wallet, Plus, RefreshCw, Search, CheckCircle2, Circle, Pencil, RotateCcw,
  History as HistoryIcon, ClipboardList, ArrowDownCircle, ArrowUpCircle, Settings as SettingsIcon,
  Loader2,
} from 'lucide-react';

async function api(path, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null;
  const headers = {
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 20000);
  let res;
  try {
    res = await fetch(`/api/${path}`, { ...options, headers, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Server tidak merespon dalam 20s. Coba lagi.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const IDR = (n) => `Rp ${Math.round(Number(n || 0)).toLocaleString('id-ID')}`;
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '-');
const fmtDT = (v) => (v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const isOwner = (u) => u?.role === 'owner';

// ===================================================================
// MODULE ROOT
// ===================================================================
export default function SinergiModule({ user, initialView }) {
  const [tab, setTab] = useState(initialView === 'sin:cash' ? 'cash' : 'shipments');
  useEffect(() => {
    if (initialView === 'sin:cash') setTab('cash');
    else if (initialView === 'sin:shipments') setTab('shipments');
  }, [initialView]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-500/15 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Pencatatan Operasional Sinergi</h1>
          <p className="text-sm text-muted-foreground">Dua submodul berdiri sendiri — Pengiriman Barang & Kas Tunai</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/10">
        <TabBtn active={tab === 'shipments'} onClick={() => setTab('shipments')} icon={Truck} label="Pengiriman Barang" />
        <TabBtn active={tab === 'cash'} onClick={() => setTab('cash')} icon={Wallet} label="Kas Tunai" />
      </div>

      {tab === 'shipments' ? <ShipmentsView user={user} /> : <CashView user={user} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 flex items-center gap-2 text-sm border-b-2 -mb-px transition ${
        active ? 'border-indigo-400 text-indigo-200' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

// ===================================================================
// SHIPMENTS
// ===================================================================
function ShipmentsView({ user }) {
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ from: '', to: '', status: '', carrier: '', q: '' });
  const [edit, setEdit] = useState(null);
  const [auditOf, setAuditOf] = useState(null);

  async function loadRows(silent = false) {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      Object.entries(filter).forEach(([k, v]) => { if (v) qs.set(k, v); });
      const d = await api(`sinergi/shipments?${qs.toString()}`);
      setRows(d.items || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }
  async function loadStaff() {
    try {
      const d = await api('sinergi/staff');
      setStaff(d.items || []);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadStaff(); }, []);
  useEffect(() => { loadRows(); /* eslint-disable-next-line */ }, [filter.from, filter.to, filter.status, filter.carrier]);

  async function markReturned(id) {
    if (!confirm('Tandai faktur Sudah Kembali?')) return;
    try {
      await api(`sinergi/shipments/${id}/return`, { method: 'POST' });
      toast.success('Status diupdate');
      loadRows(true);
    } catch (e) { toast.error(e.message); }
  }

  const stats = useMemo(() => ({
    total: rows.length,
    bawa: rows.filter((r) => r.status === 'bawa').length,
    kembali: rows.filter((r) => r.status === 'kembali').length,
  }), [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard title="Total" value={stats.total} />
        <StatCard title="Masih Dibawa" value={stats.bawa} color="text-amber-400" />
        <StatCard title="Sudah Kembali" value={stats.kembali} color="text-emerald-400" />
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2"><Truck className="w-4 h-4" /> Pengiriman Barang</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => loadRows()} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
            <Button size="sm" onClick={() => setEdit({})} className="gap-1"><Plus className="w-3.5 h-3.5" /> Tambah</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} className="h-9" />
            <Input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} className="h-9" />
            <Select value={filter.status || 'all'} onValueChange={(v) => setFilter({ ...filter, status: v === 'all' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="bawa">Masih Dibawa</SelectItem>
                <SelectItem value="kembali">Sudah Kembali</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filter.carrier || 'all'} onValueChange={(v) => setFilter({ ...filter, carrier: v === 'all' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Pengirim" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Pengirim</SelectItem>
                {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative col-span-2 md:col-span-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Cari no/pelanggan..." className="pl-8 h-9" onKeyDown={(e) => e.key === 'Enter' && loadRows()} />
            </div>
          </div>

          <div className="overflow-x-auto -mx-6 md:mx-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-white/10">
                <tr><th className="p-2 text-left">Tanggal</th><th className="p-2 text-left">No. Transaksi</th><th className="p-2 text-left">Pelanggan</th><th className="p-2 text-left">Pengirim</th><th className="p-2 text-left">Status</th><th className="p-2 text-right">Aksi</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Belum ada data</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="p-2 font-mono text-xs">{r.trx_no}</td>
                    <td className="p-2">{r.customer}</td>
                    <td className="p-2">{r.carrier_name}</td>
                    <td className="p-2">
                      {r.status === 'bawa'
                        ? <Badge variant="outline" className="border-amber-500/40 text-amber-300">Masih Dibawa</Badge>
                        : <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">Sudah Kembali</Badge>}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {r.status === 'bawa' && (
                        <Button size="sm" variant="outline" className="h-7 mr-1 text-xs border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10" onClick={() => markReturned(r.id)}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Kembali
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setEdit(r)}><Pencil className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setAuditOf(r)}><HistoryIcon className="w-3 h-3" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {edit && <ShipmentEditDialog row={edit} staff={staff} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); loadRows(true); }} />}
      {auditOf && <ShipmentAuditDialog shipment={auditOf} onClose={() => setAuditOf(null)} />}
    </div>
  );
}

function ShipmentEditDialog({ row, staff, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    date: row.date || today(),
    trx_no: row.trx_no || '',
    customer: row.customer || '',
    carrier_user_id: row.carrier_user_id || '',
    notes: row.notes || '',
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    const s = staff.find((x) => x.id === form.carrier_user_id);
    if (!s) return toast.error('Pengirim wajib dipilih');
    setSaving(true);
    try {
      const payload = { ...form, carrier_name: s.name };
      if (isNew) await api('sinergi/shipments', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`sinergi/shipments/${row.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Ditambahkan' : 'Disimpan');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isNew ? 'Tambah Pengiriman' : 'Edit Pengiriman'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Tanggal"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="No. Transaksi"><Input value={form.trx_no} onChange={(e) => setForm({ ...form, trx_no: e.target.value })} placeholder="FJ-001/2026" /></Field>
          <Field label="Nama Pelanggan"><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></Field>
          <Field label="Pengirim (Nama Staff)">
            <Select value={form.carrier_user_id} onValueChange={(v) => setForm({ ...form, carrier_user_id: v })}>
              <SelectTrigger><SelectValue placeholder="Pilih pengirim..." /></SelectTrigger>
              <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Catatan (opsional)"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShipmentAuditDialog({ shipment, onClose }) {
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const d = await api(`sinergi/shipments/${shipment.id}/audit`);
        setAudit(d.items || []);
      } catch (e) { toast.error(e.message); }
      finally { setLoading(false); }
    })();
  }, [shipment.id]);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Riwayat — {shipment.trx_no}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {loading && <div className="text-sm text-muted-foreground">Memuat...</div>}
          {!loading && audit.length === 0 && <div className="text-sm text-muted-foreground">Belum ada riwayat</div>}
          {audit.map((a) => (
            <div key={a.id} className="border border-white/10 rounded p-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium capitalize">{a.action}</span>
                <span className="text-muted-foreground">{fmtDT(a.at)}</span>
              </div>
              <div className="text-muted-foreground">oleh {a.by_user_name}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===================================================================
// CASH
// ===================================================================
function CashView({ user }) {
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [summary, setSummary] = useState({ opening_balance: 0, final_balance: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ from: '', to: '', jenis: '', carrier: '', q: '' });
  const [newOpen, setNewOpen] = useState(false);
  const [reverseOf, setReverseOf] = useState(null);
  const [auditOf, setAuditOf] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  async function loadRows(silent = false) {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      Object.entries(filter).forEach(([k, v]) => { if (v) qs.set(k, v); });
      const d = await api(`sinergi/cash?${qs.toString()}`);
      setRows(d.items || []);
      setSummary({ opening_balance: d.opening_balance, final_balance: d.final_balance });
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }
  async function loadStaff() {
    try { const d = await api('sinergi/staff'); setStaff(d.items || []); } catch { /* */ }
  }
  useEffect(() => { loadStaff(); }, []);
  useEffect(() => { loadRows(); /* eslint-disable-next-line */ }, [filter.from, filter.to, filter.jenis, filter.carrier]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard title="Saldo Awal" value={IDR(summary.opening_balance)} isText />
        <StatCard title="Saldo Akhir" value={IDR(summary.final_balance)} isText color="text-emerald-400" />
        <StatCard title="Total Transaksi" value={rows.length} />
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Wallet className="w-4 h-4" /> Kas Tunai</CardTitle>
            <CardDescription className="text-xs">Immutable — tidak ada tombol hapus; koreksi membuat transaksi lawan</CardDescription>
          </div>
          <div className="flex gap-2">
            {isOwner(user) && (
              <Button size="sm" variant="outline" onClick={() => setShowSettings(true)} className="gap-1"><SettingsIcon className="w-3.5 h-3.5" /> Saldo Awal</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => loadRows()} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)} className="gap-1"><Plus className="w-3.5 h-3.5" /> Tambah</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} className="h-9" />
            <Input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} className="h-9" />
            <Select value={filter.jenis || 'all'} onValueChange={(v) => setFilter({ ...filter, jenis: v === 'all' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Jenis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Jenis</SelectItem>
                <SelectItem value="in">Uang Masuk</SelectItem>
                <SelectItem value="out">Uang Keluar</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filter.carrier || 'all'} onValueChange={(v) => setFilter({ ...filter, carrier: v === 'all' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Dibawa Oleh" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Staff</SelectItem>
                {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative col-span-2 md:col-span-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Cari no/keperluan..." className="pl-8 h-9" onKeyDown={(e) => e.key === 'Enter' && loadRows()} />
            </div>
          </div>

          <div className="overflow-x-auto -mx-6 md:mx-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-white/10">
                <tr>
                  <th className="p-2 text-left">Tanggal</th>
                  <th className="p-2 text-left">No. Trx</th>
                  <th className="p-2 text-left">Keperluan</th>
                  <th className="p-2 text-left">Dibawa Oleh</th>
                  <th className="p-2 text-left">Jenis</th>
                  <th className="p-2 text-right">Jumlah</th>
                  <th className="p-2 text-right">Saldo</th>
                  <th className="p-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Belum ada transaksi</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${r.is_reversal ? 'text-amber-200' : ''}`}>
                    <td className="p-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="p-2 font-mono text-xs">{r.trx_no || '-'}</td>
                    <td className="p-2">{r.purpose}</td>
                    <td className="p-2">{r.carrier_name}</td>
                    <td className="p-2">
                      {r.jenis === 'in'
                        ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-300"><ArrowDownCircle className="w-3 h-3 mr-1" /> Masuk</Badge>
                        : <Badge variant="outline" className="border-rose-500/40 text-rose-300"><ArrowUpCircle className="w-3 h-3 mr-1" /> Keluar</Badge>}
                    </td>
                    <td className="p-2 text-right font-medium">{IDR(r.amount)}</td>
                    <td className="p-2 text-right font-medium">{IDR(r.running_balance)}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {!r.is_reversal && (
                        <Button size="sm" variant="ghost" className="h-7 text-amber-300" onClick={() => setReverseOf(r)} title="Koreksi (reversing)"><RotateCcw className="w-3 h-3" /></Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setAuditOf(r)}><HistoryIcon className="w-3 h-3" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {newOpen && <CashCreateDialog staff={staff} onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); loadRows(true); }} />}
      {reverseOf && <CashReverseDialog row={reverseOf} onClose={() => setReverseOf(null)} onSaved={() => { setReverseOf(null); loadRows(true); }} />}
      {auditOf && <CashAuditDialog cash={auditOf} onClose={() => setAuditOf(null)} />}
      {showSettings && <CashSettingsDialog opening={summary.opening_balance} onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); loadRows(true); }} />}
    </div>
  );
}

function CashCreateDialog({ staff, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: today(), trx_no: '', purpose: '', carrier_user_id: '', jenis: 'in', amount: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    const s = staff.find((x) => x.id === form.carrier_user_id);
    if (!s) return toast.error('Dibawa Oleh wajib dipilih');
    if (!form.purpose.trim()) return toast.error('Keperluan wajib diisi');
    if (!(Number(form.amount) > 0)) return toast.error('Jumlah harus > 0');
    setSaving(true);
    try {
      await api('sinergi/cash', { method: 'POST', body: JSON.stringify({ ...form, carrier_name: s.name }) });
      toast.success('Transaksi dicatat');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Tambah Transaksi Kas</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Tanggal"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="No. Transaksi (opsional)"><Input value={form.trx_no} onChange={(e) => setForm({ ...form, trx_no: e.target.value })} placeholder="Referensi" /></Field>
          <Field label="Nama Pelanggan / Keperluan"><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
          <Field label="Dibawa Oleh">
            <Select value={form.carrier_user_id} onValueChange={(v) => setForm({ ...form, carrier_user_id: v })}>
              <SelectTrigger><SelectValue placeholder="Pilih staff..." /></SelectTrigger>
              <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Jenis Transaksi">
            <Select value={form.jenis} onValueChange={(v) => setForm({ ...form, jenis: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Uang Masuk (+)</SelectItem>
                <SelectItem value="out">Uang Keluar (−)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Jumlah Uang"><Input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="100000" /></Field>
          <Field label="Catatan (opsional)"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CashReverseDialog({ row, onClose, onSaved }) {
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!notes.trim()) return toast.error('Alasan koreksi wajib diisi');
    setSaving(true);
    try {
      await api(`sinergi/cash/${row.id}/reverse`, { method: 'POST', body: JSON.stringify({ notes, date }) });
      toast.success('Transaksi koreksi dicatat');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Koreksi Transaksi</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200">
            Transaksi asli tidak akan dihapus. Sistem akan membuat transaksi lawan ({row.jenis === 'in' ? 'Uang Keluar' : 'Uang Masuk'}) sebesar {IDR(row.amount)} untuk menetralisir efek saldo.
          </div>
          <div className="text-xs text-muted-foreground">
            <div>Asli: {fmtDate(row.date)} · {row.jenis === 'in' ? 'Masuk' : 'Keluar'} · {IDR(row.amount)} · {row.purpose}</div>
          </div>
          <Field label="Tanggal Koreksi"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Alasan Koreksi"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Contoh: salah input nominal" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}Simpan Koreksi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CashAuditDialog({ cash, onClose }) {
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { const d = await api(`sinergi/cash/${cash.id}/audit`); setAudit(d.items || []); }
      catch (e) { toast.error(e.message); }
      finally { setLoading(false); }
    })();
  }, [cash.id]);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Riwayat Transaksi</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {loading && <div className="text-sm text-muted-foreground">Memuat...</div>}
          {!loading && audit.length === 0 && <div className="text-sm text-muted-foreground">Belum ada riwayat</div>}
          {audit.map((a) => (
            <div key={a.id} className="border border-white/10 rounded p-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium capitalize">{a.action}</span>
                <span className="text-muted-foreground">{fmtDT(a.at)}</span>
              </div>
              <div className="text-muted-foreground">oleh {a.by_user_name}</div>
              {a.notes && <div className="mt-1 text-amber-200">{a.notes}</div>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CashSettingsDialog({ opening, onClose, onSaved }) {
  const [val, setVal] = useState(opening ?? 0);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api('sinergi/cash/settings', { method: 'PUT', body: JSON.stringify({ opening_balance: Number(val) }) });
      toast.success('Saldo awal disimpan');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Saldo Awal Kas</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">Mengubah saldo awal akan mempengaruhi saldo seluruh transaksi secara berurutan. Hanya Owner.</div>
          <Field label="Saldo Awal (Rp)"><Input type="number" value={val} onChange={(e) => setVal(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===================================================================
// SHARED
// ===================================================================
function StatCard({ title, value, color = '', isText = false }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className={`${isText ? 'text-xl' : 'text-2xl'} font-bold mt-1 ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
