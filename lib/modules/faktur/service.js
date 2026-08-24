// ============================================================================
// Module: MIS Faktur (isolated)
// Stores customer invoice PDF metadata + Telegram references.
// Actual PDF file is uploaded to a private Telegram channel to keep MIS
// storage small. Only the Telegram message_id/file_id + metadata are kept
// in MongoDB. When Telegram send fails, the PDF is retained as BSON Binary
// on the invoice document so the operator can retry later; on success the
// binary is deleted immediately.
//
// PRODUCTION SAFETY:
//   - Fully isolated from Cycle Count and Order Management modules.
//   - Does not touch any existing collection. Uses `mis_faktur` collection only.
//   - Uses same auth pattern (Bearer token via `user` passed by the router).
// ============================================================================

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { Binary } from 'mongodb';

// ---- Helpers ----------------------------------------------------------------
function jsonRes(data, status = 200) {
  return NextResponse.json(data, { status });
}
function errRes(msg, status = 400, extra = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status });
}

const TG_API = 'https://api.telegram.org';

function getTgConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

// Send a PDF Buffer to the configured Telegram channel via sendDocument.
// Returns { ok: true, message_id, file_id } on success or { ok: false, error }.
async function sendDocumentToTelegram({ buffer, filename, caption }) {
  const cfg = getTgConfig();
  if (!cfg) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum di-set di server .env' };
  }
  try {
    const form = new FormData();
    form.append('chat_id', String(cfg.chatId));
    if (caption) form.append('caption', String(caption).slice(0, 1000));
    // Blob with correct MIME so Telegram infers PDF properly.
    const blob = new Blob([buffer], { type: 'application/pdf' });
    form.append('document', blob, filename || 'faktur.pdf');

    const url = `${TG_API}/bot${cfg.token}/sendDocument`;
    // Telegram sometimes stalls on cold connects — 60s is plenty.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let resp;
    try {
      resp = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.description || `Telegram HTTP ${resp.status}` };
    }
    const msg = data.result || {};
    const doc = msg.document || {};
    return {
      ok: true,
      message_id: msg.message_id ?? null,
      file_id: doc.file_id ?? null,
      file_unique_id: doc.file_unique_id ?? null,
      file_size: doc.file_size ?? null,
      mime_type: doc.mime_type ?? 'application/pdf',
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Fetch a PDF from Telegram using file_id → getFile → download.
// Returns { ok, buffer, mime } or { ok: false, error }.
async function fetchDocumentFromTelegram(fileId) {
  const cfg = getTgConfig();
  if (!cfg) return { ok: false, error: 'TELEGRAM env belum di-set' };
  try {
    const infoResp = await fetch(`${TG_API}/bot${cfg.token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = await infoResp.json().catch(() => ({}));
    if (!infoResp.ok || !info.ok || !info.result?.file_path) {
      return { ok: false, error: info.description || `getFile HTTP ${infoResp.status}` };
    }
    const filePath = info.result.file_path;
    const dlResp = await fetch(`${TG_API}/file/bot${cfg.token}/${filePath}`);
    if (!dlResp.ok) return { ok: false, error: `download HTTP ${dlResp.status}` };
    const arrayBuf = await dlResp.arrayBuffer();
    return { ok: true, buffer: Buffer.from(arrayBuf), mime: 'application/pdf' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function serializeFaktur(row) {
  if (!row) return null;
  // Never leak the temporary file blob or Mongo _id to the client.
  const { _id, file_data, ...safe } = row;
  return {
    ...safe,
    has_local_file: !!file_data, // useful for UI to know a retry can stream local buffer
  };
}

async function ensureIndexes(db) {
  try {
    await db.collection('mis_faktur').createIndex({ id: 1 }, { unique: true });
    await db.collection('mis_faktur').createIndex({ uploaded_at: -1 });
    await db.collection('mis_faktur').createIndex({ no_faktur: 1 });
    await db.collection('mis_faktur').createIndex({ nama_pelanggan: 1 });
  } catch { /* idempotent */ }
}

// ---- Main handler ----------------------------------------------------------
// subPath is the request path AFTER the "faktur/" prefix. Examples:
//   ""                              -> GET list | POST upload
//   "<id>"                          -> GET one | PATCH edit | DELETE soft delete
//   "<id>/download"                 -> GET pdf stream
//   "<id>/retry"                    -> POST retry telegram send
export async function handleFakturRequest(req, subPath, method, ctx) {
  const { db, user } = ctx;
  if (!user) return errRes('unauthorized', 401);

  await ensureIndexes(db);

  // ---- LIST + SEARCH ------------------------------------------------------
  // GET /api/faktur?q=&limit=&status=
  if (subPath === '' && method === 'GET') {
    const url = new URL(req.url);
    const qStr = (url.searchParams.get('q') || '').trim();
    const status = url.searchParams.get('status') || '';
    const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);

    const filter = { deleted: { $ne: true } };
    if (qStr) {
      filter.$or = [
        { no_faktur: { $regex: qStr, $options: 'i' } },
        { nama_pelanggan: { $regex: qStr, $options: 'i' } },
        { filename: { $regex: qStr, $options: 'i' } },
      ];
    }
    if (status === 'sent' || status === 'failed' || status === 'pending') {
      filter.telegram_status = status;
    }
    const rows = await db
      .collection('mis_faktur')
      .find(filter)
      .sort({ uploaded_at: -1 })
      .limit(limit)
      .project({ file_data: 0 })
      .toArray();
    return jsonRes({
      items: rows.map(serializeFaktur),
      total: rows.length,
    });
  }

  // ---- UPLOAD -------------------------------------------------------------
  // POST /api/faktur  (multipart: file, no_faktur, nama_pelanggan,
  //                    tanggal_faktur, nominal, catatan)
  if (subPath === '' && method === 'POST') {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return errRes('Content-Type harus multipart/form-data');
    }
    let form;
    try {
      form = await req.formData();
    } catch (e) {
      return errRes(`form-data parse error: ${e?.message || e}`);
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') return errRes('file wajib diunggah');
    const filename = (file.name || 'faktur.pdf').slice(0, 200);
    if (!/\.pdf$/i.test(filename) && (file.type || '').toLowerCase() !== 'application/pdf') {
      return errRes('File harus berupa PDF');
    }
    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (!buffer.length) return errRes('file kosong');

    // Telegram Bot API caps sendDocument at 50 MB — enforce here for a clean error.
    const MAX_SIZE = 50 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      return errRes(`Ukuran PDF melebihi batas Telegram (50MB). Ukuran file: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
    }

    const noFaktur = String(form.get('no_faktur') || '').trim();
    const namaPelanggan = String(form.get('nama_pelanggan') || '').trim();
    const tanggalFaktur = String(form.get('tanggal_faktur') || '').trim(); // YYYY-MM-DD (optional)
    const nominalRaw = String(form.get('nominal') || '').trim();
    const catatan = String(form.get('catatan') || '').trim();
    const nominal = nominalRaw === '' ? null : Number(nominalRaw.replace(/[^\d.-]/g, ''));

    const id = uuidv4();
    const now = new Date();
    const caption = [
      noFaktur ? `No: ${noFaktur}` : null,
      namaPelanggan ? `Pelanggan: ${namaPelanggan}` : null,
      tanggalFaktur ? `Tanggal: ${tanggalFaktur}` : null,
      nominal ? `Nominal: ${nominal.toLocaleString('id-ID')}` : null,
      `Upload: ${user.name}`,
    ].filter(Boolean).join('\n');

    // 1) Insert metadata FIRST with pending status + retain binary as fallback.
    const baseDoc = {
      id,
      no_faktur: noFaktur || null,
      nama_pelanggan: namaPelanggan || null,
      tanggal_faktur: tanggalFaktur || null,
      nominal: Number.isFinite(nominal) ? nominal : null,
      catatan: catatan || null,
      filename,
      file_size: buffer.length,
      uploaded_by_id: user.id,
      uploaded_by_name: user.name,
      uploaded_at: now,
      telegram_message_id: null,
      telegram_file_id: null,
      telegram_file_unique_id: null,
      telegram_status: 'pending',
      telegram_error: null,
      telegram_sent_at: null,
      file_data: new Binary(buffer),
      deleted: false,
      createdAt: now,
    };
    await db.collection('mis_faktur').insertOne(baseDoc);

    // 2) Send to Telegram.
    const tg = await sendDocumentToTelegram({ buffer, filename, caption });
    if (tg.ok) {
      await db.collection('mis_faktur').updateOne(
        { id },
        {
          $set: {
            telegram_status: 'sent',
            telegram_message_id: tg.message_id,
            telegram_file_id: tg.file_id,
            telegram_file_unique_id: tg.file_unique_id,
            telegram_sent_at: new Date(),
            telegram_error: null,
          },
          $unset: { file_data: '' }, // Telegram now owns the storage — drop local copy.
        }
      );
    } else {
      await db.collection('mis_faktur').updateOne(
        { id },
        {
          $set: {
            telegram_status: 'failed',
            telegram_error: String(tg.error || 'unknown error').slice(0, 500),
          },
        }
      );
    }

    const saved = await db.collection('mis_faktur').findOne({ id }, { projection: { file_data: 0 } });
    return jsonRes({
      ok: tg.ok,
      faktur: serializeFaktur(saved),
      telegram: tg.ok ? { message_id: tg.message_id, file_id: tg.file_id } : { error: tg.error },
    }, tg.ok ? 200 : 502);
  }

  // ---- Per-invoice routes ------------------------------------------------
  const idMatch = subPath.match(/^([^/]+)(?:\/(download|retry))?$/);
  if (!idMatch) return null;
  const fakturId = idMatch[1];
  const action = idMatch[2] || '';

  const row = await db.collection('mis_faktur').findOne({ id: fakturId });
  if (!row || row.deleted) return errRes('faktur tidak ditemukan', 404);

  // ---- GET one ------------------------------------------------------------
  if (!action && method === 'GET') {
    return jsonRes({ faktur: serializeFaktur({ ...row, file_data: row.file_data }) });
  }

  // ---- PATCH metadata (light edit) ---------------------------------------
  if (!action && method === 'PATCH') {
    const body = await req.json().catch(() => ({}));
    const upd = {};
    if (body.no_faktur !== undefined) upd.no_faktur = String(body.no_faktur).trim() || null;
    if (body.nama_pelanggan !== undefined) upd.nama_pelanggan = String(body.nama_pelanggan).trim() || null;
    if (body.tanggal_faktur !== undefined) upd.tanggal_faktur = String(body.tanggal_faktur).trim() || null;
    if (body.nominal !== undefined) {
      const n = Number(String(body.nominal).replace(/[^\d.-]/g, ''));
      upd.nominal = Number.isFinite(n) ? n : null;
    }
    if (body.catatan !== undefined) upd.catatan = String(body.catatan).trim() || null;
    upd.updatedAt = new Date();
    await db.collection('mis_faktur').updateOne({ id: fakturId }, { $set: upd });
    const updated = await db.collection('mis_faktur').findOne(
      { id: fakturId },
      { projection: { file_data: 0 } }
    );
    return jsonRes({ faktur: serializeFaktur(updated) });
  }

  // ---- DELETE (soft) ------------------------------------------------------
  if (!action && method === 'DELETE') {
    await db.collection('mis_faktur').updateOne(
      { id: fakturId },
      { $set: { deleted: true, deleted_at: new Date(), deleted_by_id: user.id } }
    );
    return jsonRes({ ok: true });
  }

  // ---- DOWNLOAD -----------------------------------------------------------
  // GET /api/faktur/:id/download → stream PDF bytes.
  if (action === 'download' && method === 'GET') {
    let buffer = null;

    // Case 1: successfully sent to Telegram → fetch it back.
    if (row.telegram_status === 'sent' && row.telegram_file_id) {
      const tg = await fetchDocumentFromTelegram(row.telegram_file_id);
      if (tg.ok) buffer = tg.buffer;
    }
    // Case 2: fallback to locally-retained buffer (upload that failed to reach TG).
    if (!buffer && row.file_data) {
      buffer = Buffer.from(row.file_data.buffer || row.file_data);
    }
    if (!buffer) return errRes('PDF tidak tersedia (Telegram gagal & buffer lokal kosong)', 404);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${(row.filename || 'faktur.pdf').replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=60',
      },
    });
  }

  // ---- RETRY --------------------------------------------------------------
  // POST /api/faktur/:id/retry → resend to Telegram (buffer must still exist).
  if (action === 'retry' && method === 'POST') {
    if (row.telegram_status === 'sent') {
      return jsonRes({ ok: true, already_sent: true, faktur: serializeFaktur(row) });
    }
    if (!row.file_data) {
      return errRes('Buffer lokal sudah tidak ada — tidak bisa retry', 400);
    }
    const buffer = Buffer.from(row.file_data.buffer || row.file_data);
    const caption = [
      row.no_faktur ? `No: ${row.no_faktur}` : null,
      row.nama_pelanggan ? `Pelanggan: ${row.nama_pelanggan}` : null,
      row.tanggal_faktur ? `Tanggal: ${row.tanggal_faktur}` : null,
      row.nominal ? `Nominal: ${Number(row.nominal).toLocaleString('id-ID')}` : null,
      `Retry oleh: ${user.name}`,
    ].filter(Boolean).join('\n');
    const tg = await sendDocumentToTelegram({ buffer, filename: row.filename, caption });
    if (tg.ok) {
      await db.collection('mis_faktur').updateOne(
        { id: fakturId },
        {
          $set: {
            telegram_status: 'sent',
            telegram_message_id: tg.message_id,
            telegram_file_id: tg.file_id,
            telegram_file_unique_id: tg.file_unique_id,
            telegram_sent_at: new Date(),
            telegram_error: null,
          },
          $unset: { file_data: '' },
        }
      );
    } else {
      await db.collection('mis_faktur').updateOne(
        { id: fakturId },
        { $set: { telegram_status: 'failed', telegram_error: String(tg.error).slice(0, 500) } }
      );
    }
    const updated = await db.collection('mis_faktur').findOne(
      { id: fakturId },
      { projection: { file_data: 0 } }
    );
    return jsonRes({
      ok: tg.ok,
      faktur: serializeFaktur(updated),
      telegram: tg.ok ? { message_id: tg.message_id, file_id: tg.file_id } : { error: tg.error },
    }, tg.ok ? 200 : 502);
  }

  return null;
}
