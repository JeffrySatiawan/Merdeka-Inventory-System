'use client';

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Download, Bell, BellOff, Sparkles, AlertCircle } from 'lucide-react';

async function getMonitor() {
  const res = await fetch('/api/monitor', { cache: 'no-store' });
  if (!res.ok) throw new Error('failed');
  return res.json();
}

export default function WidgetPage() {
  const [data, setData] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [notifPerm, setNotifPerm] = useState('default');
  const lastNotifRef = useRef(0);

  // Fetch loop
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const d = await getMonitor();
        if (alive) setData(d);
      } catch {}
    }
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // PWA install prompt
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true);
    if (typeof Notification !== 'undefined') setNotifPerm(Notification.permission);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Hourly notification
  useEffect(() => {
    if (!data || notifPerm !== 'granted') return;
    const now = Date.now();
    // Notify every 60 minutes (or immediately once when data first loads)
    const HOUR = 60 * 60 * 1000;
    if (now - lastNotifRef.current < HOUR) return;
    if (data.today.progressPct >= 100 || data.is_closed) return;
    const notFinished = data.employees
      .filter((e) => e.pct < 100 && e.assigned > 0)
      .map((e) => `${e.name} ${e.pct}%`)
      .join(' · ');
    try {
      new Notification('Merdeka Inventory System', {
        body: `Progress: ${data.today.progressPct}% · Sisa ${data.today.remaining} SKU\n${notFinished || 'Semua selesai!'}`,
        icon: '/manifest.json',
        badge: '/manifest.json',
        tag: 'mis-hourly',
      });
      lastNotifRef.current = now;
    } catch {}
  }, [data, notifPerm]);

  async function requestNotif() {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
    if (p === 'granted') {
      try {
        new Notification('Notifikasi aktif', { body: 'Anda akan mendapat update progress tiap jam' });
      } catch {}
    }
  }

  async function doInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setInstallPrompt(null);
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-white text-sm">
        Loading...
      </div>
    );
  }

  const t = data.today;
  const notFinished = data.employees.filter((e) => e.pct < 100 && e.assigned > 0);

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/30 font-black text-white text-[10px] tracking-tight">
            MIS
          </div>
          <div>
            <div className="font-bold text-sm leading-none">Merdeka Inventory</div>
            <div className="text-[10px] text-neutral-400 mt-0.5">System · Widget</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {notifPerm !== 'granted' ? (
            <button
              onClick={requestNotif}
              className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10"
              title="Aktifkan notifikasi"
            >
              <BellOff className="w-3.5 h-3.5 text-neutral-400" />
            </button>
          ) : (
            <div className="p-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30">
              <Bell className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          )}
          {installPrompt && !installed && (
            <button
              onClick={doInstall}
              className="p-1.5 rounded-md bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40"
              title="Install sebagai aplikasi"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
            </button>
          )}
        </div>
      </div>

      {/* Progress big */}
      <div className={`rounded-2xl border p-4 mb-3 ${data.is_closed ? 'border-rose-500/30 bg-rose-500/5' : 'border-white/10 bg-gradient-to-br from-blue-500/10 to-purple-500/5'}`}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Progress</div>
          <div className="text-[10px] text-neutral-400 tabular-nums">{data.today.time} WITA</div>
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-5xl font-bold tabular-nums">{t.progressPct}%</div>
          <div className="text-xs text-neutral-400">
            {t.completed} / {t.target}
          </div>
        </div>
        <div className="h-2 rounded-full bg-white/5 mt-3 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${t.progressPct}%` }}
            transition={{ duration: 0.5 }}
            className={`h-full rounded-full ${t.progressPct === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'}`}
          />
        </div>
        <div className="flex justify-between mt-3 text-xs">
          <div>
            <div className="text-[9px] uppercase text-neutral-400">Sisa</div>
            <div className="font-bold text-orange-400">{t.remaining}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-neutral-400">Backlog</div>
            <div className={`font-bold ${data.backlog > 0 ? 'text-rose-400' : 'text-neutral-500'}`}>{data.backlog}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-neutral-400">Jam Kerja</div>
            <div className="font-bold text-neutral-300">{data.working.start}-{data.working.end}</div>
          </div>
        </div>
      </div>

      {/* Employees */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Karyawan</div>
        <div className="space-y-2">
          {data.employees.map((e) => (
            <div key={e.name} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 flex items-center justify-center text-[10px] font-bold shrink-0">
                {e.name[0]}
              </div>
              <div className="w-14 text-xs truncate shrink-0">{e.name}</div>
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${e.pct}%` }}
                  transition={{ duration: 0.5 }}
                  className={`h-full rounded-full ${
                    e.pct === 100
                      ? 'bg-emerald-500'
                      : e.pct >= 60
                      ? 'bg-blue-500'
                      : e.pct >= 30
                      ? 'bg-orange-500'
                      : 'bg-rose-500'
                  }`}
                />
              </div>
              <div className="w-14 text-right text-xs tabular-nums shrink-0">
                {e.assigned === 0 && !e.logged_in ? (
                  <span className="text-[9px] text-neutral-500 italic">off</span>
                ) : (
                  <span className="font-semibold">{e.pct}%</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.is_closed && (
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 flex items-center gap-2 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4" />
          <div>Session ditutup</div>
        </div>
      )}

      <div className="mt-3 text-center text-[9px] text-neutral-500">
        {installed ? 'Installed as app' : installPrompt ? 'Klik icon download untuk install' : 'Buka di Chrome/Edge untuk install'}
      </div>
    </div>
  );
}
