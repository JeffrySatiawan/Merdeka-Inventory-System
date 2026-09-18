import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { handleOMRequest } from '@/lib/modules/order-management/service';
import { handleFakturRequest } from '@/lib/modules/faktur/service';
import { handleAbsensiRequest } from '@/lib/modules/absensi/service';
import { handlePayrollRequest } from '@/lib/modules/payroll/service';

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

// ---------- Owner Recovery: in-memory rate limiter (per-process) ----------
// Best-effort: reset on server restart. Scope terbatas pada endpoint recovery
// Owner sehingga tidak menyentuh login staff / auth-existing.
const _ownerRecoveryAttempts = new Map(); // username -> { count, first_ms }
const _ownerRecoveryTokens = new Map();   // recovery_token -> { owner_id, expires_ms }
const RECOVERY_MAX_ATTEMPTS = 5;
const RECOVERY_WINDOW_MS = 15 * 60 * 1000;
const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000;
function _recoveryRateCheck(uname) {
  const now = Date.now();
  const s = _ownerRecoveryAttempts.get(uname);
  if (s && (now - s.first_ms) > RECOVERY_WINDOW_MS) {
    _ownerRecoveryAttempts.delete(uname);
  }
  const cur = _ownerRecoveryAttempts.get(uname);
  if (cur && cur.count >= RECOVERY_MAX_ATTEMPTS) {
    return { locked: true, waitMs: Math.max(0, RECOVERY_WINDOW_MS - (now - cur.first_ms)) };
  }
  return { locked: false };
}
function _recoveryRateFail(uname) {
  const now = Date.now();
  const cur = _ownerRecoveryAttempts.get(uname) || { count: 0, first_ms: now };
  cur.count += 1;
  if (!cur.first_ms) cur.first_ms = now;
  _ownerRecoveryAttempts.set(uname, cur);
}
function _recoveryRateReset(uname) {
  _ownerRecoveryAttempts.delete(uname);
}

async function getUserFromRequest(req) {
  // Primary: Authorization: Bearer <token> header (fetch/XHR calls).
  const auth = req.headers.get('authorization') || '';
  let token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  // Fallback: `?token=<...>` URL query param. Required for browser navigation
  // to authenticated resources like `/api/om/pdfs/{id}/file` where the browser
  // (new-tab / window.open / <a target=_blank>) cannot attach a request header.
  // Tokens are opaque server-issued session UUIDs (revocable via logout /
  // employee delete), and only ever unlock the same permissions the header
  // would — no elevation, no bypass of role/module checks downstream.
  if (!token) {
    try {
      const u = new URL(req.url);
      const q = u.searchParams.get('token');
      if (q) token = q;
    } catch { /* ignore invalid url */ }
  }
  if (!token) return null;
  const db = await getDb();
  const session = await db.collection('sessions').findOne({ token });
  if (!session) return null;
  const user = await db.collection('employees').findOne({ id: session.employee_id });
  if (!user) return null;
  const { password, _id, ...safe } = user;
  return safe;
}

// ---------- Module Registry ----------
// Central place to register modules. To add Module 2, 3, ..., just add here.
const AVAILABLE_MODULES = [
  {
    key: 'cycle_count',
    name: 'Cycle Count',
    description: 'Manajemen cycle count SKU harian, import produk, distribusi tugas per bobot karyawan, riwayat perhitungan.',
    icon: 'Package',
    status: 'active',
  },
  {
    key: 'order_management',
    name: 'Order Management',
    description: 'Manajemen pesanan pembelian & penjualan. (Belum aktif — coming soon)',
    icon: 'ShoppingCart',
    status: 'coming_soon',
  },
  {
    key: 'absensi',
    name: 'Absensi',
    description: 'Absensi masuk & keluar dengan selfie, QR statis, dan validasi GPS radius.',
    icon: 'Clock',
    status: 'active',
  },
  {
    key: 'faktur',
    name: 'MIS Faktur',
    description: 'Arsip faktur pelanggan (PDF) tersimpan otomatis di Telegram Channel.',
    icon: 'Receipt',
    status: 'active',
  },
  {
    // OWNER-ONLY. Tidak boleh muncul di module list staff. `normalizeModules`
    // sengaja men-drop 'payroll' dari input staff (defense-in-depth).
    key: 'payroll',
    name: 'Payroll',
    description: 'Penggajian karyawan (private Owner).',
    icon: 'Wallet',
    status: 'active',
    owner_only: true,
  },
];
const VALID_MODULE_KEYS = AVAILABLE_MODULES.map((m) => m.key);
const OWNER_ONLY_MODULES = new Set(AVAILABLE_MODULES.filter((m) => m.owner_only).map((m) => m.key));
const VALID_ROLES = ['owner', 'supervisor', 'staff'];

function normalizeModules(input) {
  if (!Array.isArray(input)) return null;
  // Drop owner-only modules dari input staff (defense-in-depth: mustahil
  // muncul di user.modules staff via seed/CRUD user, bahkan bila owner iseng
  // menekan check di UI).
  const set = new Set(
    input.filter((m) => VALID_MODULE_KEYS.includes(m) && !OWNER_ONLY_MODULES.has(m))
  );
  return Array.from(set);
}

function hasModule(user, moduleKey) {
  if (!user) return false;
  if (user.role === 'owner') return true; // Owner selalu punya akses semua module
  return Array.isArray(user.modules) && user.modules.includes(moduleKey);
}

// Merge module keys that are open to every authenticated user regardless of
// per-employee `modules` array. Currently only MIS Faktur qualifies.
// Merge module keys that are open to every authenticated user regardless of
// per-employee `modules` array. Currently only MIS Faktur qualifies (per product
// spec: "semua staff yang login" can upload invoices). Absensi is NOT in this
// list because access to Absensi must be controlled via User Management on a
// per-employee basis (owner enables the module in the employee edit dialog).
function withGlobalModules(user, mods) {
  const set = new Set(Array.isArray(mods) ? mods : []);
  set.add('faktur'); // available to all authenticated staff
  return Array.from(set);
}

// ---------- Seed ----------
const SEED_EMPLOYEES = [
  { name: 'Owner', username: 'owner', password: 'owner123', weight: 0, status: 'active', role: 'owner', modules: ['cycle_count', 'order_management'] },
  { name: 'Cindy', username: 'cindy', password: 'cindy123', weight: 120, status: 'active', role: 'staff', modules: ['cycle_count'] },
  { name: 'Hayu', username: 'hayu', password: 'hayu123', weight: 100, status: 'active', role: 'staff', modules: ['cycle_count'] },
  { name: 'Desak', username: 'desak', password: 'desak123', weight: 80, status: 'active', role: 'staff', modules: ['cycle_count'] },
  { name: 'Naila', username: 'naila', password: 'naila123', weight: 90, status: 'active', role: 'staff', modules: ['cycle_count'] },
  { name: 'Dian', username: 'dian', password: 'dian123', weight: 60, status: 'active', role: 'staff', modules: ['cycle_count'] },
  { name: 'Shinta', username: 'shinta', password: 'shinta123', weight: 40, status: 'active', role: 'staff', modules: ['cycle_count'] },
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

  // Migration: ensure every employee has `modules` array (backfill for existing installs)
  const empsNeedingMigration = await db
    .collection('employees')
    .find({ modules: { $exists: false } })
    .toArray();
  for (const e of empsNeedingMigration) {
    const defaults = e.role === 'owner' ? ['cycle_count', 'order_management'] : ['cycle_count'];
    await db.collection('employees').updateOne({ id: e.id }, { $set: { modules: defaults } });
  }

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
  // Only active staff who actually have the cycle_count module get tasks.
  // Previously the filter was just {role:'staff', status:'active'} which meant
  // an employee with ONLY the order_management module (or any other) was still
  // pulled into the Cycle Count task distribution — visible as a phantom row
  // in Employee Task with a chunk of SKUs they were never supposed to receive.
  const employees = await db
    .collection('employees')
    .find({
      role: 'staff',
      status: 'active',
      deleted: { $ne: true },
      modules: 'cycle_count',
    })
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

  // ============================================================
  // MODULE 2 — Order Management (delegated to its own service)
  // ============================================================
  if (path.startsWith('om/')) {
    const user = await getUserFromRequest(req);
    const omResp = await handleOMRequest(req, path.slice(3), method, { db, user });
    if (omResp) return omResp;
    return err('not found', 404);
  }

  // ============================================================
  // MODULE — MIS Faktur (isolated). All authenticated users allowed.
  // ============================================================
  if (path === 'faktur' || path.startsWith('faktur/')) {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    const sub = path === 'faktur' ? '' : path.slice('faktur/'.length);
    const resp = await handleFakturRequest(req, sub, method, { db, user });
    if (resp) return resp;
    return err('not found', 404);
  }

  // ============================================================
  // MODULE — Absensi (isolated). Access controlled via User Management
  // (owner assigns `absensi` in the employee.modules array). Owner has all
  // modules by default. Any other authenticated user without permission → 403.
  // ============================================================
  if (path === 'absensi' || path.startsWith('absensi/')) {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    if (!hasModule(user, 'absensi')) {
      return err('forbidden — module Absensi belum diaktifkan untuk akun Anda', 403);
    }
    const sub = path === 'absensi' ? '' : path.slice('absensi/'.length);
    const resp = await handleAbsensiRequest(req, sub, method, { db, user });
    if (resp) return resp;
    return err('not found', 404);
  }

  // ============================================================
  // Payroll — OWNER ONLY. Defense-in-depth: check role LANGSUNG di router,
  // bukan hanya hasModule (yang mengembalikan true untuk owner). Setiap
  // request payroll wajib role === 'owner'; staff dijamin 403 walau
  // seandainya modules array mereka manipulated.
  // ============================================================
  if (path === 'payroll' || path.startsWith('payroll/')) {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    if (user.role !== 'owner') {
      return err('forbidden — Payroll hanya untuk Owner', 403);
    }
    const sub = path === 'payroll' ? '' : path.slice('payroll/'.length);
    const resp = await handlePayrollRequest(req, sub, method, { db, user });
    if (resp) return resp;
    return err('not found', 404);
  }

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
    // Enrich returned user with globally-available modules (e.g. Faktur)
    const effective = safe.role === 'owner'
      ? VALID_MODULE_KEYS.slice()
      : withGlobalModules(safe, safe.modules);
    return json({ token, user: { ...safe, modules: effective } });
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
    // Owner always has all modules effectively
    const effectiveModules =
      user.role === 'owner'
        ? VALID_MODULE_KEYS.slice()
        : withGlobalModules(user, user.modules);
    return json({ user: { ...user, modules: effectiveModules } });
  }

  // ============================================================
  // Owner Self-Service (profile edit + password recovery) — APPEND-ONLY.
  // Staff auth / permissions / login-existing tidak disentuh.
  // In-memory rate limiter & recovery-token store (per-process, reset saat
  // supervisor restart — cukup untuk MVP owner-only recovery).
  // ============================================================

  // PUT /api/auth/owner/profile — Owner ubah username/password (self only).
  if (path === 'auth/owner/profile' && method === 'PUT') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const body = await req.json().catch(() => ({}));
    const { current_password, new_username, new_password } = body || {};
    if (!current_password) return err('Password saat ini wajib diisi');
    const fresh = await db.collection('employees').findOne({ id: user.id });
    if (!fresh) return err('User tidak ditemukan', 404);
    if (fresh.password !== hashPassword(current_password)) return err('Password saat ini salah', 401);
    const upd = { updatedAt: new Date() };
    if (new_username && String(new_username).trim()) {
      const uNew = String(new_username).toLowerCase().trim();
      if (!/^[a-z0-9_]{3,32}$/.test(uNew)) return err('Username tidak valid (3-32 karakter: a-z, 0-9, _)');
      if (uNew !== fresh.username) {
        const clash = await db.collection('employees').findOne({ username: uNew });
        if (clash) return err('Username sudah dipakai');
        upd.username = uNew;
      }
    }
    if (new_password && String(new_password).length > 0) {
      if (String(new_password).length < 6) return err('Password baru minimal 6 karakter');
      upd.password = hashPassword(String(new_password));
    }
    if (Object.keys(upd).length === 1) return err('Tidak ada perubahan');
    await db.collection('employees').updateOne({ id: user.id }, { $set: upd });
    return json({ ok: true, message: 'Kredensial Owner diperbarui' });
  }

  // GET /api/auth/owner/recovery — Owner lihat status setup recovery-nya.
  if (path === 'auth/owner/recovery' && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const fresh = await db.collection('employees').findOne({ id: user.id });
    const qs = Array.isArray(fresh?.recovery_questions) ? fresh.recovery_questions : [];
    return json({
      configured: qs.length === 3 && !!fresh?.recovery_pin_hash,
      questions: qs.map((r) => ({ q: r.q })),
      updated_at: fresh?.recovery_updated_at || null,
    });
  }

  // PUT /api/auth/owner/recovery — Owner set 3 pertanyaan + PIN 6 digit.
  // Jawaban & PIN disimpan hashed (SHA256, sama seperti password existing).
  if (path === 'auth/owner/recovery' && method === 'PUT') {
    const user = await getUserFromRequest(req);
    if (!user || user.role !== 'owner') return err('unauthorized', 401);
    const body = await req.json().catch(() => ({}));
    const { current_password, questions, pin } = body || {};
    if (!current_password) return err('Password saat ini wajib diisi');
    const fresh = await db.collection('employees').findOne({ id: user.id });
    if (!fresh) return err('User tidak ditemukan', 404);
    if (fresh.password !== hashPassword(current_password)) return err('Password saat ini salah', 401);
    if (!Array.isArray(questions) || questions.length !== 3) return err('Wajib 3 pertanyaan keamanan');
    const cleaned = questions.map((it) => ({
      q: String(it?.q || '').trim().slice(0, 200),
      a: String(it?.a || '').trim().toLowerCase(),
    }));
    if (cleaned.some((x) => !x.q || !x.a)) return err('Setiap pertanyaan wajib punya jawaban');
    if (!/^\d{6}$/.test(String(pin || ''))) return err('PIN harus 6 digit angka');
    await db.collection('employees').updateOne(
      { id: user.id },
      {
        $set: {
          recovery_questions: cleaned.map((x) => ({ q: x.q, a_hash: hashPassword(x.a) })),
          recovery_pin_hash: hashPassword(String(pin)),
          recovery_updated_at: new Date(),
        },
      }
    );
    return json({ ok: true, message: 'Recovery Owner tersimpan' });
  }

  // GET /api/auth/owner/recovery-status?username=... — PUBLIC (unauth).
  // Hanya mengungkap pertanyaan (tanpa jawaban/hash). Staff username selalu
  // mengembalikan exists:false supaya tidak bocor daftar user.
  if (path === 'auth/owner/recovery-status' && method === 'GET') {
    const url = new URL(req.url);
    const uname = String(url.searchParams.get('username') || '').toLowerCase().trim();
    if (!uname) return json({ exists: false, has_recovery: false });
    const owner = await db.collection('employees').findOne({ username: uname, role: 'owner' });
    if (!owner) return json({ exists: false, has_recovery: false });
    const qs = Array.isArray(owner.recovery_questions) ? owner.recovery_questions : [];
    return json({
      exists: true,
      has_recovery: qs.length === 3 && !!owner.recovery_pin_hash,
      questions: qs.map((r) => ({ q: r.q })),
    });
  }

  // POST /api/auth/owner/recovery/verify — PUBLIC.
  // Body: { username, answers:[a1,a2,a3], pin }. Rate-limited per-username.
  if (path === 'auth/owner/recovery/verify' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const uname = String(body?.username || '').toLowerCase().trim();
    const answers = Array.isArray(body?.answers) ? body.answers : [];
    const pin = String(body?.pin || '');
    if (!uname) return err('Username wajib');
    const rl = _recoveryRateCheck(uname);
    if (rl.locked) return err(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(rl.waitMs / 60000)} menit.`, 429);
    const owner = await db.collection('employees').findOne({ username: uname, role: 'owner' });
    if (!owner) {
      _recoveryRateFail(uname);
      return err('Data recovery tidak cocok', 401);
    }
    const qs = Array.isArray(owner.recovery_questions) ? owner.recovery_questions : [];
    if (qs.length !== 3 || !owner.recovery_pin_hash) {
      return err('Recovery Owner belum di-setup. Login manual lalu setup dari User Management.', 400);
    }
    if (answers.length !== 3) {
      _recoveryRateFail(uname);
      return err('Data recovery tidak cocok', 401);
    }
    const ansOk = qs.every(
      (row, i) => hashPassword(String(answers[i] || '').trim().toLowerCase()) === row.a_hash
    );
    const pinOk = hashPassword(pin) === owner.recovery_pin_hash;
    if (!ansOk || !pinOk) {
      _recoveryRateFail(uname);
      const remaining = Math.max(0, RECOVERY_MAX_ATTEMPTS - (_ownerRecoveryAttempts.get(uname)?.count || 0));
      return err(`Data recovery tidak cocok. Sisa percobaan: ${remaining}`, 401);
    }
    _recoveryRateReset(uname);
    const rtoken = uuidv4();
    _ownerRecoveryTokens.set(rtoken, {
      owner_id: owner.id,
      expires_ms: Date.now() + RECOVERY_TOKEN_TTL_MS,
    });
    return json({ ok: true, recovery_token: rtoken, expires_in_min: 15 });
  }

  // POST /api/auth/owner/recovery/reset — PUBLIC. Pakai recovery_token → set
  // password baru → invalidate semua sesi Owner lama → issue token sesi baru
  // (auto login). Tidak ada master password / backdoor.
  if (path === 'auth/owner/recovery/reset' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const { recovery_token, new_password } = body || {};
    if (!recovery_token || !new_password) return err('recovery_token & new_password wajib');
    const rec = _ownerRecoveryTokens.get(recovery_token);
    if (!rec || rec.expires_ms < Date.now()) {
      _ownerRecoveryTokens.delete(recovery_token);
      return err('Token recovery kedaluwarsa, ulangi verifikasi', 401);
    }
    if (String(new_password).length < 6) return err('Password baru minimal 6 karakter');
    const owner = await db.collection('employees').findOne({ id: rec.owner_id, role: 'owner' });
    if (!owner) {
      _ownerRecoveryTokens.delete(recovery_token);
      return err('Owner tidak ditemukan', 404);
    }
    await db.collection('employees').updateOne(
      { id: rec.owner_id, role: 'owner' },
      { $set: { password: hashPassword(String(new_password)), updatedAt: new Date() } }
    );
    _ownerRecoveryTokens.delete(recovery_token);
    // Invalidate semua sesi Owner lama, lalu issue token baru (auto login).
    await db.collection('sessions').deleteMany({ employee_id: rec.owner_id });
    const token = uuidv4();
    await db.collection('sessions').insertOne({ token, employee_id: rec.owner_id, createdAt: new Date() });
    const owner2 = await db.collection('employees').findOne({ id: rec.owner_id });
    const { password: _pw, _id, ...safe } = owner2;
    return json({ ok: true, token, user: { ...safe, modules: VALID_MODULE_KEYS.slice() } });
  }

  // ---------- MODULES REGISTRY ----------
  if (path === 'modules' && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    return json({ modules: AVAILABLE_MODULES });
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
    // role: owner cannot be created via this endpoint (only seeded owner)
    const roleReq = body.role && VALID_ROLES.includes(body.role) && body.role !== 'owner' ? body.role : 'staff';
    const modulesReq = normalizeModules(body.modules) ?? ['cycle_count'];
    const doc = {
      id: uuidv4(),
      name: String(name).trim(),
      username: String(username).toLowerCase().trim(),
      password: hashPassword(password),
      weight: Number(weight) || 100,
      status: status || 'active',
      role: roleReq,
      modules: modulesReq,
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
      // Cascade cleanup so the deleted employee doesn't leave phantom rows
      // in Employee Task or a still-valid session token behind.
      await db.collection('employees').deleteOne({ id });
      // Delete their UNCOMPLETED daily_tasks (completed tasks kept for audit).
      // Employee Task view auto-reassigns any leftover on next fetch.
      await db.collection('daily_tasks').deleteMany({ employee_id: id, completed: false });
      // Invalidate their sessions so a token they still hold can't be used.
      await db.collection('sessions').deleteMany({ employee_id: id });
      return json({ ok: true });
    }

    const body = await req.json();
    const update = {};
    if (body.name) update.name = String(body.name).trim();
    if (body.username) update.username = String(body.username).toLowerCase().trim();
    if (body.password) update.password = hashPassword(body.password);
    if (body.weight !== undefined) update.weight = Number(body.weight) || 0;
    if (body.status) update.status = body.status;
    if (body.role && VALID_ROLES.includes(body.role) && body.role !== 'owner') {
      update.role = body.role;
    }
    const mods = normalizeModules(body.modules);
    if (mods !== null) update.modules = mods;
    update.updatedAt = new Date();
    await db.collection('employees').updateOne({ id }, { $set: update });
    // If the employee just lost the cycle_count module (or was deactivated),
    // release their uncompleted tasks so they don't stay stuck in Employee
    // Task view. The next GET /api/tasks/employees will redistribute them.
    const nowLostCC =
      (mods !== null && !mods.includes('cycle_count') && (target.modules || []).includes('cycle_count')) ||
      (update.status && update.status !== 'active' && target.status === 'active');
    if (nowLostCC) {
      await db.collection('daily_tasks').deleteMany({ employee_id: id, completed: false });
    }
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
    if (!hasModule(user, 'cycle_count')) return err('Anda tidak memiliki akses ke module Cycle Count', 403);
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

  // GET /api/tasks/employees — OWNER ONLY.
  // Returns ALL daily_tasks for today, grouped by employee.
  // Used by the "Employee Task" view in the Cycle Count module — lets the
  // owner see every SKU that is currently being checked by every staff.
  if (path === 'tasks/employees' && method === 'GET') {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    if (user.role !== 'owner') return err('Hanya owner yang dapat mengakses Employee Task', 403);
    const today = getWitaDate();
    await generateDailyTasks(db, today);

    // Purge orphan tasks: any daily_task whose employee_id no longer maps to
    // an active, non-deleted staff with the cycle_count module. This ensures
    // employees removed from User Management (or whose module was revoked)
    // do NOT keep appearing in Employee Task with a stack of "yatim" SKUs.
    const validStaff = await db
      .collection('employees')
      .find({
        role: 'staff',
        status: 'active',
        deleted: { $ne: true },
        modules: 'cycle_count',
      })
      .toArray();
    const validIds = new Set(validStaff.map((e) => e.id));
    const orphanTasks = await db
      .collection('daily_tasks')
      .find({ date: today, employee_id: { $nin: [...validIds] } })
      .toArray();
    if (orphanTasks.length > 0) {
      // Only auto-cleanup UNCOMPLETED orphan tasks — completed ones stay for
      // audit history. Redistribute the uncompleted ones to remaining valid
      // staff proportional to their weight so total work coverage is preserved.
      const uncompletedOrphans = orphanTasks.filter((t) => !t.completed);
      const uncompletedOrphanIds = uncompletedOrphans.map((t) => t._id);
      if (uncompletedOrphanIds.length > 0 && validStaff.length > 0) {
        // Reassign: distribute by weight (fallback to equal if all weights=0)
        const totalW = validStaff.reduce((s, e) => s + (e.weight || 0), 0);
        const useEqual = totalW === 0;
        const perEmp = validStaff.map((e) => ({ emp: e, count: 0 }));
        uncompletedOrphans.forEach((_t, idx) => {
          if (useEqual) {
            perEmp[idx % perEmp.length].count += 1;
          } else {
            // Weighted round-robin using a running quota
            let best = perEmp[0];
            let bestDeficit = -Infinity;
            for (const row of perEmp) {
              const expected = ((idx + 1) * (row.emp.weight || 0)) / totalW;
              const deficit = expected - row.count;
              if (deficit > bestDeficit) {
                bestDeficit = deficit;
                best = row;
              }
            }
            best.count += 1;
          }
        });
        // Apply: bulk update each orphan task's employee_id
        const bulk = db.collection('daily_tasks').initializeUnorderedBulkOp();
        let cursor = 0;
        for (const row of perEmp) {
          for (let j = 0; j < row.count; j++) {
            const orphan = uncompletedOrphans[cursor++];
            if (!orphan) break;
            bulk.find({ _id: orphan._id }).updateOne({
              $set: {
                employee_id: row.emp.id,
                employee_name: row.emp.name,
                reassigned_at: new Date(),
                reassigned_from: orphan.employee_name || orphan.employee_id,
              },
            });
          }
        }
        if (bulk.length > 0) await bulk.execute();
      } else if (uncompletedOrphanIds.length > 0 && validStaff.length === 0) {
        // No valid staff left at all — just delete the orphaned uncompleted tasks.
        await db.collection('daily_tasks').deleteMany({ _id: { $in: uncompletedOrphanIds } });
      }
    }

    const tasks = await db
      .collection('daily_tasks')
      .find({ date: today })
      .sort({ is_backlog: -1, category: 1, sku_code: 1 })
      .toArray();
    const employees = await db
      .collection('employees')
      .find({ deleted: { $ne: true } })
      .toArray();
    const empMap = {};
    employees.forEach((e) => {
      empMap[e.id] = {
        id: e.id,
        name: e.name,
        username: e.username,
        role: e.role,
        weight: e.weight || 0,
        modules: e.modules || [],
        status: e.status || 'active',
      };
    });
    const settings = await db.collection('cycle_settings').findOne({ id: 'default' });

    // Group by employee — SKIP any task whose employee_id no longer resolves
    // to a valid, non-deleted staff. After the orphan-cleanup above these
    // should already be reassigned, but the guard here protects against edge
    // races (e.g. tasks completed by a now-deleted employee earlier today).
    const grouped = {};
    tasks.forEach((t) => {
      const eid = t.employee_id;
      const emp = empMap[eid];
      if (!emp) return; // deleted employee — skip
      if (emp.role !== 'staff') return; // owner never gets task rows
      if (!Array.isArray(emp.modules) || !emp.modules.includes('cycle_count')) return;
      if (!grouped[eid]) {
        grouped[eid] = { employee: emp, tasks: [], total: 0, completed: 0, backlog: 0 };
      }
      const { _id: _mid, ...safeTask } = t;
      grouped[eid].tasks.push(safeTask);
      grouped[eid].total += 1;
      if (t.completed) grouped[eid].completed += 1;
      if (t.is_backlog) grouped[eid].backlog += 1;
    });

    // Also include ACTIVE cycle_count staff who have no tasks assigned today
    // (empty list) so owner can see idle staff too.
    Object.values(empMap).forEach((emp) => {
      if (emp.role !== 'staff') return;
      if (emp.status !== 'active') return;
      if (!Array.isArray(emp.modules) || !emp.modules.includes('cycle_count')) return;
      if (!grouped[emp.id]) {
        grouped[emp.id] = { employee: emp, tasks: [], total: 0, completed: 0, backlog: 0 };
      }
    });

    const list = Object.values(grouped).sort((a, b) =>
      (a.employee.name || '').localeCompare(b.employee.name || '')
    );

    return json({
      date: today,
      time: getWitaTime(),
      is_closed: isSessionClosed(settings),
      working: { start: settings.working_start, end: settings.working_end },
      employees: list,
      total_tasks: tasks.length,
      total_completed: tasks.filter((t) => t.completed).length,
      total_backlog: tasks.filter((t) => t.is_backlog).length,
    });
  }

  const taskActionMatch = path.match(/^tasks\/([^/]+)\/(complete|uncomplete)$/);
  if (taskActionMatch && method === 'POST') {
    const user = await getUserFromRequest(req);
    if (!user) return err('unauthorized', 401);
    if (!hasModule(user, 'cycle_count')) return err('Anda tidak memiliki akses ke module Cycle Count', 403);
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
