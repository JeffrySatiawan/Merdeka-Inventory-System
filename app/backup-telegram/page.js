'use client';
/**
 * Owner-only one-shot trigger untuk /api/admin/backup/telegram.
 * Hanya halaman kecil terpisah — tidak mengubah UI MIS existing.
 * Buka URL `/backup-telegram` di browser sambil login sebagai Owner MIS.
 * Akses: self-contained, pakai Bearer token dari localStorage (`cc_token`).
 * Boleh dihapus setelah backup production selesai.
 */
import React, { useEffect, useState } from 'react';

export default function BackupTelegramPage() {
  const [me, setMe] = useState(null);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const getToken = () => (typeof window === 'undefined' ? '' : (localStorage.getItem('cc_token') || ''));

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        if (!token) throw new Error('Belum login. Silakan login dulu sebagai Owner di MIS, lalu kembali ke halaman ini.');
        const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error('Session tidak valid. Login ulang sebagai Owner di MIS.');
        const d = await r.json();
        if (d?.user?.role !== 'owner') throw new Error('Akses ditolak — hanya Owner yang dapat menjalankan backup.');
        setMe(d.user);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const runBackup = async () => {
    setRunning(true); setError(''); setResult(null);
    try {
      const token = getToken();
      const r = await fetch('/api/admin/backup/telegram', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      setResult(d);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRunning(false);
    }
  };

  const panel = (children) => (
    <div style={{ maxWidth: 760, margin: '48px auto', padding: 24, background: '#0b1221', color: '#e5e7eb', fontFamily: 'ui-sans-serif, system-ui', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Backup Telegram → MongoDB</h1>
      <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>Trigger sementara untuk Owner MIS. Idempotent — aman dijalankan ulang.</p>
      {children}
    </div>
  );

  if (checking) return panel(<div style={{ color: '#9ca3af' }}>Memeriksa sesi…</div>);
  if (error && !me) return panel(<div style={{ color: '#fca5a5' }}>❌ {error}</div>);

  return panel(
    <>
      <div style={{ fontSize: 13, marginBottom: 16 }}>
        Login sebagai: <b style={{ color: '#a7f3d0' }}>{me?.username}</b> (Owner)
      </div>
      <button
        onClick={runBackup}
        disabled={running}
        style={{
          padding: '10px 16px', borderRadius: 8, border: 'none',
          background: running ? '#374151' : '#2563eb', color: '#fff',
          fontSize: 14, fontWeight: 600, cursor: running ? 'wait' : 'pointer',
        }}
      >
        {running ? 'Backup berjalan — mohon tunggu (bisa 1-2 menit untuk data banyak)…' : 'Jalankan Backup Sekarang'}
      </button>
      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#450a0a', color: '#fecaca', borderRadius: 8, fontSize: 13 }}>❌ {error}</div>
      )}
      {result && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              padding: 12,
              background: result.ok ? '#064e3b' : '#78350f',
              color: result.ok ? '#a7f3d0' : '#fde68a',
              borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 12,
            }}
          >
            {result.ok ? '✅ ' : '⚠️ '}{result.status}
            {' · '}Durasi {result.elapsed_sec}s
          </div>
          <SummaryBlock title="MIS Faktur" data={result.summary?.mis_faktur} />
          <SummaryBlock title="Trading Journal Screenshots" data={result.summary?.tj_screenshots} />
          <div style={{ fontSize: 13, marginTop: 12 }}>
            <b>TOTAL BERHASIL:</b> {result.summary?.total_berhasil}
            {'  ·  '}
            <b>TOTAL GAGAL:</b> {result.summary?.total_gagal}
          </div>
          <details style={{ marginTop: 16 }}>
            <summary style={{ fontSize: 12, color: '#9ca3af', cursor: 'pointer' }}>Lihat JSON lengkap</summary>
            <pre style={{ marginTop: 8, padding: 12, background: '#111827', color: '#d1d5db', borderRadius: 8, fontSize: 11, overflow: 'auto', maxHeight: 400 }}>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
      <p style={{ marginTop: 24, fontSize: 11, color: '#6b7280' }}>Halaman ini boleh dihapus setelah backup production selesai (file: <code>/app/app/backup-telegram/page.js</code>).</p>
    </>
  );
}

function SummaryBlock({ title, data }) {
  if (!data) return null;
  const Row = ({ k, v, tone }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: '#9ca3af' }}>{k}</span>
      <span style={{ color: tone || '#e5e7eb', fontWeight: 600 }}>{v}</span>
    </div>
  );
  return (
    <div style={{ marginBottom: 12, padding: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#60a5fa', marginBottom: 6 }}>{title}</div>
      <Row k="Total di Telegram" v={data.total_telegram} />
      <Row k="Sudah ter-backup" v={data.already_backed} />
      <Row k="Diproses kali ini" v={data.attempted} />
      <Row k="Berhasil" v={data.ok} tone="#6ee7b7" />
      <Row k="Gagal" v={data.fail} tone={data.fail > 0 ? '#fca5a5' : '#e5e7eb'} />
      {data.failures?.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, color: '#fca5a5', cursor: 'pointer' }}>Daftar kegagalan ({data.failures.length})</summary>
          <pre style={{ marginTop: 6, padding: 8, background: '#111827', color: '#fecaca', borderRadius: 6, fontSize: 10, overflow: 'auto', maxHeight: 200 }}>{JSON.stringify(data.failures, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
