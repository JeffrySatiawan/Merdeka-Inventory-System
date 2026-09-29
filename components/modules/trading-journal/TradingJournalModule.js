/**
 * Trading Journal Module (PRIVATE Owner-Only).
 * Views: tj:journal, tj:master, tj:compounding, tj:analytics
 * Screenshot: paste (Ctrl+V) → preview → upload ke Telegram → simpan file_id.
 */
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Plus, Pencil, Trash2, Upload, X, Loader2, Download, Filter, Image as ImageIcon, RefreshCw, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

const fmtIDR = (v) => Number(v || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const fmtNum = (v, d = 2) => Number(v || 0).toLocaleString('id-ID', { maximumFractionDigits: d });

async function tjApi(path, opts = {}) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null;
  const r = await fetch(`${base}/api/tj/${path}`, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function photoUrl(file_id) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  return `${base}/api/tj/photo/${encodeURIComponent(file_id)}`;
}

export default function TradingJournalModule({ user, initialView = 'tj:journal' }) {
  const [view, setView] = useState(initialView);
  useEffect(() => { setView(initialView); }, [initialView]);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
          <LineChart className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="flex-1">
          <div className="text-lg font-semibold">Personal Trading Journal</div>
          <div className="text-xs text-muted-foreground">Journal trading pribadi. Private Owner.</div>
        </div>
      </div>
      <Tabs value={view} onValueChange={setView} className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="tj:journal">Journal</TabsTrigger>
          <TabsTrigger value="tj:master">Master</TabsTrigger>
          <TabsTrigger value="tj:compounding">Compounding</TabsTrigger>
          <TabsTrigger value="tj:analytics">Analytics</TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'tj:journal' && <JournalView />}
      {view === 'tj:master' && <MasterView />}
      {view === 'tj:compounding' && <CompoundingView />}
      {view === 'tj:analytics' && <AnalyticsView />}
    </div>
  );
}

// ============================================================================
// JOURNAL
// ============================================================================
function JournalView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // 'new' | trade obj
  const [viewing, setViewing] = useState(null);
  const [masters, setMasters] = useState({ pair: [], tf: [], metode: [] });
  const [filter, setFilter] = useState({ from: '', to: '', pair: '', tf: '', metode: '', hasil: '' });

  const loadMasters = async () => {
    try {
      const d = await tjApi('masters');
      const m = { pair: [], tf: [], metode: [] };
      for (const it of d.items || []) if (it.active !== false && m[it.kind]) m[it.kind].push(it);
      setMasters(m);
    } catch (e) { /* ignore */ }
  };
  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
      const d = await tjApi(`trades${qs ? `?${qs}` : ''}`);
      setItems(d.items || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadMasters(); load(); /* eslint-disable-next-line */ }, []);

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><LineChart className="w-4 h-4" /> Trading Journal</CardTitle>
            <CardDescription>{items.length} trade tercatat.</CardDescription>
          </div>
          <Button size="sm" className="gap-1" onClick={() => setEditing('new')}><Plus className="w-3.5 h-3.5" /> Trade Baru</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filter */}
          <div className="flex flex-wrap items-end gap-2">
            <div><Label className="text-xs">Dari</Label><Input type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} className="h-8" /></div>
            <div><Label className="text-xs">Sampai</Label><Input type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} className="h-8" /></div>
            <div className="min-w-[100px]"><Label className="text-xs">Pair</Label>
              <Select value={filter.pair || 'all'} onValueChange={(v) => setFilter((f) => ({ ...f, pair: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua</SelectItem>{masters.pair.map((m) => <SelectItem key={m.id} value={m.nama}>{m.nama}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-[80px]"><Label className="text-xs">TF</Label>
              <Select value={filter.tf || 'all'} onValueChange={(v) => setFilter((f) => ({ ...f, tf: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua</SelectItem>{masters.tf.map((m) => <SelectItem key={m.id} value={m.nama}>{m.nama}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-[100px]"><Label className="text-xs">Metode</Label>
              <Select value={filter.metode || 'all'} onValueChange={(v) => setFilter((f) => ({ ...f, metode: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua</SelectItem>{masters.metode.map((m) => <SelectItem key={m.id} value={m.nama}>{m.nama}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-[90px]"><Label className="text-xs">Hasil</Label>
              <Select value={filter.hasil || 'all'} onValueChange={(v) => setFilter((f) => ({ ...f, hasil: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua</SelectItem><SelectItem value="TP">TP</SelectItem><SelectItem value="SL">SL</SelectItem></SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={load} disabled={loading} className="gap-1 h-8">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />} Filter
            </Button>
          </div>

          {loading ? (
            <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:text-muted-foreground [&>th]:font-semibold">
                    <th>Nama Trade</th><th>Pos</th><th>TF</th><th>Metode</th>
                    <th className="text-right">Entry</th><th className="text-right">SL</th><th className="text-right">TP</th>
                    <th className="text-right">R:R</th><th>Hasil</th><th className="text-right">Hasil ($)</th><th className="text-right">R</th><th className="text-right">Durasi</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={13} className="py-6 text-center text-muted-foreground">Belum ada trade.</td></tr>
                  ) : items.map((t) => (
                    <tr key={t.id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2 cursor-pointer hover:bg-white/[0.02]" onClick={() => setViewing(t)}>
                      <td className="font-medium">{t.nama}</td>
                      <td><Badge variant="outline" className={t.position === 'BUY' ? 'border-emerald-500/30 text-emerald-300' : 'border-rose-500/30 text-rose-300'}>{t.position}</Badge></td>
                      <td>{t.tf}</td><td className="max-w-[120px] truncate">{t.metode}</td>
                      <td className="text-right tabular-nums">{fmtNum(t.entry_price, 5)}</td>
                      <td className="text-right tabular-nums">{fmtNum(t.sl_price, 5)}</td>
                      <td className="text-right tabular-nums">{fmtNum(t.tp_price, 5)}</td>
                      <td className="text-right tabular-nums">{fmtNum(t.rr, 2)}</td>
                      <td>{t.hasil ? <Badge className={t.hasil === 'TP' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30'}>{t.hasil}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                      <td className={`text-right tabular-nums ${Number(t.hasil_trade) > 0 ? 'text-emerald-300' : Number(t.hasil_trade) < 0 ? 'text-rose-300' : ''}`}>{t.hasil_trade != null ? fmtIDR(t.hasil_trade) : '—'}</td>
                      <td className="text-right tabular-nums">{t.actual_r != null ? fmtNum(t.actual_r, 2) : '—'}</td>
                      <td className="text-right tabular-nums text-[11px]">{t.duration_minutes != null ? `${Math.floor(t.duration_minutes / 60)}j ${t.duration_minutes % 60}m` : '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(t)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400" onClick={async () => {
                          if (!confirm(`Hapus "${t.nama}"?`)) return;
                          try { await tjApi(`trades/${t.id}`, { method: 'DELETE' }); toast.success('Terhapus'); load(); }
                          catch (e) { toast.error(e.message); }
                        }}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && <TradeEditor open={!!editing} initial={editing === 'new' ? null : editing} masters={masters} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {viewing && <TradeDetail open={!!viewing} trade={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
    </>
  );
}

// ---- Screenshot picker (paste / upload) ----
function ScreenshotPicker({ value, onChange, label }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(value?.file_id ? photoUrl(value.file_id) : null);
  useEffect(() => { setPreview(value?.file_id ? photoUrl(value.file_id) : null); }, [value]);

  const doUpload = async (blob, filename, mime) => {
    setUploading(true);
    try {
      // Preview local URL first.
      const localUrl = URL.createObjectURL(blob);
      setPreview(localUrl);
      // Upload as multipart.
      const fd = new FormData();
      fd.append('photo', blob, filename || 'screenshot.png');
      const d = await tjApi('upload', { method: 'POST', body: fd });
      onChange(d.screenshot);
      URL.revokeObjectURL(localUrl);
      setPreview(photoUrl(d.screenshot.file_id));
      toast.success('Screenshot terunggah ke Telegram');
    } catch (e) { toast.error(e.message); setPreview(value?.file_id ? photoUrl(value.file_id) : null); }
    finally { setUploading(false); }
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        e.preventDefault();
        await doUpload(blob, `paste-${Date.now()}.png`, blob.type);
        return;
      }
    }
  };
  const handleFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    await doUpload(f, f.name, f.type);
    e.target.value = '';
  };
  const clear = () => { onChange(null); setPreview(null); };

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <div
        onPaste={handlePaste}
        tabIndex={0}
        className="border-2 border-dashed border-white/10 rounded-lg p-3 text-center text-xs focus:outline-none focus:border-cyan-500/50 min-h-[100px] flex flex-col items-center justify-center gap-2"
      >
        {preview ? (
          <>
            <img src={preview} alt={label} className="max-h-40 rounded" />
            <div className="flex gap-2">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
                <span className="px-2 py-1 rounded border border-white/10 text-[10px] hover:bg-white/5">Ganti</span>
              </label>
              <button type="button" onClick={clear} className="px-2 py-1 rounded border border-rose-500/30 text-rose-300 text-[10px] hover:bg-rose-500/10">Hapus</button>
            </div>
          </>
        ) : (
          <>
            {uploading ? <Loader2 className="w-5 h-5 animate-spin text-cyan-400" /> : <ImageIcon className="w-5 h-5 text-muted-foreground" />}
            <div className="text-muted-foreground">
              <b>Ctrl+V</b> untuk paste screenshot, atau{' '}
              <label className="cursor-pointer text-cyan-300 hover:underline">
                <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
                pilih file
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TradeEditor({ open, initial, masters, onClose, onSaved }) {
  const isEdit = !!initial;
  const [f, setF] = useState({
    tanggal: initial?.tanggal || new Date().toISOString().slice(0, 10),
    pair: initial?.pair || '', tf: initial?.tf || '', metode: initial?.metode || '',
    position: initial?.position || 'BUY',
    entry_price: initial?.entry_price ?? '', sl_price: initial?.sl_price ?? '', tp_price: initial?.tp_price ?? '',
    sl_money: initial?.sl_money ?? '', tp_money: initial?.tp_money ?? '',
    emosi: initial?.emosi || '', jam_entry: initial?.jam_entry || '', reason: initial?.reason || '',
    entry_screenshot: initial?.entry_screenshot || null,
    hasil: initial?.hasil || '',
    close_price: initial?.close_price ?? '', jam_close: initial?.jam_close || '',
    hasil_trade: initial?.hasil_trade ?? '',
    close_screenshot: initial?.close_screenshot || null,
    evaluasi: initial?.evaluasi || '',
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);

  // Live R & Actual R.
  const risk = f.position === 'BUY' ? Number(f.entry_price) - Number(f.sl_price) : Number(f.sl_price) - Number(f.entry_price);
  const reward = f.position === 'BUY' ? Number(f.tp_price) - Number(f.entry_price) : Number(f.entry_price) - Number(f.tp_price);
  const rr = risk !== 0 && !isNaN(risk) ? reward / risk : 0;
  const actualR = Number(f.sl_money) !== 0 && !isNaN(f.sl_money) ? Number(f.hasil_trade || 0) / Number(f.sl_money) : 0;

  const save = async () => {
    if (!f.pair || !f.tf || !f.metode) { toast.error('Pair, TF, Metode wajib'); return; }
    if (!(Number(f.entry_price) > 0 && Number(f.sl_price) > 0 && Number(f.tp_price) > 0)) { toast.error('Entry/SL/TP wajib > 0'); return; }
    setSaving(true);
    try {
      const body = { ...f };
      // Kosongkan `hasil` bila belum ada.
      if (!body.hasil) body.hasil = null;
      if (body.close_price === '') body.close_price = null;
      if (body.hasil_trade === '') body.hasil_trade = null;
      if (isEdit) {
        await tjApi(`trades/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success('Trade diperbarui');
      } else {
        await tjApi('trades', { method: 'POST', body: JSON.stringify(body) });
        toast.success('Trade tersimpan');
      }
      onSaved?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Trade' : 'Trade Baru'}</DialogTitle>
          <DialogDescription>Nama otomatis: [PAIR] [Tanggal]. R:R hitung live.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ENTRY */}
          <div className="border border-white/10 rounded-lg p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Entry</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div><Label className="text-xs">Tanggal</Label><Input type="date" value={f.tanggal} onChange={(e) => set('tanggal', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Pair</Label>
                <Select value={f.pair} onValueChange={(v) => set('pair', v)}><SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{masters.pair.map((m) => <SelectItem key={m.id} value={m.nama}>{m.nama}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><Label className="text-xs">Time Frame</Label>
                <Select value={f.tf} onValueChange={(v) => set('tf', v)}><SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{masters.tf.map((m) => <SelectItem key={m.id} value={m.nama}>{m.nama}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><Label className="text-xs">Metode</Label>
                <Select value={f.metode} onValueChange={(v) => set('metode', v)}><SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{masters.metode.map((m) => <SelectItem key={m.id} value={m.nama}>{m.nama}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><Label className="text-xs">Posisi</Label>
                <Select value={f.position} onValueChange={(v) => set('position', v)}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="BUY">BUY</SelectItem><SelectItem value="SELL">SELL</SelectItem></SelectContent></Select>
              </div>
              <div><Label className="text-xs">Jam Entry</Label><Input type="time" value={f.jam_entry} onChange={(e) => set('jam_entry', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Emosi</Label><Input value={f.emosi} onChange={(e) => set('emosi', e.target.value)} className="h-8" placeholder="tenang / fomo / dst" /></div>
              <div></div>
              <div><Label className="text-xs">Harga Entry</Label><Input type="number" step="any" value={f.entry_price} onChange={(e) => set('entry_price', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Harga SL</Label><Input type="number" step="any" value={f.sl_price} onChange={(e) => set('sl_price', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Harga TP</Label><Input type="number" step="any" value={f.tp_price} onChange={(e) => set('tp_price', e.target.value)} className="h-8" /></div>
              <div>
                <Label className="text-xs">R:R (live)</Label>
                <div className="h-8 flex items-center px-2 rounded border border-white/10 bg-white/[0.03] text-sm tabular-nums">{isFinite(rr) ? rr.toFixed(2) : '—'}</div>
              </div>
              <div><Label className="text-xs">Nilai uang SL ($)</Label><Input type="number" step="any" value={f.sl_money} onChange={(e) => set('sl_money', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Nilai uang TP ($)</Label><Input type="number" step="any" value={f.tp_money} onChange={(e) => set('tp_money', e.target.value)} className="h-8" /></div>
              <div></div><div></div>
            </div>
            <div><Label className="text-xs">Alasan Entry</Label><Textarea value={f.reason} onChange={(e) => set('reason', e.target.value)} rows={2} maxLength={2000} /></div>
            <ScreenshotPicker label="Screenshot Entry" value={f.entry_screenshot} onChange={(v) => set('entry_screenshot', v)} />
          </div>

          {/* CLOSE */}
          <div className="border border-white/10 rounded-lg p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">Close (Opsional saat entry — bisa dilengkapi setelah trade berakhir)</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div><Label className="text-xs">Hasil</Label>
                <Select value={f.hasil || 'none'} onValueChange={(v) => set('hasil', v === 'none' ? '' : v)}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="TP">TP</SelectItem><SelectItem value="SL">SL</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Harga Close</Label><Input type="number" step="any" value={f.close_price} onChange={(e) => set('close_price', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Jam Close</Label><Input type="time" value={f.jam_close} onChange={(e) => set('jam_close', e.target.value)} className="h-8" /></div>
              <div><Label className="text-xs">Hasil Trade ($)</Label><Input type="number" step="any" value={f.hasil_trade} onChange={(e) => set('hasil_trade', e.target.value)} className="h-8" placeholder="+/-" /></div>
              <div>
                <Label className="text-xs">Actual R (live)</Label>
                <div className="h-8 flex items-center px-2 rounded border border-white/10 bg-white/[0.03] text-sm tabular-nums">{isFinite(actualR) ? actualR.toFixed(2) : '—'}</div>
              </div>
            </div>
            <div><Label className="text-xs">Evaluasi Hasil Trade</Label><Textarea value={f.evaluasi} onChange={(e) => set('evaluasi', e.target.value)} rows={2} maxLength={2000} /></div>
            <ScreenshotPicker label="Screenshot Close" value={f.close_screenshot} onChange={(v) => set('close_screenshot', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={save} disabled={saving} className="gap-1"><Save className="w-3.5 h-3.5" /> {saving ? 'Menyimpan…' : 'Simpan'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TradeDetail({ open, trade, onClose, onEdit }) {
  if (!trade) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{trade.nama}</DialogTitle>
          <DialogDescription>
            <Badge variant="outline" className={trade.position === 'BUY' ? 'border-emerald-500/30 text-emerald-300 mr-1' : 'border-rose-500/30 text-rose-300 mr-1'}>{trade.position}</Badge>
            {trade.tf} · {trade.metode}
            {trade.hasil && (
              <Badge className={`ml-2 ${trade.hasil === 'TP' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30'}`}>{trade.hasil}</Badge>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {[
            ['Entry', fmtNum(trade.entry_price, 5)],
            ['SL', fmtNum(trade.sl_price, 5)],
            ['TP', fmtNum(trade.tp_price, 5)],
            ['R:R', fmtNum(trade.rr, 2)],
            ['SL ($)', fmtIDR(trade.sl_money)],
            ['TP ($)', fmtIDR(trade.tp_money)],
            ['Jam Entry', trade.jam_entry || '—'],
            ['Jam Close', trade.jam_close || '—'],
            ['Durasi', trade.duration_minutes != null ? `${Math.floor(trade.duration_minutes / 60)}j ${trade.duration_minutes % 60}m` : '—'],
            ['Close', trade.close_price != null ? fmtNum(trade.close_price, 5) : '—'],
            ['Hasil Trade', trade.hasil_trade != null ? fmtIDR(trade.hasil_trade) : '—'],
            ['Actual R', trade.actual_r != null ? fmtNum(trade.actual_r, 2) : '—'],
            ['Emosi', trade.emosi || '—'],
          ].map(([k, v]) => (
            <div key={k} className="border border-white/10 rounded p-2">
              <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
              <div className="tabular-nums font-medium">{v}</div>
            </div>
          ))}
        </div>
        {trade.reason && <div className="mt-3"><div className="text-[10px] uppercase text-muted-foreground mb-1">Alasan Entry</div><div className="text-xs whitespace-pre-wrap">{trade.reason}</div></div>}
        {trade.evaluasi && <div className="mt-3"><div className="text-[10px] uppercase text-muted-foreground mb-1">Evaluasi</div><div className="text-xs whitespace-pre-wrap">{trade.evaluasi}</div></div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {trade.entry_screenshot?.file_id && <div><div className="text-[10px] uppercase text-muted-foreground mb-1">Screenshot Entry</div><img src={photoUrl(trade.entry_screenshot.file_id)} className="rounded border border-white/10 w-full" /></div>}
          {trade.close_screenshot?.file_id && <div><div className="text-[10px] uppercase text-muted-foreground mb-1">Screenshot Close</div><img src={photoUrl(trade.close_screenshot.file_id)} className="rounded border border-white/10 w-full" /></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          <Button onClick={onEdit} className="gap-1"><Pencil className="w-3.5 h-3.5" /> Edit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// MASTER
// ============================================================================
function MasterView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState('pair');
  const [nama, setNama] = useState('');
  const load = async () => {
    setLoading(true);
    try { const d = await tjApi('masters'); setItems(d.items || []); }
    catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!nama.trim()) { toast.error('Nama wajib'); return; }
    try { await tjApi('masters', { method: 'POST', body: JSON.stringify({ kind, nama: nama.trim() }) }); toast.success('Ditambahkan'); setNama(''); load(); }
    catch (e) { toast.error(e.message); }
  };
  const toggle = async (it) => {
    try { await tjApi(`masters/${it.id}`, { method: 'PATCH', body: JSON.stringify({ active: !it.active }) }); load(); }
    catch (e) { toast.error(e.message); }
  };
  const rename = async (it) => {
    const v = prompt('Nama baru:', it.nama); if (!v) return;
    try { await tjApi(`masters/${it.id}`, { method: 'PATCH', body: JSON.stringify({ nama: v }) }); load(); }
    catch (e) { toast.error(e.message); }
  };
  const groups = ['pair', 'tf', 'metode'];
  const labels = { pair: 'Pair', tf: 'Time Frame', metode: 'Metode' };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Master Data</CardTitle><CardDescription>Kelola pilihan dropdown untuk Journal.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div><Label className="text-xs">Jenis</Label><Select value={kind} onValueChange={setKind}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pair">Pair</SelectItem><SelectItem value="tf">Time Frame</SelectItem><SelectItem value="metode">Metode</SelectItem></SelectContent></Select></div>
          <div className="flex-1 min-w-[200px]"><Label className="text-xs">Nama</Label><Input value={nama} onChange={(e) => setNama(e.target.value)} className="h-8" placeholder={kind === 'pair' ? 'EURUSD' : kind === 'tf' ? 'H1' : 'Break of Structure'} /></div>
          <Button size="sm" onClick={add} className="gap-1 h-8"><Plus className="w-3.5 h-3.5" /> Tambah</Button>
        </div>
        {loading ? <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {groups.map((g) => {
              const list = items.filter((x) => x.kind === g);
              return (
                <div key={g} className="border border-white/10 rounded-lg p-2">
                  <div className="text-[11px] uppercase text-muted-foreground font-semibold mb-2">{labels[g]} ({list.length})</div>
                  <div className="space-y-1">
                    {list.length === 0 ? <div className="text-[11px] text-muted-foreground italic">—</div> : list.map((it) => (
                      <div key={it.id} className="flex items-center justify-between text-xs p-1 rounded hover:bg-white/[0.02]">
                        <span className={it.active === false ? 'line-through text-muted-foreground' : ''}>{it.nama}</span>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => rename(it)}><Pencil className="w-3 h-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => toggle(it)}><X className={`w-3 h-3 ${it.active === false ? 'text-emerald-400' : 'text-rose-400'}`} /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// COMPOUNDING
// ============================================================================
function CompoundingView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState('');
  const load = async () => {
    setLoading(true);
    try { const d = await tjApi('compounding'); setData(d); setModal(String(d.config.modal_awal || 0)); }
    catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    try { await tjApi('compounding', { method: 'PUT', body: JSON.stringify({ modal_awal: Number(modal) || 0 }) }); toast.success('Modal awal disimpan'); load(); }
    catch (e) { toast.error(e.message); }
  };
  if (loading || !data) return <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader><CardTitle className="text-base">Compounding</CardTitle><CardDescription>Otomatis dari Trading Journal (hanya trade dengan hasil TP/SL & Hasil Trade ($) terisi).</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px]"><Label className="text-xs">Modal Awal ($)</Label><Input type="number" step="any" value={modal} onChange={(e) => setModal(e.target.value)} className="h-8" /></div>
            <Button size="sm" onClick={save} className="gap-1 h-8"><Save className="w-3.5 h-3.5" /> Simpan</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Modal Awal" v={fmtIDR(data.config.modal_awal)} />
            <StatCard label="Modal Saat Ini" v={fmtIDR(data.modal_saat_ini)} />
            <StatCard label={`Total P/L (${fmtNum(data.total_pct, 2)}%)`} v={fmtIDR(data.total_pl)} color={data.total_pl >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
            <StatCard label="Trade / W-L" v={`${data.jumlah_trade} · ${data.wins}W / ${data.losses}L`} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:text-muted-foreground">
                <th>#</th><th>Tgl</th><th>Nama Trade</th><th className="text-right">Modal Sebelum</th><th className="text-right">Hasil</th><th className="text-right">%</th><th className="text-right">Modal Setelah</th>
              </tr></thead>
              <tbody>
                {data.rows.length === 0 ? <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">Belum ada trade selesai.</td></tr> : data.rows.map((r) => (
                  <tr key={r.trade_id} className="border-b border-white/5 [&>td]:py-1.5 [&>td]:px-2">
                    <td className="tabular-nums">{r.no}</td>
                    <td>{r.tanggal}</td>
                    <td className="font-medium">{r.nama}</td>
                    <td className="text-right tabular-nums">{fmtIDR(r.modal_sebelum)}</td>
                    <td className={`text-right tabular-nums ${r.hasil_trade >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtIDR(r.hasil_trade)}</td>
                    <td className={`text-right tabular-nums ${r.pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtNum(r.pct, 2)}%</td>
                    <td className="text-right tabular-nums font-semibold">{fmtIDR(r.modal_setelah)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
function StatCard({ label, v, color }) {
  return (
    <div className="border border-white/10 rounded p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color || ''}`}>{v}</div>
    </div>
  );
}

// ============================================================================
// ANALYTICS + EXPORT
// ============================================================================
function AnalyticsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const d = await tjApi('analytics'); setData(d); }
    catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const doExport = (format) => {
    const base = process.env.NEXT_PUBLIC_BASE_URL || '';
    const token = localStorage.getItem('cc_token') || '';
    // Simple download via fetch → blob.
    fetch(`${base}/api/tj/export?format=${format}`, { headers: { Authorization: `Bearer ${token}` }})
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trading_journal.${format === 'csv' ? 'csv' : 'json'}`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };
  if (loading || !data) return <div className="py-6 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Memuat…</div>;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div><CardTitle className="text-base">Analytics</CardTitle><CardDescription>Historical performance dari semua trade selesai.</CardDescription></div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => doExport('csv')} className="gap-1"><Download className="w-3.5 h-3.5" /> CSV</Button>
            <Button size="sm" variant="outline" onClick={() => doExport('json')} className="gap-1"><Download className="w-3.5 h-3.5" /> JSON</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Trade" v={data.total_trades} />
            <StatCard label="Win Rate" v={`${fmtNum(data.win_rate, 1)}%`} color="text-emerald-300" />
            <StatCard label="Loss Rate" v={`${fmtNum(data.loss_rate, 1)}%`} color="text-rose-300" />
            <StatCard label="Net P/L" v={fmtIDR(data.net)} color={data.net >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
            <StatCard label="Avg R" v={fmtNum(data.avg_r, 2)} />
            <StatCard label="Expectancy" v={fmtNum(data.expectancy, 2)} />
            <StatCard label="Profit Factor" v={data.profit_factor == null ? '—' : fmtNum(data.profit_factor, 2)} />
            <StatCard label="Max Drawdown" v={`${fmtNum(data.max_drawdown_pct, 2)}%`} />
            <StatCard label="Max Win Streak" v={data.max_consecutive_wins} />
            <StatCard label="Max Loss Streak" v={data.max_consecutive_losses} />
            <StatCard label="Avg Durasi (menit)" v={fmtNum(data.avg_duration_minutes, 0)} />
          </div>
          {[
            ['Per Pair', data.by_pair],
            ['Per Time Frame', data.by_tf],
            ['Per Metode', data.by_metode],
          ].map(([title, rows]) => (
            <Card key={title}>
              <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left border-b border-white/10 [&>th]:py-2 [&>th]:px-2 [&>th]:text-[10px] [&>th]:uppercase [&>th]:text-muted-foreground">
                    <th>{title.replace('Per ', '')}</th><th className="text-right">n</th><th className="text-right">Wins</th><th className="text-right">Win Rate</th><th className="text-right">P/L</th>
                  </tr></thead>
                  <tbody>
                    {rows.length === 0 ? <tr><td colSpan={5} className="py-3 text-center text-muted-foreground">—</td></tr> : rows.map((r) => (
                      <tr key={r.key} className="border-b border-white/5 [&>td]:py-1 [&>td]:px-2">
                        <td className="font-medium">{r.key}</td>
                        <td className="text-right tabular-nums">{r.n}</td>
                        <td className="text-right tabular-nums">{r.wins}</td>
                        <td className="text-right tabular-nums">{fmtNum(r.win_rate, 1)}%</td>
                        <td className={`text-right tabular-nums ${r.pl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtIDR(r.pl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
