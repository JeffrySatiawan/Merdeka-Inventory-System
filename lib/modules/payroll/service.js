// ============================================================
// Payroll Module — OWNER ONLY.
// Router (/app/api/[[...path]]/route.js) sudah melakukan hard-guard:
// - user.role === 'owner' → wajib.
// - `payroll` di-drop dari user.modules staff oleh normalizeModules.
// Service ini fokus pada CRUD & compute. Setiap fungsi TIDAK mempercayai
// input untuk otorisasi — router yang otoritatif.
//
// Sumber data BACA-SAJA:
// - `absensi_records`    → jam kerja diakui (irisan actual × shift)
// - `absensi_point_ledger` → total poin per user per periode (Reward Poin)
// - `absensi_settings`   → tidak dipakai langsung; derivasi jam sudah stored
// - `employees`          → daftar staff (tidak menyentuh; hanya read)
// TIDAK menghitung ulang logika Absensi/SO/Lembur/Reward Poin — REUSE hasil.
//
// Collection MILIK Payroll:
// - `payroll_config`     (id='default'): { poin_rupiah_per_point }
// - `payroll_employees`  (per user_id): { jabatan, tarif_per_jam }
// - `payroll_periods`    (per period_key 'YYYY-MM'): globals, products,
//                        per_user (adjustments, komisi_kebersihan)
// ============================================================
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const json = (data, init) => NextResponse.json(data, init);
const err = (msg, status = 400) => NextResponse.json({ error: msg }, { status });

// ---------- Konfigurasi default ----------
const DEFAULT_CONFIG = {
  id: 'default',
  poin_rupiah_per_point: 0, // Rp per 1 poin; owner set via UI.
  jabatans: ['Staff', 'Apoteker', 'Admin', 'Supervisor', 'Kepala Toko'],
};

const KOMPONEN_KEYS = [
  'komisi_penjualan',
  'komisi_produk_fokus',
  'apresiasi_so',
  'tunjangan_kinerja',
  'bpjs_tk',
  'bpjs_kes',
];

async function loadConfig(db) {
  let doc = await db.collection('payroll_config').findOne({ id: 'default' });
  if (!doc) {
    doc = { ...DEFAULT_CONFIG, createdAt: new Date(), updatedAt: new Date() };
    await db.collection('payroll_config').insertOne(doc);
  }
  return doc;
}

// Reuse periodKey format YYYY-MM (kompatibel dengan `absensi_point_ledger.period_key`).
function periodKey(period) {
  const s = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (!s) return null;
  return `${s[1]}-${s[2]}`;
}

function periodRange(pk) {
  // pk = "YYYY-MM" → date strings from=YYYY-MM-01 to=YYYY-MM-<lastDay>.
  const [y, m] = pk.split('-').map((n) => Number(n));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${pk}-01`, to: `${pk}-${String(last).padStart(2, '0')}` };
}

// ---------- Derivasi Jam Diakui ----------
// Duplikasi minimal dari absensi/service (hanya fungsi murni; hindari
// refactor global). Struktur field `absensi_records` sudah stable.
function parseWitaHM(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2})[.:](\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function deriveDiakui(r) {
  const shiftStart = Number(r.shift_start_mins || 0);
  const shiftEnd = Number(r.shift_end_mins || 0);
  const inMins = parseWitaHM(r.actual_check_in_wita);
  const outMins = parseWitaHM(r.actual_check_out_wita);
  let kerjaMins = 0;
  if (inMins != null && outMins != null) {
    const a = Math.max(inMins, shiftStart);
    const b = Math.min(outMins, shiftEnd);
    kerjaMins = Math.max(0, b - a);
  }
  let soMins = 0;
  if (r.so_selected && inMins != null && outMins != null && inMins < shiftStart) {
    soMins = Math.max(0, Math.min(outMins, shiftStart) - inMins);
  }
  const lemburMins = r.overtime_status === 'approved' ? Number(r.overtime_minutes || 0) : 0;
  return { kerjaMins, soMins, lemburMins };
}

// ---------- Aggregations (BACA hasil existing) ----------
async function aggregatePoints(db, from, to) {
  // Read ledger entries by event_date range, sum per user_id. TIDAK
  // menghitung ulang aturan reward poin — hanya jumlahkan `points` (yg sudah
  // frozen saat event terjadi oleh module Absensi).
  const rows = await db
    .collection('absensi_point_ledger')
    .find({ event_date: { $gte: from, $lte: to } })
    .project({ user_id: 1, points: 1 })
    .toArray();
  const byUser = new Map();
  for (const r of rows) {
    const uid = r.user_id;
    if (!uid) continue;
    byUser.set(uid, (byUser.get(uid) || 0) + Number(r.points || 0));
  }
  return byUser;
}

async function aggregateWorkMinutes(db, from, to) {
  const rows = await db
    .collection('absensi_records')
    .find({ date: { $gte: from, $lte: to } })
    .project({
      user_id: 1,
      shift_start_mins: 1,
      shift_end_mins: 1,
      actual_check_in_wita: 1,
      actual_check_out_wita: 1,
      so_selected: 1,
      overtime_status: 1,
      overtime_minutes: 1,
    })
    .toArray();
  const byUser = new Map();
  for (const r of rows) {
    const uid = r.user_id;
    if (!uid) continue;
    const d = deriveDiakui(r);
    const cur = byUser.get(uid) || { kerjaMins: 0, soMins: 0, lemburMins: 0 };
    cur.kerjaMins += d.kerjaMins;
    cur.soMins += d.soMins;
    cur.lemburMins += d.lemburMins;
    byUser.set(uid, cur);
  }
  return byUser;
}

async function loadPayrollEmployees(db) {
  // Merge employees (staff + owner-if-you-want) with payroll_employees.
  // Payroll hanya menampilkan staff aktif (bukan owner).
  const staff = await db
    .collection('employees')
    .find({ role: 'staff' })
    .project({ id: 1, name: 1, username: 1, status: 1 })
    .toArray();
  const peList = await db.collection('payroll_employees').find({}).toArray();
  const peMap = new Map(peList.map((x) => [x.user_id, x]));
  return staff.map((s) => {
    const pe = peMap.get(s.id) || {};
    return {
      user_id: s.id,
      name: s.name,
      username: s.username,
      status: s.status,
      jabatan: pe.jabatan || '',
      tarif_per_jam: Number(pe.tarif_per_jam || 0),
    };
  });
}

async function loadOrCreatePeriod(db, pk) {
  let doc = await db.collection('payroll_periods').findOne({ period_key: pk });
  if (!doc) {
    doc = {
      id: uuidv4(),
      period_key: pk,
      globals: {
        komisi_penjualan: 0,
        apresiasi_so: 0,
        tunjangan_kinerja: 0,
        bpjs_tk: 0,
        bpjs_kes: 0,
      },
      products: [],
      per_user: {}, // { [user_id]: { komisi_kebersihan, adjustments: {komponen: delta} } }
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('payroll_periods').insertOne(doc);
  }
  return doc;
}

function serializePeriod(doc) {
  const { _id, ...rest } = doc;
  return rest;
}
function serializeConfig(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

// ---------- Compute breakdown per staff ----------
function computeBreakdown({ config, period, employees, workByUser, pointsByUser }) {
  const productTotal = (period.products || []).reduce((s, p) => s + Number(p.nilai || 0), 0);
  const n = Math.max(1, employees.length);
  const perHead = {
    komisi_penjualan: (Number(period.globals?.komisi_penjualan || 0)) / n,
    komisi_produk_fokus: productTotal / n,
    apresiasi_so: (Number(period.globals?.apresiasi_so || 0)) / n,
    tunjangan_kinerja: (Number(period.globals?.tunjangan_kinerja || 0)) / n,
    bpjs_tk: (Number(period.globals?.bpjs_tk || 0)) / n,
    bpjs_kes: (Number(period.globals?.bpjs_kes || 0)) / n,
  };
  const rupiahPerPoint = Number(config.poin_rupiah_per_point || 0);
  const items = employees.map((emp) => {
    const w = workByUser.get(emp.user_id) || { kerjaMins: 0, soMins: 0, lemburMins: 0 };
    const jamKerjaHours = w.kerjaMins / 60;
    const gajiJamKerja = jamKerjaHours * Number(emp.tarif_per_jam || 0);
    const pu = period.per_user?.[emp.user_id] || {};
    // Nilai FINAL per komponen: pakai override individual (`finals[k]`) bila
    // ada, else pakai default dari global/N. Ini menghilangkan konsep
    // Adjustment — Owner cukup lihat/edit nominal akhir per karyawan.
    const finals = pu.finals || {};
    const komisiKebersihan = Number(pu.komisi_kebersihan || 0);
    const pts = pointsByUser.get(emp.user_id) || 0;
    const rewardPoin = pts * rupiahPerPoint;

    const pick = (k) => (finals[k] != null ? Number(finals[k]) : perHead[k]);
    const c = {
      gaji_jam_kerja: round2(gajiJamKerja),
      komisi_penjualan: round2(pick('komisi_penjualan')),
      komisi_produk_fokus: round2(pick('komisi_produk_fokus')),
      komisi_kebersihan: round2(komisiKebersihan),
      apresiasi_so: round2(pick('apresiasi_so')),
      tunjangan_kinerja: round2(pick('tunjangan_kinerja')),
      reward_poin: round2(rewardPoin),
      bpjs_tk: round2(pick('bpjs_tk')),
      bpjs_kes: round2(pick('bpjs_kes')),
    };
    // Set flag mana komponen yg statusnya OVERRIDE vs DEFAULT (utk UI badge).
    const overrides = {};
    for (const k of ['komisi_penjualan', 'komisi_produk_fokus', 'apresiasi_so', 'tunjangan_kinerja', 'bpjs_tk', 'bpjs_kes']) {
      overrides[k] = finals[k] != null;
    }
    const total = Object.values(c).reduce((s, v) => s + Number(v || 0), 0);
    return {
      user_id: emp.user_id,
      name: emp.name,
      jabatan: emp.jabatan,
      tarif_per_jam: Number(emp.tarif_per_jam || 0),
      jam_kerja_diakui_minutes: w.kerjaMins,
      jam_kerja_diakui_hours: round2(jamKerjaHours),
      poin_periode: pts,
      komponen: c,
      overrides,
      total: round2(total),
    };
  });
  return { items, per_head: perHead, product_total: round2(productTotal) };
}

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

// ============================================================
// Router handler
// ============================================================
export async function handlePayrollRequest(req, subPath, method, ctx) {
  const { db } = ctx;

  // ---- CONFIG ----
  if (subPath === 'config' && method === 'GET') {
    const doc = await loadConfig(db);
    return json({ config: serializeConfig(doc) });
  }
  if (subPath === 'config' && method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    const upd = { updatedAt: new Date() };
    if (body.poin_rupiah_per_point != null) {
      upd.poin_rupiah_per_point = Math.max(0, Number(body.poin_rupiah_per_point) || 0);
    }
    if (Array.isArray(body.jabatans)) {
      upd.jabatans = body.jabatans
        .map((s) => String(s || '').trim())
        .filter((s) => s.length > 0 && s.length <= 40)
        .slice(0, 30);
    }
    await db.collection('payroll_config').updateOne(
      { id: 'default' },
      { $set: upd, $setOnInsert: { id: 'default', createdAt: new Date() } },
      { upsert: true }
    );
    const doc = await loadConfig(db);
    return json({ config: serializeConfig(doc) });
  }

  // ---- EMPLOYEES (Data Karyawan) ----
  if (subPath === 'employees' && method === 'GET') {
    const items = await loadPayrollEmployees(db);
    return json({ items });
  }
  if (subPath.startsWith('employees/') && method === 'PUT') {
    const uid = subPath.slice('employees/'.length);
    if (!uid) return err('user_id wajib');
    // Verify user exists & is staff.
    const emp = await db.collection('employees').findOne({ id: uid });
    if (!emp) return err('user tidak ditemukan', 404);
    if (emp.role === 'owner') return err('Payroll tidak berlaku untuk Owner');
    const body = await req.json().catch(() => ({}));
    const upd = { updatedAt: new Date() };
    if (body.jabatan != null) upd.jabatan = String(body.jabatan).trim().slice(0, 40);
    if (body.tarif_per_jam != null) upd.tarif_per_jam = Math.max(0, Number(body.tarif_per_jam) || 0);
    await db.collection('payroll_employees').updateOne(
      { user_id: uid },
      { $set: upd, $setOnInsert: { user_id: uid, createdAt: new Date() } },
      { upsert: true }
    );
    const items = await loadPayrollEmployees(db);
    return json({ items });
  }

  // ---- PERIOD (settings + compute) ----
  // Support:
  //   GET /api/payroll/period?from=YYYY-MM-DD&to=YYYY-MM-DD  (baru)
  //   GET /api/payroll/period?period=YYYY-MM                  (legacy, di-expand ke full-month)
  if (subPath === 'period' && method === 'GET') {
    const url = new URL(req.url);
    const range = resolveRange(url.searchParams);
    if (range.error) return err(range.error);
    const pkStr = `${range.from}_${range.to}`;
    const [config, period, employees, workByUser, pointsByUser] = await Promise.all([
      loadConfig(db),
      loadOrCreatePeriod(db, pkStr),
      loadPayrollEmployees(db),
      aggregateWorkMinutes(db, range.from, range.to),
      aggregatePoints(db, range.from, range.to),
    ]);
    const breakdown = computeBreakdown({ config, period, employees, workByUser, pointsByUser });
    return json({
      from: range.from,
      to: range.to,
      period_key: pkStr,
      config: serializeConfig(config),
      period: serializePeriod(period),
      employees,
      breakdown,
    });
  }

  // PUT /api/payroll/period  { from, to, globals, products, per_user }
  // BWC: PUT /api/payroll/period/:key masih diterima; key di-parse `from_to`
  // atau legacy `YYYY-MM` (di-expand ke full-month).
  if ((subPath === 'period' || subPath.startsWith('period/')) && method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    let from = null, to = null;
    if (subPath.startsWith('period/')) {
      const key = subPath.slice('period/'.length);
      const m = key.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
      if (m) { from = m[1]; to = m[2]; }
      else {
        const legacy = periodKey(key);
        if (legacy) { const r = periodRange(legacy); from = r.from; to = r.to; }
      }
    }
    if (!from || !to) {
      // Parse dari body.
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.from || ''))) from = body.from;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.to || ''))) to = body.to;
    }
    if (!from || !to) return err('from & to (YYYY-MM-DD) wajib');
    if (from > to) return err('Rentang tanggal tidak valid');
    const pkStr = `${from}_${to}`;
    const upd = { updatedAt: new Date() };
    if (body.globals && typeof body.globals === 'object') {
      const g = {};
      for (const k of ['komisi_penjualan', 'apresiasi_so', 'tunjangan_kinerja', 'bpjs_tk', 'bpjs_kes']) {
        g[k] = Number(body.globals[k]) || 0;
      }
      upd.globals = g;
    }
    if (Array.isArray(body.products)) {
      upd.products = body.products
        .map((p) => ({
          nama: String(p?.nama || '').trim().slice(0, 100),
          nilai: Number(p?.nilai) || 0,
        }))
        .filter((p) => p.nama || p.nilai);
    }
    if (body.per_user && typeof body.per_user === 'object') {
      const pu = {};
      for (const [uid, v] of Object.entries(body.per_user)) {
        if (!uid || typeof v !== 'object' || !v) continue;
        const row = {};
        if (v.komisi_kebersihan != null) row.komisi_kebersihan = Number(v.komisi_kebersihan) || 0;
        // Simpan `finals` — override nilai final per komponen. Nilai yg null/
        // undefined artinya "revert ke default" dan tidak akan disimpan.
        const finals = {};
        const src = v.finals && typeof v.finals === 'object' ? v.finals : {};
        for (const k of KOMPONEN_KEYS) {
          if (src[k] != null && src[k] !== '') finals[k] = Number(src[k]) || 0;
        }
        row.finals = finals;
        pu[uid] = row;
      }
      upd.per_user = pu;
    }
    await db.collection('payroll_periods').updateOne(
      { period_key: pkStr },
      { $set: upd, $setOnInsert: { id: uuidv4(), period_key: pkStr, createdAt: new Date() } },
      { upsert: true }
    );
    // Return fresh compute.
    const [config, period, employees, workByUser, pointsByUser] = await Promise.all([
      loadConfig(db),
      loadOrCreatePeriod(db, pkStr),
      loadPayrollEmployees(db),
      aggregateWorkMinutes(db, from, to),
      aggregatePoints(db, from, to),
    ]);
    const breakdown = computeBreakdown({ config, period, employees, workByUser, pointsByUser });
    return json({
      from, to,
      period_key: pkStr,
      config: serializeConfig(config),
      period: serializePeriod(period),
      employees,
      breakdown,
    });
  }

  return null;
}

function resolveRange(searchParams) {
  const fromRaw = String(searchParams.get('from') || '');
  const toRaw = String(searchParams.get('to') || '');
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (isDate(fromRaw) && isDate(toRaw)) {
    if (fromRaw > toRaw) return { error: 'Rentang tanggal tidak valid' };
    return { from: fromRaw, to: toRaw };
  }
  // BWC: ?period=YYYY-MM → expand ke full month.
  const legacy = periodKey(searchParams.get('period'));
  if (legacy) {
    const r = periodRange(legacy);
    return { from: r.from, to: r.to };
  }
  return { error: 'from & to (YYYY-MM-DD) wajib' };
}
