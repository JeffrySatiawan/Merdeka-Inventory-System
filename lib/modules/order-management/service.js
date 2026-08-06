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
  archive_cutoff_hour: 6, // Jam (0-23) WITA di mana resi delivered pindah ke Selesai
  // Global notification settings for OM PDF Resi. Only OWNER can modify these,
  // but they apply to ALL users receiving realtime notifications.
  notif_popup: true,
  notif_sound: true,
  notif_browser: true,
};

const SEED_EXPEDITIONS = [
  { name: 'Shopee Express', code: 'SPX', express_id: '', active: true, sort_order: 1 },
  { name: 'J&T Express', code: 'JNT', express_id: '', active: true, sort_order: 2 },
  { name: 'JNE', code: 'JNE', express_id: '', active: true, sort_order: 3 },
  { name: 'SiCepat', code: 'SCP', express_id: '', active: true, sort_order: 4 },
  { name: 'Anteraja', code: 'ATR', express_id: '', active: true, sort_order: 5 },
  { name: 'Lion Parcel', code: 'LNP', express_id: '', active: true, sort_order: 6 },
  { name: 'Ninja Express', code: 'NNJ', express_id: '', active: true, sort_order: 7 },
  { name: 'Pos Indonesia', code: 'POS', express_id: '', active: true, sort_order: 8 },
];

// -------- Helpers --------
const jsonRes = (data, init = {}) => NextResponse.json(data, init);
const err = (message, status = 400) => NextResponse.json({ error: message }, { status });

// -------- KETOKO per-resi helpers --------
// Notes only accept a small enum. Anything else → coerced to null.
const KETOKO_NOTE_TYPES = new Set(['kosong', 'lainnya']);

/**
 * Ensure a doc's ketoko_resi array has one entry per detected tracking number.
 * Adds any missing entries with default state (unchecked, no note). Preserves
 * existing entries as-is. Also strips entries whose tracking_number no longer
 * appears in detected_tracking_numbers (e.g. after re-scan).
 *
 * Returns { resi, changed } — the possibly-mutated array and whether it
 * differs from the doc's stored value (caller decides whether to persist).
 *
 * Called on GET /api/om/pdfs (hydrates every list item) and on the per-resi
 * update endpoint (ensures the entry exists before mutating).
 */
function hydrateKetokoResi(doc) {
  const detected = Array.isArray(doc.detected_tracking_numbers)
    ? doc.detected_tracking_numbers
    : [];
  const existing = Array.isArray(doc.ketoko_resi) ? doc.ketoko_resi : [];
  const byTn = new Map();
  for (const row of existing) {
    if (row && row.tracking_number) byTn.set(row.tracking_number, row);
  }
  const resi = [];
  for (const tn of detected) {
    const prev = byTn.get(tn);
    if (prev) {
      resi.push({
        tracking_number: tn,
        checked: !!prev.checked,
        checked_at: prev.checked_at || null,
        checked_by_id: prev.checked_by_id || null,
        checked_by_name: prev.checked_by_name || null,
        note_type: KETOKO_NOTE_TYPES.has(prev.note_type) ? prev.note_type : null,
        note_text: typeof prev.note_text === 'string' ? prev.note_text : null,
        note_updated_at: prev.note_updated_at || null,
      });
    } else {
      resi.push({
        tracking_number: tn,
        checked: false,
        checked_at: null,
        checked_by_id: null,
        checked_by_name: null,
        note_type: null,
        note_text: null,
        note_updated_at: null,
      });
    }
  }
  // Detect divergence — cheap length check first, then per-key.
  let changed = resi.length !== existing.length;
  if (!changed) {
    for (let i = 0; i < resi.length; i++) {
      const a = resi[i];
      const b = existing[i];
      if (
        !b ||
        a.tracking_number !== b.tracking_number ||
        !!a.checked !== !!b.checked ||
        (a.note_type || null) !== (b.note_type || null) ||
        (a.note_text || null) !== (b.note_text || null)
      ) {
        changed = true;
        break;
      }
    }
  }
  return { resi, changed };
}

/**
 * Recompute the legacy overall `ketoko_input_at` field from a fresh ketoko_resi
 * array. The overall flag is true (set to the latest resi checked_at) ONLY when
 * every detected resi is checked AND there is at least one detected resi. This
 * keeps backward-compat with older code that used a single flag per PDF.
 */
function recomputeKetokoOverall(resi, currentUser) {
  if (!Array.isArray(resi) || resi.length === 0) {
    return {
      ketoko_input_at: null,
      ketoko_input_by_id: null,
      ketoko_input_by_name: null,
    };
  }
  const allChecked = resi.every((r) => r.checked);
  if (!allChecked) {
    return {
      ketoko_input_at: null,
      ketoko_input_by_id: null,
      ketoko_input_by_name: null,
    };
  }
  // Use the latest checked_at as the "overall" timestamp.
  let latest = null;
  let latestBy = null;
  let latestByName = null;
  for (const r of resi) {
    const t = r.checked_at ? new Date(r.checked_at).getTime() : 0;
    if (!latest || t > new Date(latest).getTime()) {
      latest = r.checked_at;
      latestBy = r.checked_by_id;
      latestByName = r.checked_by_name;
    }
  }
  return {
    ketoko_input_at: latest || (currentUser ? new Date() : null),
    ketoko_input_by_id: latestBy || currentUser?.id || null,
    ketoko_input_by_name: latestByName || currentUser?.name || null,
  };
}

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

// -------- Archive / Cutoff helpers --------
// Compute the most recent moment (JS Date, UTC) when the WITA local clock hit `cutoffHour:00`.
// Any shipment delivered BEFORE this moment should be considered "Selesai".
function getLastCutoffMoment(cutoffHour = 6) {
  const h = Math.max(0, Math.min(23, Number(cutoffHour) || 0));
  const now = new Date();
  const nowUtcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const witaMs = nowUtcMs + 8 * 3600000;
  const wita = new Date(witaMs);
  const yyyy = wita.getUTCFullYear();
  const mm = wita.getUTCMonth();
  const dd = wita.getUTCDate();
  const witaHour = wita.getUTCHours();
  const witaMin = wita.getUTCMinutes();
  const witaSec = wita.getUTCSeconds();

  // Candidate: today's cutoff in WITA
  // If current WITA time (hh:mm) >= cutoffHour:00 => use today; else use yesterday
  const nowHhMm = witaHour * 3600 + witaMin * 60 + witaSec;
  const cutoffHhMm = h * 3600;
  let cutoffWitaDay = dd;
  if (nowHhMm < cutoffHhMm) cutoffWitaDay -= 1;

  // Build UTC ms for the cutoff (WITA is UTC+8, so subtract 8h from WITA wall time to get UTC)
  const cutoffUtcMs = Date.UTC(yyyy, mm, cutoffWitaDay, h - 8, 0, 0);
  return new Date(cutoffUtcMs);
}

// Mark delivered shipments whose delivered_at is BEFORE the most recent cutoff.
// Idempotent, safe to call frequently.
export async function ensureArchivedFlags(db) {
  const settings = (await db.collection('om_settings').findOne({ id: 'default' })) || DEFAULT_SETTINGS;
  const cutoff = getLastCutoffMoment(settings.archive_cutoff_hour ?? 6);
  const now = new Date();
  await db.collection('om_shipments').updateMany(
    {
      status: 'delivered',
      delivered_at: { $lt: cutoff, $ne: null },
      $or: [{ archived_at: { $exists: false } }, { archived_at: null }],
    },
    { $set: { archived_at: now, archived_by_cutoff: cutoff } }
  );
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
  } else {
    // Migration: backfill express_id field on existing expeditions
    await db.collection('om_expeditions').updateMany(
      { express_id: { $exists: false } },
      { $set: { express_id: '' } }
    );
  }

  // 2) Migration: backfill printed_* fields on existing shipments (printed_at=null means "no print scan recorded")
  await db.collection('om_shipments').updateMany(
    { printed_at: { $exists: false } },
    {
      $set: {
        printed_at: null,
        printed_by_id: null,
        printed_by_name: null,
        printed_wita_date: null,
      },
    }
  );

  // 3) Seed settings if not present
  const existing = await db.collection('om_settings').findOne({ id: 'default' });
  if (!existing) {
    await db.collection('om_settings').insertOne({
      id: 'default',
      ...DEFAULT_SETTINGS,
      updatedAt: new Date(),
    });
  }

  // 4) Ensure upload dir exists
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
      // Also purge the MongoDB Binary copy so retention actually frees DB space
      // (leaving the row for audit but dropping the ~KB binary blob).
      await db.collection('om_shipments').updateOne(
        { id: doc.id },
        { $set: { photo_deleted: true, photo_path: null }, $unset: { photo_data: '' } }
      );
    }

    // Purge expired PDFs (follow photo retention setting)
    try {
      const expiredPdfs = await db
        .collection('om_pdfs')
        .find({ uploaded_at: { $lt: photoCutoff }, deleted: { $ne: true } })
        .toArray();
      for (const doc of expiredPdfs) {
        if (doc.file_path) {
          try { fs.unlinkSync(doc.file_path); } catch {}
        }
        // $unset the file_data too so retention actually frees MongoDB space
        // (leaving the row for audit/history but dropping the ~KB-MB binary).
        await db.collection('om_pdfs').updateOne(
          { id: doc.id },
          { $set: { deleted: true, file_path: null }, $unset: { file_data: '' } }
        );
      }
    } catch {}

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
  // Lazy migration: mark delivered items older than last cutoff as archived (Selesai)
  await ensureArchivedFlags(db);

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
    const { name, code = '', express_id = '', active = true, sort_order = 99 } = body || {};
    if (!name) return err('nama wajib diisi');
    const exists = await db.collection('om_expeditions').findOne({ name });
    if (exists) return err('Ekspedisi dengan nama tersebut sudah ada');
    const doc = {
      id: uuidv4(),
      name: String(name).trim(),
      code: String(code).trim().toUpperCase(),
      express_id: String(express_id).trim(),
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
    if (body.express_id !== undefined) update.express_id = String(body.express_id).trim();
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
    if (body.archive_cutoff_hour !== undefined) {
      const v = Math.max(0, Math.min(23, Number(body.archive_cutoff_hour)));
      update.archive_cutoff_hour = Number.isFinite(v) ? v : 6;
    }
    update.updatedAt = new Date();
    await db.collection('om_settings').updateOne({ id: 'default' }, { $set: update }, { upsert: true });
    const s = await db.collection('om_settings').findOne({ id: 'default' });
    return jsonRes({ settings: { ...s, _id: undefined } });
  }

  // -------- Notification Settings (GLOBAL, owner-only writes) --------
  // GET  /api/om/notif-settings → any authenticated OM user reads current global
  //                               config. Used by useOMPdfNotifications hook so
  //                               every user follows the same rules the owner set.
  // PUT  /api/om/notif-settings → OWNER ONLY. Body: {popup?, sound?, browser?}.
  //                               Changes take effect for all users on their next
  //                               poll (typically within ~10s).
  if (subPath === 'notif-settings' && method === 'GET') {
    const s = (await db.collection('om_settings').findOne({ id: 'default' })) || {};
    return jsonRes({
      settings: {
        popup: s.notif_popup !== undefined ? !!s.notif_popup : DEFAULT_SETTINGS.notif_popup,
        sound: s.notif_sound !== undefined ? !!s.notif_sound : DEFAULT_SETTINGS.notif_sound,
        browser: s.notif_browser !== undefined ? !!s.notif_browser : DEFAULT_SETTINGS.notif_browser,
      },
    });
  }
  if (subPath === 'notif-settings' && method === 'PUT') {
    if (user.role !== 'owner') return err('Hanya owner yang boleh mengubah pengaturan notifikasi', 403);
    const body = await req.json().catch(() => ({}));
    const update = {};
    if (body.popup !== undefined) update.notif_popup = !!body.popup;
    if (body.sound !== undefined) update.notif_sound = !!body.sound;
    if (body.browser !== undefined) update.notif_browser = !!body.browser;
    update.updatedAt = new Date();
    await db.collection('om_settings').updateOne({ id: 'default' }, { $set: update }, { upsert: true });
    const s = (await db.collection('om_settings').findOne({ id: 'default' })) || {};
    return jsonRes({
      settings: {
        popup: s.notif_popup !== undefined ? !!s.notif_popup : DEFAULT_SETTINGS.notif_popup,
        sound: s.notif_sound !== undefined ? !!s.notif_sound : DEFAULT_SETTINGS.notif_sound,
        browser: s.notif_browser !== undefined ? !!s.notif_browser : DEFAULT_SETTINGS.notif_browser,
      },
    });
  }

  // -------- SCAN: Cetak Resi (Phase 1) --------
  if (subPath === 'scan/print' && method === 'POST') {
    const body = await req.json();
    const { tracking_number, expedition_id } = body || {};
    if (!tracking_number) return err('tracking_number wajib');
    const trackingNorm = String(tracking_number).trim();
    if (!trackingNorm) return err('tracking_number tidak valid');
    if (!expedition_id) return err('Pilih ekspedisi terlebih dahulu');
    const exp = await db.collection('om_expeditions').findOne({ id: expedition_id });
    if (!exp) return err('Ekspedisi tidak ditemukan', 404);

    // Anti-duplicate on print phase
    const existing = await db.collection('om_shipments').findOne({ tracking_number: trackingNorm });
    if (existing) {
      if (existing.printed_at) {
        return NextResponse.json(
          {
            error: 'RESI SUDAH PERNAH DICETAK',
            duplicate: {
              stage: 'printed',
              tracking_number: trackingNorm,
              operator: existing.printed_by_name,
              expedition: existing.expedition_name,
              at: existing.printed_at,
            },
          },
          { status: 409 }
        );
      }
      // Existing record without print (legacy: packed directly) — attach print info
      const now = new Date();
      const wita = getWita();
      await db.collection('om_shipments').updateOne(
        { id: existing.id },
        {
          $set: {
            printed_at: now,
            printed_by_id: user.id,
            printed_by_name: user.name,
            printed_wita_date: wita.date,
            // If expedition not set yet, adopt it
            ...(existing.expedition_id ? {} : {
              expedition_id: exp.id,
              expedition_name: exp.name,
              expedition_code: exp.code,
            }),
          },
        }
      );
      const updated = await db.collection('om_shipments').findOne({ id: existing.id });
      return jsonRes({
        shipment: { ...updated, _id: undefined, photo_path: undefined, photo_data: undefined },
        message: `Resi ${trackingNorm} dicatat sebagai tercetak.`,
      });
    }

    const now = new Date();
    const wita = getWita();
    const shipment = {
      id: uuidv4(),
      tracking_number: trackingNorm,
      // Expedition captured at print phase — used by ALL downstream phases
      expedition_id: exp.id,
      expedition_name: exp.name,
      expedition_code: exp.code,
      sku_count: 0,
      item_count: 0,
      status: 'printed',
      printed_by_id: user.id,
      printed_by_name: user.name,
      printed_at: now,
      printed_wita_date: wita.date,
      packed_by_id: null,
      packed_by_name: null,
      packed_at: null,
      packed_wita_date: null,
      delivered_by_id: null,
      delivered_by_name: null,
      delivered_at: null,
      delivered_wita_date: null,
      photo_path: null,
      photo_size: 0,
      photo_saved_at: null,
      photo_deleted: true,
      createdAt: now,
    };
    await db.collection('om_shipments').insertOne(shipment);
    return jsonRes({
      shipment: { ...shipment, _id: undefined, photo_path: undefined },
      message: `Resi ${trackingNorm} · ${exp.name} · tercetak.`,
    });
  }

  // -------- SCAN: Mulai Packing (Phase 2) --------
  if (subPath === 'scan/pack' && method === 'POST') {
    const body = await req.json();
    const { tracking_number, sku_count, item_count, photo_data_url } = body || {};

    if (!tracking_number) return err('tracking_number wajib');
    const trackingNorm = String(tracking_number).trim();
    if (!trackingNorm) return err('tracking_number tidak valid');

    const skuNum = Number(sku_count);
    const itemNum = Number(item_count);
    // Menu 1 "Serah Terima Barang" sends sku+item (>=1) with no photo.
    // Menu 2 "Dokumentasi Packing"  sends photo with no sku/item.
    // Both use this same endpoint (spec: "Jangan membuat API baru").
    // → sku/item are OPTIONAL: absent/null/0 stored as null. Existing callers
    //   supplying valid values (>=1) keep working exactly as before.
    const hasSku = Number.isFinite(skuNum) && skuNum >= 1;
    const hasItem = Number.isFinite(itemNum) && itemNum >= 1;
    const hasPhoto = !!photo_data_url;
    if (!hasSku && !hasItem && !hasPhoto) {
      return err('Isi minimal SKU+Item atau Foto barang');
    }
    // If ANY count is provided (>0), both must be >= 1 (preserve legacy behavior
    // — no partial-count updates in the original Serah Terima form).
    if ((sku_count !== undefined && sku_count !== null && sku_count !== '' && !hasSku) ||
        (item_count !== undefined && item_count !== null && item_count !== '' && !hasItem)) {
      if (!hasSku) return err('jumlah SKU tidak valid');
      if (!hasItem) return err('jumlah item tidak valid');
    }

    // Must exist AND be in 'printed' state
    const doc = await db.collection('om_shipments').findOne({ tracking_number: trackingNorm });
    if (!doc || !doc.printed_at) {
      return NextResponse.json(
        { error: 'Resi belum terdaftar pada proses Scan Cetak Resi.' },
        { status: 404 }
      );
    }

    // Determine operation mode from payload for MODE-AWARE handling.
    // This is the minimal-change fix for the "cross-mode duplicate" bug: the
    // OLD code blocked ANY caller when status='packed' and always set
    // status='packed' — so Menu 1 (Serah Terima) prematurely finalized
    // packing, causing Menu 2 (Dokumentasi) to hit a false 409.
    //  - 'serah_terima' → sku+item only (no photo). Records counts, does NOT
    //                     mark packing done.
    //  - 'dokumentasi'  → photo only (no sku/item). Records photo AND marks
    //                     packing done (packing selesai after dokumentasi).
    //  - 'full' (legacy) → sku+item+photo together. Original behavior preserved
    //                     for any existing caller that still sends all fields.
    const opMode =
      (hasSku && hasItem && !hasPhoto) ? 'serah_terima'
      : (!hasSku && !hasItem && hasPhoto) ? 'dokumentasi'
      : 'full';

    // Any mode: delivered resi cannot be re-processed.
    if (doc.status === 'delivered') {
      return NextResponse.json(
        {
          error: 'RESI SUDAH DISERAHTERIMAKAN KE KURIR',
          duplicate: {
            stage: 'delivered',
            tracking_number: trackingNorm,
            operator: doc.delivered_by_name || doc.packed_by_name,
            expedition: doc.expedition_name,
            at: doc.delivered_at,
          },
        },
        { status: 409 }
      );
    }

    // Per-mode duplicate check (mode-specific to avoid cross-mode false 409).
    if (opMode === 'serah_terima') {
      // Block only if THIS resi already has Serah Terima done (check serah_terima_at field).
      // Note: We check serah_terima_at instead of sku_count/item_count because initial
      // values are 0 (not null), so checking != null would block first attempt.
      if (doc.serah_terima_at) {
        return NextResponse.json(
          {
            error: 'SERAH TERIMA BARANG SUDAH DILAKUKAN',
            duplicate: {
              stage: 'serah_terima',
              tracking_number: trackingNorm,
              operator: doc.serah_terima_by_name || doc.packed_by_name,
              expedition: doc.expedition_name,
              at: doc.serah_terima_at || doc.packed_at,
            },
          },
          { status: 409 }
        );
      }
    } else if (opMode === 'dokumentasi') {
      // Block only if THIS resi already has a live photo (dokumentasi done).
      if (doc.photo_path && !doc.photo_deleted) {
        return NextResponse.json(
          {
            error: 'DOKUMENTASI PACKING SUDAH DILAKUKAN',
            duplicate: {
              stage: 'dokumentasi',
              tracking_number: trackingNorm,
              operator: doc.packed_by_name,
              expedition: doc.expedition_name,
              at: doc.photo_saved_at || doc.packed_at,
            },
          },
          { status: 409 }
        );
      }
    } else {
      // 'full' legacy mode — preserve ORIGINAL duplicate behavior (status='packed' blocks).
      if (doc.status === 'packed') {
        return NextResponse.json(
          {
            error: 'RESI SUDAH PERNAH DIPACKING',
            duplicate: {
              stage: 'packed',
              tracking_number: trackingNorm,
              operator: doc.packed_by_name,
              expedition: doc.expedition_name,
              at: doc.packed_at,
            },
          },
          { status: 409 }
        );
      }
    }

    // Save photo if provided
    const wita = getWita();
    let photoPath = null;
    let photoSize = 0;
    let photoBuffer = null; // Kept for MongoDB backfill (production-safe on ephemeral pods)
    if (photo_data_url) {
      const parsed = parseDataUrl(photo_data_url);
      if (!parsed) return err('format foto tidak valid (harus data URL base64)');
      if (parsed.buffer.length > 500 * 1024) return err('ukuran foto terlalu besar (>500KB)');
      const ext = parsed.mime.includes('webp') ? 'webp' : parsed.mime.includes('jpeg') ? 'jpg' : 'png';
      const dir = path.join(UPLOAD_ROOT, String(wita.year), wita.month);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const fname = `${wita.date}_${safeFilenameFromTracking(trackingNorm)}_${Date.now()}.${ext}`;
      const fpath = path.join(dir, fname);
      try { fs.writeFileSync(fpath, parsed.buffer); } catch {}
      photoPath = fpath;
      photoSize = parsed.buffer.length;
      photoBuffer = parsed.buffer;
    }

    const now = new Date();
    // Build MODE-AWARE updates — no field gets clobbered by another mode.
    // Legacy 'full' mode still writes ALL fields exactly as before.
    const updates = {};

    // Counts (Serah Terima owns these; legacy 'full' also writes them)
    if (opMode === 'serah_terima' || opMode === 'full') {
      updates.sku_count = hasSku ? Math.floor(skuNum) : null;
      updates.item_count = hasItem ? Math.floor(itemNum) : null;
    }

    // Photo (Dokumentasi owns these; legacy 'full' also writes them)
    if (opMode === 'dokumentasi' || opMode === 'full') {
      updates.photo_path = photoPath;
      updates.photo_size = photoSize;
      updates.photo_saved_at = photoPath ? now : null;
      updates.photo_deleted = !photoPath;
      // Store binary in MongoDB so photo survives Kubernetes pod restarts
      // (ephemeral disk). Mirror of what we already do for PDFs.
      if (photoBuffer) {
        updates.photo_data = photoBuffer;
        updates.photo_mime =
          photoPath && photoPath.toLowerCase().endsWith('.webp') ? 'image/webp'
          : photoPath && (photoPath.toLowerCase().endsWith('.jpg') || photoPath.toLowerCase().endsWith('.jpeg')) ? 'image/jpeg'
          : 'image/png';
      }
    }

    // Serah Terima audit trail (new fields — default undefined on old docs, safe)
    if (opMode === 'serah_terima') {
      updates.serah_terima_at = now;
      updates.serah_terima_by_id = user.id;
      updates.serah_terima_by_name = user.name;
      updates.serah_terima_wita_date = wita.date;
    }

    // Packing finalization — ONLY when photo is captured (Dokumentasi/legacy full).
    // Serah Terima alone leaves status='printed' so Dokumentasi can still run.
    if (opMode === 'dokumentasi' || opMode === 'full') {
      updates.status = 'packed';
      updates.packed_by_id = user.id;
      updates.packed_by_name = user.name;
      updates.packed_at = now;
      updates.packed_wita_date = wita.date;
    }

    await db.collection('om_shipments').updateOne({ id: doc.id }, { $set: updates });
    const shipment = { ...doc, ...updates };
    const photoUrl = shipment.photo_path && !shipment.photo_deleted ? `/api/om/photos/${shipment.id}` : null;

    // Mode-aware success message so the UI toast reads sensibly per menu.
    const doneMsg =
      opMode === 'serah_terima' ? 'serah terima barang tersimpan'
      : opMode === 'dokumentasi' ? 'dokumentasi packing selesai'
      : 'packing selesai';

    return jsonRes({
      shipment: { ...shipment, _id: undefined, photo_path: undefined, photo_data: undefined, photo_url: photoUrl },
      message: `Resi ${trackingNorm} · ${shipment.expedition_name} · ${doneMsg}.`,
    });
  }

  // -------- Photo serving --------
  const photoMatch = subPath.match(/^photos\/([^/]+)$/);
  if (photoMatch && method === 'GET') {
    const id = photoMatch[1];
    const doc = await db.collection('om_shipments').findOne({ id });
    if (!doc) return err('resi tidak ditemukan', 404);
    if (doc.photo_deleted) return err('foto sudah kadaluarsa (retensi 10 hari)', 410);
    if (!doc.photo_path && !doc.photo_data) return err('foto sudah kadaluarsa (retensi 10 hari)', 410);

    // --- Resolve the actual bytes ---
    // Primary: MongoDB Binary field (production-safe on ephemeral pods).
    // Fallback: legacy disk copy; if found, backfill DB so subsequent
    // requests on any pod succeed without needing disk access.
    let data = null;
    if (doc.photo_data) {
      const fd = doc.photo_data;
      if (Buffer.isBuffer(fd)) {
        data = fd;
      } else if (fd.buffer && Buffer.isBuffer(fd.buffer)) {
        data = fd.buffer;
      } else if (fd._bsontype === 'Binary' && fd.buffer) {
        data = Buffer.from(fd.buffer);
      } else if (fd instanceof Uint8Array) {
        data = Buffer.from(fd);
      }
    }
    if (!data && doc.photo_path && fs.existsSync(doc.photo_path)) {
      try {
        data = fs.readFileSync(doc.photo_path);
        // Best-effort backfill — swallow errors, don't block the response.
        db.collection('om_shipments')
          .updateOne({ id }, { $set: { photo_data: data } })
          .catch(() => {});
      } catch (e) {
        console.error('[OM photo serve] disk read failed', e);
      }
    }
    if (!data) return err('foto tidak ditemukan pada storage', 404);

    // Determine MIME: prefer stored photo_mime, else infer from path, else default png.
    let mime = doc.photo_mime;
    if (!mime && doc.photo_path) {
      const ext = String(doc.photo_path).toLowerCase().split('.').pop();
      mime = ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    }
    if (!mime) mime = 'image/png';

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
    if (!doc || !doc.printed_at) {
      return NextResponse.json(
        { error: 'Resi belum terdaftar pada proses Scan Cetak Resi.' },
        { status: 404 }
      );
    }
    if (doc.status === 'printed') {
      return NextResponse.json(
        { error: 'Resi belum melalui proses Packing.' },
        { status: 409 }
      );
    }
    if (doc.status === 'delivered') {
      return NextResponse.json(
        {
          error: 'RESI SUDAH PERNAH DISERAHKAN',
          duplicate: {
            stage: doc.archived_at ? 'archived' : 'delivered',
            tracking_number: trackingNorm,
            operator: doc.delivered_by_name,
            expedition: doc.expedition_name,
            at: doc.delivered_at,
            archived_at: doc.archived_at || null,
          },
        },
        { status: 409 }
      );
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
      shipment: { ...updated, _id: undefined, photo_path: undefined, photo_data: undefined },
      message: `Resi ${trackingNorm} berhasil diserahkan · ${updated.expedition_name}`,
    });
  }

  // -------- Packing Productivity Dashboard (read-only, real-time) --------
  // MINIMAL ADDITIVE ENDPOINT — reads existing packed_at/packed_by_* fields.
  // 1 Dokumentasi Packing tersimpan = 1 Packing Selesai (packed_at != null).
  // Serah Terima only (no photo) has packed_at=null → naturally excluded.
  // Owner sees full period totals. Staff only sees ranking (period totals redacted).
  if (subPath === 'packing-productivity' && method === 'GET') {
    const url = new URL(req.url);
    const period = String(url.searchParams.get('period') || 'today');
    const today = todayWitaDateString();

    // Compute period start as a JS Date (UTC). Today = start of WITA day.
    const witaOffsetMs = 8 * 3600000;
    const todayWitaStartMs = new Date(today + 'T00:00:00Z').getTime() - witaOffsetMs;
    let periodStartMs;
    if (period === '7d') periodStartMs = Date.now() - 7 * 86400000;
    else if (period === '30d') periodStartMs = Date.now() - 30 * 86400000;
    else periodStartMs = todayWitaStartMs; // 'today' default

    // Pull only the fields we need — keeps response light and query fast.
    const docs = await db
      .collection('om_shipments')
      .find({
        packed_at: { $ne: null, $gte: new Date(periodStartMs) },
        packed_by_id: { $ne: null },
      })
      .project({ _id: 0, packed_at: 1, packed_by_id: 1, packed_by_name: 1, packed_wita_date: 1 })
      .toArray();

    // Group by packer
    const byUser = new Map();
    for (const d of docs) {
      const uid = d.packed_by_id;
      if (!uid) continue;
      let u = byUser.get(uid);
      if (!u) {
        u = {
          user_id: uid,
          name: d.packed_by_name || 'Unknown',
          period_count: 0,
          today_count: 0,
          _today_timestamps: [],
        };
        byUser.set(uid, u);
      }
      u.period_count += 1;
      if (d.packed_wita_date === today) {
        u.today_count += 1;
        u._today_timestamps.push(new Date(d.packed_at).getTime());
      }
    }

    // Compute avg interval per user (today's timestamps only — resets daily).
    const list = [...byUser.values()].map((u) => {
      const ts = u._today_timestamps.slice().sort((a, b) => a - b);
      let avgIntervalSec = null;
      if (ts.length >= 2) {
        const sum = ts[ts.length - 1] - ts[0];
        avgIntervalSec = Math.round(sum / (ts.length - 1) / 1000);
      }
      const { _today_timestamps, ...rest } = u;
      return { ...rest, avg_interval_seconds: avgIntervalSec };
    });

    // Sort by period_count desc → today_count desc → name for stable ranking.
    list.sort((a, b) => (b.period_count - a.period_count) || (b.today_count - a.today_count) || a.name.localeCompare(b.name));
    const ranked = list.map((u, i) => ({ ...u, rank: i + 1 }));

    // Redact period_count for non-owners per requirement.
    const isOwner = user.role === 'owner';
    const outUsers = ranked.map((u) => {
      if (isOwner) return u;
      const { period_count, ...rest } = u;
      return rest;
    });

    return jsonRes({
      period,
      today,
      as_of: new Date().toISOString(),
      users: outUsers,
      viewer_role: user.role || 'staff',
    });
  }

  // -------- Dashboard (today's stats) --------
  if (subPath === 'dashboard' && method === 'GET') {
    const today = todayWitaDateString();

    // Phase counts (today)
    const printedToday = await db.collection('om_shipments').countDocuments({ printed_wita_date: today });
    const packedToday = await db.collection('om_shipments').countDocuments({ packed_wita_date: today });
    const deliveredToday = await db.collection('om_shipments').countDocuments({ delivered_wita_date: today });

    // Selisih (all-time, currently pending each phase)
    const printedNotPacked = await db
      .collection('om_shipments')
      .countDocuments({ status: 'printed' });
    const packedNotDelivered = await db
      .collection('om_shipments')
      .countDocuments({ status: 'packed' });

    // Success rate today = delivered/printed if printed>0 else delivered/packed
    const baseToday = printedToday || packedToday;
    const successRate = baseToday === 0 ? 0 : Math.round((deliveredToday / baseToday) * 100);

    // Breakdown by expedition — GROUPED across all 3 phases (today)
    const byExpAgg = await db
      .collection('om_shipments')
      .aggregate([
        {
          $match: {
            $or: [
              { printed_wita_date: today },
              { packed_wita_date: today },
              { delivered_wita_date: today },
            ],
          },
        },
        {
          $group: {
            _id: '$expedition_id',
            expedition_name: { $first: '$expedition_name' },
            printed: { $sum: { $cond: [{ $eq: ['$printed_wita_date', today] }, 1, 0] } },
            packed: { $sum: { $cond: [{ $eq: ['$packed_wita_date', today] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $eq: ['$delivered_wita_date', today] }, 1, 0] } },
          },
        },
        { $sort: { printed: -1, packed: -1 } },
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
      .project({ _id: 0, photo_path: 0, photo_data: 0 })
      .toArray();

    return jsonRes({
      date: today,
      today: {
        printed: printedToday,
        packed: packedToday,
        delivered: deliveredToday,
        // Selisih antar fase (hari ini)
        diff_print_pack: printedToday - packedToday,
        diff_pack_deliver: packedToday - deliveredToday,
        success_rate: successRate,
      },
      pending: {
        printed_not_packed: printedNotPacked,
        packed_not_delivered: packedNotDelivered,
      },
      by_expedition: byExpAgg.map((x) => ({
        expedition_id: x._id,
        expedition_name: x.expedition_name,
        printed: x.printed,
        packed: x.packed,
        delivered: x.delivered,
        diff: (x.printed || x.packed) - x.delivered,
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

  // -------- Pending list (belum ke fase berikutnya) --------
  if (subPath === 'pending' && method === 'GET') {
    const url = new URL(req.url);
    const date = url.searchParams.get('date'); // optional filter
    const type = url.searchParams.get('type') || 'packed_not_delivered'; // or printed_not_packed
    const q = {};
    if (type === 'printed_not_packed') {
      q.status = 'printed';
      if (date) q.printed_wita_date = date;
    } else {
      q.status = 'packed';
      if (date) q.packed_wita_date = date;
    }
    const items = await db
      .collection('om_shipments')
      .find(q)
      .sort({ packed_at: -1, printed_at: -1 })
      .limit(500)
      .project({ _id: 0, photo_path: 0, photo_data: 0 })
      .toArray();
    return jsonRes({ items, type });
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
    if (status === 'printed' || status === 'packed' || status === 'delivered') q.status = status;
    if (trackingSearch) {
      q.tracking_number = { $regex: trackingSearch, $options: 'i' };
    }
    const items = await db
      .collection('om_shipments')
      .find(q)
      .sort({ packed_at: -1 })
      .limit(limit)
      .project({ _id: 0, photo_path: 0, photo_data: 0 })
      .toArray();

    // ---- Bulk-annotate each shipment with its KETOKO status ----
    // Look up the PDF whose detected_tracking_numbers contains this shipment's
    // tracking_number, then find the matching entry in that PDF's ketoko_resi.
    // One query fetches all needed PDFs at once (avoiding N+1).
    if (items.length > 0) {
      const trackingNums = items.map((s) => s.tracking_number).filter(Boolean);
      const pdfs = trackingNums.length
        ? await db
            .collection('om_pdfs')
            .find({
              detected_tracking_numbers: { $in: trackingNums },
              deleted: { $ne: true },
            })
            .project({ _id: 0, file_path: 0, file_data: 0 })
            .toArray()
        : [];
      // Build a map: tracking_number -> ketoko resi entry
      const byTn = new Map();
      for (const pdf of pdfs) {
        const resi = Array.isArray(pdf.ketoko_resi) ? pdf.ketoko_resi : [];
        for (const r of resi) {
          if (r && r.tracking_number) {
            byTn.set(r.tracking_number, {
              ...r,
              pdf_id: pdf.id,
              pdf_filename: pdf.filename,
            });
          }
        }
        // Handle legacy PDFs that have detected_tracking_numbers but no
        // ketoko_resi yet (never opened by KETOKO panel). Emit a synthesized
        // "unchecked" entry so the report still shows a row instead of blank.
        if (resi.length === 0 && Array.isArray(pdf.detected_tracking_numbers)) {
          for (const tn of pdf.detected_tracking_numbers) {
            if (!byTn.has(tn)) {
              byTn.set(tn, {
                tracking_number: tn,
                checked: false,
                checked_at: null,
                checked_by_id: null,
                checked_by_name: null,
                note_type: null,
                note_text: null,
                note_updated_at: null,
                pdf_id: pdf.id,
                pdf_filename: pdf.filename,
              });
            }
          }
        }
      }
      for (const s of items) {
        const entry = byTn.get(s.tracking_number);
        if (entry) {
          s.ketoko_checked = !!entry.checked;
          s.ketoko_checked_at = entry.checked_at;
          s.ketoko_checked_by_id = entry.checked_by_id;
          s.ketoko_checked_by_name = entry.checked_by_name;
          s.ketoko_note_type = entry.note_type;
          s.ketoko_note_text = entry.note_text;
          s.ketoko_note_updated_at = entry.note_updated_at;
          s.ketoko_pdf_id = entry.pdf_id;
          s.ketoko_pdf_filename = entry.pdf_filename;
        } else {
          // No PDF found containing this tracking number (shipment created
          // via scan-print with a resi that wasn't in any uploaded PDF, or the
          // PDF was already deleted/expired). Leave fields undefined so client
          // can render as "belum ada PDF".
          s.ketoko_checked = false;
          s.ketoko_checked_at = null;
          s.ketoko_note_type = null;
          s.ketoko_note_text = null;
          s.ketoko_pdf_id = null;
          s.ketoko_pdf_filename = null;
        }
      }
    }

    // Summary
    const total = items.length;
    const delivered = items.filter((x) => x.status === 'delivered').length;
    const ketokoDone = items.filter((x) => x.ketoko_checked).length;
    return jsonRes({
      items,
      summary: {
        total,
        packed: total,
        delivered,
        difference: total - delivered,
        success_rate: total === 0 ? 0 : Math.round((delivered / total) * 100),
        ketoko_done: ketokoDone,
        ketoko_total: total,
        ketoko_progress: total === 0 ? '0/0' : `${ketokoDone}/${total}`,
      },
    });
  }

  // -------- TAB Workflow List (Cetak / Packing / Kirim / Selesai) --------
  // GET /api/om/tab/:tab?q=&limit=&expedition_id=
  const tabMatch = subPath.match(/^tab\/(cetak|packing|kirim|selesai)$/);
  if (tabMatch && method === 'GET') {
    const tab = tabMatch[1];
    const url = new URL(req.url);
    const q = url.searchParams.get('q') || '';
    const expeditionId = url.searchParams.get('expedition_id');
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');
    const limit = Math.min(Number(url.searchParams.get('limit') || 500), 2000);

    const filter = {};
    if (tab === 'cetak') {
      filter.status = 'printed';
    } else if (tab === 'packing') {
      filter.status = 'packed';
    } else if (tab === 'kirim') {
      // Delivered but NOT yet archived (still within current shift)
      filter.status = 'delivered';
      filter.$or = [{ archived_at: { $exists: false } }, { archived_at: null }];
    } else if (tab === 'selesai') {
      // Delivered AND archived (past cutoff)
      filter.status = 'delivered';
      filter.archived_at = { $ne: null };
    }
    if (expeditionId) filter.expedition_id = expeditionId;
    if (q) filter.tracking_number = { $regex: q, $options: 'i' };
    if (dateFrom || dateTo) {
      // Date range applied to the phase's date field
      const dateField =
        tab === 'cetak' ? 'printed_wita_date' :
        tab === 'packing' ? 'packed_wita_date' :
        'delivered_wita_date';
      filter[dateField] = {};
      if (dateFrom) filter[dateField].$gte = dateFrom;
      if (dateTo) filter[dateField].$lte = dateTo;
    }

    const sortField =
      tab === 'cetak' ? 'printed_at' :
      tab === 'packing' ? 'packed_at' :
      'delivered_at';

    const items = await db
      .collection('om_shipments')
      .find(filter)
      .sort({ [sortField]: -1 })
      .limit(limit)
      .project({ _id: 0, photo_path: 0, photo_data: 0 })
      .toArray();

    // Counts for all 4 tabs (for badge display)
    const [cetakCount, packingCount, kirimCount, selesaiCount] = await Promise.all([
      db.collection('om_shipments').countDocuments({ status: 'printed' }),
      db.collection('om_shipments').countDocuments({ status: 'packed' }),
      db.collection('om_shipments').countDocuments({
        status: 'delivered',
        $or: [{ archived_at: { $exists: false } }, { archived_at: null }],
      }),
      db.collection('om_shipments').countDocuments({
        status: 'delivered',
        archived_at: { $ne: null },
      }),
    ]);

    return jsonRes({
      tab,
      items,
      counts: {
        cetak: cetakCount,
        packing: packingCount,
        kirim: kirimCount,
        selesai: selesaiCount,
      },
    });
  }

  // -------- Cutoff Info --------
  // GET /api/om/cutoff-info — returns current cutoff hour & the moment (WITA) of last & next cutoff
  if (subPath === 'cutoff-info' && method === 'GET') {
    const s = (await db.collection('om_settings').findOne({ id: 'default' })) || DEFAULT_SETTINGS;
    const h = Number(s.archive_cutoff_hour ?? 6);
    const lastCutoff = getLastCutoffMoment(h);
    // Next cutoff is 24h after the last
    const nextCutoff = new Date(lastCutoff.getTime() + 24 * 3600000);
    return jsonRes({
      cutoff_hour: h,
      last_cutoff: lastCutoff.toISOString(),
      next_cutoff: nextCutoff.toISOString(),
    });
  }

  // Not handled -> return null so caller can decide
  return handlePDFRequest(req, subPath, method, { db, user });
}

// ============================================================
// PDF RESI — sub-router (POST/GET/DELETE for /api/om/pdfs/*)
// Follows same photo retention setting (photo_retention_days).
// ============================================================
const PDF_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'pdfs');
const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB

async function handlePDFRequest(req, subPath, method, { db, user }) {
  // POST /api/om/pdfs — upload PDF (multipart/form-data) — OWNER ONLY
  if (subPath === 'pdfs' && method === 'POST') {
    if (user.role !== 'owner') return err('Hanya owner (ADMIN) yang boleh mengunggah PDF', 403);
    let form;
    try {
      form = await req.formData();
    } catch (e) {
      return err('gagal parse form-data: ' + (e?.message || e));
    }
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return err('file wajib');

    const filename = String(file.name || 'upload.pdf');
    const size = file.size;
    const type = file.type || '';

    if (!/pdf/i.test(type) && !/\.pdf$/i.test(filename)) return err('file harus PDF');
    if (size > MAX_PDF_SIZE) return err(`ukuran file terlalu besar (max ${Math.round(MAX_PDF_SIZE/1024/1024)} MB)`);
    if (size < 100) return err('file terlalu kecil / kosong');

    const buf = Buffer.from(await file.arrayBuffer());

    const wita = getWita();
    const dir = path.join(PDF_UPLOAD_DIR, String(wita.year), wita.month);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const id = uuidv4();
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'upload.pdf';
    const fname = `${id}_${safeName}`;
    const fpath = path.join(dir, fname);
    // Best-effort write to disk (kept for backward-compat / observability).
    // The AUTHORITATIVE copy of the bytes lives in MongoDB (file_data below)
    // so PDFs remain retrievable regardless of which pod handles a later
    // request — production runs on Kubernetes and per-pod local storage is
    // NOT shared. Prior code only wrote to disk, so requests routed to a
    // different pod would 404 with "PDF tidak ditemukan pada storage".
    try { fs.writeFileSync(fpath, buf); } catch (e) {
      console.error('[OM PDF upload] disk write failed (non-fatal, DB has data)', e);
    }

    const doc = {
      id,
      filename: safeName,
      original_filename: filename,
      size,
      file_path: fpath,
      // BSON Binary — Node driver auto-converts a Buffer. Max PDF size (10 MB)
      // + other fields is well under BSON's 16 MB document limit.
      file_data: buf,
      uploaded_at: new Date(),
      uploaded_wita_date: wita.date,
      uploaded_by_id: user.id,
      uploaded_by_name: user.name,
      pages_count: null,
      detected_tracking_numbers: [],
      scanned_at: null,
      printed_at: null,
      printed_by_id: null,
      printed_by_name: null,
      // KETOKO POS input tracking
      ketoko_input_at: null,
      ketoko_input_by_id: null,
      ketoko_input_by_name: null,
      // PDF open (preview) tracking — enables PIN protection for re-opens
      first_open_at: null,
      first_open_by_id: null,
      first_open_by_name: null,
      last_open_at: null,
      last_open_by_id: null,
      last_open_by_name: null,
      open_count: 0,
      deleted: false,
    };
    await db.collection('om_pdfs').insertOne(doc);
    const { _id, file_path: _fp, file_data: _fd, ...safe } = doc;
    return jsonRes({ item: safe });
  }

  // POST /api/om/pdfs/auto — upload PDF with auto-rename (DDMMYY-N.pdf) — OWNER ONLY
  // Used by Merdeka Share PWA. Ignores original filename; stores under YYYY/MM/DD/.
  if (subPath === 'pdfs/auto' && method === 'POST') {
    if (user.role !== 'owner') return err('Hanya owner (ADMIN) yang boleh mengunggah PDF', 403);
    let form;
    try {
      form = await req.formData();
    } catch (e) {
      return err('gagal parse form-data: ' + (e?.message || e));
    }
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return err('file wajib');

    const size = file.size;
    const type = file.type || '';
    const origName = String(file.name || 'upload.pdf');

    if (!/pdf/i.test(type) && !/\.pdf$/i.test(origName)) return err('file harus PDF');
    if (size > MAX_PDF_SIZE) return err(`ukuran file terlalu besar (max ${Math.round(MAX_PDF_SIZE/1024/1024)} MB)`);
    if (size < 100) return err('file terlalu kecil / kosong');

    const buf = Buffer.from(await file.arrayBuffer());

    const wita = getWita();
    // DDMMYY (2-digit year) prefix
    const yy = String(wita.year).slice(-2);
    const ddmmyy = `${wita.day}${wita.month}${yy}`;

    // Compute next N for today: filename pattern ${ddmmyy}-N.pdf
    const escaped = ddmmyy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await db.collection('om_pdfs').find({
      filename: { $regex: `^${escaped}-\\d+\\.pdf$`, $options: 'i' },
    }).project({ filename: 1 }).toArray();
    let maxN = 0;
    for (const it of existing) {
      const m = String(it.filename || '').match(/-(\d+)\.pdf$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxN) maxN = n;
      }
    }
    const nextN = maxN + 1;
    const safeName = `${ddmmyy}-${nextN}.pdf`;

    const dir = path.join(PDF_UPLOAD_DIR, String(wita.year), wita.month, wita.day);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const id = uuidv4();
    const fname = `${id}_${safeName}`;
    const fpath = path.join(dir, fname);
    // See POST /api/om/pdfs upload path for why we store in BOTH disk and DB.
    // MongoDB is the AUTHORITATIVE copy; disk is best-effort local cache.
    try { fs.writeFileSync(fpath, buf); } catch (e) {
      console.error('[OM PDF auto-upload] disk write failed (non-fatal, DB has data)', e);
    }

    const doc = {
      id,
      filename: safeName,
      original_filename: origName,
      size,
      file_path: fpath,
      file_data: buf, // authoritative — see comment in POST /api/om/pdfs
      uploaded_at: new Date(),
      uploaded_wita_date: wita.date,
      uploaded_by_id: user.id,
      uploaded_by_name: user.name,
      uploaded_via: 'merdeka_share',
      pages_count: null,
      detected_tracking_numbers: [],
      scanned_at: null,
      printed_at: null,
      printed_by_id: null,
      printed_by_name: null,
      ketoko_input_at: null,
      ketoko_input_by_id: null,
      ketoko_input_by_name: null,
      // PDF open (preview) tracking
      first_open_at: null,
      first_open_by_id: null,
      first_open_by_name: null,
      last_open_at: null,
      last_open_by_id: null,
      last_open_by_name: null,
      open_count: 0,
      deleted: false,
    };
    await db.collection('om_pdfs').insertOne(doc);
    // Never leak the binary in the response — return metadata only.
    const { _id, file_path: _fp, file_data: _fd, ...safe } = doc;
    return jsonRes({ item: safe });
  }

  // GET /api/om/pdfs — list (only non-deleted). Supports `?since=<iso>` for polling.
  if (subPath === 'pdfs' && method === 'GET') {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    const since = url.searchParams.get('since');
    const filter = { deleted: { $ne: true } };
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime())) {
        filter.uploaded_at = { $gt: sinceDate };
      }
    }
    // IMPORTANT — capture the cursor BEFORE running the query.
    // If we captured it after the query, any insert that happened between the
    // query and the timestamp would be silently skipped on the next poll
    // (because `filter.uploaded_at > since` would filter it out). This is the
    // exact race that made Merdeka Share uploads occasionally invisible in
    // the main PDF Resi list.
    const serverTime = new Date().toISOString();
    const items = await db
      .collection('om_pdfs')
      .find(filter)
      .sort({ uploaded_at: -1 })
      .limit(limit)
      .project({ _id: 0, file_path: 0, file_data: 0 })
      .toArray();
    // Hydrate ketoko_resi array on each item so the client always sees a
    // per-tracking-number entry for every detected resi (even for legacy PDFs
    // uploaded before this feature existed). Also, if hydration ADDS new
    // entries (e.g. detected_tracking_numbers was populated after ketoko_resi
    // was initialized), persist the result back so we don't rebuild every
    // request.
    for (const it of items) {
      const { resi, changed } = hydrateKetokoResi(it);
      it.ketoko_resi = resi;
      // Add rollup fields the client uses for badges/progress
      it.ketoko_checked_count = resi.filter((r) => r.checked).length;
      it.ketoko_total_count = resi.length;
      if (changed) {
        // Fire-and-forget: swallow errors so a slow write doesn't block the list.
        db.collection('om_pdfs')
          .updateOne({ id: it.id }, { $set: { ketoko_resi: resi } })
          .catch(() => {});
      }
    }
    return jsonRes({ items, server_time: serverTime });
  }

  // GET /api/om/pdfs/[id]/file — stream PDF binary (inline for native browser viewer)
  //
  // Serves the PDF bytes from MongoDB (`file_data`) as the primary source of
  // truth. Falls back to the local `file_path` for legacy records that were
  // uploaded before the DB-embed change. If a legacy file is found on disk,
  // it is migrated into the DB so subsequent requests routed to a different
  // pod (K8s multi-replica load balancing) also succeed.
  //
  // This is the endpoint the frontend hands to `window.open()` / `<a target=_blank>`
  // for the "Print" and "Buka di tab baru" buttons. Client appends
  // `?token=<session>` so the browser can navigate without an Authorization
  // header (see getUserFromRequest URL-token fallback).
  const pdfFileMatch = subPath.match(/^pdfs\/([^/]+)\/file$/);
  if (pdfFileMatch && method === 'GET') {
    const id = pdfFileMatch[1];
    const doc = await db.collection('om_pdfs').findOne({ id });
    if (!doc) return err('PDF tidak ditemukan', 404);
    if (doc.deleted) return err('PDF sudah kadaluarsa atau dihapus', 410);

    // --- Resolve the actual bytes ---
    let data = null;

    // Primary: MongoDB Binary field. Node MongoDB driver returns BSON Binary
    // objects; unwrap into a Buffer for NextResponse.
    if (doc.file_data) {
      const fd = doc.file_data;
      if (Buffer.isBuffer(fd)) {
        data = fd;
      } else if (fd.buffer && Buffer.isBuffer(fd.buffer)) {
        data = fd.buffer; // BSON Binary { buffer: Buffer, sub_type }
      } else if (fd._bsontype === 'Binary' && fd.buffer) {
        data = Buffer.from(fd.buffer);
      } else if (fd instanceof Uint8Array) {
        data = Buffer.from(fd);
      }
    }

    // Fallback: legacy disk copy. If found, migrate it into MongoDB so
    // subsequent requests on any pod succeed without needing disk access.
    if (!data && doc.file_path && fs.existsSync(doc.file_path)) {
      try {
        data = fs.readFileSync(doc.file_path);
        // Best-effort backfill — swallow errors, don't block the response.
        db.collection('om_pdfs')
          .updateOne({ id }, { $set: { file_data: data } })
          .catch(() => {});
      } catch (e) {
        console.error('[OM PDF serve] disk read failed', e);
      }
    }

    if (!data) return err('PDF tidak ditemukan pada storage', 404);

    // Sanitize filename for header (RFC-2183 basic: strip CR/LF/quote)
    const safeName = String(doc.filename || 'resi.pdf').replace(/[\r\n"]/g, '_');
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        // `inline` (not attachment) so the browser opens the built-in PDF
        // viewer instead of forcing a download. filename= helps if the user
        // hits "Save As" from the viewer's toolbar.
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Content-Length': String(data.length),
        // Short private cache lets a page-refresh in the PDF viewer be fast
        // without letting shared proxies keep a copy.
        'Cache-Control': 'private, max-age=600',
        // Explicit — some CDNs will otherwise inject sniffing.
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // POST /api/om/pdfs/[id]/scan-result — save detected tracking numbers from client-side QR scan
  const pdfScanMatch = subPath.match(/^pdfs\/([^/]+)\/scan-result$/);
  if (pdfScanMatch && method === 'POST') {
    const id = pdfScanMatch[1];
    const doc = await db.collection('om_pdfs').findOne({ id });
    if (!doc) return err('PDF tidak ditemukan', 404);
    const body = await req.json();
    const raw = Array.isArray(body?.tracking_numbers) ? body.tracking_numbers : [];
    const trackingNumbers = [
      ...new Set(
        raw
          .filter((x) => typeof x === 'string')
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 200) // safety cap
      ),
    ];
    const pagesCount = Number(body?.pages_count);
    // Optional additive field: which parser pass produced these results.
    // 'qr'      → QR code found (Pass 1 in the client parser)
    // 'barcode' → 1D barcode fallback found (Pass 2, when Pass 1 empty)
    // anything else / missing → leave doc.detected_via untouched (backward-
    // compatible with legacy PDFs uploaded before this field existed).
    const detectedVia =
      body?.detected_via === 'qr' || body?.detected_via === 'barcode'
        ? body.detected_via
        : null;
    const setFields = {
      detected_tracking_numbers: trackingNumbers,
      pages_count: Number.isFinite(pagesCount) ? pagesCount : doc.pages_count,
      scanned_at: new Date(),
    };
    if (detectedVia) setFields.detected_via = detectedVia;
    // If the parser explicitly reports empty results, also clear any stale
    // detected_via from a prior scan so the UI doesn't show a mismatched label.
    if (detectedVia === null && trackingNumbers.length === 0) {
      setFields.detected_via = null;
    }
    await db.collection('om_pdfs').updateOne({ id }, { $set: setFields });
    const updated = await db.collection('om_pdfs').findOne({ id }, { projection: { _id: 0, file_path: 0, file_data: 0 } });
    return jsonRes({ item: updated });
  }

  // POST /api/om/pdfs/[id]/mark-printed
  const pdfPrintMatch = subPath.match(/^pdfs\/([^/]+)\/mark-printed$/);
  if (pdfPrintMatch && method === 'POST') {
    const id = pdfPrintMatch[1];
    const doc = await db.collection('om_pdfs').findOne({ id });
    if (!doc) return err('PDF tidak ditemukan', 404);
    await db.collection('om_pdfs').updateOne(
      { id },
      {
        $set: {
          printed_at: new Date(),
          printed_by_id: user.id,
          printed_by_name: user.name,
        },
      }
    );
    const updated = await db.collection('om_pdfs').findOne({ id }, { projection: { _id: 0, file_path: 0, file_data: 0 } });
    return jsonRes({ item: updated });
  }

  // POST /api/om/pdfs/[id]/ketoko — bulk toggle KETOKO POS input flag for ALL resi
  //   body: { input: true | false }
  //   input:true  → marks every detected resi as checked (records who + when)
  //   input:false → clears every resi's checked state (NOTES ARE PRESERVED so
  //                 an operator doesn't lose the reason they typed)
  //
  //   Kept for backward-compat with older clients that still call this. New
  //   clients should use POST /api/om/pdfs/[id]/ketoko-resi to update one
  //   resi at a time (checkbox per row).
  const pdfKetokoMatch = subPath.match(/^pdfs\/([^/]+)\/ketoko$/);
  if (pdfKetokoMatch && method === 'POST') {
    const id = pdfKetokoMatch[1];
    const doc = await db.collection('om_pdfs').findOne({ id });
    if (!doc) return err('PDF tidak ditemukan', 404);
    const body = await req.json().catch(() => ({}));
    const input = !!body?.input;

    const { resi: hydrated } = hydrateKetokoResi(doc);
    const now = new Date();
    const nextResi = hydrated.map((r) => {
      if (input) {
        // Mark ALL as checked — clear note (server rule: note only on unchecked)
        return {
          ...r,
          checked: true,
          checked_at: r.checked_at || now,
          checked_by_id: r.checked_by_id || user.id,
          checked_by_name: r.checked_by_name || user.name,
          note_type: null,
          note_text: null,
          note_updated_at: null,
        };
      }
      // Uncheck — clear checked_by/at but keep note.
      return {
        ...r,
        checked: false,
        checked_at: null,
        checked_by_id: null,
        checked_by_name: null,
      };
    });
    const overall = recomputeKetokoOverall(nextResi, user);
    await db.collection('om_pdfs').updateOne(
      { id },
      { $set: { ketoko_resi: nextResi, ...overall } }
    );
    const updated = await db.collection('om_pdfs').findOne(
      { id },
      { projection: { _id: 0, file_path: 0, file_data: 0 } }
    );
    updated.ketoko_checked_count = nextResi.filter((r) => r.checked).length;
    updated.ketoko_total_count = nextResi.length;
    return jsonRes({ item: updated });
  }

  // POST /api/om/pdfs/[id]/ketoko-resi — per-resi update (new)
  //   body: { tracking_number: string, checked?: bool, note_type?: 'kosong'|'lainnya'|null, note_text?: string|null }
  //
  //   RULES (server-enforced):
  //   - tracking_number MUST be in this PDF's detected_tracking_numbers.
  //   - When checked flips to TRUE:  clears any note (business rule: notes
  //     exist to explain why a resi was NOT input to KETOKO).
  //   - When checked flips to FALSE: preserves note (operator may have typed
  //     it before flipping back).
  //   - Notes accept only 'kosong' or 'lainnya' (or null to clear). If the
  //     resi is currently checked and body tries to set a note, the note is
  //     silently rejected (only relevant on unchecked resi).
  //   - Overall `ketoko_input_at` (legacy flag) is auto-recomputed after the
  //     mutation so existing badges/reports still work.
  const pdfKetokoResiMatch = subPath.match(/^pdfs\/([^/]+)\/ketoko-resi$/);
  if (pdfKetokoResiMatch && method === 'POST') {
    const id = pdfKetokoResiMatch[1];
    const doc = await db.collection('om_pdfs').findOne({ id });
    if (!doc) return err('PDF tidak ditemukan', 404);

    const body = await req.json().catch(() => ({}));
    const tn = String(body?.tracking_number || '').trim();
    if (!tn) return err('tracking_number wajib diisi', 400);

    const detected = Array.isArray(doc.detected_tracking_numbers)
      ? doc.detected_tracking_numbers
      : [];
    if (!detected.includes(tn)) {
      return err('tracking_number tidak terdeteksi pada PDF ini', 400);
    }

    const { resi } = hydrateKetokoResi(doc);
    const idx = resi.findIndex((r) => r.tracking_number === tn);
    if (idx < 0) return err('tracking_number tidak ditemukan di ketoko_resi', 500);
    const before = resi[idx];
    const next = { ...before };

    const now = new Date();
    // Handle checked flip
    if (body.checked !== undefined) {
      const willCheck = !!body.checked;
      if (willCheck && !next.checked) {
        next.checked = true;
        next.checked_at = now;
        next.checked_by_id = user.id;
        next.checked_by_name = user.name;
        // Server rule: notes belong only to unchecked resi. Clear on check.
        next.note_type = null;
        next.note_text = null;
        next.note_updated_at = null;
      } else if (!willCheck && next.checked) {
        next.checked = false;
        next.checked_at = null;
        next.checked_by_id = null;
        next.checked_by_name = null;
        // Preserve note (operator may resume editing it).
      }
    }

    // Handle note update — allowed only when the resi is UN-checked AFTER any
    // checked-flip above. If checked, silently ignore note fields (server-safe).
    if (!next.checked && (body.note_type !== undefined || body.note_text !== undefined)) {
      // Coerce note_type to allowed enum (or null)
      let nt = body.note_type;
      if (nt === '' || nt === null || nt === undefined) nt = null;
      else if (!KETOKO_NOTE_TYPES.has(nt)) nt = null;

      let ntext = body.note_text;
      if (ntext === undefined || ntext === null) ntext = null;
      else ntext = String(ntext).slice(0, 500);

      // 'kosong' has no free-text — force text=null.
      if (nt === 'kosong') ntext = null;
      // 'lainnya' with empty text is fine (operator picked it but hasn't typed yet).
      // null type → clear both.
      if (nt === null) ntext = null;

      next.note_type = nt;
      next.note_text = ntext;
      next.note_updated_at = now;
    }

    // Write out the updated array + recompute overall flag.
    const nextResi = [...resi];
    nextResi[idx] = next;
    const overall = recomputeKetokoOverall(nextResi, user);
    await db.collection('om_pdfs').updateOne(
      { id },
      { $set: { ketoko_resi: nextResi, ...overall } }
    );

    const updated = await db.collection('om_pdfs').findOne(
      { id },
      { projection: { _id: 0, file_path: 0, file_data: 0 } }
    );
    updated.ketoko_checked_count = nextResi.filter((r) => r.checked).length;
    updated.ketoko_total_count = nextResi.length;
    return jsonRes({ item: updated, resi: next });
  }

  // POST /api/om/pdfs/[id]/open — record a PDF open (preview) event.
  //   Used by the client to increment open_count and refresh timestamps.
  //   Body is ignored. Response: updated item.
  const pdfOpenMatch = subPath.match(/^pdfs\/([^/]+)\/open$/);
  if (pdfOpenMatch && method === 'POST') {
    const id = pdfOpenMatch[1];
    const doc = await db.collection('om_pdfs').findOne({ id });
    if (!doc) return err('PDF tidak ditemukan', 404);
    const now = new Date();
    const setFields = {
      last_open_at: now,
      last_open_by_id: user.id,
      last_open_by_name: user.name,
    };
    if (!doc.first_open_at) {
      setFields.first_open_at = now;
      setFields.first_open_by_id = user.id;
      setFields.first_open_by_name = user.name;
    }
    await db.collection('om_pdfs').updateOne(
      { id },
      { $set: setFields, $inc: { open_count: 1 } }
    );
    const updated = await db.collection('om_pdfs').findOne({ id }, { projection: { _id: 0, file_path: 0, file_data: 0 } });
    return jsonRes({ item: updated });
  }

  // DELETE /api/om/pdfs/[id] — OWNER ONLY (staff cannot delete)
  const pdfDeleteMatch = subPath.match(/^pdfs\/([^/]+)$/);
  if (pdfDeleteMatch && method === 'DELETE') {
    if (user.role !== 'owner') return err('Hanya owner (ADMIN) yang boleh menghapus PDF', 403);
    const id = pdfDeleteMatch[1];
    const doc = await db.collection('om_pdfs').findOne({ id });
    if (!doc) return err('PDF tidak ditemukan', 404);
    if (doc.file_path) {
      try { fs.unlinkSync(doc.file_path); } catch {}
    }
    // Soft-delete metadata (kept for audit) + hard-remove the binary so the
    // MongoDB doc doesn't stay bloated.
    await db.collection('om_pdfs').updateOne(
      { id },
      { $set: { deleted: true, file_path: null }, $unset: { file_data: '' } }
    );
    return jsonRes({ ok: true });
  }

  return null;
}
