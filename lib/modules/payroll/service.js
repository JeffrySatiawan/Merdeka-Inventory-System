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

// ---------- Cycle Payroll: FIXED 25 bulan sebelumnya → 26 bulan berjalan ----------
// cycleKey = "YYYY-MM" → end month. Contoh cycleKey="2026-09" berarti
// tanggal 25 Agustus 2026 – 26 September 2026.
function cycleRange(cycleKey) {
  const m = String(cycleKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  const toStr = `${m[1]}-${m[2]}-26`;
  const prev = new Date(Date.UTC(y, mo - 1, 1));
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const py = prev.getUTCFullYear();
  const pm = prev.getUTCMonth() + 1;
  const fromStr = `${py}-${String(pm).padStart(2, '0')}-25`;
  return { from: fromStr, to: toStr };
}

function listCycles(count = 12) {
  // Cycle "berjalan" = cycle yang berakhir di bulan saat ini bila tanggal
  // sekarang ≥ 26; kalau belum tanggal 26, cycle berjalan tetap yg berakhir
  // bulan ini (owner tetap dapat memilih meski belum ditutup).
  const now = new Date();
  const list = [];
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  for (let i = 0; i < count; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const r = cycleRange(key);
    list.push({ cycle_key: key, from: r.from, to: r.to, label: `${r.from} → ${r.to}` });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return list;
}

// Legacy periodKey/periodRange (BWC) — tidak dipakai flow baru tapi biarkan
// biar route legacy tidak crash.
function periodKey(period) {
  const s = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (!s) return null;
  return `${s[1]}-${s[2]}`;
}
function periodRange(pk) {
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
// Sisa Poin: SALDO poin TERAKHIR per user pada tanggal AKHIR periode
// (`to`). Reuse Riwayat Poin (`absensi_point_ledger`) + point-settings
// existing dari module Absensi. TIDAK menjumlahkan poin selama periode &
// TIDAK mengambil saldo setelah tanggal akhir.
async function balancePointsAsOf(db, to) {
  // Point settings (initial_balance, max_positive, max_negative) dibaca
  // dari collection `absensi_settings` — sumber tunggal Reward Poin. Bila
  // tidak ada, pakai default yang sama dengan module Absensi.
  let ps = null;
  try {
    ps = await db.collection('absensi_settings').findOne({ id: 'default' });
  } catch { /* optional */ }
  const initial = Number(ps?.initial_balance ?? 100);
  const maxPos = Number(ps?.max_positive ?? 150);
  const maxNeg = Number(ps?.max_negative ?? -50);
  const clampBal = (n) => Math.max(maxNeg, Math.min(maxPos, n));

  // Ambil semua entri ledger dgn event_date ≤ tanggal akhir periode.
  // Sort by (event_date asc, createdAt asc) supaya transaksi TERAKHIR pd
  // hari yg sama benar-benar menjadi entri paling akhir yang dijumlah.
  const rows = await db
    .collection('absensi_point_ledger')
    .find({ event_date: { $lte: to } })
    .project({ user_id: 1, event_date: 1, points: 1, createdAt: 1 })
    .sort({ event_date: 1, createdAt: 1 })
    .toArray();
  const byUser = new Map();
  for (const r of rows) {
    if (!r.user_id) continue;
    byUser.set(r.user_id, (byUser.get(r.user_id) || 0) + Number(r.points || 0));
  }
  const out = new Map();
  for (const [uid, delta] of byUser.entries()) {
    out.set(uid, clampBal(initial + delta));
  }
  return { byUser: out, initial, clampBal };
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

async function loadOrCreatePeriod(db, cycleKey) {
  let doc = await db.collection('payroll_periods').findOne({ cycle_key: cycleKey });
  if (!doc) {
    doc = {
      id: uuidv4(),
      cycle_key: cycleKey,
      period_key: cycleKey, // BWC
      status: 'draft', // draft | final
      finalized_at: null,
      snapshot: null,   // di-set saat finalisasi (hasil compute FROZEN)
      globals: {
        komisi_penjualan: 0,
        apresiasi_so: 0,
        tunjangan_kinerja: 0,
        bpjs_tk: 0,
        bpjs_kes: 0,
      },
      products: [],
      // Produk Fokus (info-only, tidak mempengaruhi perhitungan).
      // Struktur item: { id, nama, keterangan }. Terpisah dari `products`
      // (Komisi Produk Fokus) supaya perhitungan komisi existing TIDAK
      // berubah. Ditampilkan di Kitir Gaji sebagai informasi tambahan.
      focus_products: [],
      per_user: {},
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
    // JAM DIAKUI PAYROLL = Jam Kerja Diakui + Jam SO Diakui + Jam Lembur
    // Diakui. Ketiga field ini sudah tersedia dari derivasi Absensi
    // existing (`deriveDiakui`) — lembur hanya masuk bila overtime_status
    // === 'approved'. Tidak ada rumus jam baru; hanya penjumlahan tiga
    // field existing.
    const jamKerjaHours = w.kerjaMins / 60;
    const jamSoHours = w.soMins / 60;
    const jamLemburHours = w.lemburMins / 60;
    const jamDiakuiTotalHours = jamKerjaHours + jamSoHours + jamLemburHours;
    const gajiJamKerja = jamDiakuiTotalHours * Number(emp.tarif_per_jam || 0);
    const pu = period.per_user?.[emp.user_id] || {};
    // Nilai FINAL per komponen: pakai override individual (`finals[k]`) bila
    // ada, else pakai default dari global/N. Ini menghilangkan konsep
    // Adjustment — Owner cukup lihat/edit nominal akhir per karyawan.
    const finals = pu.finals || {};
    const komisiKebersihan = Number(pu.komisi_kebersihan || 0);
    const pts = pointsByUser.get(emp.user_id) || 0; // = SISA POIN (saldo akhir periode)
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
      // Field baru — konsumsi frontend & Kitir PDF (semua otomatis
      // mengikuti hasil perhitungan baru). Nama field additif; field lama
      // (`jam_kerja_diakui_hours`) tetap ada untuk BWC.
      jam_so_hours: round2(jamSoHours),
      jam_lembur_hours: round2(jamLemburHours),
      jam_diakui_payroll_hours: round2(jamDiakuiTotalHours),
      poin_periode: pts, // BWC name; sekarang = SISA POIN (saldo akhir)
      sisa_poin: pts,
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

  // ---- CYCLES: daftar cycle payroll (25 bulan sebelumnya → 26 bulan ini) ----
  if (subPath === 'cycles' && method === 'GET') {
    return json({ cycles: listCycles(12) });
  }

  // ---- PERIOD: GET (baca) ----
  // GET /api/payroll/period?cycle=YYYY-MM  (utama)
  // GET /api/payroll/period?from=YYYY-MM-DD&to=YYYY-MM-DD  (BWC)
  // GET /api/payroll/period?period=YYYY-MM  (legacy full-month, BWC)
  if (subPath === 'period' && method === 'GET') {
    const url = new URL(req.url);
    const resolved = resolveCycle(url.searchParams);
    if (resolved.error) return err(resolved.error);
    const { cycleKey, from, to } = resolved;
    const [config, period, employees] = await Promise.all([
      loadConfig(db),
      loadOrCreatePeriod(db, cycleKey),
      loadPayrollEmployees(db),
    ]);
    let breakdown;
    if (period.status === 'final' && period.snapshot) {
      // FROZEN: pakai snapshot apa adanya. Perubahan Absensi/SO/Lembur/
      // Reward Poin/data-sumber setelah finalisasi TIDAK boleh mengubah nilai.
      breakdown = period.snapshot.breakdown;
    } else {
      const [workByUser, pointsRes] = await Promise.all([
        aggregateWorkMinutes(db, from, to),
        balancePointsAsOf(db, to),
      ]);
      breakdown = computeBreakdown({ config, period, employees, workByUser, pointsByUser: pointsRes.byUser });
    }
    return json({
      cycle_key: cycleKey,
      from, to,
      period_key: cycleKey, // BWC
      config: serializeConfig(config),
      period: serializePeriod(period),
      employees,
      breakdown,
    });
  }

  // ---- PERIOD: PUT (edit) ----
  // Hanya diperbolehkan saat status='draft'. Reject 409 saat 'final'.
  if ((subPath === 'period' || subPath.startsWith('period/')) && method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    let cycleKey = null;
    if (subPath.startsWith('period/')) {
      const raw = subPath.slice('period/'.length);
      cycleKey = periodKey(raw) || null;
      if (!cycleKey) {
        // Legacy `from_to` → derive cycle key dari end-date bulan.
        const mm = raw.match(/^\d{4}-\d{2}-\d{2}_(\d{4}-\d{2})-\d{2}$/);
        if (mm) cycleKey = mm[1];
      }
    }
    if (!cycleKey && body.cycle) cycleKey = periodKey(body.cycle);
    if (!cycleKey) return err('cycle wajib (YYYY-MM)');
    const rng = cycleRange(cycleKey);
    if (!rng) return err('cycle tidak valid');

    // GUARD: kalau sudah FINAL, tolak edit APA PUN.
    const cur = await loadOrCreatePeriod(db, cycleKey);
    if (cur.status === 'final') {
      return err('Payroll periode ini sudah FINAL — tidak dapat diubah.', 409);
    }

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
    // Produk Fokus (info-only). Wajib punya `nama` (non-empty), `keterangan`
    // opsional (boleh string kosong). `id` di-generate bila belum ada.
    if (Array.isArray(body.focus_products)) {
      upd.focus_products = body.focus_products
        .map((p) => ({
          id: (p?.id && typeof p.id === 'string') ? p.id : uuidv4(),
          nama: String(p?.nama || '').trim().slice(0, 120),
          keterangan: String(p?.keterangan || '').trim().slice(0, 500),
        }))
        .filter((p) => p.nama)
        .slice(0, 100);
    }
    if (body.per_user && typeof body.per_user === 'object') {
      const pu = {};
      for (const [uid, v] of Object.entries(body.per_user)) {
        if (!uid || typeof v !== 'object' || !v) continue;
        const row = {};
        if (v.komisi_kebersihan != null) row.komisi_kebersihan = Number(v.komisi_kebersihan) || 0;
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
      { cycle_key: cycleKey },
      { $set: upd, $setOnInsert: { id: uuidv4(), cycle_key: cycleKey, period_key: cycleKey, status: 'draft', createdAt: new Date() } },
      { upsert: true }
    );
    // Return fresh compute (draft).
    const [config, period, employees, workByUser, pointsRes] = await Promise.all([
      loadConfig(db),
      loadOrCreatePeriod(db, cycleKey),
      loadPayrollEmployees(db),
      aggregateWorkMinutes(db, rng.from, rng.to),
      balancePointsAsOf(db, rng.to),
    ]);
    const breakdown = computeBreakdown({ config, period, employees, workByUser, pointsByUser: pointsRes.byUser });
    return json({
      cycle_key: cycleKey,
      from: rng.from, to: rng.to,
      period_key: cycleKey,
      config: serializeConfig(config),
      period: serializePeriod(period),
      employees,
      breakdown,
    });
  }

  // ---- PERIOD: FINALIZE ----
  // POST /api/payroll/period/finalize  body { cycle: 'YYYY-MM' }
  // Menghitung ulang dari sumber existing, MENYIMPAN sebagai snapshot,
  // mengunci status → 'final'. TIDAK dapat difinalisasi ulang.
  if (subPath === 'period/finalize' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const cycleKey = periodKey(body.cycle);
    if (!cycleKey) return err('cycle wajib (YYYY-MM)');
    const rng = cycleRange(cycleKey);
    if (!rng) return err('cycle tidak valid');
    const cur = await loadOrCreatePeriod(db, cycleKey);
    if (cur.status === 'final') {
      return err('Payroll periode ini sudah FINAL — tidak dapat difinalisasi ulang.', 409);
    }
    const [config, employees, workByUser, pointsRes] = await Promise.all([
      loadConfig(db),
      loadPayrollEmployees(db),
      aggregateWorkMinutes(db, rng.from, rng.to),
      balancePointsAsOf(db, rng.to),
    ]);
    const breakdown = computeBreakdown({ config, period: cur, employees, workByUser, pointsByUser: pointsRes.byUser });
    const snapshot = {
      cycle_key: cycleKey,
      from: rng.from,
      to: rng.to,
      finalized_at: new Date(),
      finalized_by: ctx.user.id,
      config: serializeConfig(config),
      globals: cur.globals || {},
      products: Array.isArray(cur.products) ? cur.products : [],
      focus_products: Array.isArray(cur.focus_products) ? cur.focus_products : [],
      per_user: cur.per_user || {},
      employees, // snapshot daftar karyawan + jabatan + tarif pada saat finalisasi
      breakdown, // frozen breakdown per staff dgn nilai final semua komponen
    };
    await db.collection('payroll_periods').updateOne(
      { cycle_key: cycleKey },
      {
        $set: {
          status: 'final',
          finalized_at: snapshot.finalized_at,
          finalized_by: ctx.user.id,
          snapshot,
          updatedAt: new Date(),
        },
      }
    );
    const period = await loadOrCreatePeriod(db, cycleKey);
    return json({
      cycle_key: cycleKey,
      from: rng.from, to: rng.to,
      period_key: cycleKey,
      config: serializeConfig(config),
      period: serializePeriod(period),
      employees: snapshot.employees,
      breakdown: snapshot.breakdown,
    });
  }

  return null;
}

// ---------- URL parsing helper ----------
function resolveCycle(searchParams) {
  const c = String(searchParams.get('cycle') || '').trim();
  if (/^\d{4}-\d{2}$/.test(c)) {
    const r = cycleRange(c);
    return { cycleKey: c, from: r.from, to: r.to };
  }
  // BWC: from/to bebas → derive cycleKey dari bulan `to`.
  const fromRaw = String(searchParams.get('from') || '');
  const toRaw = String(searchParams.get('to') || '');
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (isDate(fromRaw) && isDate(toRaw)) {
    if (fromRaw > toRaw) return { error: 'Rentang tanggal tidak valid' };
    const cycleKey = toRaw.slice(0, 7);
    return { cycleKey, from: fromRaw, to: toRaw };
  }
  // BWC: legacy `period=YYYY-MM` → treat sebagai cycle YYYY-MM.
  const legacy = periodKey(searchParams.get('period'));
  if (legacy) {
    const r = cycleRange(legacy);
    return { cycleKey: legacy, from: r.from, to: r.to };
  }
  return { error: 'cycle wajib (YYYY-MM)' };
}
