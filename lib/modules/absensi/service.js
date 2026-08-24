// ============================================================================
// Module: Absensi (isolated).
// Uses existing MIS user/session/permission — no new auth or user table.
// Stores its own collections only: `absensi_settings` (single doc) and
// `absensi_records` (one doc per user per WITA date).
//
// PRODUCTION SAFETY:
//   - Zero touch on OMS / Cycle Count / MIS Faktur code, data, or endpoints.
//   - Only additive collections & routes.
//   - Reuses WITA time helpers via ctx (passed from main router).
// ============================================================================

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { Binary } from 'mongodb';
import * as XLSX from 'xlsx';

// ---- Small helpers ---------------------------------------------------------
function jsonRes(data, status = 200) { return NextResponse.json(data, { status }); }
function errRes(msg, status = 400) { return NextResponse.json({ error: msg }, { status }); }
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map((v) => parseInt(v, 10) || 0);
  return h * 60 + m;
}
// WITA (Asia/Makassar, UTC+8) helpers — mirror the ones in main router.
function witaDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar' }).format(new Date());
}
function witaHM() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const hh = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  const mm = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  return { hour: hh, minute: mm, mins: hh * 60 + mm };
}
function witaClock() {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// Haversine great-circle distance (meters).
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- Defaults --------------------------------------------------------------
// Shift key layout matches product spec:
//   Apotek Pagi 07:00-15:00, Apotek Sore 15:00-22:00
//   Packing 09:00-17:00, Admin Gudang 09:00-17:00
const DEFAULT_SHIFTS = [
  { key: 'apotek_pagi', name: 'Apotek — Pagi', category: 'apotek', start: '07:00', end: '15:00' },
  { key: 'apotek_sore', name: 'Apotek — Sore', category: 'apotek', start: '15:00', end: '22:00' },
  { key: 'packing',     name: 'Packing',        category: 'gudang', start: '09:00', end: '17:00' },
  { key: 'admin_gudang', name: 'Admin Gudang',  category: 'gudang', start: '09:00', end: '17:00' },
];
const DEFAULT_SETTINGS = {
  id: 'default',
  // Owner must set the real location on first use — 0,0 forces "outside radius".
  location: { name: 'Apotek Merdeka', lat: 0, lng: 0, radius_m: 50 },
  qr_secret: null, // random UUID; QR content = "MIS-ABSENSI:<qr_secret>"
  shifts: DEFAULT_SHIFTS,
  overtime_min_minutes: 30, // minimum minutes past shift end to count as potential overtime
  // Retensi foto selfie absensi (hari). Mirrors OMS `photo_retention_days`
  // pattern but stored in this module's OWN settings doc — OMS retention
  // remains independent and unchanged.
  photo_retention_days: 30,
};

async function loadSettings(db) {
  let s = await db.collection('absensi_settings').findOne({ id: 'default' });
  if (!s) {
    s = { ...DEFAULT_SETTINGS, qr_secret: uuidv4(), createdAt: new Date() };
    await db.collection('absensi_settings').insertOne(s);
  } else if (!s.qr_secret) {
    // Backfill: guarantee a QR secret exists so scanning always has a target.
    const qr = uuidv4();
    await db.collection('absensi_settings').updateOne({ id: 'default' }, { $set: { qr_secret: qr } });
    s.qr_secret = qr;
  }
  return s;
}

function publicSettings(s) {
  // Values non-owner staff are allowed to read (needed for the check-in form).
  return {
    location: s.location,
    shifts: s.shifts,
    overtime_min_minutes: s.overtime_min_minutes,
    photo_retention_days: s.photo_retention_days ?? 30,
    updated_at: s.updatedAt || s.createdAt || null,
  };
}

// ---- Periodic cleanup — mirrors OMS `maybeRunOMCleanup` pattern -----------
// Fire-and-forget at the start of every /api/absensi/* request. Throttled to
// once per hour per Node process. ONLY purges selfie binaries from
// `absensi_records`; leaves every other field intact so reports and Excel
// exports still work. This function NEVER touches OMS or other modules.
let _lastAbsensiCleanupTs = 0;
async function maybeRunAbsensiCleanup(db) {
  const nowMs = Date.now();
  if (nowMs - _lastAbsensiCleanupTs < 60 * 60 * 1000) return; // 1h throttle
  _lastAbsensiCleanupTs = nowMs;
  try {
    const s = (await db.collection('absensi_settings').findOne({ id: 'default' })) || DEFAULT_SETTINGS;
    const ttlDays = Number(s.photo_retention_days ?? 30);
    if (!(ttlDays > 0)) return;
    const cutoff = new Date(Date.now() - ttlDays * 86400000);
    // Records whose `date` (WITA yyyy-mm-dd) is older than cutoff AND still
    // have a selfie binary attached → purge only the binary. Keep row.
    const cutoffISODate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar' }).format(cutoff);
    await db.collection('absensi_records').updateMany(
      {
        date: { $lt: cutoffISODate },
        $or: [
          { check_in_selfie: { $exists: true, $ne: null } },
          { check_out_selfie: { $exists: true, $ne: null } },
        ],
      },
      {
        $set: { selfie_deleted: true, selfie_deleted_at: new Date() },
        $unset: { check_in_selfie: '', check_out_selfie: '' },
      }
    );
  } catch (e) {
    console.error('[Absensi cleanup]', e);
  }
}

function pickShiftByNow(shifts, hmMins) {
  // "Belongs to this shift" if we're within [start - 60m, end + 240m].
  // Preference: earliest start whose window contains hmMins.
  const inRange = shifts
    .map((s) => ({ ...s, sMin: toMinutes(s.start), eMin: toMinutes(s.end) }))
    .sort((a, b) => a.sMin - b.sMin)
    .find((s) => hmMins >= s.sMin - 60 && hmMins <= s.eMin + 240);
  return inRange || null;
}

function serializeRecord(r) {
  if (!r) return null;
  const { _id, check_in_selfie, check_out_selfie, ...safe } = r;
  return {
    ...safe,
    // Prefer explicit booleans if already added by an aggregation pipeline;
    // fall back to inspecting the raw binary fields when present.
    has_check_in_photo: safe.has_check_in_photo != null ? !!safe.has_check_in_photo : !!check_in_selfie,
    has_check_out_photo: safe.has_check_out_photo != null ? !!safe.has_check_out_photo : !!check_out_selfie,
  };
}

// Reusable aggregation stages for endpoints that must NOT return the raw
// selfie binary but still need the has_*_photo booleans for the UI.
function listPipeline(match, extraStages = []) {
  return [
    { $match: match },
    {
      $addFields: {
        has_check_in_photo: { $cond: [{ $ifNull: ['$check_in_selfie', false] }, true, false] },
        has_check_out_photo: { $cond: [{ $ifNull: ['$check_out_selfie', false] }, true, false] },
      },
    },
    { $project: { check_in_selfie: 0, check_out_selfie: 0, _id: 0 } },
    ...extraStages,
  ];
}

async function ensureIndexes(db) {
  try {
    await db.collection('absensi_records').createIndex({ user_id: 1, date: 1 }, { unique: true });
    await db.collection('absensi_records').createIndex({ date: 1 });
    await db.collection('absensi_records').createIndex({ overtime_status: 1 });
  } catch { /* idempotent */ }
}

// Decode a data URL (image/webp;base64,....) into a Buffer.
function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1);
  try { return Buffer.from(b64, 'base64'); } catch { return null; }
}

// ---- Handler --------------------------------------------------------------
// subPath is the request path AFTER the "absensi/" prefix.
export async function handleAbsensiRequest(req, subPath, method, ctx) {
  const { db, user } = ctx;
  if (!user) return errRes('unauthorized', 401);
  await ensureIndexes(db);
  // Fire-and-forget periodic cleanup (mirrors OMS pattern; throttled 1h).
  maybeRunAbsensiCleanup(db).catch(() => {});

  // -------- SETTINGS (read/write) --------
  if (subPath === 'settings' && method === 'GET') {
    const s = await loadSettings(db);
    // Owner sees everything (incl. qr_secret); staff only public parts.
    if (user.role === 'owner') {
      const { _id, ...safe } = s;
      // Ensure new-in-2026-02 field is always present in the response, even
      // if the persisted doc predates the retention feature.
      if (safe.photo_retention_days == null) safe.photo_retention_days = 30;
      return jsonRes({ settings: safe });
    }
    return jsonRes({ settings: publicSettings(s) });
  }

  if (subPath === 'settings' && method === 'PUT') {
    if (user.role !== 'owner') return errRes('hanya owner yang dapat mengubah pengaturan Absensi', 403);
    const body = await req.json().catch(() => ({}));
    const upd = { updatedAt: new Date() };
    if (body.location && typeof body.location === 'object') {
      const lat = Number(body.location.lat);
      const lng = Number(body.location.lng);
      const radius = Math.max(5, Math.min(2000, Number(body.location.radius_m || 50)));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return errRes('lat/lng tidak valid');
      upd.location = {
        name: String(body.location.name || 'Lokasi Absensi').slice(0, 100),
        lat, lng, radius_m: radius,
      };
    }
    if (Array.isArray(body.shifts)) {
      const shifts = body.shifts
        .map((sh) => ({
          key: String(sh.key || '').trim().slice(0, 40),
          name: String(sh.name || '').trim().slice(0, 60),
          category: String(sh.category || 'apotek').trim().slice(0, 20),
          start: String(sh.start || '').trim(),
          end: String(sh.end || '').trim(),
        }))
        .filter((sh) => sh.key && sh.name && /^\d{2}:\d{2}$/.test(sh.start) && /^\d{2}:\d{2}$/.test(sh.end));
      // Dedupe keys
      const seen = new Set();
      upd.shifts = shifts.filter((sh) => (seen.has(sh.key) ? false : seen.add(sh.key)));
      if (upd.shifts.length === 0) return errRes('minimal 1 shift valid');
    }
    if (body.overtime_min_minutes !== undefined) {
      const v = Math.max(0, Math.min(240, Number(body.overtime_min_minutes) || 0));
      upd.overtime_min_minutes = v;
    }
    if (body.photo_retention_days !== undefined) {
      // Mirrors the OMS photo_retention_days input bounds: 1..365 days.
      // Explicitly clamp using Number.isFinite so `0` clamps up to `1`
      // instead of falling back to the default via `|| 30`.
      const raw = Number(body.photo_retention_days);
      const n = Number.isFinite(raw) ? raw : 30;
      upd.photo_retention_days = Math.max(1, Math.min(365, n));
    }
    if (body.regenerate_qr === true) upd.qr_secret = uuidv4();
    await db.collection('absensi_settings').updateOne({ id: 'default' }, { $set: upd }, { upsert: true });
    const s = await loadSettings(db);
    const { _id, ...safe } = s;
    return jsonRes({ settings: safe });
  }

  // -------- QR reveal (owner) --------
  if (subPath === 'qr' && method === 'GET') {
    if (user.role !== 'owner') return errRes('hanya owner', 403);
    const s = await loadSettings(db);
    return jsonRes({ qr_value: `MIS-ABSENSI:${s.qr_secret}`, location: s.location });
  }

  // -------- TODAY (own status) --------
  if (subPath === 'today' && method === 'GET') {
    const s = await loadSettings(db);
    const date = witaDate();
    const now = witaHM();
    const rec = await db.collection('absensi_records').findOne({ user_id: user.id, date });
    const suggested = pickShiftByNow(s.shifts, now.mins);
    return jsonRes({
      date,
      now: witaClock(),
      record: serializeRecord(rec),
      shifts: s.shifts,
      location: s.location,
      suggested_shift_key: suggested?.key || null,
    });
  }

  // -------- CHECK-IN --------
  if (subPath === 'check-in' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const s = await loadSettings(db);

    // 1) QR validation
    const qrRaw = String(body.qr_value || '').trim();
    if (!qrRaw) return errRes('QR belum discan');
    if (qrRaw !== `MIS-ABSENSI:${s.qr_secret}`) return errRes('QR tidak valid — bukan QR Absensi MIS');

    // 2) Location validation
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return errRes('lokasi GPS tidak terdeteksi');
    if (!Number.isFinite(s.location.lat) || !Number.isFinite(s.location.lng) ||
        (s.location.lat === 0 && s.location.lng === 0)) {
      return errRes('Owner belum mengatur lokasi absensi. Silakan hubungi owner.');
    }
    const dist = haversineMeters(lat, lng, s.location.lat, s.location.lng);
    if (dist > s.location.radius_m) {
      return errRes(`Absensi gagal. Anda berada di luar area absensi (jarak ${Math.round(dist)} m, radius ${s.location.radius_m} m).`);
    }

    // 3) Shift validation
    const shiftKey = String(body.shift_key || '').trim();
    const shift = s.shifts.find((sh) => sh.key === shiftKey);
    if (!shift) return errRes('shift tidak valid');

    // 4) Selfie validation (photo_data_url — WEBp/JPEG data URL from client)
    const photoBuf = dataUrlToBuffer(body.photo_data_url);
    if (!photoBuf || photoBuf.length === 0) return errRes('selfie belum diambil');
    if (photoBuf.length > 500 * 1024) return errRes('ukuran selfie terlalu besar (>500KB)');

    // 5) Persist — one record per user per date. Reject double check-in.
    const date = witaDate();
    const existing = await db.collection('absensi_records').findOne({ user_id: user.id, date });
    if (existing && existing.actual_check_in) {
      return errRes('Anda sudah absen masuk hari ini');
    }

    const now = new Date();
    const nowMins = witaHM().mins;
    const shiftStartMins = toMinutes(shift.start);
    const shiftEndMins = toMinutes(shift.end);
    // Effective check-in = max(actual, shift_start). Early arrivals don't gain hours.
    const effectiveMins = Math.max(nowMins, shiftStartMins);
    const lateMinutes = Math.max(0, nowMins - shiftStartMins);

    const doc = {
      id: existing?.id || uuidv4(),
      user_id: user.id,
      user_name: user.name,
      user_role: user.role,
      date,
      shift_key: shift.key,
      shift_name: shift.name,
      shift_category: shift.category,
      shift_start: shift.start,
      shift_end: shift.end,
      actual_check_in: now,
      actual_check_in_wita: witaClock(),
      effective_check_in_mins: effectiveMins,
      shift_start_mins: shiftStartMins,
      shift_end_mins: shiftEndMins,
      late_minutes: lateMinutes,
      check_in_lat: lat,
      check_in_lng: lng,
      check_in_distance_m: Math.round(dist),
      check_in_selfie: new Binary(photoBuf),
      qr_verified: true,
      actual_check_out: null,
      check_out_lat: null,
      check_out_lng: null,
      check_out_distance_m: null,
      check_out_selfie: null,
      worked_minutes: null,
      overtime_minutes: 0,
      overtime_status: 'none', // none | pending | approved | rejected
      overtime_reviewed_by_id: null,
      overtime_reviewed_by_name: null,
      overtime_reviewed_at: null,
      overtime_review_note: null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await db.collection('absensi_records').updateOne(
      { user_id: user.id, date },
      { $set: doc },
      { upsert: true }
    );
    return jsonRes({ ok: true, record: serializeRecord(doc) });
  }

  // -------- CHECK-OUT --------
  if (subPath === 'check-out' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const s = await loadSettings(db);

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return errRes('lokasi GPS tidak terdeteksi');
    const dist = (Number.isFinite(s.location.lat) && Number.isFinite(s.location.lng) &&
                  !(s.location.lat === 0 && s.location.lng === 0))
      ? haversineMeters(lat, lng, s.location.lat, s.location.lng)
      : null;
    if (dist != null && dist > s.location.radius_m) {
      return errRes(`Absen keluar gagal. Anda berada di luar area absensi (jarak ${Math.round(dist)} m).`);
    }

    const photoBuf = dataUrlToBuffer(body.photo_data_url);
    if (!photoBuf || photoBuf.length === 0) return errRes('selfie belum diambil');
    if (photoBuf.length > 500 * 1024) return errRes('ukuran selfie terlalu besar (>500KB)');

    const date = witaDate();
    const rec = await db.collection('absensi_records').findOne({ user_id: user.id, date });
    if (!rec || !rec.actual_check_in) return errRes('Anda belum absen masuk hari ini');
    if (rec.actual_check_out) return errRes('Anda sudah absen keluar hari ini');

    const now = new Date();
    const nowMins = witaHM().mins;
    const workedMinutes = Math.max(0, nowMins - rec.effective_check_in_mins);
    const overtimeRaw = Math.max(0, nowMins - rec.shift_end_mins);
    const overtimeMinutes = overtimeRaw >= (s.overtime_min_minutes || 30) ? overtimeRaw : 0;
    const overtimeStatus = overtimeMinutes > 0 ? 'pending' : 'none';

    await db.collection('absensi_records').updateOne(
      { user_id: user.id, date },
      {
        $set: {
          actual_check_out: now,
          actual_check_out_wita: witaClock(),
          check_out_lat: lat,
          check_out_lng: lng,
          check_out_distance_m: dist != null ? Math.round(dist) : null,
          check_out_selfie: new Binary(photoBuf),
          worked_minutes: workedMinutes,
          overtime_minutes: overtimeMinutes,
          overtime_status: overtimeStatus,
          updatedAt: now,
        },
      }
    );
    const updated = await db.collection('absensi_records').findOne({ user_id: user.id, date });
    return jsonRes({ ok: true, record: serializeRecord(updated) });
  }

  // -------- MY HISTORY --------
  if (subPath === 'my-history' && method === 'GET') {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const filter = { user_id: user.id };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    const rows = await db.collection('absensi_records')
      .aggregate(listPipeline(filter, [{ $sort: { date: -1 } }, { $limit: 200 }]))
      .toArray();
    return jsonRes({ items: rows.map(serializeRecord) });
  }

  // -------- OWNER DASHBOARD (today) --------
  if (subPath === 'dashboard' && method === 'GET') {
    if (user.role !== 'owner') return errRes('hanya owner', 403);
    const date = witaDate();
    const rows = await db.collection('absensi_records')
      .aggregate(listPipeline({ date }))
      .toArray();
    // Also include ACTIVE staff who haven't punched-in today.
    const staff = await db.collection('employees')
      .find({ status: 'active', deleted: { $ne: true } })
      .toArray();
    const rowByUser = new Map(rows.map((r) => [r.user_id, r]));
    const notCheckedIn = staff
      .filter((e) => e.role !== 'owner' && !rowByUser.has(e.id))
      .map((e) => ({ user_id: e.id, user_name: e.name, user_role: e.role }));
    const summary = {
      total_staff: staff.filter((e) => e.role !== 'owner').length,
      checked_in: rows.filter((r) => r.actual_check_in).length,
      not_checked_in: notCheckedIn.length,
      late: rows.filter((r) => (r.late_minutes || 0) > 0).length,
      checked_out: rows.filter((r) => r.actual_check_out).length,
      still_working: rows.filter((r) => r.actual_check_in && !r.actual_check_out).length,
      overtime_pending: rows.filter((r) => r.overtime_status === 'pending').length,
    };
    return jsonRes({
      date,
      now: witaClock(),
      summary,
      records: rows.map(serializeRecord),
      not_checked_in: notCheckedIn,
    });
  }

  // -------- REPORT + EXCEL EXPORT (owner) --------
  // GET /api/absensi/report?from=YYYY-MM-DD&to=YYYY-MM-DD&user_id&shift_key&status=all|late|ontime
  // GET /api/absensi/report/export?...  → XLSX binary
  if ((subPath === 'report' || subPath === 'report/export') && method === 'GET') {
    if (user.role !== 'owner') return errRes('hanya owner', 403);
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const userId = url.searchParams.get('user_id') || '';
    const shiftKey = url.searchParams.get('shift_key') || '';
    const status = url.searchParams.get('status') || 'all';

    const filter = {};
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (userId) filter.user_id = userId;
    if (shiftKey) filter.shift_key = shiftKey;
    if (status === 'late') filter.late_minutes = { $gt: 0 };
    if (status === 'ontime') filter.late_minutes = { $lte: 0 };

    const rows = await db.collection('absensi_records')
      .aggregate(listPipeline(filter, [{ $sort: { date: -1, user_name: 1 } }, { $limit: 5000 }]))
      .toArray();

    // JSON report response.
    if (subPath === 'report') {
      return jsonRes({
        items: rows.map(serializeRecord),
        filter: { from, to, user_id: userId, shift_key: shiftKey, status },
        total: rows.length,
      });
    }

    // ---- Excel export path -------------------------------------------------
    // Header row + data rows. Numbers stay numeric so Excel can aggregate.
    const header = [
      'Tanggal', 'Nama Staff', 'Role', 'Shift', 'Jam Shift',
      'Jam Masuk', 'Jam Keluar',
      'Status Kehadiran', 'Menit Terlambat',
      'Total Kerja (menit)', 'Potensi Lembur (menit)', 'Status Lembur',
      'Ditinjau Oleh', 'Ditinjau At', 'Foto Selfie',
    ];
    const aoa = [header];
    for (const r of rows) {
      aoa.push([
        r.date || '',
        r.user_name || '',
        r.user_role || '',
        r.shift_name || '',
        r.shift_start && r.shift_end ? `${r.shift_start}-${r.shift_end}` : '',
        r.actual_check_in_wita || '',
        r.actual_check_out_wita || '',
        (r.late_minutes || 0) > 0 ? 'Terlambat' : (r.actual_check_in ? 'Tepat Waktu' : 'Belum Masuk'),
        Number(r.late_minutes || 0),
        Number(r.worked_minutes || 0),
        Number(r.overtime_minutes || 0),
        r.overtime_status || 'none',
        r.overtime_reviewed_by_name || '',
        r.overtime_reviewed_at ? new Date(r.overtime_reviewed_at).toISOString() : '',
        r.selfie_deleted ? 'Dihapus (retensi)' : ((r.has_check_in_photo || r.has_check_out_photo) ? 'Ada' : 'Tidak ada'),
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Simple column widths
    ws['!cols'] = [
      { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 18 }, { wch: 12 },
      { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 20 }, { wch: 20 }, { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Laporan Absensi');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fname = `laporan-absensi_${from || 'all'}_${to || 'all'}.xlsx`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fname}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // -------- OVERTIME LIST (owner) --------
  if (subPath === 'overtime' && method === 'GET') {
    if (user.role !== 'owner') return errRes('hanya owner', 403);
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'pending';
    const filter = { overtime_minutes: { $gt: 0 } };
    if (['pending', 'approved', 'rejected'].includes(status)) {
      filter.overtime_status = status;
    }
    const rows = await db.collection('absensi_records')
      .aggregate(listPipeline(filter, [{ $sort: { date: -1 } }, { $limit: 500 }]))
      .toArray();
    return jsonRes({ items: rows.map(serializeRecord) });
  }

  // -------- OVERTIME APPROVE / REJECT --------
  const otMatch = subPath.match(/^overtime\/([^/]+)\/(approve|reject)$/);
  if (otMatch && method === 'POST') {
    if (user.role !== 'owner') return errRes('hanya owner', 403);
    const [, recId, action] = otMatch;
    const body = await req.json().catch(() => ({}));
    const rec = await db.collection('absensi_records').findOne({ id: recId });
    if (!rec) return errRes('record tidak ditemukan', 404);
    if (!(rec.overtime_minutes > 0)) return errRes('record ini tidak memiliki potensi lembur');
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await db.collection('absensi_records').updateOne(
      { id: recId },
      {
        $set: {
          overtime_status: newStatus,
          overtime_reviewed_by_id: user.id,
          overtime_reviewed_by_name: user.name,
          overtime_reviewed_at: new Date(),
          overtime_review_note: String(body.note || '').slice(0, 200) || null,
          updatedAt: new Date(),
        },
      }
    );
    const updated = await db.collection('absensi_records').findOne({ id: recId });
    return jsonRes({ ok: true, record: serializeRecord(updated) });
  }

  // -------- SELFIE STREAM (owner or self, safeguarded) --------
  // GET /api/absensi/record/:id/selfie/(in|out)
  const selfieMatch = subPath.match(/^record\/([^/]+)\/selfie\/(in|out)$/);
  if (selfieMatch && method === 'GET') {
    const [, recId, which] = selfieMatch;
    const rec = await db.collection('absensi_records').findOne({ id: recId });
    if (!rec) return errRes('record tidak ditemukan', 404);
    if (user.role !== 'owner' && user.id !== rec.user_id) return errRes('forbidden', 403);
    const bin = which === 'in' ? rec.check_in_selfie : rec.check_out_selfie;
    if (!bin) return errRes('selfie tidak tersedia', 404);
    const buf = Buffer.from(bin.buffer || bin);
    // Content type: try to sniff — webp starts with "RIFF....WEBP", jpeg with FFD8FF, png 89 50 4E 47
    let ct = 'image/webp';
    if (buf[0] === 0xff && buf[1] === 0xd8) ct = 'image/jpeg';
    else if (buf[0] === 0x89 && buf[1] === 0x50) ct = 'image/png';
    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=300' },
    });
  }

  return null;
}
