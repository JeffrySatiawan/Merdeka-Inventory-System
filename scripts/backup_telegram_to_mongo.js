/**
 * Backup Telegram-hosted files → MongoDB BSON Binary (MIS server storage).
 *
 * SAFE / ADDITIVE ONLY. Script:
 *   - Enumerate `mis_faktur` + `tj_screenshots` records yg menyimpan file di
 *     Telegram (`telegram_status === 'sent'` AND `file_data` missing).
 *   - Download tiap file lewat Telegram Bot API (`getFile` → `/file/bot…`).
 *   - Simpan bytes ke MongoDB di field `file_data` (BSON Binary) — field
 *     EXISTING yang kedua service pakai sebagai fallback. Tambah metadata
 *     `backup_at`, `backup_source: 'telegram'`, `backup_size`.
 *   - PERTAHANKAN seluruh metadata Telegram (file_id, message_id, status).
 *   - TIDAK menghapus / memindahkan apapun di Telegram.
 *   - TIDAK mengubah UI / API / workflow / config / schema.
 *   - Idempotent: skip record yg sudah di-backup (`file_data` ada).
 *
 * Usage:
 *   node /app/scripts/backup_telegram_to_mongo.js
 */
const { MongoClient, Binary } = require('mongodb');
const fs = require('fs');

// Load .env ringkas (tanpa dep tambahan)
const envText = fs.readFileSync('/app/.env', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || 'cycle_count';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!MONGO_URL) { console.error('MONGO_URL kosong'); process.exit(2); }
if (!BOT_TOKEN) { console.error('TELEGRAM_BOT_TOKEN kosong'); process.exit(2); }

async function tgGetFile(fileId) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const j = await r.json();
  if (!j.ok) throw new Error(`getFile gagal: ${j.description || JSON.stringify(j)}`);
  if (!j.result?.file_path) throw new Error('getFile: file_path kosong');
  return j.result; // { file_id, file_unique_id, file_path, file_size }
}
async function tgDownload(filePath) {
  const r = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  if (!r.ok) throw new Error(`download gagal HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

async function backupCollection(db, collName, labelField) {
  const coll = db.collection(collName);
  const totalTg = await coll.countDocuments({ telegram_status: 'sent', telegram_file_id: { $ne: null } });
  const alreadyBacked = await coll.countDocuments({ telegram_status: 'sent', telegram_file_id: { $ne: null }, file_data: { $exists: true } });
  const cursor = coll.find(
    { telegram_status: 'sent', telegram_file_id: { $ne: null }, file_data: { $exists: false } },
    { projection: { _id: 0, id: 1, telegram_file_id: 1, mime: 1, filename: 1, [labelField]: 1 } }
  );
  const docs = await cursor.toArray();
  let ok = 0, fail = 0;
  const failures = [];
  for (const d of docs) {
    try {
      const meta = await tgGetFile(d.telegram_file_id);
      const buf = await tgDownload(meta.file_path);
      await coll.updateOne(
        { id: d.id },
        {
          $set: {
            file_data: new Binary(buf),
            backup_at: new Date(),
            backup_source: 'telegram',
            backup_size: buf.length,
            backup_telegram_file_path: meta.file_path,
          },
        }
      );
      ok += 1;
      console.log(`  ✓ ${collName}/${d.id} (${d[labelField] || d.filename || '-'}) ${buf.length} bytes`);
    } catch (e) {
      fail += 1;
      failures.push({ id: d.id, label: d[labelField] || d.filename || null, file_id: d.telegram_file_id, error: String(e.message || e) });
      console.log(`  ✗ ${collName}/${d.id} FAILED: ${e.message || e}`);
    }
    // Small delay untuk hormati Telegram rate limit (max ~30 req/s).
    await new Promise((r) => setTimeout(r, 60));
  }
  return { total_telegram: totalTg, already_backed: alreadyBacked, attempted: docs.length, ok, fail, failures };
}

(async () => {
  const t0 = Date.now();
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`[BACKUP] start · DB=${DB_NAME}`);

  console.log('\n>> MIS Faktur');
  const fRes = await backupCollection(db, 'mis_faktur', 'no_faktur');
  console.log('>> MIS Faktur summary:', fRes);

  console.log('\n>> Trading Journal screenshots');
  const tRes = await backupCollection(db, 'tj_screenshots', 'filename');
  console.log('>> TJ screenshots summary:', tRes);

  await client.close();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const totalOk = fRes.ok + tRes.ok;
  const totalFail = fRes.fail + tRes.fail;
  console.log(`\n==================== FINAL REPORT ====================`);
  console.log(`Durasi             : ${elapsed}s`);
  console.log(`[MIS Faktur]`);
  console.log(`  Total di Telegram: ${fRes.total_telegram}`);
  console.log(`  Sudah ter-backup : ${fRes.already_backed}`);
  console.log(`  Diproses kali ini: ${fRes.attempted}`);
  console.log(`  Berhasil         : ${fRes.ok}`);
  console.log(`  Gagal            : ${fRes.fail}`);
  console.log(`[Trading Journal screenshots]`);
  console.log(`  Total di Telegram: ${tRes.total_telegram}`);
  console.log(`  Sudah ter-backup : ${tRes.already_backed}`);
  console.log(`  Diproses kali ini: ${tRes.attempted}`);
  console.log(`  Berhasil         : ${tRes.ok}`);
  console.log(`  Gagal            : ${tRes.fail}`);
  console.log(`TOTAL BERHASIL     : ${totalOk}`);
  console.log(`TOTAL GAGAL        : ${totalFail}`);
  if (fRes.failures.length) {
    console.log('\nDAFTAR KEGAGALAN — MIS Faktur:');
    for (const f of fRes.failures) console.log('  -', JSON.stringify(f));
  }
  if (tRes.failures.length) {
    console.log('\nDAFTAR KEGAGALAN — Trading Journal:');
    for (const f of tRes.failures) console.log('  -', JSON.stringify(f));
  }
  if (totalFail > 0) {
    console.log('\n⚠️  BACKUP BELUM 100% SELESAI — ada kegagalan di atas.');
    process.exit(1);
  }
  console.log('\n✅ BACKUP SELESAI — seluruh file berhasil tersalin ke MongoDB server MIS.');
  process.exit(0);
})().catch((e) => { console.error('Fatal:', e); process.exit(2); });
