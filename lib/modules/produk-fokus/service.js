/**
 * MODULE: Produk Fokus (MANDIRI, terisolasi).
 * ============================================================================
 * Collections (semua prefix `pf_` supaya jelas terpisah):
 *   - pf_masters      : Master Produk Fokus per periode (owner-managed).
 *   - pf_pengajuan    : Pengajuan Produk Fokus dari staff.
 *   - pf_penjualan    : Transaksi penjualan (immutable — tak boleh edit/hapus).
 *   - pf_rekonsiliasi : Total POS per (period_key, master_id) yang di-input owner.
 *
 * Periode: 26 bulan sebelumnya → 25 bulan berjalan. Reuse konstanta yang
 * cerminan Payroll. Periode pertama = 2026-09 (26 Agu 2026 → 25 Sep 2026).
 *
 * TIDAK menyentuh collection MIS lain (employees, absensi_records, payroll_*,
 * cycle_count, om_*, faktur_*). Modul ini benar-benar berdiri sendiri.
 */

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const PF_FIRST_PERIOD_KEY = '2026-09'; // 26 Agu 2026 → 25 Sep 2026

// ---- Period helpers (26→25) ----
function pfPeriodRange(periodKey) {
  const m = String(periodKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  if (periodKey < PF_FIRST_PERIOD_KEY) return null;
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
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  if (d >= 26) {
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return `${ny}-${String(nm).padStart(2, '0')}`;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function pfPrevPeriodKey(key) {
  const [y, m] = key.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, '0')}`;
}
function listPfPeriods() {
  const latest = pfActivePeriodKey();
  if (latest < PF_FIRST_PERIOD_KEY) return [];
  const out = [];
  let k = latest;
  for (let i = 0; i < 240 && k >= PF_FIRST_PERIOD_KEY; i++) {
    const r = pfPeriodRange(k);
    if (!r) break;
    out.push({ period_key: k, from: r.from, to: r.to });
    k = pfPrevPeriodKey(k);
  }
  return out;
}

// ---- Small utils ----
const j = (data, init = {}) => NextResponse.json(data, init);
const err = (msg, status = 400) => NextResponse.json({ error: msg }, { status });
const s = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const n = (v) => Number(v || 0);
const isOwner = (u) => u?.role === 'owner';
const isPeriodKey = (v) => /^\d{4}-\d{2}$/.test(String(v || ''));

// Normalize a master doc for API response.
function serMaster(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}
function serPengajuan(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

// ============================================================================
// Router
// ============================================================================
export async function handleProdukFokusRequest(req, subPath, method, ctx) {
  const { db, user } = ctx;
  const url = new URL(req.url);

  // ---- PERIODS: daftar periode 26→25 (mulai PF_FIRST_PERIOD_KEY) ----
  if (subPath === 'periods' && method === 'GET') {
    return j({ periods: listPfPeriods(), first_period_key: PF_FIRST_PERIOD_KEY });
  }

  // ============================================================
  // MASTERS
  // ============================================================
  if (subPath === 'masters' && method === 'GET') {
    const period = String(url.searchParams.get('period') || '').trim();
    if (!isPeriodKey(period)) return err('period wajib (YYYY-MM)');
    const items = await db.collection('pf_masters')
      .find({ period_key: period })
      .sort({ createdAt: 1 })
      .project({ _id: 0 })
      .toArray();
    return j({ items });
  }

  if (subPath === 'masters' && method === 'POST') {
    if (!isOwner(user)) return err('hanya owner', 403);
    const body = await req.json().catch(() => ({}));
    const period_key = String(body.period_key || '').trim();
    if (!isPeriodKey(period_key)) return err('period_key wajib');
    if (period_key < PF_FIRST_PERIOD_KEY) return err(`period ${period_key} sebelum periode pertama (${PF_FIRST_PERIOD_KEY})`);
    const kode = s(body.kode, 40);
    const nama = s(body.nama, 200);
    if (!kode || !nama) return err('Kode dan Nama Produk wajib');
    const jumlah_type = body.jumlah_type === 'unlimited' ? 'unlimited' : 'limited';
    const jumlah_max = jumlah_type === 'limited' ? Math.max(0, Math.floor(n(body.jumlah_max))) : null;
    if (jumlah_type === 'limited' && !(jumlah_max > 0)) return err('Jumlah harus > 0 untuk tipe Terbatas');
    const bonus = Math.max(0, n(body.bonus));
    const keterangan = s(body.keterangan, 500);
    // Duplicate kode dalam periode yang sama → tolak.
    const dup = await db.collection('pf_masters').findOne({ period_key, kode });
    if (dup) return err(`Kode "${kode}" sudah ada di periode ini`, 409);
    const doc = {
      id: uuidv4(),
      period_key,
      kode,
      nama,
      satuan: s(body.satuan, 20) || 'pcs',
      jumlah_type,
      jumlah_max, // null untuk unlimited
      bonus,
      keterangan,
      source_pengajuan_id: body.source_pengajuan_id ? s(body.source_pengajuan_id, 60) : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('pf_masters').insertOne(doc);
    return j({ item: serMaster(doc) });
  }

  if (subPath.startsWith('masters/') && (method === 'PATCH' || method === 'PUT')) {
    if (!isOwner(user)) return err('hanya owner', 403);
    const id = subPath.slice('masters/'.length);
    const cur = await db.collection('pf_masters').findOne({ id });
    if (!cur) return err('Master tidak ditemukan', 404);
    const body = await req.json().catch(() => ({}));
    const upd = { updatedAt: new Date() };
    if (body.kode != null) {
      const kode = s(body.kode, 40);
      if (!kode) return err('Kode tidak boleh kosong');
      if (kode !== cur.kode) {
        const dup = await db.collection('pf_masters').findOne({ period_key: cur.period_key, kode, id: { $ne: id } });
        if (dup) return err(`Kode "${kode}" sudah ada di periode ini`, 409);
        upd.kode = kode;
      }
    }
    if (body.nama != null) {
      const nama = s(body.nama, 200);
      if (!nama) return err('Nama tidak boleh kosong');
      upd.nama = nama;
    }
    if (body.satuan != null) upd.satuan = s(body.satuan, 20) || 'pcs';
    if (body.jumlah_type != null) {
      upd.jumlah_type = body.jumlah_type === 'unlimited' ? 'unlimited' : 'limited';
    }
    if (body.jumlah_max != null || (upd.jumlah_type === 'limited' && body.jumlah_max === undefined)) {
      const effType = upd.jumlah_type || cur.jumlah_type;
      if (effType === 'unlimited') upd.jumlah_max = null;
      else {
        const v = Math.max(0, Math.floor(n(body.jumlah_max ?? cur.jumlah_max)));
        if (!(v > 0)) return err('Jumlah harus > 0 untuk tipe Terbatas');
        upd.jumlah_max = v;
      }
    } else if (upd.jumlah_type === 'unlimited') {
      upd.jumlah_max = null;
    }
    if (body.bonus != null) upd.bonus = Math.max(0, n(body.bonus));
    if (body.keterangan != null) upd.keterangan = s(body.keterangan, 500);
    await db.collection('pf_masters').updateOne({ id }, { $set: upd });
    const next = await db.collection('pf_masters').findOne({ id }, { projection: { _id: 0 } });
    return j({ item: next });
  }

  if (subPath.startsWith('masters/') && method === 'DELETE') {
    if (!isOwner(user)) return err('hanya owner', 403);
    const id = subPath.slice('masters/'.length);
    const cur = await db.collection('pf_masters').findOne({ id });
    if (!cur) return err('Master tidak ditemukan', 404);
    // Blokir jika sudah ada penjualan untuk master ini.
    const usedCount = await db.collection('pf_penjualan').countDocuments({ master_id: id });
    if (usedCount > 0) {
      return err(`Master sudah dipakai di ${usedCount} transaksi penjualan — tidak bisa dihapus. Silakan koreksi via Owner.`, 409);
    }
    await db.collection('pf_masters').deleteOne({ id });
    return j({ ok: true });
  }

  // Copy dari periode sebelumnya. Body: {period_key (target), source_ids?: [id...]}.
  // Bila source_ids kosong/tidak diberikan → copy SEMUA master dari periode sebelumnya.
  if (subPath === 'masters/copy-previous' && method === 'POST') {
    if (!isOwner(user)) return err('hanya owner', 403);
    const body = await req.json().catch(() => ({}));
    const period_key = String(body.period_key || '').trim();
    if (!isPeriodKey(period_key)) return err('period_key wajib');
    if (period_key < PF_FIRST_PERIOD_KEY) return err(`period ${period_key} sebelum periode pertama`);
    const prevKey = pfPrevPeriodKey(period_key);
    if (prevKey < PF_FIRST_PERIOD_KEY) return err('Belum ada periode sebelumnya untuk di-copy');
    const filter = { period_key: prevKey };
    if (Array.isArray(body.source_ids) && body.source_ids.length > 0) {
      filter.id = { $in: body.source_ids.map((x) => String(x)) };
    }
    const sources = await db.collection('pf_masters').find(filter).toArray();
    if (sources.length === 0) return j({ copied: 0, skipped: 0, items: [] });
    // Hindari duplikat kode di target period.
    const existing = await db.collection('pf_masters')
      .find({ period_key })
      .project({ kode: 1, _id: 0 })
      .toArray();
    const existingKodes = new Set(existing.map((x) => x.kode));
    const now = new Date();
    const toInsert = [];
    let skipped = 0;
    for (const src of sources) {
      if (existingKodes.has(src.kode)) { skipped += 1; continue; }
      toInsert.push({
        id: uuidv4(),
        period_key,
        kode: src.kode,
        nama: src.nama,
        satuan: src.satuan || 'pcs',
        jumlah_type: src.jumlah_type,
        jumlah_max: src.jumlah_max,
        bonus: src.bonus,
        keterangan: src.keterangan || '',
        source_pengajuan_id: null,
        copied_from_period: prevKey,
        createdAt: now,
        updatedAt: now,
      });
      existingKodes.add(src.kode);
    }
    if (toInsert.length > 0) await db.collection('pf_masters').insertMany(toInsert);
    return j({ copied: toInsert.length, skipped, items: toInsert.map(serMaster) });
  }

  // ============================================================
  // PENGAJUAN
  // ============================================================
  if (subPath === 'pengajuan' && method === 'GET') {
    const period = String(url.searchParams.get('period') || '').trim();
    if (!isPeriodKey(period)) return err('period wajib (YYYY-MM)');
    const filter = { period_key: period };
    if (!isOwner(user)) filter.submitted_by = user.id;
    const items = await db.collection('pf_pengajuan')
      .find(filter)
      .sort({ createdAt: -1 })
      .project({ _id: 0 })
      .toArray();
    return j({ items });
  }

  if (subPath === 'pengajuan' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const period_key = String(body.period_key || '').trim();
    if (!isPeriodKey(period_key)) return err('period_key wajib');
    if (period_key < PF_FIRST_PERIOD_KEY) return err(`period ${period_key} sebelum periode pertama`);
    const kode = s(body.kode, 40);
    const nama = s(body.nama, 200);
    const jumlah = Math.max(0, Math.floor(n(body.jumlah)));
    if (!kode || !nama) return err('Kode dan Nama Produk wajib');
    if (!(jumlah > 0)) return err('Jumlah harus > 0');
    const doc = {
      id: uuidv4(),
      period_key,
      kode,
      nama,
      jumlah,
      satuan: s(body.satuan, 20) || 'pcs',
      submitted_by: user.id,
      submitted_by_name: user.name || user.username || '',
      status: 'menunggu', // 'menunggu' | 'diterima' | 'ditolak'
      reviewed_by: null,
      reviewed_by_name: null,
      reviewed_at: null,
      review_note: '',
      createdAt: new Date(),
    };
    await db.collection('pf_pengajuan').insertOne(doc);
    return j({ item: serPengajuan(doc) });
  }

  // PATCH /pengajuan/:id — owner accept/reject; submitter tidak bisa edit
  // (immutable pengajuan setelah dibuat, sesuai flow simple).
  if (subPath.startsWith('pengajuan/') && method === 'PATCH') {
    if (!isOwner(user)) return err('hanya owner', 403);
    const id = subPath.slice('pengajuan/'.length);
    const cur = await db.collection('pf_pengajuan').findOne({ id });
    if (!cur) return err('Pengajuan tidak ditemukan', 404);
    if (cur.status !== 'menunggu') return err(`Pengajuan sudah ${cur.status}, tidak bisa diubah lagi`, 409);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();
    if (action !== 'accept' && action !== 'reject') return err("action wajib: 'accept' atau 'reject'");
    const upd = {
      status: action === 'accept' ? 'diterima' : 'ditolak',
      reviewed_by: user.id,
      reviewed_by_name: user.name || user.username || '',
      reviewed_at: new Date(),
      review_note: s(body.review_note, 300),
    };
    let masterCreated = null;
    if (action === 'accept') {
      // Otomatis jadi Master Produk Fokus periode aktif — kecuali sudah ada kode
      // yang sama, skip create (owner bisa edit master via panel Master).
      const dup = await db.collection('pf_masters').findOne({ period_key: cur.period_key, kode: cur.kode });
      if (!dup) {
        const masterDoc = {
          id: uuidv4(),
          period_key: cur.period_key,
          kode: cur.kode,
          nama: cur.nama,
          satuan: cur.satuan || 'pcs',
          jumlah_type: 'limited',
          jumlah_max: cur.jumlah,
          bonus: 0, // owner atur bonus manual setelah accept
          keterangan: `Dari pengajuan ${cur.submitted_by_name || ''}`.trim(),
          source_pengajuan_id: cur.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await db.collection('pf_masters').insertOne(masterDoc);
        masterCreated = serMaster(masterDoc);
        upd.created_master_id = masterDoc.id;
      } else {
        upd.created_master_id = dup.id;
      }
    }
    await db.collection('pf_pengajuan').updateOne({ id }, { $set: upd });
    const next = await db.collection('pf_pengajuan').findOne({ id }, { projection: { _id: 0 } });
    return j({ item: next, master: masterCreated });
  }

  // DELETE /pengajuan/:id — hanya submitter atau owner.
  if (subPath.startsWith('pengajuan/') && method === 'DELETE') {
    const id = subPath.slice('pengajuan/'.length);
    const cur = await db.collection('pf_pengajuan').findOne({ id });
    if (!cur) return err('Pengajuan tidak ditemukan', 404);
    if (!isOwner(user) && cur.submitted_by !== user.id) return err('Bukan pemilik pengajuan', 403);
    await db.collection('pf_pengajuan').deleteOne({ id });
    return j({ ok: true });
  }

  // ============================================================
  // STAFF LIST — sumber "Pilih Nama Staff" pada input penjualan.
  // Reuse `employees` (User Management existing). Endpoint ini ringan,
  // hanya expose id + name untuk seluruh staff aktif (non-owner).
  // ============================================================
  if (subPath === 'staff-list' && method === 'GET') {
    const rows = await db.collection('employees')
      .find({ role: { $ne: 'owner' }, status: { $ne: 'inactive' } })
      .project({ _id: 0, id: 1, name: 1 })
      .sort({ name: 1 })
      .toArray();
    return j({ items: rows });
  }

  // ============================================================
  // PENJUALAN (immutable transactions)
  // ============================================================
  // GET /penjualan?period=YYYY-MM
  // - Owner: seluruh transaksi
  // - Staff: hanya transaksi milik dirinya (staff_id === user.id)
  if (subPath === 'penjualan' && method === 'GET') {
    const period = String(url.searchParams.get('period') || '').trim();
    if (!isPeriodKey(period)) return err('period wajib (YYYY-MM)');
    const filter = { period_key: period };
    if (!isOwner(user)) filter.staff_id = user.id;
    const items = await db.collection('pf_penjualan')
      .find(filter)
      .sort({ createdAt: -1 })
      .project({ _id: 0 })
      .limit(2000)
      .toArray();
    return j({ items });
  }

  // POST /penjualan
  // Aturan (dikonfirmasi user):
  //  - Hanya periode aktif berjalan yang boleh (server enforces via active key).
  //  - Qty bilangan bulat positif (>0). Tidak boleh 0/negatif/desimal.
  //  - Master tipe limited: total penjualan (semua staff) NAIK oleh qty ini
  //    tidak boleh melebihi jumlah_max → jika melewati, TOLAK (409).
  //  - Immutable: tidak ada PATCH/DELETE untuk pf_penjualan.
  //  - staff_id: bila body.staff_id kosong → default user.id.
  if (subPath === 'penjualan' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const activeKey = pfActivePeriodKey();
    const master_id = s(body.master_id, 60);
    if (!master_id) return err('master_id wajib');
    const qtyRaw = n(body.qty);
    if (!Number.isFinite(qtyRaw) || qtyRaw <= 0 || !Number.isInteger(qtyRaw)) {
      return err('Qty harus bilangan bulat positif (>0)');
    }
    const qty = Math.floor(qtyRaw);
    const master = await db.collection('pf_masters').findOne({ id: master_id });
    if (!master) return err('Master produk tidak ditemukan', 404);
    // Enforce: hanya periode aktif berjalan.
    if (master.period_key !== activeKey) {
      return err(`Hanya boleh input untuk periode aktif (${activeKey}). Master ini milik periode ${master.period_key}.`, 409);
    }
    // Staff id: bila diberikan (misal owner input untuk staff X), validasi.
    let staff_id = s(body.staff_id, 60);
    let staff_name = '';
    if (staff_id) {
      const staff = await db.collection('employees').findOne({ id: staff_id, status: { $ne: 'inactive' } });
      if (!staff) return err('Staff tidak ditemukan / non-aktif', 404);
      if (staff.role === 'owner') return err('Owner tidak dapat dipilih sebagai staff penjualan', 400);
      staff_name = staff.name || '';
    } else {
      staff_id = user.id;
      staff_name = user.name || user.username || '';
    }
    // Limit check untuk tipe limited.
    if (master.jumlah_type === 'limited') {
      const soldAgg = await db.collection('pf_penjualan').aggregate([
        { $match: { master_id, period_key: master.period_key } },
        { $group: { _id: null, total: { $sum: '$qty' } } },
      ]).toArray();
      const soldTotal = soldAgg[0]?.total || 0;
      const sisa = Math.max(0, Number(master.jumlah_max || 0) - soldTotal);
      if (sisa <= 0) return err(`Produk "${master.nama}" sudah habis (kuota 0). Tidak bisa input lagi.`, 409);
      if (qty > sisa) return err(`Qty ${qty} melebihi sisa kuota (${sisa}). Silakan input maks ${sisa}.`, 409);
    }
    const doc = {
      id: uuidv4(),
      period_key: master.period_key,
      master_id,
      kode: master.kode,
      nama: master.nama,
      satuan: master.satuan || 'pcs',
      bonus_unit: Number(master.bonus || 0),
      staff_id,
      staff_name,
      qty,
      input_by: user.id,           // audit: siapa yang meng-input (bisa berbeda dari staff)
      input_by_name: user.name || user.username || '',
      createdAt: new Date(),
    };
    await db.collection('pf_penjualan').insertOne(doc);
    const { _id, ...rest } = doc;
    return j({ item: rest });
  }

  // DELETE /penjualan/:id — HANYA OWNER. Staff tidak bisa hapus.
  // Menghapus transaksi akan otomatis membebaskan kuota master (via
  // agregasi ulang di limit-check saat POST berikutnya).
  if (subPath.startsWith('penjualan/') && method === 'DELETE') {
    if (!isOwner(user)) return err('hanya owner yang boleh menghapus penjualan', 403);
    const id = subPath.slice('penjualan/'.length);
    const cur = await db.collection('pf_penjualan').findOne({ id });
    if (!cur) return err('Transaksi tidak ditemukan', 404);
    await db.collection('pf_penjualan').deleteOne({ id });
    return j({ ok: true });
  }

  // ============================================================
  // DASHBOARD — Staff (data dirinya) & Owner (agregat).
  // ============================================================
  if (subPath === 'dashboard/staff' && method === 'GET') {
    const period = String(url.searchParams.get('period') || pfActivePeriodKey()).trim();
    if (!isPeriodKey(period)) return err('period wajib');
    // Owner boleh pilih staff_id lain via query (?staff_id=...).
    let staff_id = user.id;
    if (isOwner(user) && url.searchParams.get('staff_id')) {
      staff_id = String(url.searchParams.get('staff_id'));
    }
    const [masters, salesRows, rekon] = await Promise.all([
      db.collection('pf_masters').find({ period_key: period }).project({ _id: 0 }).toArray(),
      db.collection('pf_penjualan').find({ period_key: period }).project({ _id: 0 }).toArray(),
      db.collection('pf_rekonsiliasi').find({ period_key: period }).project({ _id: 0 }).toArray(),
    ]);
    const diakuiByRow = computeQtyDiakuiIndex(salesRows, rekon);
    const rekonMap = new Map(rekon.map((r) => [r.master_id, r]));
    // Aggregate per master.
    const perMaster = new Map();
    for (const m of masters) {
      perMaster.set(m.id, {
        master: m,
        my_qty: 0,
        my_qty_diakui: 0,
        total_qty: 0,
        my_bonus: 0,
      });
    }
    for (const t of salesRows) {
      const p = perMaster.get(t.master_id);
      if (!p) continue;
      const q = Number(t.qty || 0);
      const qd = diakuiByRow.get(t.id) ?? q;
      p.total_qty += q;
      if (t.staff_id === staff_id) {
        p.my_qty += q;
        p.my_qty_diakui += qd;
        p.my_bonus += qd * Number(t.bonus_unit || 0);
      }
    }
    const rows = [];
    let total_my_qty = 0, total_my_qty_diakui = 0, total_my_bonus = 0;
    for (const [, v] of perMaster) {
      const m = v.master;
      const limit = m.jumlah_type === 'limited' ? Number(m.jumlah_max || 0) : null;
      const sisa = m.jumlah_type === 'limited' ? Math.max(0, limit - v.total_qty) : null;
      const progress = m.jumlah_type === 'limited' && limit > 0 ? Math.min(100, (v.total_qty / limit) * 100) : null;
      const r = rekonMap.get(m.id);
      rows.push({
        master_id: m.id,
        kode: m.kode,
        nama: m.nama,
        satuan: m.satuan,
        jumlah_type: m.jumlah_type,
        limit,
        bonus_unit: Number(m.bonus || 0),
        keterangan: m.keterangan || '',
        my_qty: v.my_qty,
        my_qty_diakui: v.my_qty_diakui,
        total_qty: v.total_qty,
        sisa,
        progress,
        my_bonus: Math.round(v.my_bonus),
        adjustment_pct: r ? Number(r.adjustment_pct || 1) : null,
      });
      total_my_qty += v.my_qty;
      total_my_qty_diakui += v.my_qty_diakui;
      total_my_bonus += v.my_bonus;
    }
    return j({ period, staff_id, rows, total_my_qty, total_my_qty_diakui, total_my_bonus: Math.round(total_my_bonus) });
  }

  if (subPath === 'dashboard/owner' && method === 'GET') {
    if (!isOwner(user)) return err('hanya owner', 403);
    const period = String(url.searchParams.get('period') || pfActivePeriodKey()).trim();
    if (!isPeriodKey(period)) return err('period wajib');
    const [masters, sales, pengajuan, rekon] = await Promise.all([
      db.collection('pf_masters').find({ period_key: period }).project({ _id: 0 }).toArray(),
      db.collection('pf_penjualan').find({ period_key: period }).project({ _id: 0 }).toArray(),
      db.collection('pf_pengajuan').find({ period_key: period }).project({ _id: 0 }).toArray(),
      db.collection('pf_rekonsiliasi').find({ period_key: period }).project({ _id: 0 }).toArray(),
    ]);
    // Terapkan penyesuaian qty_diakui (Rekonsiliasi POS).
    const diakuiByRow = computeQtyDiakuiIndex(sales, rekon);
    // Per produk.
    const byMaster = new Map();
    for (const m of masters) byMaster.set(m.id, { master: m, qty: 0, qty_diakui: 0, bonus: 0 });
    // Per staff.
    const byStaff = new Map();
    let grand_qty = 0, grand_qty_diakui = 0, grand_bonus = 0;
    for (const t of sales) {
      const q = Number(t.qty || 0);
      const qd = diakuiByRow.get(t.id) ?? q;
      const bo = qd * Number(t.bonus_unit || 0);
      grand_qty += q; grand_qty_diakui += qd; grand_bonus += bo;
      const pm = byMaster.get(t.master_id);
      if (pm) { pm.qty += q; pm.qty_diakui += qd; pm.bonus += bo; }
      const key = t.staff_id;
      const staffEntry = byStaff.get(key) || { staff_id: key, staff_name: t.staff_name || '(unknown)', qty: 0, qty_diakui: 0, bonus: 0 };
      staffEntry.qty += q; staffEntry.qty_diakui += qd; staffEntry.bonus += bo;
      byStaff.set(key, staffEntry);
    }
    const rekonMap = new Map(rekon.map((r) => [r.master_id, r]));
    const per_produk = Array.from(byMaster.values()).map((v) => {
      const m = v.master;
      const limit = m.jumlah_type === 'limited' ? Number(m.jumlah_max || 0) : null;
      const sisa = m.jumlah_type === 'limited' ? Math.max(0, limit - v.qty) : null;
      const progress = m.jumlah_type === 'limited' && limit > 0 ? Math.min(100, (v.qty / limit) * 100) : null;
      const r = rekonMap.get(m.id);
      return {
        master_id: m.id, kode: m.kode, nama: m.nama, satuan: m.satuan,
        jumlah_type: m.jumlah_type, limit, bonus_unit: Number(m.bonus || 0),
        qty: v.qty, qty_diakui: v.qty_diakui,
        sisa, progress, bonus: Math.round(v.bonus),
        pos_total: r ? Number(r.pos_total || 0) : null,
        adjustment_pct: r ? Number(r.adjustment_pct || 1) : null,
      };
    });
    const per_staff = Array.from(byStaff.values()).map((s) => ({ ...s, bonus: Math.round(s.bonus) }))
      .sort((a, b) => b.bonus - a.bonus);
    // Pengajuan counts.
    const pengajuanStats = { menunggu: 0, diterima: 0, ditolak: 0 };
    for (const p of pengajuan) if (pengajuanStats[p.status] != null) pengajuanStats[p.status] += 1;
    return j({
      period,
      grand_qty,
      grand_qty_diakui,
      grand_bonus: Math.round(grand_bonus),
      per_produk,
      per_staff,
      pengajuan_stats: pengajuanStats,
      pengajuan_menunggu_list: pengajuan.filter((p) => p.status === 'menunggu'),
    });
  }

  // ============================================================
  // REKONSILIASI POS (Owner only)
  // ============================================================
  // GET /rekonsiliasi?period=YYYY-MM
  // Returns per master: MIS total, POS total (owner input), adjustment_pct,
  // dan detail per-staff qty_input & qty_diakui.
  if (subPath === 'rekonsiliasi' && method === 'GET') {
    if (!isOwner(user)) return err('hanya owner', 403);
    const period = String(url.searchParams.get('period') || pfActivePeriodKey()).trim();
    if (!isPeriodKey(period)) return err('period wajib');
    const [masters, sales, rekon] = await Promise.all([
      db.collection('pf_masters').find({ period_key: period }).project({ _id: 0 }).toArray(),
      db.collection('pf_penjualan').find({ period_key: period }).project({ _id: 0 }).toArray(),
      db.collection('pf_rekonsiliasi').find({ period_key: period }).project({ _id: 0 }).toArray(),
    ]);
    const rekonMap = new Map(rekon.map((r) => [r.master_id, r]));
    const diakuiByRow = computeQtyDiakuiIndex(sales, rekon);
    // Group sales per master + per staff.
    const items = masters.map((m) => {
      const misTotal = sales.filter((s) => s.master_id === m.id).reduce((sum, s) => sum + Number(s.qty || 0), 0);
      const r = rekonMap.get(m.id);
      const pos_total = r ? Number(r.pos_total || 0) : null;
      const adjustment_pct = r ? Number(r.adjustment_pct || 1) : 1;
      const perStaffMap = new Map();
      for (const t of sales.filter((x) => x.master_id === m.id)) {
        const cur = perStaffMap.get(t.staff_id) || { staff_id: t.staff_id, staff_name: t.staff_name, qty_input: 0, qty_diakui: 0 };
        cur.qty_input += Number(t.qty || 0);
        cur.qty_diakui += diakuiByRow.get(t.id) ?? Number(t.qty || 0);
        perStaffMap.set(t.staff_id, cur);
      }
      const per_staff = Array.from(perStaffMap.values()).map((x) => ({
        ...x,
        bonus: Math.round(x.qty_diakui * Number(m.bonus || 0)),
      }));
      const total_diakui = per_staff.reduce((s, x) => s + x.qty_diakui, 0);
      return {
        master_id: m.id,
        kode: m.kode,
        nama: m.nama,
        satuan: m.satuan,
        jumlah_type: m.jumlah_type,
        jumlah_max: m.jumlah_max,
        bonus_unit: Number(m.bonus || 0),
        mis_total: misTotal,
        pos_total,
        adjustment_pct,
        total_diakui,
        per_staff,
        updated_at: r?.updatedAt || null,
        updated_by_name: r?.updated_by_name || null,
      };
    });
    return j({ period, items });
  }

  // PUT /rekonsiliasi — body: { period_key, entries: [{master_id, pos_total}] }.
  // Owner boleh update pos_total kapan saja (termasuk periode aktif).
  // Nilai `null`/kosong → hapus entry (reset ke MIS).
  if (subPath === 'rekonsiliasi' && method === 'PUT') {
    if (!isOwner(user)) return err('hanya owner', 403);
    const body = await req.json().catch(() => ({}));
    const period_key = String(body.period_key || '').trim();
    if (!isPeriodKey(period_key)) return err('period_key wajib');
    if (period_key < PF_FIRST_PERIOD_KEY) return err(`period ${period_key} sebelum periode pertama`);
    if (!Array.isArray(body.entries)) return err('entries wajib array');
    const now = new Date();
    for (const e of body.entries) {
      const master_id = s(e?.master_id, 60);
      if (!master_id) continue;
      const master = await db.collection('pf_masters').findOne({ id: master_id, period_key });
      if (!master) continue; // silently skip unknown
      const posRaw = e?.pos_total;
      if (posRaw == null || posRaw === '') {
        // Reset: hapus rekon entry.
        await db.collection('pf_rekonsiliasi').deleteOne({ period_key, master_id });
        continue;
      }
      const posTotal = Math.max(0, Math.floor(n(posRaw)));
      // Hitung MIS total.
      const misAgg = await db.collection('pf_penjualan').aggregate([
        { $match: { master_id, period_key } },
        { $group: { _id: null, total: { $sum: '$qty' } } },
      ]).toArray();
      const misTotal = misAgg[0]?.total || 0;
      // Rule: POS >= MIS → tidak ada penyesuaian (adjustment_pct = 1).
      //       POS <  MIS → adjustment_pct = pos/mis.
      const adjustmentPct = misTotal > 0 && posTotal < misTotal ? posTotal / misTotal : 1;
      await db.collection('pf_rekonsiliasi').updateOne(
        { period_key, master_id },
        {
          $set: {
            period_key,
            master_id,
            kode: master.kode,
            nama: master.nama,
            bonus_unit: Number(master.bonus || 0),
            pos_total: posTotal,
            mis_total_at_update: misTotal,
            adjustment_pct: adjustmentPct,
            updatedAt: now,
            updated_by: user.id,
            updated_by_name: user.name || user.username || '',
          },
          $setOnInsert: { id: uuidv4(), createdAt: now },
        },
        { upsert: true },
      );
    }
    // Return updated view.
    const [masters, sales, rekon] = await Promise.all([
      db.collection('pf_masters').find({ period_key }).project({ _id: 0 }).toArray(),
      db.collection('pf_penjualan').find({ period_key }).project({ _id: 0 }).toArray(),
      db.collection('pf_rekonsiliasi').find({ period_key }).project({ _id: 0 }).toArray(),
    ]);
    const rekonMap = new Map(rekon.map((r) => [r.master_id, r]));
    const items = masters.map((m) => {
      const misTotal = sales.filter((x) => x.master_id === m.id).reduce((s, x) => s + Number(x.qty || 0), 0);
      const r = rekonMap.get(m.id);
      return {
        master_id: m.id, kode: m.kode, nama: m.nama, bonus_unit: Number(m.bonus || 0),
        mis_total: misTotal,
        pos_total: r ? Number(r.pos_total || 0) : null,
        adjustment_pct: r ? Number(r.adjustment_pct || 1) : 1,
        updated_at: r?.updatedAt || null,
      };
    });
    return j({ period: period_key, items, ok: true });
  }

  // ============================================================
  // HISTORI (Owner only) — snapshot lengkap 1 periode.
  // ============================================================
  if (subPath === 'histori' && method === 'GET') {
    if (!isOwner(user)) return err('hanya owner', 403);
    const period = String(url.searchParams.get('period') || '').trim();
    if (!isPeriodKey(period)) return err('period wajib');
    const [masters, pengajuan, sales, rekon] = await Promise.all([
      db.collection('pf_masters').find({ period_key: period }).project({ _id: 0 }).sort({ createdAt: 1 }).toArray(),
      db.collection('pf_pengajuan').find({ period_key: period }).project({ _id: 0 }).sort({ createdAt: -1 }).toArray(),
      db.collection('pf_penjualan').find({ period_key: period }).project({ _id: 0 }).sort({ createdAt: -1 }).toArray(),
      db.collection('pf_rekonsiliasi').find({ period_key: period }).project({ _id: 0 }).toArray(),
    ]);
    const diakuiByRow = computeQtyDiakuiIndex(sales, rekon);
    // Attach qty_diakui + bonus_estimate ke tiap sale row.
    const salesEnriched = sales.map((s) => ({
      ...s,
      qty_diakui: diakuiByRow.get(s.id) ?? Number(s.qty || 0),
      bonus_estimate: Math.round((diakuiByRow.get(s.id) ?? Number(s.qty || 0)) * Number(s.bonus_unit || 0)),
    }));
    // Rekap per staff (bonus final).
    const byStaff = new Map();
    for (const t of salesEnriched) {
      const cur = byStaff.get(t.staff_id) || { staff_id: t.staff_id, staff_name: t.staff_name, qty: 0, qty_diakui: 0, bonus: 0 };
      cur.qty += Number(t.qty || 0);
      cur.qty_diakui += Number(t.qty_diakui || 0);
      cur.bonus += Number(t.bonus_estimate || 0);
      byStaff.set(t.staff_id, cur);
    }
    const rekap_per_staff = Array.from(byStaff.values()).sort((a, b) => b.bonus - a.bonus);
    return j({
      period,
      masters,
      pengajuan,
      penjualan: salesEnriched,
      rekonsiliasi: rekon,
      rekap_per_staff,
      totals: {
        qty: salesEnriched.reduce((s, x) => s + Number(x.qty || 0), 0),
        qty_diakui: salesEnriched.reduce((s, x) => s + Number(x.qty_diakui || 0), 0),
        bonus: salesEnriched.reduce((s, x) => s + Number(x.bonus_estimate || 0), 0),
      },
    });
  }

  return null; // 404 fallthrough
}

// ============================================================================
// Helper: qty_diakui per sale row.
// ============================================================================
// Distribusi proporsional (opsi b): floor(qty × pct) per row; sisa kekurangan
// (target - sum(floor)) dibulatkan naik untuk row dengan qty_input TERBESAR.
// Bila POS >= MIS → adjustment_pct = 1 → qty_diakui = qty_input (tanpa penyesuaian).
function computeQtyDiakuiIndex(sales, rekon) {
  const out = new Map(); // sale.id → qty_diakui
  const rekonByMaster = new Map(rekon.map((r) => [r.master_id, r]));
  // Group sales by master_id.
  const byMaster = new Map();
  for (const t of sales) {
    if (!byMaster.has(t.master_id)) byMaster.set(t.master_id, []);
    byMaster.get(t.master_id).push(t);
  }
  for (const [mid, rows] of byMaster) {
    const r = rekonByMaster.get(mid);
    const pct = r ? Number(r.adjustment_pct || 1) : 1;
    if (pct >= 1) {
      // Tidak ada penyesuaian (POS>=MIS atau tidak ada rekon).
      for (const t of rows) out.set(t.id, Number(t.qty || 0));
      continue;
    }
    const misTotal = rows.reduce((s, x) => s + Number(x.qty || 0), 0);
    const target = Math.max(0, Math.floor(Number(r.pos_total || 0)));
    if (misTotal <= 0 || target >= misTotal) {
      for (const t of rows) out.set(t.id, Number(t.qty || 0));
      continue;
    }
    // Floor pass.
    const floored = rows.map((t) => ({ id: t.id, qty: Number(t.qty || 0), diakui: Math.floor(Number(t.qty || 0) * pct) }));
    let assigned = floored.reduce((s, x) => s + x.diakui, 0);
    let remainder = target - assigned;
    // Distribute remainder to rows with largest qty first (desc).
    floored.sort((a, b) => b.qty - a.qty || 0);
    let idx = 0;
    while (remainder > 0 && idx < floored.length) {
      // Jangan melebihi qty_input asli.
      if (floored[idx].diakui < floored[idx].qty) {
        floored[idx].diakui += 1;
        remainder -= 1;
      }
      idx += 1;
      if (idx >= floored.length && remainder > 0) idx = 0; // loop lagi bila masih ada sisa
      // Safety brake.
      if (idx > floored.length * 3) break;
    }
    for (const r0 of floored) out.set(r0.id, r0.diakui);
  }
  return out;
}
