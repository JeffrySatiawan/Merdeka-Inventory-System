// ============================================================
// Order Management Module — Backend Service
// Fully isolated from Cycle Count module. Uses its own collections
// (prefixed `om_`) and its own endpoint namespace (/api/om/*).
// ============================================================
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// -------- Constants & Config --------
export const OM_MODULE_KEY = 'order_management';

const UPLOAD_ROOT = process.env.OM_UPLOAD_DIR || '/app/uploads/om';
const DEFAULT_SETTINGS = {
  photo_retention_days: 10,
  record_retention_days: 90,
};

const SEED_EXPEDITIONS = [
  { name: 'Shopee Express', code: 'SPX', active: true, sort_order: 1 },
  { name: 'J&T Express', code: 'JNT', active: true, sort_order: 2 },
  { name: 'JNE', code: 'JNE', active: true, sort_order: 3 },
  { name: 'SiCepat', code: 'SCP', active: true, sort_order: 4 },
  { name: 'Anteraja', code: 'ATR', active: true, sort_order: 5 },
  { name: 'Lion Parcel', code: 'LNP', active: true, sort_order: 6 },
  { name: 'Ninja Express', code: 'NNJ', active: true, sort_order: 7 },
  { name: 'Pos Indonesia', code: 'POS', active: true, sort_order: 8 },
];

// -------- Helpers --------
const jsonRes = (data, init = {}) => NextResponse.json(data, init);
const err = (message, status = 400) => NextResponse.json({ error: message }, { status });

// Return WITA (UTC+8) local date/time
function getWita(now = new Date()) {
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const wita = new Date(utc + 8 * 3600000);
  const yyyy = wita.getUTCFullYear();
  const mm = String(wita.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(wita.getUTCDate()).padStart(2, '0');
  const hh = String(wita.getUTCHours()).padStart(2, '0');
  const mi = String(wita.getUTCMinutes()).padStart(2, '0');
  const ss = String(wita.getUTCSeconds()).padStart(2, '0');
  return {
    date: `${yyyy}-${mm}-${dd}`, // e.g. 2026-07-19
    time: `${hh}.${mi}.${ss}`,
    year: yyyy,
    month: mm,
    day: dd,
    iso: `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+08:00`,
    ts: now.toISOString(),
  };
}

function todayWitaDateString() {
  return getWita().date;
}

function safeFilenameFromTracking(tracking) {
  return String(tracking).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
}

// Parse a data URL (data:image/webp;base64,....) to a Buffer + mime
function parseDataUrl(dataUrl) {
  const m = /^data:([a-zA-Z0-9+/.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1];
  const buffer = Buffer.from(m[2], 'base64');
  return { mime, buffer };
}

// -------- Seed & Migration --------
export async function ensureOMSeeded(db) {
  // 1) Seed expeditions if empty
  const expCount = await db.collection('om_expeditions').countDocuments({});
  if (expCount === 0) {
    const docs = SEED_EXPEDITIONS.map((e) => ({
      id: uuidv4(),
      ...e,
      createdAt: new Date(),
    }));
    await db.collection('om_expeditions').insertMany(docs);
  }

  // 2) Seed settings if not present
  const existing = await db.collection('om_settings').findOne({ id: 'default' });
  if (!existing) {
    await db.collection('om_settings').insertOne({
      id: 'default',
      ...DEFAULT_SETTINGS,
      updatedAt: new Date(),
    });
  }

  // 3) Ensure upload dir exists
  try {
    if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  } catch {}
}

// Periodic cleanup: purge expired photos & old records.
// Runs at most once per hour per process.
let _lastCleanupTs = 0;
export async function maybeRunOMCleanup(db) {
  const nowMs = Date.now();
  if (nowMs - _lastCleanupTs < 60 * 60 * 1000) return; // 1h throttle
  _lastCleanupTs = nowMs;

  try {
    const s = (await db.collection('om_settings').findOne({ id: 'default' })) || DEFAULT_SETTINGS;
    const photoTtl = Number(s.photo_retention_days || 10);
    const recordTtl = Number(s.record_retention_days || 90);

    const photoCutoff = new Date(Date.now() - photoTtl * 86400000);
    const recordCutoff = new Date(Date.now() - recordTtl * 86400000);

    // Delete photo files where photo_saved_at < cutoff and photo_deleted !== true
    const expired = await db
      .collection('om_shipments')
      .find({ photo_saved_at: { $lt: photoCutoff }, photo_deleted: { $ne: true } })
      .toArray();
    for (const doc of expired) {
      if (doc.photo_path) {
        try { fs.unlinkSync(doc.photo_path); } catch {}
      }
      await db.collection('om_shipments').updateOne(
        { id: doc.id },
        { $set: { photo_deleted: true, photo_path: null } }
      );
    }

    // Delete very old records (both packed_at and delivered_at older than cutoff)
    await db.collection('om_shipments').deleteMany({
      packed_at: { $lt: recordCutoff },
    });
  } catch (e) {
    // Silent — don't break normal requests
    console.error('[OM cleanup]', e);
  }
}

// -------- Permission check helper --------
export function omHasAccess(user) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return Array.isArray(user.modules) && user.modules.includes(OM_MODULE_KEY);
}

// ============================================================
// ROUTER — handles all `/api/om/*` paths.
// Called from main /api/[[...path]]/route.js as:
//   const omResp = await handleOMRequest(req, subPath, method, { db, user });
//   if (omResp) return omResp;
// Returns NextResponse or null if path not handled by OM.
// ============================================================
export async function handleOMRequest(req, subPath, method, { db, user }) {
  // Ensure OM data is initialized
  await ensureOMSeeded(db);
  // Fire-and-forget cleanup
  maybeRunOMCleanup(db).catch(() => {});

  // Every OM endpoint requires authentication + module access.
  if (!user) return err('unauthorized', 401);
  if (!omHasAccess(user)) return err('Anda tidak memiliki akses ke module Order Management', 403);

  // Route table
  // -------- Expeditions --------
  if (subPath === 'expeditions' && method === 'GET') {
    const includeInactive = new URL(req.url).searchParams.get('include_inactive') === '1';
    const q = includeInactive ? {} : { active: true };
    const items = await db.collection('om_expeditions').find(q).sort({ sort_order: 1, name: 1 }).toArray();
    return jsonRes({ items: items.map((x) => ({ ...x, _id: undefined })) });
  }

  if (subPath === 'expeditions' && method === 'POST') {
    if (user.role !== 'owner') return err('Hanya owner yang boleh menambah ekspedisi', 403);
    const body = await req.json();
    const { name, code = '', active = true, sort_order = 99 } = body || {};
    if (!name) return err('nama wajib diisi');
    const exists = await db.collection('om_expeditions').findOne({ name });
    if (exists) return err('Ekspedisi dengan nama tersebut sudah ada');
    const doc = {
      id: uuidv4(),
      name: String(name).trim(),
      code: String(code).trim().toUpperCase(),
      active: !!active,
      sort_order: Number(sort_order) || 99,
      createdAt: new Date(),
    };
    await db.collection('om_expeditions').insertOne(doc);
    return jsonRes({ item: { ...doc, _id: undefined } });
  }

  const expMatch = subPath.match(/^expeditions\/([^/]+)$/);
  if (expMatch && method === 'PUT') {
    if (user.role !== 'owner') return err('Hanya owner yang boleh mengubah ekspedisi', 403);
    const id = expMatch[1];
    const body = await req.json();
    const update = {};
    if (body.name !== undefined) update.name = String(body.name).trim();
    if (body.code !== undefined) update.code = String(body.code).trim().toUpperCase();
    if (body.active !== undefined) update.active = !!body.active;
    if (body.sort_order !== undefined) update.sort_order = Number(body.sort_order) || 99;
    update.updatedAt = new Date();
    await db.collection('om_expeditions').updateOne({ id }, { $set: update });
    const updated = await db.collection('om_expeditions').findOne({ id });
    if (!updated) return err('ekspedisi tidak ditemukan', 404);
    return jsonRes({ item: { ...updated, _id: undefined } });
  }
  if (expMatch && method === 'DELETE') {
    if (user.role !== 'owner') return err('Hanya owner yang boleh menghapus ekspedisi', 403);
    const id = expMatch[1];
    await db.collection('om_expeditions').deleteOne({ id });
    return jsonRes({ ok: true });
  }

  // -------- Settings --------
  if (subPath === 'settings' && method === 'GET') {
    const s = (await db.collection('om_settings').findOne({ id: 'default' })) || DEFAULT_SETTINGS;
    return jsonRes({ settings: { ...DEFAULT_SETTINGS, ...s, _id: undefined } });
  }
  if (subPath === 'settings' && method === 'PUT') {
    if (user.role !== 'owner') return err('Hanya owner yang boleh mengubah pengaturan', 403);
    const body = await req.json();
    const update = {};
    if (body.photo_retention_days !== undefined) {
      const v = Math.max(1, Math.min(365, Number(body.photo_retention_days) || 10));
      update.photo_retention_days = v;
    }
    if (body.record_retention_days !== undefined) {
      const v = Math.max(1, Math.min(3650, Number(body.record_retention_days) || 90));
      update.record_retention_days = v;
    }
    update.updatedAt = new Date();
    await db.collection('om_settings').updateOne({ id: 'default' }, { $set: update }, { upsert: true });
    const s = await db.collection('om_settings').findOne({ id: 'default' });
    return jsonRes({ settings: { ...s, _id: undefined } });
  }

  // -------- SCAN: Mulai Packing --------
  if (subPath === 'scan/pack' && method === 'POST') {
    const body = await req.json();
    const {
      tracking_number,
      expedition_id,
      sku_count,
      item_count,
      photo_data_url,
    } = body || {};

    if (!tracking_number) return err('tracking_number wajib');
    const trackingNorm = String(tracking_number).trim();
    if (!trackingNorm) return err('tracking_number tidak valid');
    if (!expedition_id) return err('expedition wajib dipilih');
    const exp = await db.collection('om_expeditions').findOne({ id: expedition_id });
    if (!exp) return err('ekspedisi tidak ditemukan', 404);

    const skuNum = Number(sku_count);
    const itemNum = Number(item_count);
    if (!Number.isFinite(skuNum) || skuNum < 1) return err('jumlah SKU tidak valid');
    if (!Number.isFinite(itemNum) || itemNum < 1) return err('jumlah item tidak valid');

    // Prevent duplicate packing of same tracking (if not delivered / not deleted)
    const dup = await db.collection('om_shipments').findOne({ tracking_number: trackingNorm });
    if (dup) {
      return err(`Resi ${trackingNorm} sudah pernah dipacking pada ${dup.packed_at ? new Date(dup.packed_at).toLocaleString('id-ID') : '-'}`, 409);
    }

    // Save photo to disk (if provided)
    const wita = getWita();
    let photoPath = null;
    let photoUrl = null;
    let photoSize = 0;
    if (photo_data_url) {
      const parsed = parseDataUrl(photo_data_url);
      if (!parsed) return err('format foto tidak valid (harus data URL base64)');
      // Reasonable size limit — server accepts up to 500KB (client should already compress)
      if (parsed.buffer.length > 500 * 1024) {
        return err('ukuran foto terlalu besar setelah kompresi (>500KB)');
      }
      const ext = parsed.mime.includes('webp') ? 'webp' : parsed.mime.includes('jpeg') ? 'jpg' : 'png';
      const dir = path.join(UPLOAD_ROOT, String(wita.year), wita.month);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const fname = `${wita.date}_${safeFilenameFromTracking(trackingNorm)}_${Date.now()}.${ext}`;
      const fpath = path.join(dir, fname);
      fs.writeFileSync(fpath, parsed.buffer);
      photoPath = fpath;
      photoSize = parsed.buffer.length;
      // We serve via /api/om/photos/:id
    }

    const now = new Date();
    const shipment = {
      id: uuidv4(),
      tracking_number: trackingNorm,
      expedition_id: exp.id,
      expedition_name: exp.name,
      expedition_code: exp.code,
      sku_count: Math.floor(skuNum),
      item_count: Math.floor(itemNum),
      status: 'packed', // packed | delivered
      packed_by_id: user.id,
      packed_by_name: user.name,
      packed_at: now,
      packed_wita_date: wita.date,
      delivered_by_id: null,
      delivered_by_name: null,
      delivered_at: null,
      delivered_wita_date: null,
      photo_path: photoPath,
      photo_size: photoSize,
      photo_saved_at: photoPath ? now : null,
      photo_deleted: !photoPath,
      createdAt: now,
    };
    await db.collection('om_shipments').insertOne(shipment);
    photoUrl = photoPath ? `/api/om/photos/${shipment.id}` : null;

    return jsonRes({
      shipment: { ...shipment, _id: undefined, photo_path: undefined, photo_url: photoUrl },
      message: `Resi ${trackingNorm} berhasil dipacking · ${exp.name}`,
    });
  }

  // -------- Photo serving --------
  const photoMatch = subPath.match(/^photos\/([^/]+)$/);
  if (photoMatch && method === 'GET') {
    const id = photoMatch[1];
    const doc = await db.collection('om_shipments').findOne({ id });
    if (!doc) return err('resi tidak ditemukan', 404);
    if (doc.photo_deleted || !doc.photo_path) return err('foto sudah kadaluarsa (retensi 10 hari)', 410);
    if (!fs.existsSync(doc.photo_path)) return err('foto tidak ditemukan pada storage', 404);
    const data = fs.readFileSync(doc.photo_path);
    const ext = doc.photo_path.toLowerCase().split('.').pop();
    const mime = ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }

  // -------- SCAN: Serah Terima Kurir --------
  if (subPath === 'scan/deliver' && method === 'POST') {
    const body = await req.json();
    const { tracking_number } = body || {};
    if (!tracking_number) return err('tracking_number wajib');
    const trackingNorm = String(tracking_number).trim();

    const doc = await db.collection('om_shipments').findOne({ tracking_number: trackingNorm });
    if (!doc) {
      return err('Resi belum pernah dipacking.', 404);
    }
    if (doc.status === 'delivered') {
      return jsonRes({
        shipment: { ...doc, _id: undefined, photo_path: undefined },
        message: `Resi ${trackingNorm} sudah diserahkan sebelumnya pada ${new Date(doc.delivered_at).toLocaleString('id-ID')}`,
        already: true,
      });
    }

    const now = new Date();
    const wita = getWita();
    await db.collection('om_shipments').updateOne(
      { id: doc.id },
      {
        $set: {
          status: 'delivered',
          delivered_by_id: user.id,
          delivered_by_name: user.name,
          delivered_at: now,
          delivered_wita_date: wita.date,
        },
      }
    );
    const updated = await db.collection('om_shipments').findOne({ id: doc.id });
    return jsonRes({
      shipment: { ...updated, _id: undefined, photo_path: undefined },
      message: `Resi ${trackingNorm} berhasil diserahkan · ${updated.expedition_name}`,
    });
  }

  // -------- Dashboard (today's stats) --------
  if (subPath === 'dashboard' && method === 'GET') {
    const today = todayWitaDateString();
    const packedToday = await db.collection('om_shipments').countDocuments({ packed_wita_date: today });
    const deliveredToday = await db.collection('om_shipments').countDocuments({ delivered_wita_date: today });
    // Shipments packed today and still not delivered
    const pendingToday = await db.collection('om_shipments').countDocuments({
      packed_wita_date: today,
      status: 'packed',
    });
    const successRate = packedToday === 0 ? 0 : Math.round((deliveredToday / packedToday) * 100);

    // Breakdown by expedition (packed today)
    const byExpAgg = await db
      .collection('om_shipments')
      .aggregate([
        { $match: { packed_wita_date: today } },
        {
          $group: {
            _id: '$expedition_id',
            expedition_name: { $first: '$expedition_name' },
            packed: { $sum: 1 },
            delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          },
        },
        { $sort: { packed: -1 } },
      ])
      .toArray();

    // Breakdown by operator (packed today)
    const byOpAgg = await db
      .collection('om_shipments')
      .aggregate([
        { $match: { packed_wita_date: today } },
        {
          $group: {
            _id: '$packed_by_id',
            operator: { $first: '$packed_by_name' },
            packed: { $sum: 1 },
            delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          },
        },
        { $sort: { packed: -1 } },
      ])
      .toArray();

    // Recent activity (last 15)
    const recent = await db
      .collection('om_shipments')
      .find({})
      .sort({ createdAt: -1 })
      .limit(15)
      .project({ _id: 0, photo_path: 0 })
      .toArray();

    // Pending (packed but not delivered), all-time
    const pendingTotal = await db.collection('om_shipments').countDocuments({ status: 'packed' });

    return jsonRes({
      date: today,
      today: {
        packed: packedToday,
        delivered: deliveredToday,
        pending: pendingToday,
        difference: packedToday - deliveredToday,
        success_rate: successRate,
      },
      pending_total: pendingTotal,
      by_expedition: byExpAgg.map((x) => ({
        expedition_id: x._id,
        expedition_name: x.expedition_name,
        packed: x.packed,
        delivered: x.delivered,
      })),
      by_operator: byOpAgg.map((x) => ({
        operator_id: x._id,
        operator: x.operator,
        packed: x.packed,
        delivered: x.delivered,
      })),
      recent,
    });
  }

  // -------- Pending list (belum diserahkan) --------
  if (subPath === 'pending' && method === 'GET') {
    const url = new URL(req.url);
    const date = url.searchParams.get('date'); // optional filter
    const q = { status: 'packed' };
    if (date) q.packed_wita_date = date;
    const items = await db
      .collection('om_shipments')
      .find(q)
      .sort({ packed_at: -1 })
      .limit(500)
      .project({ _id: 0, photo_path: 0 })
      .toArray();
    return jsonRes({ items });
  }

  // -------- Shipments (list with filters, for Laporan) --------
  if (subPath === 'shipments' && method === 'GET') {
    const url = new URL(req.url);
    const dateFrom = url.searchParams.get('date_from'); // YYYY-MM-DD
    const dateTo = url.searchParams.get('date_to');
    const operatorId = url.searchParams.get('operator_id');
    const expeditionId = url.searchParams.get('expedition_id');
    const status = url.searchParams.get('status'); // packed | delivered
    const trackingSearch = url.searchParams.get('q');
    const limit = Math.min(Number(url.searchParams.get('limit') || 500), 2000);

    const q = {};
    if (dateFrom || dateTo) {
      q.packed_wita_date = {};
      if (dateFrom) q.packed_wita_date.$gte = dateFrom;
      if (dateTo) q.packed_wita_date.$lte = dateTo;
    }
    if (operatorId) q.packed_by_id = operatorId;
    if (expeditionId) q.expedition_id = expeditionId;
    if (status === 'packed' || status === 'delivered') q.status = status;
    if (trackingSearch) {
      q.tracking_number = { $regex: trackingSearch, $options: 'i' };
    }
    const items = await db
      .collection('om_shipments')
      .find(q)
      .sort({ packed_at: -1 })
      .limit(limit)
      .project({ _id: 0, photo_path: 0 })
      .toArray();

    // Summary
    const total = items.length;
    const delivered = items.filter((x) => x.status === 'delivered').length;
    return jsonRes({
      items,
      summary: {
        total,
        packed: total,
        delivered,
        difference: total - delivered,
        success_rate: total === 0 ? 0 : Math.round((delivered / total) * 100),
      },
    });
  }

  // Not handled -> return null so caller can decide
  return null;
}
