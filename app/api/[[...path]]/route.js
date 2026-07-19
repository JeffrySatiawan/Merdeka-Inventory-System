import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import * as XLSX from 'xlsx';

// ---------- Mongo ----------
let cachedClient = null;
async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGO_URL);
    await cachedClient.connect();
  }
  return cachedClient.db(process.env.DB_NAME || 'cycle_count');
}

// ---------- Helpers ----------
function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}
function json(data, status = 200) {
  return NextResponse.json(data, { status });
}
function err(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}
// Return YYYY-MM-DD in WITA (Asia/Makassar, UTC+8)
function getWitaDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar' }).format(d);
}
function getWitaTime() {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}
// Returns {hour, minute} in WITA
function getWitaHM() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Makassar',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hh = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  const mm = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  return { hour: hh, minute: mm };
}
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '22:00').split(':').map((v) => parseInt(v, 10) || 0);
  return h * 60 + m;
}
function isSessionClosed(settings) {
  const now = getWitaHM();
  const cur = now.hour * 60 + now.minute;
  const endM = toMinutes(settings?.working_end);
  const startM = toMinutes(settings?.working_start);
  // Closed if before opening OR after closing
  return cur < startM || cur >= endM;
}

async function getUserFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const db = await getDb();
  const session = await db.collection('sessions').findOne({ token });
  if (!session) return null;
  const user = await db.collection('employees').findOne({ id: session.employee_id });
  if (!user) return null;
  const { password, _id, ...safe } = user;
  return safe;
}

// ---------- Seed ----------
const SEED_EMPLOYEES = [
  { name: 'Owner', username: 'owner', password: 'owner123', weight: 0, status: 'active', role: 'owner' },
  { name: 'Cindy', username: 'cindy', password: 'cindy123', weight: 120, status: 'active', role: 'staff' },
  { name: 'Hayu', username: 'hayu', password: 'hayu123', weight: 100, status: 'active', role: 'staff' },
  { name: 'Desak', username: 'desak', password: 'desak123', weight: 80, status: 'active', role: 'staff' },
  { name: 'Naila', username: 'naila', password: 'naila123', weight: 90, status: 'active', role: 'staff' },
  { name: 'Dian', username: 'dian', password: 'dian123', weight: 60, status: 'active', role: 'staff' },
  { name: 'Shinta', username: 'shinta', password: 'shinta123', weight: 40, status: 'active', role: 'staff' },
];

const SEED_PRODUCTS = [
  // FAST (17)
  ['PRD00001', 'Paracetamol 500mg', 'FAST'],
  ['PRD00002', 'Vitamin C 500mg', 'FAST'],
  ['PRD00003', 'Panadol Extra', 'FAST'],
  ['PRD00004', 'Bodrex', 'FAST'],
  ['PRD00005', 'Promag Tablet', 'FAST'],
  ['PRD00006', 'Antasida Doen', 'FAST'],
  ['PRD00007', 'Betadine 15ml', 'FAST'],
  ['PRD00008', 'Oralit Sachet', 'FAST'],
  ['PRD00009', 'Tolak Angin Cair', 'FAST'],
  ['PRD00010', 'Antangin JRG', 'FAST'],
  ['PRD00011', 'OBH Combi', 'FAST'],
  ['PRD00012', 'Actifed Syrup', 'FAST'],
  ['PRD00013', 'Neozep Forte', 'FAST'],
  ['PRD00014', 'Sanmol Tablet', 'FAST'],
  ['PRD00015', 'Decolgen', 'FAST'],
  ['PRD00016', 'Woods Peppermint', 'FAST'],
  ['PRD00017', 'Vicks Vaporub', 'FAST'],
  // MEDIUM (17)
  ['PRD00018', 'Amoxicillin 500mg', 'MEDIUM'],
  ['PRD00019', 'Ciprofloxacin 500mg', 'MEDIUM'],
  ['PRD00020', 'Loratadine 10mg', 'MEDIUM'],
  ['PRD00021', 'Cetirizine 10mg', 'MEDIUM'],
  ['PRD00022', 'Ranitidine 150mg', 'MEDIUM'],
  ['PRD00023', 'Omeprazole 20mg', 'MEDIUM'],
  ['PRD00024', 'Diclofenac 50mg', 'MEDIUM'],
  ['PRD00025', 'Ibuprofen 400mg', 'MEDIUM'],
  ['PRD00026', 'Metformin 500mg', 'MEDIUM'],
  ['PRD00027', 'Amlodipine 5mg', 'MEDIUM'],
  ['PRD00028', 'Simvastatin 20mg', 'MEDIUM'],
  ['PRD00029', 'Captopril 25mg', 'MEDIUM'],
  ['PRD00030', 'Vitamin B Complex', 'MEDIUM'],
  ['PRD00031', 'Vitamin E 400 IU', 'MEDIUM'],
  ['PRD00032', 'Zinc 20mg', 'MEDIUM'],
  ['PRD00033', 'Iron Tablet 60mg', 'MEDIUM'],
  ['PRD00034', 'Kalsium Laktat', 'MEDIUM'],
  // SLOW (16)
  ['PRD00035', 'Salbutamol Inhaler', 'SLOW'],
  ['PRD00036', 'Insulin Novorapid', 'SLOW'],
  ['PRD00037', 'Warfarin 2mg', 'SLOW'],
  ['PRD00038', 'Diazepam 5mg', 'SLOW'],
  ['PRD00039', 'Codeine 10mg', 'SLOW'],
  ['PRD00040', 'Morphine 10mg', 'SLOW'],
  ['PRD00041', 'Ergotamin Tablet', 'SLOW'],
  ['PRD00042', 'Levothyroxine 50mcg', 'SLOW'],
  ['PRD00043', 'Prednisone 5mg', 'SLOW'],
  ['PRD00044', 'Digoxin 0.25mg', 'SLOW'],
  ['PRD00045', 'Furosemide 40mg', 'SLOW'],
  ['PRD00046', 'Bisoprolol 5mg', 'SLOW'],
  ['PRD00047', 'Alprazolam 0.5mg', 'SLOW'],
  ['PRD00048', 'Fluoxetine 20mg', 'SLOW'],
  ['PRD00049', 'Sertraline 50mg', 'SLOW'],
  ['PRD00050', 'Risperidone 2mg', 'SLOW'],
];

async function ensureSeeded(db) {
  // Migration: convert old per_month fields to interval_days if needed
  const existing = await db.collection('cycle_settings').findOne({ id: 'default' });
  if (existing && existing.fast_per_month !== undefined && existing.fast_interval_days === undefined) {
    const conv = (perMonth) => (perMonth > 0 ? Math.round(30 / perMonth) : 30);
    await db.collection('cycle_settings').updateOne(
      { id: 'default' },
      {
        $set: {
          fast_interval_days: conv(existing.fast_per_month),
          medium_interval_days: conv(existing.medium_per_month),
          slow_interval_days: conv(existing.slow_per_month),
        },
        $unset: { fast_per_month: '', medium_per_month: '', slow_per_month: '' },
      }
    );
  }

  const meta = await db.collection('_meta').findOne({ id: 'seed' });
  if (meta?.done) return;

  // Employees
  const empDocs = SEED_EMPLOYEES.map((e) => ({
    id: uuidv4(),
    ...e,
    password: hashPassword(e.password),
    createdAt: new Date(),
  }));
  await db.collection('employees').insertMany(empDocs);

  // Products
  const prodDocs = SEED_PRODUCTS.map(([sku, name, cat]) => ({
    id: uuidv4(),
    sku_code: sku,
    product_name: name,
    category: cat,
    last_counted_at: null,
    count_total: 0,
    createdAt: new Date(),
  }));
  await db.collection('products').insertMany(prodDocs);

  // Settings
  await db.collection('cycle_settings').insertOne({
    id: 'default',
    fast_interval_days: 7,
    medium_interval_days: 15,
    slow_interval_days: 30,
    working_start: '07:00',
    working_end: '22:00',
    timezone: 'WITA',
    updatedAt: new Date(),
  });

  await db.collection('products').createIndex({ sku_code: 1 }, { unique: true });
  await db.collection('products').createIndex({ category: 1, last_counted_at: 1 });
  await db.collection('employees').createIndex({ username: 1 }, { unique: true });
  await db.collection('daily_tasks').createIndex({ date: 1, employee_id: 1 });
  await db.collection('daily_tasks').createIndex({ date: 1, product_id: 1 });
  await db.collection('sku_history').createIndex({ sku_code: 1, counted_at: -1 });
  await db.collection('sessions').createIndex({ token: 1 }, { unique: true });

  await db.collection('_meta').insertOne({ id: 'seed', done: true, at: new Date() });
}

// ---------- Task Generation ----------
async function generateDailyTasks(db, dateStr) {
  // If tasks already exist for date, skip.
  const existing = await db.collection('daily_tasks').countDocuments({ date: dateStr });
  if (existing > 0) return { skipped: true, count: existing };

  const settings = await db.collection('cycle_settings').findOne({ id: 'default' });
  const employees = await db
    .collection('employees')
    .find({ role: 'staff', status: 'active' })
    .toArray();
  if (employees.length === 0) return { skipped: true, reason: 'no active employees' };

  // Compute daily targets per category (interval in DAYS)
  const categories = [
    { key: 'FAST', days: settings.fast_interval_days || 7 },
    { key: 'MEDIUM', days: settings.medium_interval_days || 15 },
    { key: 'SLOW', days: settings.slow_interval_days || 30 },
  ];

  const pickedProducts = [];
  for (const c of categories) {
    const total = await db.collection('products').countDocuments({ category: c.key });
    if (total === 0) continue;
    const target = Math.max(1, Math.round(total / c.days));
    // Order by last_counted_at asc (nulls first), then sku_code
    const list = await db
      .collection('products')
      .find({ category: c.key })
      .sort({ last_counted_at: 1, sku_code: 1 })
      .limit(target)
      .toArray();
    pickedProducts.push(...list);
  }

  // Add backlog: any daily_task from previous days not completed
  // Only include if the underlying product isn't already in pickedProducts (avoid dup)
  const pickedIds = new Set(pickedProducts.map((p) => p.id));
  const backlogTasks = await db
    .collection('daily_tasks')
    .find({ date: { $lt: dateStr }, completed: false })
    .toArray();
  const backlogProdIds = [...new Set(backlogTasks.map((t) => t.product_id).filter((id) => !pickedIds.has(id)))];
  if (backlogProdIds.length > 0) {
    const backlogProds = await db
      .collection('products')
      .find({ id: { $in: backlogProdIds } })
      .toArray();
    for (const p of backlogProds) {
      pickedProducts.push({ ...p, __backlog: true });
    }
  }

  // Mark old backlog tasks as consumed (delete them to avoid double count)
  if (backlogTasks.length > 0) {
    await db.collection('daily_tasks').deleteMany({
      _id: { $in: backlogTasks.map((t) => t._id) },
    });
  }

  // Distribute by weight
  const totalWeight = employees.reduce((s, e) => s + (e.weight || 0), 0) || 1;
  const N = pickedProducts.length;
  let shares = employees.map((e) => ({
    emp: e,
    share: Math.floor((N * (e.weight || 0)) / totalWeight),
  }));
  let assigned = shares.reduce((s, x) => s + x.share, 0);
  let remainder = N - assigned;
  // Distribute remainder to highest weights first
  const order = [...shares].sort((a, b) => b.emp.weight - a.emp.weight);
  let i = 0;
  while (remainder > 0) {
    order[i % order.length].share += 1;
    remainder--;
    i++;
  }

  // Shuffle products deterministically? Just take in current order (backlog first for priority).
  // Move backlog to front
  pickedProducts.sort((a, b) => (b.__backlog ? 1 : 0) - (a.__backlog ? 1 : 0));

  const tasks = [];
  let cursor = 0;
  for (const s of shares) {
    const slice = pickedProducts.slice(cursor, cursor + s.share);
    cursor += s.share;
    for (const p of slice) {
      tasks.push({
        id: uuidv4(),
        date: dateStr,
        employee_id: s.emp.id,
        employee_name: s.emp.name,
        product_id: p.id,
        sku_code: p.sku_code,
        product_name: p.product_name,
        category: p.category,
        completed: false,
        completed_at: null,
        is_backlog: !!p.__backlog,
        createdAt: new Date(),
      });
    }
  }

  if (tasks.length > 0) {
    await db.collection('daily_tasks').insertMany(tasks);
  }
  return { created: tasks.length, employees: employees.length };
}

// ---------- Route Handler ----------
async function handleRequest(req, path, method) {
  const db = await getDb();
  await ensureSeeded(db);
  const url = new URL(req.url);
  const q = url.searchParams;

  // ---------- AUTH ----------
  if (path === 'auth/login' && method === 'POST') {
    const body = await req.json();
    const { username, password } = body || {};
    if (!username || !password) return err('username & password required');
    const user = await db.collection('employees').findOne({ username: String(username).toLowerCase().trim() });
    if (!user) return err('User tidak ditemukan', 401);
    if (user.status !== 'active') return err('Akun tidak aktif', 401);
    if (user.password !== hashPassword(password)) return err('Password salah', 401);
    const token = uuidv4();
    await db.collection('sessions').insertOne({
      token,
      employee_id: user.id,
      createdAt: new Date(),
    });
    const { password: _pw, _id, ...safe } = user;
    return json({ token, user: safe });
  }

  if (path === 'auth/logout' && method === 'POST') {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) await db.collection('sessions').deleteOne({ token });
    return json({ ok: true });
  }

  if (path === 'auth/me' && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    return json({ user });
  }

  // ---------- PUBLIC / DASHBOARD ----------
  if (path === 'time' && method === 'GET') {
    return json({ date: getWitaDate(), time: getWitaTime(), tz: 'WITA' });
  }

  if (path === 'dashboard' && method === 'GET') {
    const today = getWitaDate();
    // Auto-generate today's tasks if not exist
    await generateDailyTasks(db, today);

    const [totalSku, fastSku, mediumSku, slowSku] = await Promise.all([
      db.collection('products').countDocuments({}),
      db.collection('products').countDocuments({ category: 'FAST' }),
      db.collection('products').countDocuments({ category: 'MEDIUM' }),
      db.collection('products').countDocuments({ category: 'SLOW' }),
    ]);

    const todaysTasks = await db.collection('daily_tasks').find({ date: today }).toArray();
    const target = todaysTasks.length;
    const completed = todaysTasks.filter((t) => t.completed).length;
    const remaining = target - completed;
    const progressPct = target > 0 ? Math.round((completed / target) * 100) : 0;

    const employees = await db
      .collection('employees')
      .find({ role: 'staff' })
      .toArray();
    const activeSessions = await db.collection('sessions').find({}).toArray();
    const loggedInIds = new Set(activeSessions.map((s) => s.employee_id));

    const empProgress = employees.map((e) => {
      const own = todaysTasks.filter((t) => t.employee_id === e.id);
      const done = own.filter((t) => t.completed).length;
      return {
        id: e.id,
        name: e.name,
        weight: e.weight,
        status: e.status,
        assigned: own.length,
        completed: done,
        pct: own.length > 0 ? Math.round((done / own.length) * 100) : 0,
        logged_in: loggedInIds.has(e.id),
        never_logged_in_today: !loggedInIds.has(e.id) && done === 0,
      };
    });

    const backlog = await db
      .collection('daily_tasks')
      .countDocuments({ date: { $lt: today }, completed: false });

    const settings = await db.collection('cycle_settings').findOne({ id: 'default' });
    const closed = isSessionClosed(settings);

    return json({
      totals: { totalSku, fastSku, mediumSku, slowSku },
      today: { target, completed, remaining, progressPct, date: today, time: getWitaTime() },
      employees: empProgress,
      backlog,
      working: { start: settings.working_start, end: settings.working_end, tz: 'WITA' },
      is_closed: closed,
    });
  }

  // ---------- PUBLIC MONITOR (no auth) ----------
  if (path === 'monitor' && method === 'GET') {
    const today = getWitaDate();
    await generateDailyTasks(db, today);
    const todaysTasks = await db.collection('daily_tasks').find({ date: today }).toArray();
    const target = todaysTasks.length;
    const completed = todaysTasks.filter((t) => t.completed).length;
    const remaining = target - completed;
    const progressPct = target > 0 ? Math.round((completed / target) * 100) : 0;
    const employees = await db.collection('employees').find({ role: 'staff', status: 'active' }).toArray();
    const activeSessions = await db.collection('sessions').find({}).toArray();
    const loggedInIds = new Set(activeSessions.map((s) => s.employee_id));
    const empProgress = employees
      .map((e) => {
        const own = todaysTasks.filter((t) => t.employee_id === e.id);
        const done = own.filter((t) => t.completed).length;
        return {
          name: e.name,
          assigned: own.length,
          completed: done,
          pct: own.length > 0 ? Math.round((done / own.length) * 100) : 0,
          logged_in: loggedInIds.has(e.id),
        };
      })
      .sort((a, b) => b.pct - a.pct);
    const backlog = await db.collection('daily_tasks').countDocuments({ date: { $lt: today }, completed: false });
    const settings = await db.collection('cycle_settings').findOne({ id: 'default' });
    return json({
      today: { target, completed, remaining, progressPct, date: today, time: getWitaTime() },
      employees: empProgress,
      backlog,
      working: { start: settings.working_start, end: settings.working_end, tz: 'WITA' },
      is_closed: isSessionClosed(settings),
    });
  }

  // ---------- OWNER: PRODUCTS ----------
  if (path === 'products' && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const search = q.get('search') || '';
    const limit = Math.min(parseInt(q.get('limit') || '50'), 500);
    const skip = parseInt(q.get('skip') || '0');
    const filter = search
      ? {
          $or: [
            { sku_code: { $regex: search, $options: 'i' } },
            { product_name: { $regex: search, $options: 'i' } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      db.collection('products').find(filter).sort({ sku_code: 1 }).skip(skip).limit(limit).toArray(),
      db.collection('products').countDocuments(filter),
    ]);
    return json({
      items: items.map(({ _id, ...r }) => r),
      total,
    });
  }

  if (path === 'products/import' && method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    // Accept either JSON array or file upload
    const contentType = req.headers.get('content-type') || '';
    let rows = [];
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file) return err('file required');
      const buf = Buffer.from(await file.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      const body = await req.json();
      rows = Array.isArray(body?.items) ? body.items : [];
    }

    // Normalize keys
    const normalized = rows
      .map((r) => {
        const keys = Object.keys(r);
        const findKey = (target) =>
          keys.find((k) => k.toLowerCase().replace(/[_\s-]/g, '').includes(target.replace(/[_\s-]/g, '')));
        const skuKey = findKey('sku') || findKey('code');
        const nameKey = findKey('name') || findKey('product');
        const catKey = findKey('category') || findKey('kategori');
        return {
          sku_code: String(r[skuKey] || '').trim(),
          product_name: String(r[nameKey] || '').trim(),
          category: String(r[catKey] || '').trim().toUpperCase(),
        };
      })
      .filter((r) => r.sku_code && r.product_name && ['FAST', 'MEDIUM', 'SLOW'].includes(r.category));

    // De-dupe by sku in input
    const seen = new Set();
    const cleaned = [];
    const dups = [];
    for (const r of normalized) {
      if (seen.has(r.sku_code)) {
        dups.push(r.sku_code);
        continue;
      }
      seen.add(r.sku_code);
      cleaned.push(r);
    }

    let inserted = 0;
    let updated = 0;
    for (const r of cleaned) {
      const existing = await db.collection('products').findOne({ sku_code: r.sku_code });
      if (existing) {
        await db.collection('products').updateOne(
          { sku_code: r.sku_code },
          {
            $set: {
              product_name: r.product_name,
              category: r.category,
              updatedAt: new Date(),
            },
          }
        );
        updated++;
      } else {
        await db.collection('products').insertOne({
          id: uuidv4(),
          sku_code: r.sku_code,
          product_name: r.product_name,
          category: r.category,
          last_counted_at: null,
          count_total: 0,
          createdAt: new Date(),
        });
        inserted++;
      }
    }

    return json({
      inserted,
      updated,
      total_rows: rows.length,
      valid_rows: cleaned.length,
      duplicates_in_file: dups,
    });
  }

  // Reset products (danger)
  if (path === 'products/reset' && method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const [pRes, tRes, hRes] = await Promise.all([
      db.collection('products').deleteMany({}),
      db.collection('daily_tasks').deleteMany({}),
      db.collection('sku_history').deleteMany({}),
    ]);
    return json({
      deleted: {
        products: pRes.deletedCount,
        daily_tasks: tRes.deletedCount,
        sku_history: hRes.deletedCount,
      },
    });
  }

  // Lookup for staff/owner - search products by SKU or name (any authenticated user)
  if (path === 'lookup' && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    const qs = (q.get('q') || '').trim();
    if (!qs) return json({ items: [] });
    const filter = {
      $or: [
        { sku_code: { $regex: qs, $options: 'i' } },
        { product_name: { $regex: qs, $options: 'i' } },
      ],
    };
    const items = await db.collection('products').find(filter).sort({ sku_code: 1 }).limit(20).toArray();
    return json({ items: items.map(({ _id, ...r }) => r) });
  }

  // SKU History
  const skuHistoryMatch = path.match(/^products\/([^/]+)\/history$/);
  if (skuHistoryMatch && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    const sku = skuHistoryMatch[1];
    const product = await db.collection('products').findOne({ sku_code: sku });
    if (!product) return err('product not found', 404);
    const history = await db
      .collection('sku_history')
      .find({ sku_code: sku })
      .sort({ counted_at: -1 })
      .limit(200)
      .toArray();
    const { _id, ...safeProd } = product;
    return json({
      product: safeProd,
      history: history.map(({ _id, ...r }) => r),
    });
  }

  // ---------- OWNER: EMPLOYEES ----------
  if (path === 'employees' && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const list = await db.collection('employees').find({}).sort({ role: -1, name: 1 }).toArray();
    return json({
      items: list.map(({ password, _id, ...r }) => r),
    });
  }

  if (path === 'employees' && method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const body = await req.json();
    const { name, username, password, weight, status } = body || {};
    if (!name || !username || !password) return err('name, username, password required');
    const exists = await db.collection('employees').findOne({ username: String(username).toLowerCase() });
    if (exists) return err('username already exists');
    const doc = {
      id: uuidv4(),
      name: String(name).trim(),
      username: String(username).toLowerCase().trim(),
      password: hashPassword(password),
      weight: Number(weight) || 100,
      status: status || 'active',
      role: 'staff',
      createdAt: new Date(),
    };
    await db.collection('employees').insertOne(doc);
    const { password: _p, _id, ...safe } = doc;
    return json({ employee: safe });
  }

  const empIdMatch = path.match(/^employees\/([^/]+)$/);
  if (empIdMatch && (method === 'PUT' || method === 'DELETE')) {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const id = empIdMatch[1];
    const target = await db.collection('employees').findOne({ id });
    if (!target) return err('employee not found', 404);
    if (target.role === 'owner') return err('cannot modify owner', 403);

    if (method === 'DELETE') {
      await db.collection('employees').deleteOne({ id });
      return json({ ok: true });
    }

    const body = await req.json();
    const update = {};
    if (body.name) update.name = String(body.name).trim();
    if (body.username) update.username = String(body.username).toLowerCase().trim();
    if (body.password) update.password = hashPassword(body.password);
    if (body.weight !== undefined) update.weight = Number(body.weight) || 0;
    if (body.status) update.status = body.status;
    update.updatedAt = new Date();
    await db.collection('employees').updateOne({ id }, { $set: update });
    const updated = await db.collection('employees').findOne({ id });
    const { password: _p, _id, ...safe } = updated;
    return json({ employee: safe });
  }

  // ---------- OWNER: SETTINGS ----------
  if (path === 'settings' && method === 'GET') {
    const settings = await db.collection('cycle_settings').findOne({ id: 'default' });
    const [fast, medium, slow] = await Promise.all([
      db.collection('products').countDocuments({ category: 'FAST' }),
      db.collection('products').countDocuments({ category: 'MEDIUM' }),
      db.collection('products').countDocuments({ category: 'SLOW' }),
    ]);
    const fDays = settings.fast_interval_days || 7;
    const mDays = settings.medium_interval_days || 15;
    const sDays = settings.slow_interval_days || 30;
    const dailyFast = Math.round(fast / fDays);
    const dailyMedium = Math.round(medium / mDays);
    const dailySlow = Math.round(slow / sDays);
    const { _id, ...safe } = settings;
    return json({
      settings: safe,
      breakdown: {
        fast: { total: fast, daily: dailyFast, interval_days: fDays },
        medium: { total: medium, daily: dailyMedium, interval_days: mDays },
        slow: { total: slow, daily: dailySlow, interval_days: sDays },
        daily_total: dailyFast + dailyMedium + dailySlow,
      },
    });
  }

  if (path === 'settings' && method === 'PUT') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const body = await req.json();
    const upd = {};
    if (body.fast_interval_days !== undefined) upd.fast_interval_days = Math.max(1, Number(body.fast_interval_days));
    if (body.medium_interval_days !== undefined) upd.medium_interval_days = Math.max(1, Number(body.medium_interval_days));
    if (body.slow_interval_days !== undefined) upd.slow_interval_days = Math.max(1, Number(body.slow_interval_days));
    if (body.working_start) upd.working_start = body.working_start;
    if (body.working_end) upd.working_end = body.working_end;
    upd.updatedAt = new Date();
    await db.collection('cycle_settings').updateOne({ id: 'default' }, { $set: upd }, { upsert: true });
    return json({ ok: true });
  }

  // ---------- TASKS ----------
  if (path === 'tasks/generate' && method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const body = await req.json().catch(() => ({}));
    const today = getWitaDate();
    if (body?.force) {
      // Reset today's un-completed tasks and re-generate
      await db.collection('daily_tasks').deleteMany({ date: today, completed: false });
    }
    const result = await generateDailyTasks(db, today);
    return json(result);
  }

  if (path === 'tasks/mine' && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    const today = getWitaDate();
    // Ensure today's tasks exist
    await generateDailyTasks(db, today);
    const tasks = await db
      .collection('daily_tasks')
      .find({ date: today, employee_id: user.id })
      .sort({ is_backlog: -1, category: 1, sku_code: 1 })
      .toArray();
    const settings = await db.collection('cycle_settings').findOne({ id: 'default' });
    return json({
      tasks: tasks.map(({ _id, ...t }) => t),
      date: today,
      time: getWitaTime(),
      is_closed: isSessionClosed(settings),
      working: { start: settings.working_start, end: settings.working_end },
    });
  }

  const taskActionMatch = path.match(/^tasks\/([^/]+)\/(complete|uncomplete)$/);
  if (taskActionMatch && method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    const [, taskId, action] = taskActionMatch;
    const task = await db.collection('daily_tasks').findOne({ id: taskId });
    if (!task) return err('task not found', 404);
    if (task.employee_id !== user.id && user.role !== 'owner') return err('forbidden', 403);

    if (action === 'complete') {
      // Auto-close guard: reject if outside working hours
      const settings = await db.collection('cycle_settings').findOne({ id: 'default' });
      if (isSessionClosed(settings)) {
        return err(`Session ditutup. Jam kerja ${settings.working_start} - ${settings.working_end} WITA`, 423);
      }
      const now = new Date();
      await db.collection('daily_tasks').updateOne(
        { id: taskId },
        { $set: { completed: true, completed_at: now } }
      );
      // Update product
      await db.collection('products').updateOne(
        { id: task.product_id },
        { $set: { last_counted_at: now }, $inc: { count_total: 1 } }
      );
      // Add history
      await db.collection('sku_history').insertOne({
        id: uuidv4(),
        sku_code: task.sku_code,
        product_id: task.product_id,
        product_name: task.product_name,
        employee_id: user.id,
        employee_name: user.name,
        counted_at: now,
        date: task.date,
      });
    } else {
      await db.collection('daily_tasks').updateOne(
        { id: taskId },
        { $set: { completed: false, completed_at: null } }
      );
      // Remove last history record for this task
      await db.collection('sku_history').deleteOne({
        sku_code: task.sku_code,
        employee_id: user.id,
        date: task.date,
      });
    }

    return json({ ok: true });
  }

  return err('not found', 404);
}

async function router(req, ctx) {
  try {
    const params = await ctx.params;
    const path = (params.path || []).join('/');
    return await handleRequest(req, path, req.method);
  } catch (e) {
    console.error('API error', e);
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}

export const GET = router;
export const POST = router;
export const PUT = router;
export const DELETE = router;
export const PATCH = router;
