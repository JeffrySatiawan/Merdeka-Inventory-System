'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  FileText,
  Trash2,
  LogIn,
  Smartphone,
  Share2,
  WifiOff,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------- IndexedDB helpers (mirror of sw.js) ----------------
const DB_NAME = 'merdeka-share-db';
const STORE_QUEUE = 'queue';
const STORE_AUTH = 'auth';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const s = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AUTH)) {
        db.createObjectStore(STORE_AUTH, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- Helpers ----------------
function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}
function witaTodayDate() {
  // Return YYYY-MM-DD in WITA (UTC+8)
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const wita = new Date(utc + 8 * 3600000);
  const yyyy = wita.getUTCFullYear();
  const mm = String(wita.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(wita.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Register SW and push token to SW so background sync can upload
async function pushAuthToSW(token) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.active) return;
    reg.active.postMessage({
      type: 'merdeka-share:set-auth',
      token,
      base_url: window.location.origin,
    });
  } catch {
    // ignore
  }
}

async function uploadFile(blob, filename, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/om/pdfs/auto');
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.item);
      else reject(new Error(data.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    const fd = new FormData();
    fd.append('file', blob, filename || 'shared.pdf');
    xhr.send(fd);
  });
}

// ---------------- Page ----------------
export default function ShareApp() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [queue, setQueue] = useState([]);       // pending/uploading/success/failed items from IDB
  const [todayList, setTodayList] = useState([]); // server-side today's uploads
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({}); // { itemId: 0..100 }
  const [installPrompt, setInstallPrompt] = useState(null); // beforeinstallprompt event
  const [isInstalled, setIsInstalled] = useState(false);
  const fileInputRef = useRef(null);

  // ---- boot: load token + user + queue ----
  const loadEverything = useCallback(async () => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null;
    setToken(t);
    if (t) {
      try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t } });
        if (res.ok) {
          const d = await res.json();
          setUser(d.user);
          await pushAuthToSW(t);
        } else {
          setUser(null);
          localStorage.removeItem('cc_token');
        }
      } catch {
        setUser(null);
      }
    } else {
      setUser(null);
    }
    try {
      const items = await idbGetAll(STORE_QUEUE);
      items.sort((a, b) => (b.received_at || 0) - (a.received_at || 0));
      setQueue(items);
    } catch {
      setQueue([]);
    }
  }, []);

  const loadToday = useCallback(async (t) => {
    if (!t) return;
    try {
      const res = await fetch('/api/om/pdfs', { headers: { Authorization: 'Bearer ' + t } });
      if (res.ok) {
        const d = await res.json();
        const today = witaTodayDate();
        const items = (d.items || []).filter((x) => x.uploaded_wita_date === today);
        items.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
        setTodayList(items);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      await loadEverything();
      setReady(true);
    })();
    // Poll for SW messages
    const onMsg = (e) => {
      if (e.data?.type === 'merdeka-share:queue-updated') {
        loadEverything();
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Capture beforeinstallprompt so we can show a manual "Install" button
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    // Detect if already installed (running standalone)
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsInstalled(standalone);
    const onAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMsg);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [loadEverything]);

  async function triggerInstall() {
    if (!installPrompt) return;
    try {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setInstallPrompt(null);
        toast.success('Merdeka Share terinstall!');
      }
    } catch (e) {
      toast.error(String(e?.message || e));
    }
  }

  // when token/user set, load today list, then kick off upload of pending items
  useEffect(() => {
    if (!ready || !token) return;
    loadToday(token);
  }, [ready, token, loadToday]);

  // Auto-process queue whenever we have queue + token + user + online
  useEffect(() => {
    if (!ready || !token || !user || !online) return;
    if (user.role !== 'owner') return;
    if (processing) return;
    const hasPending = queue.some((it) => it.status === 'pending' || it.status === 'failed');
    if (!hasPending) return;
    processQueue();
  }, [ready, token, user, online, queue]);

  async function processQueue() {
    setProcessing(true);
    try {
      // Snapshot current pending list from IDB (source of truth)
      const items = await idbGetAll(STORE_QUEUE);
      const pending = items.filter((it) => it.status === 'pending' || it.status === 'failed');
      for (const it of pending) {
        // mark uploading
        const uploadingItem = { ...it, status: 'uploading', attempts: (it.attempts || 0) + 1 };
        await idbPut(STORE_QUEUE, uploadingItem);
        setQueue((prev) => prev.map((q) => (q.id === it.id ? uploadingItem : q)));
        setProgress((p) => ({ ...p, [it.id]: 0 }));
        try {
          const item = await uploadFile(it.blob, it.original_name || 'shared.pdf', token, (pct) => {
            setProgress((p) => ({ ...p, [it.id]: pct }));
          });
          const done = {
            ...uploadingItem,
            status: 'success',
            server_id: item?.id || null,
            server_filename: item?.filename || null,
            error: null,
            completed_at: Date.now(),
          };
          await idbPut(STORE_QUEUE, done);
          setQueue((prev) => prev.map((q) => (q.id === it.id ? done : q)));
          setProgress((p) => ({ ...p, [it.id]: 100 }));
          toast.success(`Terunggah: ${item?.filename || 'PDF'}`);
        } catch (e) {
          const failed = {
            ...uploadingItem,
            status: 'failed',
            error: String(e?.message || e),
          };
          await idbPut(STORE_QUEUE, failed);
          setQueue((prev) => prev.map((q) => (q.id === it.id ? failed : q)));
          toast.error(`Gagal upload: ${failed.error}`);
        }
      }
      // Refresh today list once queue processed
      await loadToday(token);
      // Register background sync so retries continue even after user closes app
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (reg && 'sync' in reg) {
          await reg.sync.register('merdeka-share-upload');
        }
      } catch { /* sync not supported */ }
    } finally {
      setProcessing(false);
    }
  }

  async function retryOne(id) {
    const items = await idbGetAll(STORE_QUEUE);
    const it = items.find((x) => x.id === id);
    if (!it) return;
    it.status = 'pending';
    it.error = null;
    await idbPut(STORE_QUEUE, it);
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...it } : q)));
  }

  async function removeOne(id) {
    await idbDelete(STORE_QUEUE, id);
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }

  async function clearFinished() {
    const items = await idbGetAll(STORE_QUEUE);
    for (const it of items) {
      if (it.status === 'success') await idbDelete(STORE_QUEUE, it.id);
    }
    setQueue((prev) => prev.filter((q) => q.status !== 'success'));
    toast.info('Riwayat berhasil dibersihkan');
  }

  // Manual pick-file (for testing / when not opened via share intent)
  async function pickFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const now = Date.now();
    const newItems = [];
    for (const f of Array.from(fileList)) {
      if (!/pdf/i.test(f.type) && !/\.pdf$/i.test(f.name)) {
        toast.error(`Bukan PDF: ${f.name}`);
        continue;
      }
      const item = {
        id: crypto.randomUUID(),
        blob: f,
        mime: f.type || 'application/pdf',
        size: f.size,
        original_name: f.name,
        status: 'pending',
        error: null,
        attempts: 0,
        server_filename: null,
        server_id: null,
        received_at: now,
      };
      await idbPut(STORE_QUEUE, item);
      newItems.push(item);
    }
    setQueue((prev) => [...newItems, ...prev]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ---------------- UI ----------------
  if (!ready) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center p-4">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not logged in: show login prompt
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-6 gap-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-[400px] h-[400px] rounded-full bg-emerald-500/10 blur-[120px]" />
          <div className="absolute -bottom-40 -left-40 w-[400px] h-[400px] rounded-full bg-blue-500/10 blur-[120px]" />
        </div>
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
          <Share2 className="w-8 h-8 text-white" />
        </div>
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-bold">Merdeka Share</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Anda harus login ke <span className="text-white">Merdeka Inventory System</span> terlebih dahulu sebelum bisa share PDF.
          </p>
        </div>
        <Button
          onClick={() => {
            window.location.href = '/';
          }}
          className="gap-2 z-10"
        >
          <LogIn className="w-4 h-4" /> Login di MIS
        </Button>
        {installPrompt && !isInstalled && (
          <Button
            onClick={triggerInstall}
            variant="outline"
            className="gap-2 z-10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
          >
            <Smartphone className="w-4 h-4" /> Install App
          </Button>
        )}
        <div className="text-[10px] text-muted-foreground/60 text-center max-w-xs">
          Setelah login di MIS, kembali ke aplikasi Merdeka Share ini. Session akan otomatis terpakai.
        </div>
      </div>
    );
  }

  // Logged in but not owner
  if (user.role !== 'owner') {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-6 gap-4">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/20 flex items-center justify-center">
          <AlertCircle className="w-7 h-7 text-rose-400" />
        </div>
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-bold">Hanya Owner</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Fitur ini hanya untuk owner (ADMIN). Login Anda saat ini: <span className="text-white">{user.name}</span> ({user.role})
          </p>
        </div>
        <Button variant="outline" onClick={() => (window.location.href = '/')} className="gap-2">
          <ExternalLink className="w-4 h-4" /> Buka MIS
        </Button>
      </div>
    );
  }

  const pendingCount = queue.filter((q) => q.status === 'pending' || q.status === 'uploading' || q.status === 'failed').length;
  const successCount = queue.filter((q) => q.status === 'success').length;

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-safe">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0a0a0b]/95 backdrop-blur border-b border-white/5 pt-safe">
        <div className="flex items-center gap-3 px-4 h-14">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center">
            <Share2 className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground leading-tight uppercase tracking-wider">
              PWA
            </div>
            <div className="font-semibold text-sm leading-tight">Merdeka Share</div>
          </div>
          {!online && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px] gap-1">
              <WifiOff className="w-3 h-3" /> Offline
            </Badge>
          )}
          <button
            onClick={async () => {
              setRefreshing(true);
              await loadEverything();
              await loadToday(token);
              setRefreshing(false);
            }}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/5 active:bg-white/10"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* User info + open OMS */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center text-sm font-bold">
            {user.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{user.name}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{user.role}</div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-9"
            onClick={() => (window.location.href = '/?view=om:pdfs')}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Buka OMS
          </Button>
        </div>

        {/* Install banner (only shown when installable and not already installed) */}
        {installPrompt && !isInstalled && (
          <Card className="border-blue-500/30 bg-gradient-to-r from-blue-500/10 to-emerald-500/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">Install Merdeka Share ke HP</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Setelah install, akan muncul di menu share HP untuk terima PDF dari aplikasi lain.
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={triggerInstall}
                  className="gap-1.5"
                >
                  <Smartphone className="w-3.5 h-3.5" /> Install
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isInstalled && (
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>Merdeka Share sudah terinstall. Aplikasi ini akan muncul di menu Share HP Anda.</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Share2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="text-white font-semibold">Cara pakai:</span> Buka PDF di aplikasi lain
                (WhatsApp, Shopee, Files, dll) → tekan tombol{' '}
                <span className="text-white font-semibold">Bagikan</span> → pilih{' '}
                <span className="text-emerald-400 font-semibold">Merdeka Share</span>. File akan otomatis diupload ke OMS.
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Manual pick (test / fallback) */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => pickFiles(e.target.files)}
          />
          <Button
            className="flex-1 gap-2"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" /> Pilih PDF Manual
          </Button>
          {(pendingCount > 0 || successCount > 0) && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={clearFinished}
              disabled={successCount === 0}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Bersihkan
            </Button>
          )}
        </div>

        {/* Queue */}
        {queue.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Antrean ({queue.length})
              </div>
              {processing && (
                <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> memproses...
                </div>
              )}
            </div>
            {queue.map((it) => (
              <QueueRow
                key={it.id}
                item={it}
                progress={progress[it.id] || 0}
                onRetry={() => retryOne(it.id)}
                onRemove={() => removeOne(it.id)}
              />
            ))}
          </div>
        )}

        {/* Today uploads */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Upload Hari Ini ({todayList.length})
            </div>
          </div>
          {todayList.length === 0 && queue.length === 0 ? (
            <Card className="border-white/10 bg-white/[0.02]">
              <CardContent className="pt-8 pb-8 text-center">
                <FileText className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                <div className="text-sm text-muted-foreground">Belum ada upload hari ini</div>
                <div className="text-[11px] text-muted-foreground/70 mt-1">
                  Share PDF dari aplikasi lain untuk mulai
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {todayList.map((it) => (
                <TodayRow key={it.id} item={it} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function QueueRow({ item, progress, onRetry, onRemove }) {
  const statusMap = {
    pending: { label: 'Menunggu', color: 'text-muted-foreground', icon: Clock },
    uploading: { label: `Uploading ${progress}%`, color: 'text-blue-400', icon: Loader2 },
    success: { label: 'Berhasil', color: 'text-emerald-400', icon: CheckCircle2 },
    failed: { label: 'Gagal', color: 'text-rose-400', icon: AlertCircle },
  };
  const s = statusMap[item.status] || statusMap.pending;
  const Icon = s.icon;
  return (
    <Card
      className={`border-white/10 ${
        item.status === 'failed'
          ? 'bg-rose-500/[0.04] border-rose-500/20'
          : item.status === 'success'
          ? 'bg-emerald-500/[0.04] border-emerald-500/20'
          : 'bg-white/[0.02]'
      }`}
    >
      <CardContent className="pt-3 pb-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {item.server_filename || item.original_name || 'shared.pdf'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
              <span>{formatBytes(item.size)}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className={`flex items-center gap-1 ${s.color}`}>
                <Icon className={`w-3 h-3 ${item.status === 'uploading' ? 'animate-spin' : ''}`} />
                {s.label}
              </span>
            </div>
            {item.status === 'uploading' && (
              <div className="mt-1.5 h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            {item.status === 'failed' && item.error && (
              <div className="text-[10px] text-rose-300 mt-1 line-clamp-2">{item.error}</div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {item.status === 'failed' && (
              <button
                onClick={onRetry}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-blue-400"
                aria-label="Retry"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            {(item.status === 'success' || item.status === 'failed' || item.status === 'pending') && (
              <button
                onClick={onRemove}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-muted-foreground"
                aria-label="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TodayRow({ item }) {
  const dt = item.uploaded_at ? new Date(item.uploaded_at) : null;
  const timeStr = dt
    ? dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const resiCount = Array.isArray(item.detected_tracking_numbers)
    ? item.detected_tracking_numbers.length
    : 0;
  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate font-mono">{item.filename}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{formatBytes(item.size)}</span>
              {timeStr && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{timeStr}</span>
                </>
              )}
              {resiCount > 0 && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-emerald-400">{resiCount} resi</span>
                </>
              )}
              {item.uploaded_via === 'merdeka_share' && (
                <Badge variant="outline" className="text-[9px] py-0 h-4 border-emerald-500/40 text-emerald-400">
                  SHARE
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
