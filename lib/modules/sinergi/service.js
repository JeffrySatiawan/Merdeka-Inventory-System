// =============================================================================
// MODULE: Pencatatan Operasional Sinergi (key: 'sinergi')
// Submodules (independent, not auto-synced):
//   - Pengiriman Barang (shipments): records packages carried by a staff
//     member to a customer, status trackable (Masih Dibawa / Sudah Kembali).
//   - Pencatatan Uang Tunai (cash): manual in/out cash ledger with running
//     balance; opening balance set by Owner. IMMUTABLE — only reversal
//     (koreksi) allowed, which inserts an equal opposite-sign transaction.
// Access: controlled via employees.modules array; owner = full.
// Database collections:
//   sinergi_shipments, sinergi_shipments_audit,
//   sinergi_cash, sinergi_cash_audit, sinergi_settings
// =============================================================================
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const json = (body, status = 200) => NextResponse.json(body, { status });
const err = (msg, status = 400) => json({ error: msg }, status);

const stripId = ({ _id, ...rest }) => rest;
const toIsoDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
};

async function ensureIndexes(db) {
  if (globalThis.__mis_sinergi_indexes) return;
  try {
    await Promise.all([
      db.collection('sinergi_shipments').createIndex({ date: -1 }),
      db.collection('sinergi_shipments').createIndex({ status: 1, date: -1 }),
      db.collection('sinergi_shipments').createIndex({ carrier_user_id: 1, date: -1 }),
      db.collection('sinergi_shipments').createIndex({ id: 1 }, { unique: true }),
      db.collection('sinergi_shipments_audit').createIndex({ shipment_id: 1, at: -1 }),
      db.collection('sinergi_cash').createIndex({ date: -1, created_at: -1 }),
      db.collection('sinergi_cash').createIndex({ jenis: 1, date: -1 }),
      db.collection('sinergi_cash').createIndex({ carrier_user_id: 1, date: -1 }),
      db.collection('sinergi_cash').createIndex({ id: 1 }, { unique: true }),
      db.collection('sinergi_cash_audit').createIndex({ cash_id: 1, at: -1 }),
    ]);
    globalThis.__mis_sinergi_indexes = true;
  } catch { /* ignore - idempotent */ }
}

async function getSettings(db) {
  const doc = await db.collection('sinergi_settings').findOne({ id: 'default' });
  if (doc) return stripId(doc);
  const def = { id: 'default', opening_balance: 0, updated_at: new Date(), updated_by: null };
  await db.collection('sinergi_settings').insertOne({ ...def });
  return def;
}

async function listActiveStaff(db) {
  const rows = await db
    .collection('employees')
    .find({ status: 'active', deleted: { $ne: true } }, { projection: { id: 1, name: 1, role: 1 } })
    .sort({ name: 1 })
    .toArray();
  return rows.map(stripId);
}

// ------------------------ SHIPMENTS ------------------------
async function handleShipments(req, sub, method, { db, user }) {
  // GET /api/sinergi/shipments
  if (sub === '' && method === 'GET') {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const status = url.searchParams.get('status'); // 'bawa' | 'kembali' | ''
    const carrier = url.searchParams.get('carrier'); // user_id
    const q = (url.searchParams.get('q') || '').trim();
    const query = {};
    if (from && to) query.date = { $gte: from, $lte: to };
    else if (from) query.date = { $gte: from };
    else if (to) query.date = { $lte: to };
    if (status === 'bawa' || status === 'kembali') query.status = status;
    if (carrier) query.carrier_user_id = carrier;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ trx_no: rx }, { customer: rx }, { carrier_name: rx }];
    }
    const rows = await db.collection('sinergi_shipments')
      .find(query).sort({ date: -1, created_at: -1 }).limit(500).toArray();
    return json({ items: rows.map(stripId) });
  }

  // POST /api/sinergi/shipments
  if (sub === '' && method === 'POST') {
    const body = await req.json();
    const date = toIsoDate(body.date) || toIsoDate(new Date());
    const trx_no = String(body.trx_no || '').trim();
    const customer = String(body.customer || '').trim();
    const carrier_user_id = String(body.carrier_user_id || '').trim();
    const carrier_name = String(body.carrier_name || '').trim();
    const notes = String(body.notes || '').trim();
    if (!trx_no) return err('No. Transaksi wajib diisi', 422);
    if (!customer) return err('Nama Pelanggan wajib diisi', 422);
    if (!carrier_user_id || !carrier_name) return err('Pengirim wajib dipilih', 422);
    const now = new Date();
    const doc = {
      id: uuidv4(),
      date, trx_no, customer,
      carrier_user_id, carrier_name,
      status: 'bawa',
      status_at: now,
      notes,
      created_at: now,
      created_by: user.id,
      created_by_name: user.name,
      updated_at: now,
    };
    await db.collection('sinergi_shipments').insertOne({ ...doc });
    await db.collection('sinergi_shipments_audit').insertOne({
      id: uuidv4(), shipment_id: doc.id, action: 'create',
      before: null, after: doc, by_user_id: user.id, by_user_name: user.name, at: now,
    });
    return json({ ok: true, item: doc });
  }

  // PUT /api/sinergi/shipments/:id
  const idMatch = sub.match(/^([^/]+)$/);
  if (idMatch && method === 'PUT') {
    const id = idMatch[1];
    const before = await db.collection('sinergi_shipments').findOne({ id });
    if (!before) return err('Shipment tidak ditemukan', 404);
    const body = await req.json();
    const upd = {};
    if (body.date !== undefined) upd.date = toIsoDate(body.date);
    if (body.trx_no !== undefined) upd.trx_no = String(body.trx_no).trim();
    if (body.customer !== undefined) upd.customer = String(body.customer).trim();
    if (body.carrier_user_id !== undefined) upd.carrier_user_id = String(body.carrier_user_id).trim();
    if (body.carrier_name !== undefined) upd.carrier_name = String(body.carrier_name).trim();
    if (body.notes !== undefined) upd.notes = String(body.notes).trim();
    upd.updated_at = new Date();
    await db.collection('sinergi_shipments').updateOne({ id }, { $set: upd });
    const after = await db.collection('sinergi_shipments').findOne({ id });
    await db.collection('sinergi_shipments_audit').insertOne({
      id: uuidv4(), shipment_id: id, action: 'update',
      before: stripId(before), after: stripId(after),
      by_user_id: user.id, by_user_name: user.name, at: new Date(),
    });
    return json({ ok: true, item: stripId(after) });
  }

  // POST /api/sinergi/shipments/:id/return
  const returnMatch = sub.match(/^([^/]+)\/return$/);
  if (returnMatch && method === 'POST') {
    const id = returnMatch[1];
    const before = await db.collection('sinergi_shipments').findOne({ id });
    if (!before) return err('Shipment tidak ditemukan', 404);
    if (before.status === 'kembali') return err('Status sudah Kembali', 409);
    const now = new Date();
    await db.collection('sinergi_shipments').updateOne(
      { id }, { $set: { status: 'kembali', status_at: now, updated_at: now } },
    );
    const after = await db.collection('sinergi_shipments').findOne({ id });
    await db.collection('sinergi_shipments_audit').insertOne({
      id: uuidv4(), shipment_id: id, action: 'return',
      before: stripId(before), after: stripId(after),
      by_user_id: user.id, by_user_name: user.name, at: now,
    });
    return json({ ok: true, item: stripId(after) });
  }

  // GET /api/sinergi/shipments/:id/audit
  const auditMatch = sub.match(/^([^/]+)\/audit$/);
  if (auditMatch && method === 'GET') {
    const id = auditMatch[1];
    const rows = await db.collection('sinergi_shipments_audit')
      .find({ shipment_id: id }).sort({ at: -1 }).limit(100).toArray();
    return json({ items: rows.map(stripId) });
  }

  return null;
}

// ------------------------ CASH ------------------------
function computeRunning(rows, openingBalance) {
  // rows: sorted ASC by date then created_at. Returns list with running_balance.
  // Reversal rows already have jenis flipped vs. original; compute like normal.
  let bal = Number(openingBalance || 0);
  const out = [];
  for (const r of rows) {
    const amt = Number(r.amount || 0);
    if (r.jenis === 'in') bal += amt;
    else if (r.jenis === 'out') bal -= amt;
    out.push({ ...r, running_balance: bal });
  }
  return out;
}

async function handleCash(req, sub, method, { db, user }) {
  // GET /api/sinergi/cash/settings
  if (sub === 'settings' && method === 'GET') {
    const s = await getSettings(db);
    return json({ settings: s });
  }
  // PUT /api/sinergi/cash/settings (owner only)
  if (sub === 'settings' && method === 'PUT') {
    if (user.role !== 'owner') return err('forbidden — hanya Owner', 403);
    const body = await req.json();
    const ob = Math.round(Number(body.opening_balance ?? 0));
    await db.collection('sinergi_settings').updateOne(
      { id: 'default' },
      { $set: { opening_balance: ob, updated_at: new Date(), updated_by: user.id } },
      { upsert: true },
    );
    return json({ ok: true, opening_balance: ob });
  }

  // GET /api/sinergi/cash — list + running balance for filtered subset
  if (sub === '' && method === 'GET') {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const jenis = url.searchParams.get('jenis'); // 'in' | 'out' | ''
    const carrier = url.searchParams.get('carrier');
    const q = (url.searchParams.get('q') || '').trim();

    // 1) Compute running balance for ALL transactions up to end of filter
    //    so paginated views still show correct running balance. Then filter
    //    for display. This keeps saldo konsisten walau ada filter.
    const settings = await getSettings(db);
    const allQuery = {};
    if (to) allQuery.date = { $lte: to };
    const allSorted = await db.collection('sinergi_cash')
      .find(allQuery).sort({ date: 1, created_at: 1 }).toArray();
    const allWithBal = computeRunning(allSorted.map(stripId), settings.opening_balance || 0);

    // Final balance = last row's running_balance or opening_balance if empty
    const finalBalance = allWithBal.length ? allWithBal[allWithBal.length - 1].running_balance : Number(settings.opening_balance || 0);

    // Filter for display
    let display = allWithBal;
    if (from) display = display.filter((r) => String(r.date) >= from);
    if (jenis === 'in' || jenis === 'out') display = display.filter((r) => r.jenis === jenis);
    if (carrier) display = display.filter((r) => r.carrier_user_id === carrier);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      display = display.filter((r) =>
        rx.test(r.trx_no || '') || rx.test(r.purpose || '') || rx.test(r.carrier_name || ''),
      );
    }
    // Return in display order DESC by date/created_at
    display = display.slice().sort((a, b) => {
      if (a.date === b.date) return new Date(b.created_at) - new Date(a.created_at);
      return a.date < b.date ? 1 : -1;
    }).slice(0, 500);

    return json({
      items: display,
      opening_balance: Number(settings.opening_balance || 0),
      final_balance: finalBalance,
    });
  }

  // POST /api/sinergi/cash
  if (sub === '' && method === 'POST') {
    const body = await req.json();
    const date = toIsoDate(body.date) || toIsoDate(new Date());
    const trx_no = String(body.trx_no || '').trim();
    const purpose = String(body.purpose || '').trim();
    const carrier_user_id = String(body.carrier_user_id || '').trim();
    const carrier_name = String(body.carrier_name || '').trim();
    const jenis = body.jenis === 'out' ? 'out' : (body.jenis === 'in' ? 'in' : null);
    const amount = Math.round(Number(body.amount || 0));
    const notes = String(body.notes || '').trim();
    if (!purpose) return err('Keperluan / Nama Pelanggan wajib diisi', 422);
    if (!carrier_user_id || !carrier_name) return err('Dibawa Oleh wajib dipilih', 422);
    if (!jenis) return err('Jenis Transaksi wajib dipilih', 422);
    if (!(amount > 0)) return err('Jumlah uang harus lebih dari 0', 422);
    const now = new Date();
    const doc = {
      id: uuidv4(),
      date, trx_no, purpose,
      carrier_user_id, carrier_name,
      jenis, amount, notes,
      is_reversal: false, reverses_id: null,
      created_at: now, created_by: user.id, created_by_name: user.name,
    };
    await db.collection('sinergi_cash').insertOne({ ...doc });
    await db.collection('sinergi_cash_audit').insertOne({
      id: uuidv4(), cash_id: doc.id, action: 'create',
      by_user_id: user.id, by_user_name: user.name, at: now, snapshot: doc,
    });
    return json({ ok: true, item: doc });
  }

  // POST /api/sinergi/cash/:id/reverse — immutable koreksi (reversing trx)
  const reverseMatch = sub.match(/^([^/]+)\/reverse$/);
  if (reverseMatch && method === 'POST') {
    const id = reverseMatch[1];
    const orig = await db.collection('sinergi_cash').findOne({ id });
    if (!orig) return err('Transaksi tidak ditemukan', 404);
    if (orig.is_reversal) return err('Transaksi koreksi tidak dapat dikoreksi lagi', 409);
    // Check if already reversed (to prevent double-reversal)
    const already = await db.collection('sinergi_cash').findOne({ reverses_id: id });
    if (already) return err('Transaksi ini sudah dikoreksi sebelumnya', 409);
    const body = await req.json().catch(() => ({}));
    const notes = String(body.notes || '').trim();
    const now = new Date();
    const reversal = {
      id: uuidv4(),
      date: toIsoDate(body.date) || toIsoDate(now),
      trx_no: orig.trx_no ? `KOREKSI/${orig.trx_no}` : 'KOREKSI',
      purpose: `[KOREKSI] ${orig.purpose}`,
      carrier_user_id: orig.carrier_user_id,
      carrier_name: orig.carrier_name,
      jenis: orig.jenis === 'in' ? 'out' : 'in',
      amount: orig.amount,
      notes,
      is_reversal: true,
      reverses_id: id,
      created_at: now,
      created_by: user.id,
      created_by_name: user.name,
    };
    await db.collection('sinergi_cash').insertOne({ ...reversal });
    await db.collection('sinergi_cash_audit').insertOne({
      id: uuidv4(), cash_id: id, action: 'reverse',
      by_user_id: user.id, by_user_name: user.name, at: now, reversal_id: reversal.id, notes,
    });
    return json({ ok: true, item: reversal });
  }

  // GET /api/sinergi/cash/:id/audit
  const auditMatch = sub.match(/^([^/]+)\/audit$/);
  if (auditMatch && method === 'GET') {
    const id = auditMatch[1];
    const rows = await db.collection('sinergi_cash_audit')
      .find({ cash_id: id }).sort({ at: -1 }).limit(100).toArray();
    return json({ items: rows.map(stripId) });
  }

  return null;
}

// ------------------------ ROUTER ------------------------
export async function handleSinergiRequest(req, sub, method, { db, user }) {
  await ensureIndexes(db);

  // /api/sinergi/staff — list active staff (untuk dropdown pengirim)
  if (sub === 'staff' && method === 'GET') {
    const rows = await listActiveStaff(db);
    return json({ items: rows });
  }

  if (sub === 'shipments' || sub.startsWith('shipments/')) {
    const s = sub === 'shipments' ? '' : sub.slice('shipments/'.length);
    const r = await handleShipments(req, s, method, { db, user });
    if (r) return r;
  }
  if (sub === 'cash' || sub.startsWith('cash/')) {
    const s = sub === 'cash' ? '' : sub.slice('cash/'.length);
    const r = await handleCash(req, s, method, { db, user });
    if (r) return r;
  }

  return null;
}

export default handleSinergiRequest;
