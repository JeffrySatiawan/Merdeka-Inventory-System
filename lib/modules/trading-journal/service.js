/**
 * MODULE: Trading Journal (PRIVATE, Owner-Only, isolated).
 * ============================================================================
 * Collections (all prefix `tj_`):
 *   - tj_masters  : Master Pair/TF/Metode
 *   - tj_trades   : Trade records + screenshots reference to Telegram
 *   - tj_config   : Compounding config (modal awal)
 *
 * Screenshot: reuse Telegram Storage (same TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 * as Faktur). Local copy of helpers to keep total isolation (no import from
 * `faktur/service.js`). NO NEW image storage — hanya reference (file_id).
 */

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const j = (data, init = {}) => NextResponse.json(data, init);
const err = (msg, status = 400) => NextResponse.json({ error: msg }, { status });
const s = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const n = (v) => Number(v || 0);

const TG_API = 'https://api.telegram.org';
function getTgConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}
async function sendPhotoToTelegram({ buffer, filename, caption, mime }) {
  const cfg = getTgConfig();
  if (!cfg) return { ok: false, error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum di-set di server .env' };
  try {
    const form = new FormData();
    form.append('chat_id', String(cfg.chatId));
    if (caption) form.append('caption', String(caption).slice(0, 1024));
    const blob = new Blob([buffer], { type: mime || 'image/png' });
    form.append('photo', blob, filename || 'screenshot.png');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let resp;
    try { resp = await fetch(`${TG_API}/bot${cfg.token}/sendPhoto`, { method: 'POST', body: form, signal: controller.signal }); }
    finally { clearTimeout(timer); }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) return { ok: false, error: data.description || `Telegram HTTP ${resp.status}` };
    const msg = data.result || {};
    // Telegram sendPhoto returns array of PhotoSize; pick the largest.
    const photos = Array.isArray(msg.photo) ? msg.photo : [];
    const largest = photos[photos.length - 1] || {};
    return {
      ok: true,
      message_id: msg.message_id ?? null,
      file_id: largest.file_id ?? null,
      file_unique_id: largest.file_unique_id ?? null,
      file_size: largest.file_size ?? null,
      width: largest.width ?? null,
      height: largest.height ?? null,
    };
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
}
async function fetchPhotoFromTelegram(fileId) {
  const cfg = getTgConfig();
  if (!cfg) return { ok: false, error: 'TELEGRAM env belum di-set' };
  try {
    const infoResp = await fetch(`${TG_API}/bot${cfg.token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = await infoResp.json().catch(() => ({}));
    if (!infoResp.ok || !info.ok || !info.result?.file_path) return { ok: false, error: info.description || `getFile HTTP ${infoResp.status}` };
    const filePath = info.result.file_path;
    const dlResp = await fetch(`${TG_API}/file/bot${cfg.token}/${filePath}`);
    if (!dlResp.ok) return { ok: false, error: `download HTTP ${dlResp.status}` };
    const arrayBuf = await dlResp.arrayBuffer();
    // Guess MIME by extension.
    let mime = 'image/png';
    if (/\.jpe?g$/i.test(filePath)) mime = 'image/jpeg';
    else if (/\.webp$/i.test(filePath)) mime = 'image/webp';
    return { ok: true, buffer: Buffer.from(arrayBuf), mime };
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
}

// ---- Compute R & durations ----
function computeTradeMetrics(t) {
  const posBuy = t.position === 'BUY';
  const entry = n(t.entry_price), sl = n(t.sl_price), tp = n(t.tp_price);
  const risk = posBuy ? entry - sl : sl - entry;
  const reward = posBuy ? tp - entry : entry - tp;
  const rr = risk !== 0 ? reward / risk : 0;
  const risk_money = n(t.sl_money);
  const hasil = n(t.hasil_trade);
  const actual_r = risk_money !== 0 ? hasil / risk_money : 0;
  // Duration.
  let duration_minutes = null;
  if (t.jam_entry && t.jam_close) {
    const parseHM = (str) => {
      const m = String(str).match(/^(\d{1,2})[.:](\d{2})$/);
      if (!m) return null;
      return Number(m[1]) * 60 + Number(m[2]);
    };
    const a = parseHM(t.jam_entry), b = parseHM(t.jam_close);
    if (a != null && b != null) {
      duration_minutes = b >= a ? b - a : (b + 24 * 60 - a);
    }
  }
  return { risk, reward, rr, actual_r, duration_minutes };
}
function serializeTrade(row) {
  if (!row) return null;
  const { _id, ...rest } = row;
  const m = computeTradeMetrics(rest);
  return { ...rest, ...m };
}

// ============================================================================
export async function handleTradingJournalRequest(req, subPath, method, ctx) {
  const { db, user } = ctx;
  const url = new URL(req.url);
  // Semua endpoint HANYA untuk owner (defense-in-depth; router juga cek).
  if (user?.role !== 'owner') return err('hanya owner', 403);

  // ============================================================
  // MASTERS (Pair, Time Frame, Metode)
  // ============================================================
  if (subPath === 'masters' && method === 'GET') {
    const kind = String(url.searchParams.get('kind') || '').trim();
    const filter = {};
    if (kind) filter.kind = kind;
    const items = await db.collection('tj_masters')
      .find(filter).sort({ kind: 1, nama: 1 }).project({ _id: 0 }).toArray();
    return j({ items });
  }
  if (subPath === 'masters' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || '').trim();
    if (!['pair', 'tf', 'metode'].includes(kind)) return err('kind harus pair | tf | metode');
    const nama = s(body.nama, 60);
    if (!nama) return err('Nama wajib diisi');
    const dup = await db.collection('tj_masters').findOne({ kind, nama });
    if (dup) return err(`Nama "${nama}" sudah ada`, 409);
    const doc = { id: uuidv4(), kind, nama, active: true, createdAt: new Date() };
    await db.collection('tj_masters').insertOne(doc);
    const { _id, ...rest } = doc;
    return j({ item: rest });
  }
  if (subPath.startsWith('masters/') && method === 'PATCH') {
    const id = subPath.slice('masters/'.length);
    const cur = await db.collection('tj_masters').findOne({ id });
    if (!cur) return err('Master tidak ditemukan', 404);
    const body = await req.json().catch(() => ({}));
    const upd = {};
    if (body.nama != null) {
      const nama = s(body.nama, 60);
      if (!nama) return err('Nama tidak boleh kosong');
      if (nama !== cur.nama) {
        const dup = await db.collection('tj_masters').findOne({ kind: cur.kind, nama, id: { $ne: id } });
        if (dup) return err(`Nama "${nama}" sudah ada`, 409);
      }
      upd.nama = nama;
    }
    if (body.active != null) upd.active = !!body.active;
    await db.collection('tj_masters').updateOne({ id }, { $set: upd });
    const next = await db.collection('tj_masters').findOne({ id }, { projection: { _id: 0 } });
    return j({ item: next });
  }

  // ============================================================
  // TRADES
  // ============================================================
  if (subPath === 'trades' && method === 'GET') {
    const filter = {};
    if (url.searchParams.get('pair')) filter.pair = url.searchParams.get('pair');
    if (url.searchParams.get('tf')) filter.tf = url.searchParams.get('tf');
    if (url.searchParams.get('metode')) filter.metode = url.searchParams.get('metode');
    if (url.searchParams.get('hasil')) filter.hasil = url.searchParams.get('hasil');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from || to) {
      filter.tanggal = {};
      if (from) filter.tanggal.$gte = from;
      if (to) filter.tanggal.$lte = to;
    }
    const items = await db.collection('tj_trades')
      .find(filter).sort({ tanggal: -1, jam_entry: -1, createdAt: -1 }).project({ _id: 0 }).toArray();
    return j({ items: items.map(serializeTrade) });
  }
  if (subPath.startsWith('trades/') && !subPath.includes('/', 7) && method === 'GET') {
    const id = subPath.slice('trades/'.length);
    const cur = await db.collection('tj_trades').findOne({ id }, { projection: { _id: 0 } });
    if (!cur) return err('Trade tidak ditemukan', 404);
    return j({ item: serializeTrade(cur) });
  }
  if (subPath === 'trades' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    // Wajib: pair, tf, metode, position, entry_price, sl_price, tp_price.
    const pair = s(body.pair, 30);
    const tf = s(body.tf, 20);
    const metode = s(body.metode, 60);
    const position = String(body.position || '').toUpperCase();
    if (!pair || !tf || !metode) return err('Pair, Time Frame, Metode wajib');
    if (!['BUY', 'SELL'].includes(position)) return err('Posisi harus BUY / SELL');
    if (!(n(body.entry_price) > 0)) return err('Harga Entry wajib > 0');
    if (!(n(body.sl_price) > 0)) return err('Harga SL wajib > 0');
    if (!(n(body.tp_price) > 0)) return err('Harga TP wajib > 0');
    const tanggal = s(body.tanggal, 10) || new Date().toISOString().slice(0, 10);
    // Nama auto: [PAIR] [DD Month YYYY]
    const MO = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const [ty, tm, td] = tanggal.split('-').map(Number);
    const nama = `${pair} ${td} ${MO[tm - 1]} ${ty}`;
    const doc = {
      id: uuidv4(),
      nama, pair, tf, metode, position,
      tanggal,
      entry_price: n(body.entry_price),
      sl_price: n(body.sl_price),
      tp_price: n(body.tp_price),
      sl_money: n(body.sl_money),
      tp_money: n(body.tp_money),
      emosi: s(body.emosi, 60),
      jam_entry: s(body.jam_entry, 5),
      reason: s(body.reason, 2000),
      entry_screenshot: body.entry_screenshot || null,
      // Close (optional; bisa di-fill saat POST awal atau via PATCH).
      hasil: ['TP','SL'].includes(String(body.hasil || '').toUpperCase()) ? String(body.hasil).toUpperCase() : null,
      close_price: body.close_price != null ? n(body.close_price) : null,
      jam_close: s(body.jam_close, 5),
      hasil_trade: body.hasil_trade != null ? n(body.hasil_trade) : null,
      close_screenshot: body.close_screenshot || null,
      evaluasi: s(body.evaluasi, 2000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('tj_trades').insertOne(doc);
    const { _id, ...rest } = doc;
    return j({ item: serializeTrade(rest) });
  }
  if (subPath.startsWith('trades/') && method === 'PATCH') {
    const id = subPath.slice('trades/'.length);
    const cur = await db.collection('tj_trades').findOne({ id });
    if (!cur) return err('Trade tidak ditemukan', 404);
    const body = await req.json().catch(() => ({}));
    const upd = { updatedAt: new Date() };
    // Editable entry fields.
    const passthroughNums = ['entry_price', 'sl_price', 'tp_price', 'sl_money', 'tp_money', 'close_price', 'hasil_trade'];
    for (const k of passthroughNums) if (body[k] !== undefined) upd[k] = body[k] == null ? null : n(body[k]);
    const passthroughStrs = ['emosi', 'jam_entry', 'reason', 'jam_close', 'evaluasi', 'tanggal', 'pair', 'tf', 'metode'];
    for (const k of passthroughStrs) if (body[k] !== undefined) upd[k] = s(body[k], k === 'reason' || k === 'evaluasi' ? 2000 : 60);
    if (body.position !== undefined) {
      const p = String(body.position || '').toUpperCase();
      if (!['BUY', 'SELL'].includes(p)) return err('Posisi harus BUY / SELL');
      upd.position = p;
    }
    if (body.hasil !== undefined) {
      const h = body.hasil == null ? null : String(body.hasil).toUpperCase();
      if (h != null && !['TP', 'SL'].includes(h)) return err('hasil harus TP / SL');
      upd.hasil = h;
    }
    if (body.entry_screenshot !== undefined) upd.entry_screenshot = body.entry_screenshot || null;
    if (body.close_screenshot !== undefined) upd.close_screenshot = body.close_screenshot || null;
    // Re-derive nama bila pair/tanggal berubah.
    const nextPair = upd.pair ?? cur.pair;
    const nextTgl = upd.tanggal ?? cur.tanggal;
    if (nextPair && nextTgl) {
      const MO = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
      const [ty, tm, td] = nextTgl.split('-').map(Number);
      if (ty && tm && td) upd.nama = `${nextPair} ${td} ${MO[tm - 1]} ${ty}`;
    }
    await db.collection('tj_trades').updateOne({ id }, { $set: upd });
    const next = await db.collection('tj_trades').findOne({ id }, { projection: { _id: 0 } });
    return j({ item: serializeTrade(next) });
  }
  if (subPath.startsWith('trades/') && method === 'DELETE') {
    const id = subPath.slice('trades/'.length);
    await db.collection('tj_trades').deleteOne({ id });
    return j({ ok: true });
  }

  // ============================================================
  // UPLOAD screenshot → Telegram; return file_id metadata.
  // ============================================================
  if (subPath === 'upload' && method === 'POST') {
    // Body: multipart form (field "photo") atau JSON { data_url, filename }.
    let buffer, filename, mime;
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('photo');
      if (!file) return err('field photo wajib');
      buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name || 'screenshot.png';
      mime = file.type || 'image/png';
    } else {
      const body = await req.json().catch(() => ({}));
      const dataUrl = String(body.data_url || '');
      const m = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.*)$/);
      if (!m) return err('data_url tidak valid (harus data:image/..;base64,..)');
      buffer = Buffer.from(m[2], 'base64');
      mime = m[1];
      filename = String(body.filename || 'screenshot.png');
    }
    if (buffer.length > 12 * 1024 * 1024) return err('Ukuran gambar melebihi 12MB', 413);
    const caption = String((await Promise.resolve(''))); // no-op; can be filled by caller
    const tgCaption = 'TJ Screenshot';
    const tg = await sendPhotoToTelegram({ buffer, filename, caption: tgCaption, mime });
    if (!tg.ok) return err(`Upload Telegram gagal: ${tg.error}`, 502);
    return j({
      screenshot: {
        message_id: tg.message_id,
        file_id: tg.file_id,
        file_unique_id: tg.file_unique_id,
        width: tg.width, height: tg.height, file_size: tg.file_size,
        mime, filename,
        uploaded_at: new Date().toISOString(),
      },
    });
  }
  // Proxy fetch photo from Telegram (for display).
  if (subPath.startsWith('photo/') && method === 'GET') {
    const fileId = decodeURIComponent(subPath.slice('photo/'.length));
    const r = await fetchPhotoFromTelegram(fileId);
    if (!r.ok) return err(r.error, 502);
    return new Response(r.buffer, {
      headers: { 'Content-Type': r.mime, 'Cache-Control': 'private, max-age=3600' },
    });
  }

  // ============================================================
  // COMPOUNDING
  // ============================================================
  if (subPath === 'compounding' && method === 'GET') {
    const cfg = (await db.collection('tj_config').findOne({ id: 'default' })) || { modal_awal: 0 };
    const trades = await db.collection('tj_trades')
      .find({ hasil: { $in: ['TP', 'SL'] } })
      .sort({ tanggal: 1, jam_close: 1, createdAt: 1 })
      .project({ _id: 0 }).toArray();
    let modal = Number(cfg.modal_awal || 0);
    const rows = [];
    let wins = 0, losses = 0, totalPL = 0;
    for (const t of trades) {
      const hasil = Number(t.hasil_trade || 0);
      const before = modal;
      const pct = before !== 0 ? (hasil / before) * 100 : 0;
      const after = before + hasil;
      rows.push({
        no: rows.length + 1,
        trade_id: t.id,
        tanggal: t.tanggal,
        nama: t.nama,
        modal_sebelum: before,
        hasil_trade: hasil,
        pct,
        modal_setelah: after,
        result: t.hasil, // TP|SL
      });
      totalPL += hasil;
      if (t.hasil === 'TP') wins += 1; else if (t.hasil === 'SL') losses += 1;
      modal = after;
    }
    const totalPct = Number(cfg.modal_awal) > 0 ? (totalPL / Number(cfg.modal_awal)) * 100 : 0;
    return j({
      config: { modal_awal: Number(cfg.modal_awal || 0) },
      modal_saat_ini: modal,
      total_pl: totalPL,
      total_pct: totalPct,
      jumlah_trade: rows.length,
      wins, losses,
      rows,
    });
  }
  if (subPath === 'compounding' && method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    const modal_awal = Math.max(0, n(body.modal_awal));
    await db.collection('tj_config').updateOne(
      { id: 'default' },
      { $set: { id: 'default', modal_awal, updatedAt: new Date() } },
      { upsert: true },
    );
    return j({ ok: true, modal_awal });
  }

  // ============================================================
  // ANALYTICS
  // ============================================================
  if (subPath === 'analytics' && method === 'GET') {
    const trades = await db.collection('tj_trades')
      .find({ hasil: { $in: ['TP', 'SL'] } })
      .sort({ tanggal: 1, jam_close: 1, createdAt: 1 })
      .project({ _id: 0 }).toArray();
    const n0 = trades.length;
    let wins = 0, losses = 0, sumProfit = 0, sumLoss = 0, sumR = 0, sumDur = 0, nDur = 0;
    let curStreak = 0, streakSign = 0, maxWinStreak = 0, maxLossStreak = 0;
    // Drawdown by modal curve — reuse compounding.
    const cfg = (await db.collection('tj_config').findOne({ id: 'default' })) || { modal_awal: 0 };
    let modal = Number(cfg.modal_awal || 0);
    let peak = modal, maxDD = 0;
    // Group aggregates.
    const byPair = new Map(), byTf = new Map(), byMet = new Map();
    const bump = (map, key, hasil, val) => {
      const cur = map.get(key) || { key, n: 0, wins: 0, pl: 0 };
      cur.n += 1; cur.pl += val;
      if (hasil === 'TP') cur.wins += 1;
      map.set(key, cur);
    };
    for (const t of trades) {
      const m = computeTradeMetrics(t);
      const hasil = Number(t.hasil_trade || 0);
      sumR += Number(m.actual_r || 0);
      if (m.duration_minutes != null) { sumDur += m.duration_minutes; nDur += 1; }
      if (t.hasil === 'TP') { wins += 1; sumProfit += hasil; }
      else if (t.hasil === 'SL') { losses += 1; sumLoss += hasil; }
      // Streak (sign: +1 win, -1 loss).
      const cs = t.hasil === 'TP' ? 1 : t.hasil === 'SL' ? -1 : 0;
      if (cs !== 0) {
        if (cs === streakSign) curStreak += 1;
        else { streakSign = cs; curStreak = 1; }
        if (cs > 0) maxWinStreak = Math.max(maxWinStreak, curStreak);
        else maxLossStreak = Math.max(maxLossStreak, curStreak);
      }
      // DD.
      modal += hasil;
      peak = Math.max(peak, modal);
      const dd = peak > 0 ? (peak - modal) / peak * 100 : 0;
      if (dd > maxDD) maxDD = dd;
      bump(byPair, t.pair, t.hasil, hasil);
      bump(byTf, t.tf, t.hasil, hasil);
      bump(byMet, t.metode, t.hasil, hasil);
    }
    const winRate = n0 > 0 ? (wins / n0) * 100 : 0;
    const lossRate = n0 > 0 ? (losses / n0) * 100 : 0;
    const avgR = n0 > 0 ? sumR / n0 : 0;
    const avgProfit = wins > 0 ? sumProfit / wins : 0;
    const avgLoss = losses > 0 ? Math.abs(sumLoss) / losses : 0;
    const expectancy = n0 > 0
      ? ((wins / n0) * avgProfit) - ((losses / n0) * avgLoss)
      : 0;
    const profitFactor = sumLoss < 0 ? sumProfit / Math.abs(sumLoss) : (sumProfit > 0 ? Infinity : 0);
    const avgDur = nDur > 0 ? sumDur / nDur : 0;
    const grpToArr = (m) => Array.from(m.values()).map((g) => ({
      key: g.key, n: g.n, wins: g.wins, win_rate: g.n > 0 ? (g.wins / g.n) * 100 : 0, pl: g.pl,
    })).sort((a, b) => b.n - a.n);
    return j({
      total_trades: n0, wins, losses,
      win_rate: winRate, loss_rate: lossRate,
      profit: sumProfit, loss: sumLoss, net: sumProfit + sumLoss,
      avg_r: avgR, expectancy, profit_factor: Number.isFinite(profitFactor) ? profitFactor : null,
      max_consecutive_wins: maxWinStreak, max_consecutive_losses: maxLossStreak,
      max_drawdown_pct: maxDD,
      avg_duration_minutes: avgDur,
      by_pair: grpToArr(byPair),
      by_tf: grpToArr(byTf),
      by_metode: grpToArr(byMet),
    });
  }

  // ============================================================
  // EXPORT (AI-friendly JSON / CSV)
  // ============================================================
  if (subPath === 'export' && method === 'GET') {
    const format = String(url.searchParams.get('format') || 'json').toLowerCase();
    const filter = {};
    if (url.searchParams.get('pair')) filter.pair = url.searchParams.get('pair');
    if (url.searchParams.get('tf')) filter.tf = url.searchParams.get('tf');
    if (url.searchParams.get('metode')) filter.metode = url.searchParams.get('metode');
    if (url.searchParams.get('hasil')) filter.hasil = url.searchParams.get('hasil');
    if (url.searchParams.get('from')) filter.tanggal = { ...(filter.tanggal || {}), $gte: url.searchParams.get('from') };
    if (url.searchParams.get('to')) filter.tanggal = { ...(filter.tanggal || {}), $lte: url.searchParams.get('to') };
    const trades = await db.collection('tj_trades').find(filter)
      .sort({ tanggal: 1, jam_entry: 1, createdAt: 1 }).project({ _id: 0 }).toArray();
    const rows = trades.map((t) => {
      const m = computeTradeMetrics(t);
      return {
        nama: t.nama, tanggal: t.tanggal,
        pair: t.pair, time_frame: t.tf, metode: t.metode,
        position: t.position,
        entry_price: t.entry_price, sl_price: t.sl_price, tp_price: t.tp_price,
        sl_money: t.sl_money, tp_money: t.tp_money,
        rr: m.rr, actual_r: m.actual_r,
        jam_entry: t.jam_entry, jam_close: t.jam_close, duration_minutes: m.duration_minutes,
        hasil: t.hasil, close_price: t.close_price, hasil_trade: t.hasil_trade,
        emosi: t.emosi, reason: t.reason, evaluasi: t.evaluasi,
        entry_screenshot_file_id: t.entry_screenshot?.file_id || null,
        close_screenshot_file_id: t.close_screenshot?.file_id || null,
      };
    });
    if (format === 'csv') {
      const cols = Object.keys(rows[0] || {
        nama:'', tanggal:'', pair:'', time_frame:'', metode:'', position:'',
        entry_price:'', sl_price:'', tp_price:'', sl_money:'', tp_money:'',
        rr:'', actual_r:'', jam_entry:'', jam_close:'', duration_minutes:'',
        hasil:'', close_price:'', hasil_trade:'', emosi:'', reason:'', evaluasi:'',
        entry_screenshot_file_id:'', close_screenshot_file_id:'',
      });
      const escape = (v) => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ');
        return /[",]/.test(s) ? `"${s}"` : s;
      };
      const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => escape(r[c])).join(','))).join('\n');
      return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="trading_journal.csv"' } });
    }
    // JSON with compounding + analytics summary for AI analysis.
    const cfg = (await db.collection('tj_config').findOne({ id: 'default' })) || { modal_awal: 0 };
    return j({
      generated_at: new Date().toISOString(),
      config: { modal_awal: Number(cfg.modal_awal || 0) },
      trades: rows,
    });
  }

  return null;
}
