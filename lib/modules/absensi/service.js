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
  // Threshold (menit) setelah jam selesai shift sebelum staff boleh mengajukan
  // lembur. Tombol "Pengajuan Lembur" tetap terlihat tapi disabled sebelum
  // batas ini terlewati. Nilai default 15 menit (sesuai spec MIS).
  overtime_request_threshold_min: 15,
  // Mode Stock Opname (SO). Saat OFF: tombol SO tetap terlihat tapi
  // disabled. Saat ON: staff boleh check-in dengan flag SO — untuk shift
  // Sore, jam kerja efektif = actual check-in (bukan shift_start).
  so_mode_enabled: false,
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
    overtime_request_threshold_min: s.overtime_request_threshold_min ?? 15,
    so_mode_enabled: !!s.so_mode_enabled,
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
          { overtime_photo: { $exists: true, $ne: null } },
        ],
      },
      {
        $set: { selfie_deleted: true, selfie_deleted_at: new Date() },
        $unset: { check_in_selfie: '', check_out_selfie: '', overtime_photo: '' },
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

// ============================================================================
// Reward Poin Absen — additive sub-system on top of the existing Absensi data.
// Nothing here mutates absensi_records. All point events live in a NEW
// collection `absensi_point_ledger` with a UNIQUE index on {source_id, event_type}
// so replaying the ledger derivation is idempotent (satu absensi = satu ledger).
// ============================================================================
const DEFAULT_POINT_SETTINGS = {
  id: 'default',
  // Legacy fields (kept for backward compatibility with the initial schema).
  // If `late_tiers` is present, those override these — legacy fields are only
  // used as fallback.
  points_ontime: 10,           // Tepat waktu (late <= 0)
  points_late_lt_10: 7,        // Terlambat < 10 menit
  points_late_10_to_30: 5,     // Terlambat 10..30 menit
  points_late_gt_30: 0,        // Terlambat > 30 menit
  // NEW (2026-02): fully dynamic late-tier ladder. Owner can add / remove
  // rows via the Pengaturan Poin UI. Each entry:
  //   max_late_minutes:  upper bound (inclusive). null = tak terhingga (last).
  //   points:            signed int.
  //   label:             free-text description shown in ledger reason.
  late_tiers: [
    { max_late_minutes: 0, points: 10, label: 'Tepat waktu' },
    { max_late_minutes: 10, points: 7, label: 'Terlambat <10 menit' },
    { max_late_minutes: 30, points: 5, label: 'Terlambat 10–30 menit' },
    { max_late_minutes: null, points: 0, label: 'Terlambat >30 menit' },
  ],
  // Balance rules.
  initial_balance: 100,
  max_positive: 150,
  max_negative: -50,
  rupiah_per_point: 2500,      // hanya untuk internal owner (opsional tampilan)
};

// Normalize + sort tiers. Removes obviously-bad rows (non-numeric points).
// The final tier's max_late_minutes is FORCED to null (catch-all).
function normalizeLateTiers(tiers) {
  if (!Array.isArray(tiers)) return null;
  const cleaned = tiers
    .map((t) => {
      const raw = t?.max_late_minutes;
      const maxL = raw === null || raw === undefined || raw === '' ? null : Number(raw);
      const pts = Math.round(Number(t?.points));
      const label = String(t?.label || '').trim().slice(0, 60);
      return {
        max_late_minutes: maxL === null || !Number.isFinite(maxL) ? null : Math.max(0, Math.min(1440, maxL)),
        points: Number.isFinite(pts) ? Math.max(-1000, Math.min(1000, pts)) : 0,
        label,
      };
    })
    .filter((t) => t.label !== '' || t.max_late_minutes !== null || t.points !== 0);
  if (cleaned.length === 0) return null;
  // Sort ascending by max_late_minutes; nulls last.
  cleaned.sort((a, b) => {
    if (a.max_late_minutes === null) return 1;
    if (b.max_late_minutes === null) return -1;
    return a.max_late_minutes - b.max_late_minutes;
  });
  // Force the LAST row to be the catch-all (null) so callers never miss a bucket.
  cleaned[cleaned.length - 1] = { ...cleaned[cleaned.length - 1], max_late_minutes: null };
  return cleaned;
}

function pointsForCheckin(lateMinutes, ps) {
  const l = Number(lateMinutes || 0);
  const tiers = normalizeLateTiers(ps?.late_tiers);
  if (tiers && tiers.length) {
    for (const t of tiers) {
      if (t.max_late_minutes === null || l <= t.max_late_minutes) {
        return Number(t.points);
      }
    }
    // Fallthrough shouldn't happen because last tier is catch-all.
    return 0;
  }
  // Legacy fallback (pre-2026-02 settings docs without late_tiers).
  if (l <= 0) return Number(ps?.points_ontime ?? 10);
  if (l < 10) return Number(ps?.points_late_lt_10 ?? 7);
  if (l <= 30) return Number(ps?.points_late_10_to_30 ?? 5);
  return Number(ps?.points_late_gt_30 ?? 0);
}

function labelForCheckin(lateMinutes, ps) {
  const l = Number(lateMinutes || 0);
  const tiers = normalizeLateTiers(ps?.late_tiers);
  if (tiers && tiers.length) {
    for (const t of tiers) {
      if (t.max_late_minutes === null || l <= t.max_late_minutes) {
        return t.label || (t.max_late_minutes === null ? 'Kategori akhir' : `<=${t.max_late_minutes}m`);
      }
    }
  }
  if (l <= 0) return 'Tepat waktu';
  if (l < 10) return 'Terlambat <10 menit';
  if (l <= 30) return 'Terlambat 10–30 menit';
  return 'Terlambat >30 menit';
}

// Reward period runs from the 26th of the previous month to the 25th of the
// current month. e.g. period key "2026-08" = 26 Jul → 25 Aug.
// Given a date string YYYY-MM-DD, returns the period key it belongs to.
function periodKeyForDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null;
  const [ys, ms, ds] = dateStr.split('-').map((v) => parseInt(v, 10));
  let y = ys;
  let m = ms;
  if (ds >= 26) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Given "YYYY-MM" period key, returns {from, to} date strings inclusive.
function periodRange(periodKey) {
  const [ys, ms] = periodKey.split('-').map((v) => parseInt(v, 10));
  let py = ys;
  let pm = ms - 1;
  if (pm < 1) { pm = 12; py -= 1; }
  const from = `${py}-${String(pm).padStart(2, '0')}-26`;
  const to = `${ys}-${String(ms).padStart(2, '0')}-25`;
  return { from, to };
}

async function loadPointSettings(db) {
  let s = await db.collection('absensi_point_settings').findOne({ id: 'default' });
  if (!s) {
    s = { ...DEFAULT_POINT_SETTINGS, createdAt: new Date() };
    await db.collection('absensi_point_settings').insertOne(s);
  }
  return { ...DEFAULT_POINT_SETTINGS, ...s };
}

async function ensurePointIndexes(db) {
  try {
    await db.collection('absensi_point_ledger').createIndex(
      { source_id: 1, event_type: 1 },
      { unique: true }
    );
    await db.collection('absensi_point_ledger').createIndex({ user_id: 1, period_key: 1 });
    await db.collection('absensi_point_ledger').createIndex({ period_key: 1 });
  } catch { /* idempotent */ }
}

// Idempotently create ledger rows for every absensi_records check-in in the
// given date range that doesn't already have a 'checkin' ledger entry.
// Called on demand (from leaderboard/history endpoints) so pre-existing
// records also participate. New check-ins also call this via handleCheckin.
async function backfillCheckinLedger(db, { from, to }) {
  const ps = await loadPointSettings(db);
  const records = await db.collection('absensi_records')
    .find({
      date: { $gte: from, $lte: to },
      actual_check_in: { $ne: null },
    })
    .project({
      id: 1, user_id: 1, user_name: 1, date: 1, late_minutes: 1,
      shift_key: 1, shift_name: 1,
    })
    .toArray();
  for (const r of records) {
    if (!r.user_id) continue;
    const pts = pointsForCheckin(r.late_minutes, ps);
    const label = labelForCheckin(r.late_minutes, ps);
    const doc = {
      id: uuidv4(),
      user_id: r.user_id,
      user_name: r.user_name || '',
      event_type: 'checkin',
      event_date: r.date,
      period_key: periodKeyForDate(r.date),
      points: pts,
      reason: `${label} (${r.shift_name || r.shift_key || 'shift'})`,
      source_id: r.id,
      source_late_minutes: Number(r.late_minutes || 0),
      created_by_id: null,
      created_by_name: null,
      createdAt: new Date(),
    };
    // Idempotent thanks to the unique {source_id, event_type} index.
    try {
      await db.collection('absensi_point_ledger').insertOne(doc);
    } catch (e) {
      // Duplicate key = already inserted for this record. Ignore silently.
      if (e?.code !== 11000) throw e;
    }
  }
}

// Fetch the active roster (used to include zero-balance staff on the board).
async function getActiveStaff(db) {
  const rows = await db.collection('employees')
    .find({ status: 'active', deleted: { $ne: true } })
    .project({ id: 1, name: 1, role: 1, modules: 1 })
    .toArray();
  // Only staff who actually have Absensi permission (or owners) are relevant.
  return rows.filter((e) =>
    e.role === 'owner' ||
    (Array.isArray(e.modules) && e.modules.includes('absensi'))
  ).filter((e) => e.role !== 'owner'); // owner not on staff leaderboard
}

// Compute leaderboard for a period, capped to max_positive/max_negative.
async function computeLeaderboard(db, periodKey) {
  const ps = await loadPointSettings(db);
  const initial = Number(ps.initial_balance ?? 100);
  const maxPos = Number(ps.max_positive ?? 150);
  const maxNeg = Number(ps.max_negative ?? -50);
  const clamp = (n) => Math.max(maxNeg, Math.min(maxPos, n));
  // Normalize late tiers so the board can show a compact rules summary
  // to ALL users (staff + owner). Never expose rupiah_per_point here.
  const tiersOut = normalizeLateTiers(ps.late_tiers) || null;

  const grouped = await db.collection('absensi_point_ledger')
    .aggregate([
      { $match: { period_key: periodKey } },
      { $group: { _id: { user_id: '$user_id', user_name: '$user_name' }, sum: { $sum: '$points' } } },
    ])
    .toArray();
  const byUser = new Map();
  for (const g of grouped) {
    byUser.set(g._id.user_id, { user_id: g._id.user_id, user_name: g._id.user_name, delta: g.sum });
  }
  const staff = await getActiveStaff(db);
  const rows = staff.map((e) => {
    const entry = byUser.get(e.id);
    const delta = entry?.delta ?? 0;
    const uncapped = initial + delta;
    const balance = clamp(uncapped);
    return {
      user_id: e.id,
      user_name: entry?.user_name || e.name,
      initial_balance: initial,
      delta,
      balance,
      capped: balance !== uncapped,
    };
  });
  rows.sort((a, b) => b.balance - a.balance || a.user_name.localeCompare(b.user_name));
  return {
    period_key: periodKey,
    period_range: periodRange(periodKey),
    settings: {
      initial_balance: initial,
      max_positive: maxPos,
      max_negative: maxNeg,
      late_tiers: tiersOut,
    },
    items: rows.map((r, i) => ({ rank: i + 1, ...r })),
  };
}

function serializeRecord(r) {
  if (!r) return null;
  const { _id, check_in_selfie, check_out_selfie, overtime_photo, ...safe } = r;
  return {
    ...safe,
    // Prefer explicit booleans if already added by an aggregation pipeline;
    // fall back to inspecting the raw binary fields when present.
    has_check_in_photo: safe.has_check_in_photo != null ? !!safe.has_check_in_photo : !!check_in_selfie,
    has_check_out_photo: safe.has_check_out_photo != null ? !!safe.has_check_out_photo : !!check_out_selfie,
    has_overtime_photo: safe.has_overtime_photo != null ? !!safe.has_overtime_photo : !!overtime_photo,
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
        has_overtime_photo: { $cond: [{ $ifNull: ['$overtime_photo', false] }, true, false] },
      },
    },
    { $project: { check_in_selfie: 0, check_out_selfie: 0, overtime_photo: 0, _id: 0 } },
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
    if (body.overtime_request_threshold_min !== undefined) {
      const raw = Number(body.overtime_request_threshold_min);
      const n = Number.isFinite(raw) ? raw : 15;
      upd.overtime_request_threshold_min = Math.max(0, Math.min(240, n));
    }
    if (body.so_mode_enabled !== undefined) {
      upd.so_mode_enabled = !!body.so_mode_enabled;
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
      settings: publicSettings(s),
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
    // Stock Opname flag — hanya berpengaruh saat Mode SO ON di settings owner.
    // Untuk shift Sore + SO: jam kerja EFEKTIF dimulai dari waktu absen masuk
    // aktual (bukan shift_start) — datang lebih awal DIHITUNG jam kerja sah,
    // BUKAN lembur. Untuk shift Pagi + SO: perilaku sama dengan check-in
    // normal (07:00–15:00), tidak ada kredit datang lebih awal.
    const soEnabled = !!s.so_mode_enabled;
    const soSelected = soEnabled && body.so_selected === true;
    const isSore = shift.key === 'apotek_sore' || /sore/i.test(shift.name || '');
    let effectiveMins;
    if (soSelected && isSore) {
      // Datang lebih awal saat SO Sore = jam kerja sah dari actual check-in.
      effectiveMins = nowMins;
    } else {
      // Effective check-in = max(actual, shift_start). Early arrivals don't gain hours.
      effectiveMins = Math.max(nowMins, shiftStartMins);
    }
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
      // Stock Opname flags. so_selected disimpan supaya laporan bisa
      // menampilkan status SO tanpa perlu hitung ulang effectiveMins.
      so_selected: soSelected,
      so_effective_start_mins: soSelected && isSore ? effectiveMins : null,
      actual_check_out: null,
      check_out_lat: null,
      check_out_lng: null,
      check_out_distance_m: null,
      check_out_selfie: null,
      worked_minutes: null,
      overtime_minutes: 0,
      overtime_status: 'none', // none | pending | approved | rejected
      overtime_requested: false,
      overtime_requested_at: null,
      overtime_reason: null,
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

    // ---- Reward Poin Absen: idempotent ledger entry for this check-in ----
    try {
      await ensurePointIndexes(db);
      const ps = await loadPointSettings(db);
      const ledger = {
        id: uuidv4(),
        user_id: doc.user_id,
        user_name: doc.user_name,
        event_type: 'checkin',
        event_date: doc.date,
        period_key: periodKeyForDate(doc.date),
        points: pointsForCheckin(doc.late_minutes, ps),
        reason: labelForCheckin(doc.late_minutes, ps) + ` (${doc.shift_name || doc.shift_key})`,
        source_id: doc.id,
        source_late_minutes: doc.late_minutes,
        created_by_id: null,
        created_by_name: null,
        createdAt: now,
      };
      // Unique index on {source_id, event_type} dedupes replays.
      await db.collection('absensi_point_ledger').insertOne(ledger).catch((e) => {
        if (e?.code !== 11000) throw e;
      });
    } catch (e) {
      // Never block check-in on a point-ledger failure.
      console.error('[Absensi points] check-in ledger insert failed:', e);
    }

    return jsonRes({ ok: true, record: serializeRecord(doc) });
  }

  // -------- CHECK-OUT --------
  if (subPath === 'check-out' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const s = await loadSettings(db);

    // 1) QR validation — identical to check-in so absen keluar juga wajib
    // scan QR statis milik Owner (mencegah absen keluar dari jarak jauh).
    const qrRaw = String(body.qr_value || '').trim();
    if (!qrRaw) return errRes('QR belum discan');
    if (qrRaw !== `MIS-ABSENSI:${s.qr_secret}`) return errRes('QR tidak valid — bukan QR Absensi MIS');

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
    // Potensi lembur = menit setelah shift_end. Hanya DIHITUNG sebagai lembur
    // jika staff sudah mengajukan Pengajuan Lembur (rec.overtime_requested).
    // Kalau tidak ada pengajuan, lembur = 0 dan waktu setelah shift TIDAK
    // dianggap lembur — mirror spec "Tidak mengajukan: → waktu setelah shift
    // tidak dihitung lembur." Kolom `overtime_raw_minutes` tetap disimpan
    // supaya laporan bisa menampilkan potensi yang tidak diklaim.
    const overtimeRaw = Math.max(0, nowMins - rec.shift_end_mins);
    const overtimeThreshold = s.overtime_min_minutes || 30;
    const hasRequest = !!rec.overtime_requested;
    const overtimeMinutes = (hasRequest && overtimeRaw >= overtimeThreshold) ? overtimeRaw : 0;
    // Jika sudah ada pengajuan → status tetap 'pending' menunggu owner
    // approve/reject. Jika belum ada pengajuan → 'none' (finalized as no lembur).
    const overtimeStatus = hasRequest
      ? (rec.overtime_status === 'approved' || rec.overtime_status === 'rejected'
          ? rec.overtime_status
          : 'pending')
      : 'none';

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
          overtime_raw_minutes: overtimeRaw,
          overtime_status: overtimeStatus,
          updatedAt: now,
        },
      }
    );
    const updated = await db.collection('absensi_records').findOne({ user_id: user.id, date });
    return jsonRes({ ok: true, record: serializeRecord(updated) });
  }

  // -------- LEMBUR SUBMIT (staff) --------
  // POST /api/absensi/lembur/submit  body { reason (req), photo_data_url (opt) }
  // Menandai record hari ini sebagai request lembur. Owner tetap menggunakan
  // endpoint /overtime/:id/approve|reject existing untuk menyetujui / menolak.
  if (subPath === 'lembur/submit' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const s = await loadSettings(db);
    const date = witaDate();
    const rec = await db.collection('absensi_records').findOne({ user_id: user.id, date });
    if (!rec || !rec.actual_check_in) return errRes('Anda belum absen masuk hari ini');
    // Tolak jika sudah Absen Keluar — sesuai spec: pengajuan lembur tidak
    // boleh dibuat setelah timestamp Absen Keluar tersimpan.
    if (rec.actual_check_out) return errRes('Anda sudah absen keluar — pengajuan lembur tidak bisa dibuat');
    if (rec.overtime_requested) return errRes('Pengajuan lembur sudah dikirim untuk hari ini');
    // Threshold: pengajuan hanya boleh setelah shift_end + N menit.
    const nowMins = witaHM().mins;
    const threshold = Number(s.overtime_request_threshold_min ?? 15);
    const earliestMins = Number(rec.shift_end_mins || 0) + threshold;
    if (nowMins < earliestMins) {
      const remain = earliestMins - nowMins;
      return errRes(`Pengajuan lembur baru boleh dikirim ${remain} menit lagi (>= ${threshold} menit setelah jam selesai shift)`);
    }
    const reason = String(body.reason || '').trim();
    if (reason.length < 3) return errRes('Alasan lembur wajib diisi (minimal 3 karakter)');
    if (reason.length > 500) return errRes('Alasan terlalu panjang (maks. 500 karakter)');
    // Foto OPSIONAL. Kompresi sudah dilakukan di client (reuse compressToWebp).
    let photoUpdate = {};
    if (body.photo_data_url) {
      const buf = dataUrlToBuffer(body.photo_data_url);
      if (buf && buf.length > 0) {
        if (buf.length > 500 * 1024) return errRes('ukuran foto terlalu besar (>500KB)');
        photoUpdate = { overtime_photo: new Binary(buf) };
      }
    }
    const now = new Date();
    await db.collection('absensi_records').updateOne(
      { user_id: user.id, date },
      {
        $set: {
          overtime_requested: true,
          overtime_requested_at: now,
          overtime_reason: reason,
          overtime_status: 'pending',
          updatedAt: now,
          ...photoUpdate,
        },
      }
    );
    const updated = await db.collection('absensi_records').findOne({ user_id: user.id, date });
    return jsonRes({ ok: true, record: serializeRecord(updated) });
  }

  // -------- LEMBUR PHOTO (owner or self) --------
  // GET /api/absensi/lembur/:recId/photo
  const lemburPhotoMatch = subPath.match(/^lembur\/([^/]+)\/photo$/);
  if (lemburPhotoMatch && method === 'GET') {
    const [, recId] = lemburPhotoMatch;
    const rec = await db.collection('absensi_records').findOne({ id: recId });
    if (!rec) return errRes('record tidak ditemukan', 404);
    if (user.role !== 'owner' && user.id !== rec.user_id) return errRes('forbidden', 403);
    const bin = rec.overtime_photo;
    if (!bin) return errRes('foto lembur tidak tersedia', 404);
    const buf = Buffer.from(bin.buffer || bin);
    let ct = 'image/webp';
    if (buf[0] === 0xff && buf[1] === 0xd8) ct = 'image/jpeg';
    else if (buf[0] === 0x89 && buf[1] === 0x50) ct = 'image/png';
    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=60' },
    });
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
    // Load current settings once — the radius stored per record is not
    // available yet (only distance is), so surface the current radius_m so
    // the Verifikasi detail can render "Radius: 50 m" consistently.
    const s = await loadSettings(db);
    const radiusM = Number(s.location?.radius_m || 50);

    // JSON report response.
    if (subPath === 'report') {
      return jsonRes({
        items: rows.map(serializeRecord),
        filter: { from, to, user_id: userId, shift_key: shiftKey, status },
        total: rows.length,
        location: { name: s.location?.name || '', lat: s.location?.lat, lng: s.location?.lng, radius_m: radiusM },
      });
    }

    // ---- Excel export path -------------------------------------------------
    // Menghasilkan 1 workbook dengan 7 sheet: Rekapitulasi, Identitas, Absensi,
    // Jam Kerja, Stock Opname, Lembur, Verifikasi. Semua sheet reuse `rows` di
    // atas — sumber data & filter SAMA persis dengan laporan JSON. Tidak ada
    // perhitungan baru: kolom "Diakui" = hasil field existing pada record.
    const fmtMinsToHours = (mins) => {
      const n = Number(mins || 0);
      // Nilai numeric jam (2 desimal) supaya Excel bisa SUM lintas periode.
      return Math.round((n / 60) * 100) / 100;
    };
    const fmtHMFromMins = (mins) => {
      const m = Number(mins || 0);
      if (!Number.isFinite(m) || m <= 0) return '';
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    };
    const jamShift = (r) => (r.shift_start && r.shift_end) ? `${r.shift_start}-${r.shift_end}` : '';

    // ---- Definisi jam DIAKUI (sumber tunggal untuk semua sheet) -----------
    // Prinsip: Jam Kerja Aktual = out - in (raw). Jam Kerja Diakui = irisan
    // aktual dengan shift normal. Jam SO Diakui = porsi datang lebih awal
    // yang berada di luar shift TAPI staff memilih SO. Jam Lembur Diakui =
    // overtime_minutes bila overtime_status === 'approved' (else 0). Tidak
    // ada double counting antara ketiganya.
    const parseWitaHM = (s) => {
      if (!s || typeof s !== 'string') return null;
      // Backend `witaClock()` pakai locale id-ID yang menghasilkan separator
      // TITIK (contoh "15.35"). Sebagian data lama & sheet manual mungkin
      // pakai colon "15:35". Terima keduanya supaya derivasi Diakui bekerja
      // untuk semua record historis.
      const m = s.match(/^(\d{1,2})[.:](\d{2})$/);
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
      return h * 60 + min;
    };
    const deriveDiakui = (r) => {
      const shiftStart = Number(r.shift_start_mins || 0);
      const shiftEnd = Number(r.shift_end_mins || 0);
      const inMins = parseWitaHM(r.actual_check_in_wita);
      const outMins = parseWitaHM(r.actual_check_out_wita);
      // Aktual = out - in (menit; 0 bila salah satu belum ada).
      const aktualMins = (inMins != null && outMins != null) ? Math.max(0, outMins - inMins) : 0;
      // Diakui = intersection([in,out], [shiftStart, shiftEnd]).
      let kerjaMins = 0;
      if (inMins != null && outMins != null) {
        const a = Math.max(inMins, shiftStart);
        const b = Math.min(outMins, shiftEnd);
        kerjaMins = Math.max(0, b - a);
      }
      // SO Diakui = hanya bila so_selected DAN staff masuk sebelum shift_start.
      // Waktu SO sah = [in, min(out, shiftStart)] — DI LUAR jam kerja diakui.
      let soMins = 0;
      if (r.so_selected && inMins != null && outMins != null && inMins < shiftStart) {
        soMins = Math.max(0, Math.min(outMins, shiftStart) - inMins);
      }
      // Lembur Diakui = hanya bila approved (backend sudah set 0 saat reject).
      const lemburMins = r.overtime_status === 'approved' ? Number(r.overtime_minutes || 0) : 0;
      return { aktualMins, kerjaMins, soMins, lemburMins, inMins, outMins, shiftStart, shiftEnd };
    };

    // ---- Sheet 1: Rekapitulasi (satu baris per staff, seluruh periode) ---
    const rekapMap = new Map(); // user_id => { name, workMins, soMins, otMins }
    for (const r of rows) {
      const uid = r.user_id;
      if (!uid) continue;
      const d = deriveDiakui(r);
      const bucket = rekapMap.get(uid) || {
        name: r.user_name || '(tanpa nama)',
        role: r.user_role || '',
        workMins: 0,
        soMins: 0,
        overtimeMins: 0,
      };
      bucket.workMins += d.kerjaMins;
      bucket.soMins += d.soMins;
      bucket.overtimeMins += d.lemburMins;
      rekapMap.set(uid, bucket);
    }
    const rekapRows = Array.from(rekapMap.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b) => {
        const work = fmtMinsToHours(b.workMins);
        const so = fmtMinsToHours(b.soMins);
        const ot = fmtMinsToHours(b.overtimeMins);
        // Total Jam Diakui = Kerja + SO + Lembur (spec).
        return [b.name, work, so, ot, Math.round((work + so + ot) * 100) / 100];
      });
    const rekapAOA = [
      ['Nama Staff', 'Total Jam Kerja Diakui (jam)', 'Total Jam SO Diakui (jam)', 'Total Jam Lembur Diakui (jam)', 'Total Jam Diakui (jam)'],
      ...rekapRows,
    ];

    // ---- Sheet 2: Identitas ------------------------------------------------
    const identitasAOA = [
      ['Tanggal', 'Nama Staff', 'Role/Bagian', 'Shift', 'Jadwal Shift'],
      ...rows.map((r) => [
        r.date || '',
        r.user_name || '',
        r.user_role || '',
        r.shift_name || '',
        jamShift(r),
      ]),
    ];

    // ---- Sheet 3: Absensi --------------------------------------------------
    const absensiAOA = [
      ['Tanggal', 'Nama Staff', 'Shift', 'Jadwal Shift', 'Jam Masuk', 'Jam Keluar', 'Status Kehadiran', 'Menit Terlambat'],
      ...rows.map((r) => [
        r.date || '',
        r.user_name || '',
        r.shift_name || '',
        jamShift(r),
        r.actual_check_in_wita || '',
        r.actual_check_out_wita || '',
        (r.late_minutes || 0) > 0 ? 'Terlambat' : (r.actual_check_in ? 'Tepat Waktu' : 'Belum Masuk'),
        Number(r.late_minutes || 0),
      ]),
    ];

    // ---- Sheet 4: Jam Kerja ------------------------------------------------
    // Normal = shift_end - shift_start (menit).
    // Aktual = check_out - check_in (dalam menit-of-day WITA).
    // Diakui = irisan aktual dengan shift normal (deriveDiakui.kerjaMins).
    const jamKerjaAOA = [
      ['Tanggal', 'Nama Staff', 'Jam Kerja Normal (jam)', 'Jam Kerja Aktual (jam)', 'Jam Kerja Diakui (jam)'],
      ...rows.map((r) => {
        const d = deriveDiakui(r);
        const normalMins = Math.max(0, d.shiftEnd - d.shiftStart);
        const aktual = (d.inMins != null && d.outMins != null) ? fmtMinsToHours(d.aktualMins) : '-';
        return [
          r.date || '',
          r.user_name || '',
          fmtMinsToHours(normalMins),
          aktual,
          fmtMinsToHours(d.kerjaMins),
        ];
      }),
    ];

    // ---- Sheet 5: Stock Opname --------------------------------------------
    // Hanya baris yang so_selected=true. Jam SO Diakui = deriveDiakui.soMins
    // (porsi datang lebih awal yang berada di luar shift normal).
    const soAOA = [
      ['Tanggal', 'Nama Staff', 'Shift', 'Status SO', 'Jam Masuk SO', 'Jam Kerja Efektif SO', 'Jam SO Diakui (jam)'],
      ...rows.filter((r) => r.so_selected).map((r) => {
        const d = deriveDiakui(r);
        const soEffStart = r.so_effective_start_mins != null ? fmtHMFromMins(r.so_effective_start_mins) : '';
        const endLabel = r.actual_check_out_wita || r.shift_end || '';
        const efektifRange = soEffStart && endLabel ? `${soEffStart}-${endLabel}` : (r.actual_check_in_wita || '');
        return [
          r.date || '',
          r.user_name || '',
          r.shift_name || '',
          'Ya',
          r.actual_check_in_wita || '',
          efektifRange,
          fmtMinsToHours(d.soMins),
        ];
      }),
    ];
    if (soAOA.length === 1) soAOA.push(['-', '-', '-', '-', '-', '-', '-']);

    // ---- Sheet 6: Lembur ---------------------------------------------------
    const lemburAOA = [
      ['Tanggal', 'Nama Staff', 'Shift', 'Jam Selesai Shift', 'Jam Mulai Lembur', 'Jam Selesai Lembur',
       'Potensi Lembur (jam)', 'Alasan', 'Status Approval', 'Approver', 'Jam Lembur Diakui (jam)'],
      ...rows.filter((r) => r.overtime_requested || r.overtime_minutes > 0).map((r) => {
        const d = deriveDiakui(r);
        const potensi = Number(r.overtime_raw_minutes ?? r.overtime_minutes ?? 0);
        return [
          r.date || '',
          r.user_name || '',
          r.shift_name || '',
          r.shift_end || '',
          r.overtime_requested ? (r.shift_end || '') : '',
          r.actual_check_out_wita || '',
          fmtMinsToHours(potensi),
          r.overtime_reason || '',
          r.overtime_status || 'none',
          r.overtime_reviewed_by_name || '',
          fmtMinsToHours(d.lemburMins),
        ];
      }),
    ];
    if (lemburAOA.length === 1) lemburAOA.push(['-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']);

    // ---- Sheet 7: Verifikasi (foto + GPS) ---------------------------------
    const verifAOA = [
      ['Tanggal', 'Nama Staff',
       'Status Foto Masuk', 'Latitude Masuk', 'Longitude Masuk', 'Jarak Masuk (m)', 'Radius Masuk (m)', 'Status GPS Masuk',
       'Status Foto Keluar', 'Latitude Keluar', 'Longitude Keluar', 'Jarak Keluar (m)', 'Radius Keluar (m)', 'Status GPS Keluar'],
      ...rows.map((r) => {
        const photoIn = r.selfie_deleted ? 'Dihapus (retensi)' : (r.has_check_in_photo ? 'Ada' : 'Tidak ada');
        const photoOut = r.selfie_deleted ? 'Dihapus (retensi)' : (r.has_check_out_photo ? 'Ada' : 'Tidak ada');
        const gpsInStatus = r.check_in_distance_m == null ? '-' : (Number(r.check_in_distance_m) <= radiusM ? 'Valid' : 'Tidak Valid');
        const gpsOutStatus = r.check_out_distance_m == null ? '-' : (Number(r.check_out_distance_m) <= radiusM ? 'Valid' : 'Tidak Valid');
        return [
          r.date || '',
          r.user_name || '',
          photoIn,
          r.check_in_lat != null ? Number(r.check_in_lat) : '-',
          r.check_in_lng != null ? Number(r.check_in_lng) : '-',
          r.check_in_distance_m != null ? Number(r.check_in_distance_m) : '-',
          radiusM,
          gpsInStatus,
          photoOut,
          r.check_out_lat != null ? Number(r.check_out_lat) : '-',
          r.check_out_lng != null ? Number(r.check_out_lng) : '-',
          r.check_out_distance_m != null ? Number(r.check_out_distance_m) : '-',
          r.actual_check_out ? radiusM : '-',
          gpsOutStatus,
        ];
      }),
    ];

    // ---- Build workbook (urutan sheet sesuai spec) -------------------------
    const wb = XLSX.utils.book_new();
    const withCols = (aoa, widths) => {
      const w = XLSX.utils.aoa_to_sheet(aoa);
      if (widths) w['!cols'] = widths.map((wch) => ({ wch }));
      return w;
    };
    XLSX.utils.book_append_sheet(wb, withCols(rekapAOA, [22, 22, 20, 22, 20]), 'Rekapitulasi');
    XLSX.utils.book_append_sheet(wb, withCols(identitasAOA, [12, 22, 14, 18, 12]), 'Identitas');
    XLSX.utils.book_append_sheet(wb, withCols(absensiAOA, [12, 22, 18, 12, 10, 10, 16, 14]), 'Absensi');
    XLSX.utils.book_append_sheet(wb, withCols(jamKerjaAOA, [12, 22, 18, 18, 20]), 'Jam Kerja');
    XLSX.utils.book_append_sheet(wb, withCols(soAOA, [12, 22, 18, 10, 12, 22, 18]), 'Stock Opname');
    XLSX.utils.book_append_sheet(wb, withCols(lemburAOA, [12, 22, 18, 14, 14, 14, 16, 30, 16, 20, 20]), 'Lembur');
    XLSX.utils.book_append_sheet(wb, withCols(verifAOA, [12, 22, 14, 12, 12, 12, 10, 14, 14, 12, 12, 12, 10, 14]), 'Verifikasi');

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
    // Include records with an explicit request even if final overtime_minutes
    // hasn't been calculated yet (staff still working past shift-end).
    const filter = {
      $or: [
        { overtime_minutes: { $gt: 0 } },
        { overtime_requested: true },
      ],
    };
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
    if (!(rec.overtime_minutes > 0) && !rec.overtime_requested) {
      return errRes('record ini tidak memiliki potensi lembur');
    }
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    // Saat REJECT: lembur diakui = 0 (jam kerja mengikuti shift normal),
    // waktu absen keluar aktual tetap tersimpan.
    const upd = {
      overtime_status: newStatus,
      overtime_reviewed_by_id: user.id,
      overtime_reviewed_by_name: user.name,
      overtime_reviewed_at: new Date(),
      overtime_review_note: String(body.note || '').slice(0, 200) || null,
      updatedAt: new Date(),
    };
    if (newStatus === 'rejected') upd.overtime_minutes = 0;
    await db.collection('absensi_records').updateOne({ id: recId }, { $set: upd });
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

  // ============================================================
  // Reward Poin Absen (submodule)
  // ============================================================

  // Helper: default to the WITA-current period.
  const currentPeriod = () => periodKeyForDate(witaDate());

  // -------- Settings (points) --------
  if (subPath === 'points/settings' && method === 'GET') {
    const ps = await loadPointSettings(db);
    // Staff sees all rules & balance limits (needed for meaningful UI) but
    // NOT rupiah_per_point (nilai rupiah tidak perlu ditampilkan ke staff).
    if (user.role === 'owner') {
      const { _id, ...safe } = ps;
      return jsonRes({ settings: safe });
    }
    const { rupiah_per_point, _id, ...publicPs } = ps;
    return jsonRes({ settings: publicPs });
  }

  if (subPath === 'points/settings' && method === 'PUT') {
    if (user.role !== 'owner') return errRes('hanya owner', 403);
    const body = await req.json().catch(() => ({}));
    const upd = { updatedAt: new Date() };
    const clampInt = (v, lo, hi, dflt) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return dflt;
      return Math.max(lo, Math.min(hi, Math.round(n)));
    };
    if (body.points_ontime !== undefined) upd.points_ontime = clampInt(body.points_ontime, -100, 100, 10);
    if (body.points_late_lt_10 !== undefined) upd.points_late_lt_10 = clampInt(body.points_late_lt_10, -100, 100, 7);
    if (body.points_late_10_to_30 !== undefined) upd.points_late_10_to_30 = clampInt(body.points_late_10_to_30, -100, 100, 5);
    if (body.points_late_gt_30 !== undefined) upd.points_late_gt_30 = clampInt(body.points_late_gt_30, -100, 100, 0);
    // NEW: dynamic tier ladder — takes precedence over the legacy 4 fields
    // when present. Normalized (sorted, capped, last row forced to catch-all).
    if (body.late_tiers !== undefined) {
      const norm = normalizeLateTiers(body.late_tiers);
      if (!norm || norm.length === 0) return errRes('minimal satu baris aturan tingkat keterlambatan');
      upd.late_tiers = norm;
    }
    if (body.initial_balance !== undefined) upd.initial_balance = clampInt(body.initial_balance, -10000, 10000, 100);
    if (body.max_positive !== undefined) upd.max_positive = clampInt(body.max_positive, 0, 10000, 150);
    if (body.max_negative !== undefined) upd.max_negative = clampInt(body.max_negative, -10000, 0, -50);
    if (body.rupiah_per_point !== undefined) upd.rupiah_per_point = clampInt(body.rupiah_per_point, 0, 10000000, 2500);
    await db.collection('absensi_point_settings').updateOne(
      { id: 'default' }, { $set: upd }, { upsert: true }
    );
    const ps = await loadPointSettings(db);
    const { _id, ...safe } = ps;
    return jsonRes({ settings: safe });
  }

  // -------- Live leaderboard --------
  // GET /api/absensi/points/leaderboard?period=YYYY-MM
  if (subPath === 'points/leaderboard' && method === 'GET') {
    await ensurePointIndexes(db);
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || currentPeriod();
    // Ensure any pre-existing check-ins in this period have ledger entries.
    const { from, to } = periodRange(period);
    await backfillCheckinLedger(db, { from, to });
    const board = await computeLeaderboard(db, period);
    return jsonRes(board);
  }

  // -------- Ranking Trend (daily rank per user for a period) --------
  // GET /api/absensi/points/trend?period=YYYY-MM
  // Returns per-day ranks so the Live Board can render a trend line chart.
  // Visible to staff + owner (public — no rupiah_per_point).
  if (subPath === 'points/trend' && method === 'GET') {
    await ensurePointIndexes(db);
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || currentPeriod();
    const { from, to } = periodRange(period);
    await backfillCheckinLedger(db, { from, to });

    const ps = await loadPointSettings(db);
    const initial = Number(ps.initial_balance ?? 100);
    const maxPos = Number(ps.max_positive ?? 150);
    const maxNeg = Number(ps.max_negative ?? -50);
    const clamp = (n) => Math.max(maxNeg, Math.min(maxPos, n));

    // 1) Build inclusive list of days from period.from up to min(period.to, today).
    const today = witaDate();
    const endDate = to < today ? to : today;
    const days = [];
    {
      // Iterate YYYY-MM-DD strings inclusively.
      const start = new Date(from + 'T00:00:00Z');
      const end = new Date(endDate + 'T00:00:00Z');
      for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
      }
    }

    // 2) Active staff (non-owner) — one entry per user regardless of ledger presence.
    const staff = await getActiveStaff(db);

    // 3) Fetch ledger deltas grouped by user + event_date.
    const grouped = await db.collection('absensi_point_ledger').aggregate([
      { $match: { period_key: period } },
      {
        $group: {
          _id: { user_id: '$user_id', user_name: '$user_name', event_date: '$event_date' },
          delta: { $sum: '$points' },
        },
      },
    ]).toArray();

    // deltaByUserDate[user_id][YYYY-MM-DD] = signed int (may be missing on days without events)
    const deltaByUserDate = new Map();
    const nameByUser = new Map();
    for (const g of grouped) {
      const uid = g._id.user_id;
      if (!deltaByUserDate.has(uid)) deltaByUserDate.set(uid, new Map());
      deltaByUserDate.get(uid).set(g._id.event_date, Number(g.delta || 0));
      if (g._id.user_name) nameByUser.set(uid, g._id.user_name);
    }
    for (const s of staff) if (!nameByUser.has(s.id)) nameByUser.set(s.id, s.name);

    // 4) For each day, compute cumulative balance per user, then dense rank
    //    (users tied get the same rank; next rank steps by 1 — friendlier UX
    //    for staff seeing themselves on the trend line).
    const userIds = Array.from(new Set([...staff.map((s) => s.id), ...deltaByUserDate.keys()]));
    const running = new Map(userIds.map((uid) => [uid, 0])); // cumulative delta
    const perUser = new Map(userIds.map((uid) => [uid, { ranks: [], balances: [] }]));

    for (const day of days) {
      // Advance running deltas by any events on `day`.
      for (const uid of userIds) {
        const perDate = deltaByUserDate.get(uid);
        if (perDate && perDate.has(day)) {
          running.set(uid, running.get(uid) + perDate.get(day));
        }
      }
      // Snapshot balances.
      const snap = userIds.map((uid) => ({
        uid,
        name: nameByUser.get(uid) || 'Staff',
        balance: clamp(initial + running.get(uid)),
      }));
      // Match leaderboard tiebreaker exactly (balance desc, then name asc)
      // and assign strict 1..N ranks so the trend chart mirrors the ranking.
      snap.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
      for (let i = 0; i < snap.length; i++) {
        perUser.get(snap[i].uid).ranks.push(i + 1);
        perUser.get(snap[i].uid).balances.push(snap[i].balance);
      }
    }

    const series = userIds
      .map((uid) => ({
        user_id: uid,
        user_name: nameByUser.get(uid) || 'Staff',
        ranks: perUser.get(uid).ranks,
        balances: perUser.get(uid).balances,
      }))
      // Sort by latest rank ascending so #1 is first (helps stable colour assignment).
      .sort((a, b) => (a.ranks[a.ranks.length - 1] || 999) - (b.ranks[b.ranks.length - 1] || 999));

    return jsonRes({
      period_key: period,
      period_range: { from, to },
      days,
      total_users: userIds.length,
      series,
    });
  }

  // -------- History (staff sees self; owner sees all/filter) --------
  // GET /api/absensi/points/history?period=YYYY-MM&user_id=...
  if (subPath === 'points/history' && method === 'GET') {
    await ensurePointIndexes(db);
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || currentPeriod();
    const userIdParam = url.searchParams.get('user_id') || '';
    // Force ledger to be filled for the requested period.
    const { from, to } = periodRange(period);
    await backfillCheckinLedger(db, { from, to });
    const filter = { period_key: period };
    if (user.role === 'owner') {
      if (userIdParam) filter.user_id = userIdParam;
    } else {
      // Staff hanya boleh melihat riwayat poinnya sendiri.
      filter.user_id = user.id;
    }
    const rows = await db.collection('absensi_point_ledger')
      .find(filter)
      .sort({ event_date: -1, createdAt: -1 })
      .limit(1000)
      .project({ _id: 0 })
      .toArray();
    const ps = await loadPointSettings(db);
    const totalDelta = rows.reduce((a, r) => a + Number(r.points || 0), 0);
    return jsonRes({
      period_key: period,
      period_range: periodRange(period),
      items: rows,
      total_delta: totalDelta,
      initial_balance: Number(ps.initial_balance ?? 100),
    });
  }

  // -------- Manual adjustment (owner) --------
  // POST /api/absensi/points/adjustment  body { user_id, points, reason }
  if (subPath === 'points/adjustment' && method === 'POST') {
    if (user.role !== 'owner') return errRes('hanya owner', 403);
    await ensurePointIndexes(db);
    const body = await req.json().catch(() => ({}));
    const targetId = String(body.user_id || '').trim();
    const pts = Number(body.points);
    const reason = String(body.reason || '').trim();
    if (!targetId) return errRes('user_id wajib');
    if (!Number.isFinite(pts) || pts === 0) return errRes('points harus berupa angka bukan nol');
    if (!reason) return errRes('alasan wajib diisi');

    const emp = await db.collection('employees').findOne({ id: targetId });
    if (!emp) return errRes('staff tidak ditemukan', 404);

    const eventDate = witaDate();
    const doc = {
      id: uuidv4(),
      user_id: emp.id,
      user_name: emp.name,
      event_type: 'adjustment',
      event_date: eventDate,
      period_key: periodKeyForDate(eventDate),
      points: Math.round(pts),
      reason: reason.slice(0, 200),
      source_id: uuidv4(), // unique per adjustment; unique idx won't collide
      created_by_id: user.id,
      created_by_name: user.name,
      createdAt: new Date(),
    };
    await db.collection('absensi_point_ledger').insertOne(doc);
    return jsonRes({ ok: true, entry: doc });
  }

  // -------- Recompute (owner utility) --------
  // POST /api/absensi/points/recompute?period=YYYY-MM
  if (subPath === 'points/recompute' && method === 'POST') {
    if (user.role !== 'owner') return errRes('hanya owner', 403);
    await ensurePointIndexes(db);
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || currentPeriod();
    const { from, to } = periodRange(period);
    await backfillCheckinLedger(db, { from, to });
    const board = await computeLeaderboard(db, period);
    return jsonRes({ ok: true, period_key: period, ...board });
  }

  return null;
}
