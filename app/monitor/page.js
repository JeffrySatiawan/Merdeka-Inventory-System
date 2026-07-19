'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Activity, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';

async function getMonitor() {
  const res = await fetch('/api/monitor', { cache: 'no-store' });
  if (!res.ok) throw new Error('failed');
  return res.json();
}

function useCountdown(target) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // target is HH:MM WITA. Compute today's target WITA time as Date object.
  const [h, m] = String(target || '22:00').split(':').map((v) => parseInt(v, 10) || 0);
  // Build target as ms in UTC: today's WITA date at h:m -> convert to UTC by subtracting 8h
  const witaDateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar' }).format(new Date(now));
  // witaDateStr is YYYY-MM-DD (WITA). Create as if it's WITA local, then to UTC.
  const targetUtcMs = Date.parse(`${witaDateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+08:00`);
  const diff = targetUtcMs - now;
  if (isNaN(diff)) return '--:--:--';
  if (diff <= 0) return '00:00:00';
  const s = Math.floor(diff / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function MonitorPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const d = await getMonitor();
        if (alive) setData(d);
      } catch (e) {
        if (alive) setErr(e.message);
      }
    }
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const countdown = useCountdown(data?.working?.end);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-white">
        {err ? <div className="text-rose-400">Error: {err}</div> : <div className="text-muted-foreground">Loading...</div>}
      </div>
    );
  }

  const t = data.today;

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-8 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[700px] h-[700px] rounded-full bg-blue-500/10 blur-[140px]" />
        <div className="absolute -bottom-40 -left-40 w-[700px] h-[700px] rounded-full bg-purple-500/10 blur-[140px]" />
      </div>

      <div className="relative max-w-[1600px] mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="font-bold text-2xl tracking-tight">Cycle Count Monitor</div>
              <div className="text-xs text-neutral-400">Live · update tiap 3 detik</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-right">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Waktu WITA</div>
              <div className="text-2xl font-bold tabular-nums">{t.time}</div>
            </div>
            <div className={`px-4 py-2 rounded-xl border text-right ${data.is_closed ? 'bg-rose-500/10 border-rose-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                {data.is_closed ? 'Session Closed' : 'Countdown ke tutup'}
              </div>
              <div className={`text-2xl font-bold tabular-nums ${data.is_closed ? 'text-rose-400' : 'text-emerald-400'}`}>
                {data.is_closed ? 'CLOSED' : countdown}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: giant progress */}
          <div className="lg:col-span-2 rounded-3xl border border-white/10 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-transparent p-8 flex flex-col items-center justify-center">
            <div className="text-xs uppercase tracking-widest text-neutral-400 mb-4">Today&apos;s Progress</div>
            <BigProgress value={t.progressPct} />
            <div className="text-xl mt-6 tabular-nums">
              <span className="text-emerald-400 font-bold">{t.completed}</span>
              <span className="text-neutral-500 mx-2">/</span>
              <span className="font-bold">{t.target}</span>
              <span className="text-neutral-400 text-sm ml-2">SKU selesai</span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 w-full">
              <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-center">
                <div className="text-[10px] uppercase text-neutral-400">Sisa Hari Ini</div>
                <div className="text-3xl font-bold text-orange-400 tabular-nums">{t.remaining}</div>
              </div>
              <div className={`rounded-xl border p-4 text-center ${data.backlog > 0 ? 'bg-rose-500/10 border-rose-500/30' : 'bg-white/5 border-white/10'}`}>
                <div className="text-[10px] uppercase text-neutral-400">Backlog</div>
                <div className={`text-3xl font-bold tabular-nums ${data.backlog > 0 ? 'text-rose-400' : 'text-neutral-500'}`}>{data.backlog}</div>
              </div>
            </div>
            <div className="mt-4 text-xs text-neutral-400 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              Jam kerja {data.working.start} – {data.working.end} WITA
            </div>
          </div>

          {/* Right: employees */}
          <div className="lg:col-span-3 rounded-3xl border border-white/10 bg-white/[0.02] p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="font-bold text-2xl">Employee Progress</div>
                <div className="text-xs text-neutral-400 flex items-center gap-1.5 mt-1">
                  <Activity className="w-3 h-3 text-blue-400" />
                  Realtime · {data.today.date}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              {data.employees.map((e, idx) => (
                <motion.div
                  key={e.name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 flex items-center justify-center font-bold text-lg shrink-0">
                    {e.name[0]}
                  </div>
                  <div className="w-32 shrink-0">
                    <div className="font-semibold text-lg">{e.name}</div>
                    <div className="text-[10px] text-neutral-400 uppercase tracking-wider">
                      {e.logged_in ? 'Online' : 'Belum login'}
                    </div>
                  </div>
                  <div className="flex-1 relative h-4 rounded-full bg-white/5 overflow-hidden border border-white/5">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${e.pct}%` }}
                      transition={{ duration: 0.6 }}
                      className={`absolute inset-y-0 left-0 rounded-full ${
                        e.pct === 100
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                          : e.pct >= 60
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-400'
                          : e.pct >= 30
                          ? 'bg-gradient-to-r from-orange-500 to-amber-400'
                          : 'bg-gradient-to-r from-rose-500 to-pink-400'
                      }`}
                    />
                  </div>
                  <div className="w-32 text-right shrink-0">
                    <div className="text-2xl font-bold tabular-nums">{e.pct}%</div>
                    <div className="text-[10px] text-neutral-400">
                      {e.completed} / {e.assigned}
                    </div>
                  </div>
                </motion.div>
              ))}
              {data.employees.length === 0 && (
                <div className="text-center text-neutral-500 py-12">Belum ada karyawan aktif</div>
              )}
            </div>
          </div>
        </div>

        {data.is_closed && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 flex items-center gap-3 text-rose-300"
          >
            <AlertCircle className="w-5 h-5" />
            <div>
              <div className="font-semibold">Session ditutup otomatis</div>
              <div className="text-xs opacity-80">Tugas yang belum selesai akan menjadi backlog dan didistribusi ulang besok</div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function BigProgress({ value }) {
  const radius = 100;
  const circ = 2 * Math.PI * radius;
  const dash = (value / 100) * circ;
  return (
    <div className="relative w-64 h-64 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 220 220">
        <circle cx="110" cy="110" r={radius} stroke="hsl(217 32% 17%)" strokeWidth="14" fill="none" />
        <motion.circle
          cx="110"
          cy="110"
          r={radius}
          stroke="url(#mgrad)"
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - dash }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="mgrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-7xl font-bold tabular-nums">{value}%</div>
        {value === 100 && <CheckCircle2 className="w-8 h-8 text-emerald-400 mt-2" />}
      </div>
    </div>
  );
}
