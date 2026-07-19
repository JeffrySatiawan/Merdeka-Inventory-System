'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import OrderManagementModule from '@/components/modules/order-management/OrderManagementModule';
import { toast } from 'sonner';
import {
  LayoutDashboard,
  Upload,
  Users,
  Settings as SettingsIcon,
  LogOut,
  Search,
  Loader2,
  CheckCircle2,
  Circle,
  Clock,
  Package,
  Zap,
  Gauge,
  Turtle,
  Target,
  History,
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  RefreshCw,
  FileSpreadsheet,
  Activity,
  Monitor,
  ExternalLink,
  AlertCircle,
  ShoppingCart,
  ChevronDown,
  ChevronRight,
  Shield,
  Database,
  BarChart3,
  Boxes,
  Lock,
  Truck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';

// ---------- API helpers ----------
async function api(path, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null;
  const headers = {
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`/api/${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- Login ----------
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api('auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem('cc_token', data.token);
      onLogin(data.user);
      toast.success(`Halo, ${data.user.name}!`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  const quickPick = (u, p) => {
    setUsername(u);
    setPassword(p);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-[#09090b]">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-blue-500/10 blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-purple-500/10 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10 px-4"
      >
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/30 font-black text-white text-sm tracking-tight">
            MIS
          </div>
          <div>
            <div className="font-bold text-lg tracking-tight leading-tight">Merdeka Inventory</div>
            <div className="text-xs text-muted-foreground">System</div>
          </div>
        </div>

        <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-2xl">
          <CardHeader>
            <CardTitle className="text-2xl">Masuk</CardTitle>
            <CardDescription>Silakan login untuk melanjutkan</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="mis. owner"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Masuk
              </Button>
            </form>

            <Separator className="my-5" />
            <div className="text-xs text-muted-foreground mb-3">Demo akun (klik untuk isi):</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => quickPick('owner', 'owner123')}
                className="p-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-left transition"
              >
                <div className="font-semibold">Owner</div>
                <div className="text-muted-foreground">owner / owner123</div>
              </button>
              <button
                onClick={() => quickPick('cindy', 'cindy123')}
                className="p-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-left transition"
              >
                <div className="font-semibold">Cindy (staff)</div>
                <div className="text-muted-foreground">cindy / cindy123</div>
              </button>
              <button
                onClick={() => quickPick('hayu', 'hayu123')}
                className="p-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-left transition"
              >
                <div className="font-semibold">Hayu (staff)</div>
                <div className="text-muted-foreground">hayu / hayu123</div>
              </button>
              <button
                onClick={() => quickPick('dian', 'dian123')}
                className="p-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-left transition"
              >
                <div className="font-semibold">Dian (staff)</div>
                <div className="text-muted-foreground">dian / dian123</div>
              </button>
            </div>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground mt-6">
          Merdeka Inventory System · Pharmacy cycle count management
        </div>
      </motion.div>
    </div>
  );
}

// ---------- Module Registry (frontend mirror of backend) ----------
const MODULES_META = {
  cycle_count: { key: 'cycle_count', name: 'Cycle Count', icon: Package, status: 'active' },
  order_management: { key: 'order_management', name: 'Order Management', icon: ShoppingCart, status: 'active' },
};

// Compute allowed module keys for a user (owner has all)
function userModules(user) {
  if (!user) return [];
  if (user.role === 'owner') return Object.keys(MODULES_META);
  return Array.isArray(user.modules) ? user.modules : [];
}
function userHasModule(user, key) {
  return userModules(user).includes(key);
}
function isOwner(user) {
  return user?.role === 'owner';
}
function isAdminRole(user) {
  return user?.role === 'owner' || user?.role === 'supervisor';
}

// Navigation structure. Each item may specify:
//   module?: string        -> requires user to have this module permission
//   ownerOnly?: boolean    -> requires user.role === 'owner'
//   adminOnly?: boolean    -> owner or supervisor
//   staffOnly?: boolean    -> only for staff role
function buildNav(user) {
  const sections = [
    {
      title: 'Modules',
      items: [
        {
          key: 'mod:cycle_count',
          label: 'Cycle Count',
          icon: Package,
          module: 'cycle_count',
          children: [
            { key: 'cc:dashboard', label: 'Realtime Monitor', adminOnly: true },
            { key: 'cc:tasks', label: 'My Tasks' },
            { key: 'cc:import', label: 'Product Import', ownerOnly: true },
            { key: 'cc:settings', label: 'Cycle Settings', ownerOnly: true },
            { key: 'cc:history', label: 'Riwayat SKU' },
          ],
        },
        {
          key: 'mod:order_management',
          label: 'Order Management',
          icon: ShoppingCart,
          module: 'order_management',
          children: [
            { key: 'om:dashboard', label: 'Dashboard' },
            { key: 'om:scan_print', label: 'Scan Cetak Resi' },
            { key: 'om:scan_pack', label: 'Scan Mulai Packing' },
            { key: 'om:scan_deliver', label: 'Scan Serah Terima Kurir' },
            { key: 'om:reports', label: 'Laporan' },
            { key: 'om:expeditions', label: 'Master Ekspedisi' },
            { key: 'om:settings', label: 'Pengaturan', ownerOnly: true },
          ],
        },
      ],
    },
    {
      title: 'Admin',
      items: [
        { key: 'ad:users', label: 'User Management', icon: Shield, ownerOnly: true },
      ],
    },
  ];
  // Filter based on permissions
  const filterItem = (it) => {
    if (it.ownerOnly && !isOwner(user)) return false;
    if (it.adminOnly && !isAdminRole(user)) return false;
    if (it.module && !userHasModule(user, it.module)) return false;
    return true;
  };
  return sections
    .map((s) => {
      const items = s.items
        .filter(filterItem)
        .map((it) => {
          if (it.children) {
            const kids = it.children.filter(filterItem);
            return kids.length ? { ...it, children: kids } : null;
          }
          return it;
        })
        .filter(Boolean);
      return items.length ? { ...s, items } : null;
    })
    .filter(Boolean);
}

function getDefaultView(user) {
  if (!user) return 'cc:dashboard';
  const mods = userModules(user);
  if (isAdminRole(user)) {
    if (mods.includes('cycle_count')) return 'cc:dashboard';
    if (mods.includes('order_management')) return 'om:dashboard';
    return 'no_access';
  }
  // staff
  if (mods.includes('cycle_count')) return 'cc:tasks';
  if (mods.includes('order_management')) return 'om:dashboard';
  return 'no_access';
}

// ---------- Sidebar with hierarchical sections ----------
function SidebarNav({ user, active, onNav, onLogout, onItemClick }) {
  const nav = useMemo(() => buildNav(user), [user]);
  // Which module groups are expanded
  const [expanded, setExpanded] = useState(() => {
    // auto-expand the group containing active
    const init = {};
    for (const s of buildNav(user)) {
      for (const it of s.items) {
        if (it.children && it.children.some((c) => c.key === active)) init[it.key] = true;
      }
    }
    return init;
  });

  function handleNav(key) {
    onNav(key);
    onItemClick && onItemClick();
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-5 flex items-center gap-3 border-b border-white/5">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/30 font-black text-white text-xs tracking-tight">
          MIS
        </div>
        <div>
          <div className="font-semibold text-sm leading-tight">Merdeka Inventory</div>
          <div className="text-[10px] text-muted-foreground">System</div>
        </div>
      </div>
      <nav className="p-3 flex-1 space-y-4 overflow-y-auto">
        {nav.map((section) => (
          <div key={section.title}>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 px-3 mb-1.5 font-semibold">
              {section.title}
            </div>
            <div className="space-y-0.5">
              {section.items.map((it) => {
                const Icon = it.icon;
                if (it.children) {
                  const open = !!expanded[it.key];
                  const anyChildActive = it.children.some((c) => c.key === active);
                  return (
                    <div key={it.key}>
                      <button
                        onClick={() =>
                          setExpanded((e) => ({ ...e, [it.key]: !e[it.key] }))
                        }
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                          anyChildActive
                            ? 'text-white'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="flex-1 text-left">{it.label}</span>
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {open && (
                        <div className="ml-6 mt-0.5 space-y-0.5 border-l border-white/5 pl-2">
                          {it.children.map((c) => {
                            const isActive = active === c.key;
                            return (
                              <button
                                key={c.key}
                                onClick={() => handleNav(c.key)}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition ${
                                  isActive
                                    ? 'bg-white/10 text-white'
                                    : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                                }`}
                              >
                                <span className={`w-1 h-1 rounded-full ${isActive ? 'bg-blue-400' : 'bg-white/20'}`} />
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }
                const isActive = active === it.key;
                const isComingSoon = it.badge === 'Soon';
                return (
                  <button
                    key={it.key}
                    onClick={() => handleNav(it.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                      isActive
                        ? 'bg-white/10 text-white'
                        : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="flex-1 text-left">{it.label}</span>
                    {isComingSoon && (
                      <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-500/40 text-amber-400">
                        Soon
                      </Badge>
                    )}
                    {isActive && <span className="w-1 h-4 rounded-full bg-blue-500" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="p-3 border-t border-white/5">
        <button
          onClick={async () => {
            try {
              if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.unregister()));
              }
              if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              }
            } catch {}
            window.location.reload();
          }}
          className="w-full mb-2 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-white/5 hover:text-white transition"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="flex-1 text-left">Refresh Aplikasi</span>
          <span className="text-[9px] text-muted-foreground/60">clear cache</span>
        </button>
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold">
            {user.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{user.name}</div>
            <div className="text-[10px] text-muted-foreground capitalize">{user.role}</div>
          </div>
        </div>
        <Button variant="ghost" onClick={onLogout} className="w-full justify-start gap-2 text-muted-foreground hover:text-white">
          <LogOut className="w-4 h-4" />
          Keluar
        </Button>
      </div>
    </div>
  );
}

function Sidebar(props) {
  return (
    <aside className="w-64 shrink-0 border-r border-white/5 bg-[#0a0a0b] h-screen sticky top-0">
      <SidebarNav {...props} />
    </aside>
  );
}

// Determine which module the current view belongs to
function getActiveModule(view) {
  if (!view) return null;
  if (view.startsWith('cc:')) return 'cycle_count';
  if (view.startsWith('om:') || view === 'mod:order_management') return 'order_management';
  return null; // no module context (e.g. ad:users)
}

// Bottom-nav items per module (filtered by role/permission at render time)
function bottomNavForModule(moduleKey, user) {
  if (moduleKey === 'cycle_count') {
    const isAdmin = isAdminRole(user);
    // 4-5 items depending on role
    if (isAdmin) {
      return [
        { key: 'cc:dashboard', label: 'Monitor', icon: LayoutDashboard },
        { key: 'cc:tasks', label: 'Tasks', icon: CheckCircle2 },
        { key: 'cc:import', label: 'Import', icon: Upload },
        { key: 'cc:settings', label: 'Setting', icon: SettingsIcon },
        { key: 'cc:history', label: 'Riwayat', icon: History },
      ];
    }
    // Staff: My Tasks + Riwayat
    return [
      { key: 'cc:tasks', label: 'My Tasks', icon: CheckCircle2 },
      { key: 'cc:history', label: 'Riwayat', icon: History },
    ];
  }
  if (moduleKey === 'order_management') {
    const isOwner = user?.role === 'owner';
    const items = [
      { key: 'om:dashboard', label: 'Home', icon: LayoutDashboard },
      { key: 'om:scan_print', label: 'Cetak', icon: FileSpreadsheet },
      { key: 'om:scan_pack', label: 'Packing', icon: ScanBarcodeIcon },
      { key: 'om:scan_deliver', label: 'Kurir', icon: Truck },
    ];
    if (isOwner) items.push({ key: 'om:reports', label: 'Laporan', icon: History });
    return items;
  }
  return [];
}

// ---------- Mobile Shell (sticky header + drawer + per-module bottom nav) ----------
function MobileShell({ user, active, onNav, onLogout, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const labels = {
    'cc:dashboard': 'Realtime Monitor',
    'cc:tasks': 'My Tasks',
    'cc:import': 'Product Import',
    'cc:settings': 'Cycle Settings',
    'cc:history': 'Riwayat SKU',
    'mod:order_management': 'Order Management',
    'om:dashboard': 'OM Dashboard',
    'om:scan_print': 'Scan Cetak Resi',
    'om:scan_pack': 'Scan Mulai Packing',
    'om:scan_deliver': 'Scan Serah Terima',
    'om:reports': 'Laporan',
    'om:expeditions': 'Master Ekspedisi',
    'om:settings': 'Pengaturan OM',
    'ad:users': 'User Management',
  };
  const moduleLabels = {
    cycle_count: 'Cycle Count',
    order_management: 'Order Management',
  };
  const currentLabel = labels[active] || 'MIS';
  const activeModule = getActiveModule(active);
  const moduleSubtitle = moduleLabels[activeModule];

  const bottomItems = bottomNavForModule(activeModule, user);
  const showBottomNav = bottomItems.length > 0;
  const gridColsMap = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' };
  const gridCols = gridColsMap[bottomItems.length] || 'grid-cols-5';

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col">
      <header className="sticky top-0 z-40 bg-[#09090b]/95 backdrop-blur border-b border-white/5 pt-safe">
        <div className="flex items-center gap-3 px-4 h-14">
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-10 h-10 -ml-2 flex items-center justify-center rounded-lg hover:bg-white/5 active:bg-white/10 select-none-app"
            aria-label="Open menu"
          >
            <MenuIcon className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground leading-tight uppercase tracking-wider">
              {moduleSubtitle || 'MIS'}
            </div>
            <div className="font-semibold text-sm leading-tight truncate">{currentLabel}</div>
          </div>
          <button
            onClick={async () => {
              try {
                if ('serviceWorker' in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(regs.map((r) => r.unregister()));
                }
                if ('caches' in window) {
                  const keys = await caches.keys();
                  await Promise.all(keys.map((k) => caches.delete(k)));
                }
              } catch {}
              window.location.reload();
            }}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/5 active:bg-white/10"
            title="Force refresh (clear cache)"
            aria-label="Force refresh"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold select-none-app">
            {user.name[0]}
          </div>
        </div>
      </header>

      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-50 bg-black/60"
            />
            <motion.aside
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.22 }}
              className="fixed top-0 left-0 bottom-0 z-50 w-72 max-w-[85vw] bg-[#0a0a0c] border-r border-white/5 flex flex-col pt-safe overflow-y-auto"
            >
              <SidebarNav
                user={user}
                active={active}
                onNav={(k) => {
                  onNav(k);
                  setDrawerOpen(false);
                }}
                onLogout={() => {
                  setDrawerOpen(false);
                  onLogout();
                }}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main
        className={`flex-1 px-4 py-4 overflow-x-hidden ${
          showBottomNav ? 'pb-bottom-nav' : 'pb-8 pb-safe'
        }`}
      >
        {children}
      </main>

      {showBottomNav && (
        <nav className="fixed bottom-0 inset-x-0 z-30 bg-[#0a0a0c]/95 backdrop-blur-xl border-t border-white/5 pb-safe">
          <div className={`grid ${gridCols} h-16`}>
            {bottomItems.map((it) => {
              const Icon = it.icon;
              const isActive = active === it.key;
              return (
                <button
                  key={it.key}
                  onClick={() => onNav(it.key)}
                  className={`relative flex flex-col items-center justify-center gap-1 select-none-app transition ${
                    isActive ? 'text-blue-400' : 'text-muted-foreground active:text-white'
                  }`}
                >
                  {isActive && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-blue-400" />}
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{it.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

const MenuIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);
const ScanBarcodeIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 5v3M3 16v3M8 5v3M8 16v3M13 5v3M13 16v3M18 5v3M18 16v3" />
    <path d="M3 12h18" />
  </svg>
);


function MobileTopBar({ user, active, onNav, onLogout }) {
  const [open, setOpen] = useState(false);
  const labels = {
    dashboard: 'Dashboard',
    'cc:dashboard': 'Cycle Count · Monitor',
    'cc:tasks': 'Cycle Count · My Tasks',
    'cc:import': 'Cycle Count · Import',
    'cc:settings': 'Cycle Count · Settings',
    'cc:history': 'Cycle Count · Riwayat',
    'mod:order_management': 'Order Management',
    'om:dashboard': 'OM · Dashboard',
    'om:scan_pack': 'OM · Scan Packing',
    'om:scan_deliver': 'OM · Serah Terima',
    'om:reports': 'OM · Laporan',
    'om:expeditions': 'OM · Master Ekspedisi',
    'om:settings': 'OM · Pengaturan',
    'rp:history': 'Reports · Riwayat SKU',
    'ad:users': 'User Management',
  };
  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-[#0a0a0b]/95 backdrop-blur border-b border-white/5">
      <div className="flex items-center gap-3">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0 bg-[#0a0a0b] border-white/5">
            <SidebarNav
              user={user}
              active={active}
              onNav={onNav}
              onLogout={() => {
                setOpen(false);
                onLogout();
              }}
              onItemClick={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-black text-white text-[10px] tracking-tight">
            MIS
          </div>
          <div className="text-sm font-semibold truncate">{labels[active] || 'Merdeka Inventory'}</div>
        </div>
      </div>
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold">
        {user.name[0]}
      </div>
    </div>
  );
}

// ---------- Reusable animated stat card ----------
function StatCard({ icon: Icon, label, value, hint, tone = 'default', delay = 0 }) {
  const tones = {
    default: 'from-white/5 to-white/[0.02] border-white/10',
    blue: 'from-blue-500/20 to-blue-500/5 border-blue-500/30',
    green: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30',
    orange: 'from-orange-500/20 to-orange-500/5 border-orange-500/30',
    red: 'from-rose-500/20 to-rose-500/5 border-rose-500/30',
    purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/30',
  };
  const iconTones = {
    default: 'text-white',
    blue: 'text-blue-400',
    green: 'text-emerald-400',
    orange: 'text-orange-400',
    red: 'text-rose-400',
    purple: 'text-purple-400',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={`rounded-2xl border bg-gradient-to-br ${tones[tone]} p-5 relative overflow-hidden`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center ${iconTones[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground/70 mt-1">{hint}</div>}
    </motion.div>
  );
}

// ---------- Owner Dashboard ----------
function DashboardView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const d = await api('dashboard');
        if (alive) setData(d);
      } catch (e) {
        toast.error(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );
  }

  const t = data.today;

  function openMonitor() {
    window.open('/monitor', '_blank', 'noopener,noreferrer');
  }
  function openWidget() {
    // Popup sized for mini app on desktop
    window.open('/widget', 'MerdekaInventoryWidget', 'width=380,height=620,resizable=yes,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start md:items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">
            Realtime · {data.today.date} · {data.today.time} WITA
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={openMonitor} className="gap-2">
            <Monitor className="w-4 h-4" /> <span className="hidden sm:inline">Live Monitor</span>
            <ExternalLink className="w-3 h-3 opacity-60" />
          </Button>
          <Button variant="outline" size="sm" onClick={openWidget} className="gap-2 border-blue-500/40 text-blue-400 hover:bg-blue-500/10">
            <Sparkles className="w-4 h-4" /> <span className="hidden sm:inline">Launch Mini App</span>
            <span className="sm:hidden">Mini App</span>
          </Button>
          <Badge
            variant="outline"
            className={`gap-1.5 py-1.5 hidden md:inline-flex ${
              data.is_closed ? 'border-rose-500/40 text-rose-400' : 'border-emerald-500/30 text-emerald-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${data.is_closed ? 'bg-rose-400' : 'bg-emerald-400 animate-pulse'}`} />
            {data.is_closed ? 'Session Closed' : `Working ${data.working.start} – ${data.working.end} WITA`}
          </Badge>
        </div>
      </div>

      {data.is_closed && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-rose-300">Session ditutup otomatis</div>
            <div className="text-xs text-rose-300/70">
              Di luar jam kerja {data.working.start} – {data.working.end} WITA. Karyawan tidak bisa lagi mencentang tugas. Tugas yang belum selesai akan otomatis jadi backlog besok.
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Package} label="Total SKU" value={data.totals.totalSku.toLocaleString()} tone="default" delay={0} />
        <StatCard icon={Zap} label="Fast SKU" value={data.totals.fastSku.toLocaleString()} tone="orange" delay={0.05} />
        <StatCard icon={Gauge} label="Medium SKU" value={data.totals.mediumSku.toLocaleString()} tone="blue" delay={0.1} />
        <StatCard icon={Turtle} label="Slow SKU" value={data.totals.slowSku.toLocaleString()} tone="purple" delay={0.15} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Target} label="Today's Target" value={t.target} tone="blue" delay={0.05} />
        <StatCard icon={CheckCircle2} label="Completed Today" value={t.completed} tone="green" delay={0.1} />
        <StatCard icon={Circle} label="Remaining Today" value={t.remaining} tone="orange" delay={0.15} />
        <StatCard icon={History} label="Backlog" value={data.backlog} hint="dari hari sebelumnya" tone={data.backlog > 0 ? 'red' : 'default'} delay={0.2} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-1 rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-transparent p-6 flex flex-col justify-center items-center"
        >
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Today's Progress
          </div>
          <CircularProgress value={t.progressPct} />
          <div className="text-sm mt-4 text-muted-foreground">
            {t.completed} / {t.target} SKU selesai
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-semibold text-lg">Employee Progress</div>
              <div className="text-xs text-muted-foreground">Realtime</div>
            </div>
            <Activity className="w-5 h-5 text-blue-400" />
          </div>
          <div className="space-y-3">
            {data.employees.map((e, idx) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + idx * 0.03 }}
                className="flex items-center gap-2 sm:gap-4"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 flex items-center justify-center text-xs font-bold shrink-0">
                  {e.name[0]}
                </div>
                <div className="w-16 sm:w-24 shrink-0">
                  <div className="text-sm font-medium truncate">{e.name}</div>
                  <div className="text-[10px] text-muted-foreground">bobot {e.weight}%</div>
                </div>
                <div className="flex-1 relative h-2 rounded-full bg-white/5 overflow-hidden min-w-0">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${e.pct}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
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
                <div className="w-16 sm:w-32 text-right shrink-0">
                  {e.assigned === 0 && !e.logged_in ? (
                    <span className="text-[10px] sm:text-xs text-muted-foreground italic">Belum Login</span>
                  ) : (
                    <div className="text-sm font-semibold tabular-nums">
                      {e.pct}%
                      <span className="text-muted-foreground text-[10px] ml-1 sm:ml-2 hidden sm:inline">
                        {e.completed}/{e.assigned}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
            {data.employees.length === 0 && (
              <div className="text-center text-muted-foreground py-8 text-sm">
                Belum ada karyawan aktif
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function CircularProgress({ value }) {
  const radius = 70;
  const circ = 2 * Math.PI * radius;
  const dash = (value / 100) * circ;
  return (
    <div className="relative w-48 h-48 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={radius} stroke="hsl(217 32% 17%)" strokeWidth="12" fill="none" />
        <motion.circle
          cx="80"
          cy="80"
          r={radius}
          stroke="url(#grad)"
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - dash }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-bold tabular-nums">{value}%</div>
      </div>
    </div>
  );
}

// ---------- Shared SKU History Finder ----------
function SkuHistoryFinder({ compact = false }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingHist, setLoadingHist] = useState(false);

  // Debounced search
  useEffect(() => {
    if (!q.trim()) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const d = await api(`lookup?q=${encodeURIComponent(q)}`);
        setItems(d.items);
      } catch (e) {
        toast.error(e.message);
      } finally {
        setLoadingSearch(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  async function pickProduct(p) {
    setSelected(p);
    setLoadingHist(true);
    setHistory([]);
    try {
      const d = await api(`products/${encodeURIComponent(p.sku_code)}/history`);
      setHistory(d.history || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoadingHist(false);
    }
  }

  function reset() {
    setSelected(null);
    setHistory([]);
  }

  return (
    <div className="space-y-4">
      {/* Search box */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            reset();
          }}
          placeholder="Ketik kode SKU atau nama produk..."
          className="pl-9 h-11 text-base"
          autoFocus
        />
      </div>

      {/* Autocomplete suggestions */}
      {q && !selected && (
        <div className="rounded-lg border border-white/10 bg-[#0a0a0b] max-h-72 overflow-y-auto">
          {loadingSearch ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Mencari...
            </div>
          ) : items.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Tidak ada produk cocok</div>
          ) : (
            items.map((p) => (
              <button
                key={p.id}
                onClick={() => pickProduct(p)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/5 border-b border-white/5 last:border-0 transition"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium">{p.product_name}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{p.sku_code}</div>
                </div>
                <CategoryBadge cat={p.category} />
              </button>
            ))
          )}
        </div>
      )}

      {/* Selected product + history */}
      {selected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-white/10 bg-white/[0.02] p-5"
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="text-xs text-muted-foreground font-mono">{selected.sku_code}</div>
              <div className="text-xl font-bold mt-1">{selected.product_name}</div>
              <div className="mt-2 flex items-center gap-2">
                <CategoryBadge cat={selected.category} />
                <span className="text-xs text-muted-foreground">
                  {selected.last_counted_at
                    ? `Terakhir dihitung: ${new Date(selected.last_counted_at).toLocaleString('id-ID')}`
                    : 'Belum pernah dihitung'}
                </span>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Ganti
            </Button>
          </div>
          <Separator className="my-3" />
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Riwayat perhitungan
          </div>
          {loadingHist ? (
            <div className="text-center text-muted-foreground py-8 text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Memuat...
            </div>
          ) : history.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">
              Belum ada riwayat counting untuk SKU ini
            </div>
          ) : (
            <div className={`space-y-2 ${compact ? 'max-h-64 overflow-y-auto pr-1' : ''}`}>
              {history.map((h, idx) => {
                const dt = new Date(h.counted_at);
                return (
                  <motion.div
                    key={h.id}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5"
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 flex items-center justify-center text-xs font-bold shrink-0">
                      {h.employee_name?.[0] || '?'}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{h.employee_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}
                        {' · '}
                        {dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function HistoryView() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Riwayat SKU</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-1">
          Cari kode SKU atau nama produk untuk melihat siapa saja yang pernah menghitungnya
        </p>
      </div>
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6">
          <SkuHistoryFinder />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Product Import ----------
function ImportView() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState({ items: [], total: 0 });
  const [loadingList, setLoadingList] = useState(false);
  const [historyModal, setHistoryModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoadingList(true);
    api(`products?search=${encodeURIComponent(search)}&limit=100`)
      .then((d) => {
        if (alive) setProducts(d);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => alive && setLoadingList(false));
    return () => {
      alive = false;
    };
  }, [search, refreshKey]);

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api('products/import', { method: 'POST', body: fd });
      setResult(r);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      toast.success(`Import selesai · ${r.inserted} baru, ${r.updated} update`);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function openHistory(sku) {
    try {
      const d = await api(`products/${encodeURIComponent(sku)}/history`);
      setHistoryModal(d);
    } catch (e) {
      toast.error(e.message);
    }
  }

  function downloadTemplate() {
    const csv = 'SKU Code,Product Name,Category\nPRD00001,Paracetamol 500mg,FAST\nPRD00002,Amoxicillin 500mg,MEDIUM\nPRD00003,Insulin,SLOW\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cycle_count_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const [resetting, setResetting] = useState(false);
  async function resetAll() {
    if (!confirm('Yakin hapus SEMUA produk, tugas hari ini, dan riwayat counting?\n\nAksi ini tidak bisa dibatalkan.')) return;
    setResetting(true);
    try {
      const r = await api('products/reset', { method: 'POST' });
      toast.success(`Reset selesai · ${r.deleted.products} produk, ${r.deleted.daily_tasks} tugas, ${r.deleted.sku_history} riwayat dihapus`);
      setResult(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Product Import</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-1">
          Upload Excel/CSV: <span className="text-white">SKU Code</span>, <span className="text-white">Product Name</span>, <span className="text-white">Category</span> (FAST/MEDIUM/SLOW)
        </p>
      </div>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1 w-full">
              <Label className="mb-2 block">File Excel / CSV</Label>
              <Input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upload} disabled={!file || uploading} className="gap-2 flex-1 md:flex-none">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import
              </Button>
              <Button variant="outline" onClick={downloadTemplate} className="gap-2 flex-1 md:flex-none">
                <FileSpreadsheet className="w-4 h-4" />
                <span className="hidden sm:inline">Template</span> CSV
              </Button>
              <Button
                variant="outline"
                onClick={resetAll}
                disabled={resetting}
                className="gap-2 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 flex-1 md:flex-none"
              >
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Reset <span className="hidden sm:inline">Semua</span>
              </Button>
            </div>
          </div>

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3"
            >
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div className="text-2xl font-bold text-emerald-400">{result.inserted}</div>
                <div className="text-xs text-muted-foreground">Ditambahkan</div>
              </div>
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <div className="text-2xl font-bold text-blue-400">{result.updated}</div>
                <div className="text-xs text-muted-foreground">Diupdate</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-2xl font-bold">{result.valid_rows}</div>
                <div className="text-xs text-muted-foreground">Baris valid</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-2xl font-bold">{result.total_rows}</div>
                <div className="text-xs text-muted-foreground">Total baris file</div>
              </div>
            </motion.div>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Daftar Produk</CardTitle>
              <CardDescription>{products.total.toLocaleString()} SKU terdaftar</CardDescription>
            </div>
            <div className="relative w-full md:max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari SKU / nama..."
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded" />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-white/5 overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="bg-white/[0.03] text-muted-foreground text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-2">SKU</th>
                    <th className="text-left px-4 py-2">Nama Produk</th>
                    <th className="text-left px-4 py-2">Kategori</th>
                    <th className="text-left px-4 py-2 hidden md:table-cell">Last Counted</th>
                    <th className="text-right px-4 py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {products.items.map((p) => (
                    <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-2 font-mono text-xs">{p.sku_code}</td>
                      <td className="px-4 py-2">{p.product_name}</td>
                      <td className="px-4 py-2">
                        <CategoryBadge cat={p.category} />
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground hidden md:table-cell">
                        {p.last_counted_at ? new Date(p.last_counted_at).toLocaleString('id-ID') : '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => openHistory(p.sku_code)} className="gap-1.5">
                          <History className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Riwayat</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {products.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        Tidak ada produk
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!historyModal} onOpenChange={(o) => !o && setHistoryModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{historyModal?.product?.product_name}</DialogTitle>
            <CardDescription className="font-mono">{historyModal?.product?.sku_code}</CardDescription>
          </DialogHeader>
          <ScrollArea className="max-h-96">
            <div className="space-y-2">
              {(historyModal?.history || []).map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between text-sm p-3 rounded-lg bg-white/[0.03] border border-white/5"
                >
                  <div>
                    <div className="font-medium">{h.employee_name}</div>
                    <div className="text-xs text-muted-foreground">{new Date(h.counted_at).toLocaleString('id-ID')}</div>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
              ))}
              {(!historyModal?.history || historyModal.history.length === 0) && (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  Belum ada riwayat counting
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryBadge({ cat }) {
  const map = {
    FAST: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    MEDIUM: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    SLOW: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${map[cat] || ''}`}>
      {cat}
    </span>
  );
}

// ---------- User Management (formerly Employees) ----------
function EmployeesView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await api('employees');
      setItems(d.items);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function del(id) {
    if (!confirm('Hapus user ini?')) return;
    try {
      await api(`employees/${id}`, { method: 'DELETE' });
      toast.success('User dihapus');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  }

  const roleBadge = (role) => {
    if (role === 'owner') return <Badge variant="outline" className="border-purple-500/40 text-purple-400 text-[10px]">OWNER</Badge>;
    if (role === 'supervisor') return <Badge variant="outline" className="border-cyan-500/40 text-cyan-400 text-[10px]">SUPERVISOR</Badge>;
    return <Badge variant="outline" className="border-white/20 text-muted-foreground text-[10px]">STAFF</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">Kelola user, role, bobot kerja & permission per module</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="gap-2"
          size="sm"
        >
          <Plus className="w-4 h-4" /> Tambah <span className="hidden sm:inline">User</span>
        </Button>
      </div>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((e, idx) => (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-white/5 hover:bg-white/[0.02]"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 flex items-center justify-center font-bold">
                    {e.name[0]}
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold">{e.name}</div>
                      {roleBadge(e.role)}
                      {e.status === 'inactive' && (
                        <Badge variant="outline" className="border-rose-500/40 text-rose-400 text-[10px]">
                          NON-AKTIF
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">@{e.username}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {(Array.isArray(e.modules) ? e.modules : []).map((mk) => (
                        <Badge
                          key={mk}
                          variant="outline"
                          className="text-[9px] py-0 h-4 border-blue-500/40 text-blue-300"
                        >
                          {MODULES_META[mk]?.name || mk}
                        </Badge>
                      ))}
                      {e.role === 'owner' && (
                        <Badge variant="outline" className="text-[9px] py-0 h-4 border-purple-500/40 text-purple-300">
                          ALL MODULES
                        </Badge>
                      )}
                      {e.role !== 'owner' && (!Array.isArray(e.modules) || e.modules.length === 0) && (
                        <Badge variant="outline" className="text-[9px] py-0 h-4 border-rose-500/40 text-rose-300">
                          NO ACCESS
                        </Badge>
                      )}
                    </div>
                  </div>
                  {e.role !== 'owner' && (
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Bobot</div>
                      <div className="font-semibold tabular-nums">{e.weight}%</div>
                    </div>
                  )}
                  {e.role !== 'owner' && (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(e);
                          setShowForm(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => del(e.id)}
                        className="text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <EmployeeForm
        open={showForm}
        onClose={() => setShowForm(false)}
        editing={editing}
        onSaved={() => {
          setShowForm(false);
          load();
        }}
      />
    </div>
  );
}

function EmployeeForm({ open, onClose, editing, onSaved }) {
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    weight: 100,
    status: 'active',
    role: 'staff',
    modules: ['cycle_count'],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              name: editing.name,
              username: editing.username,
              password: '',
              weight: editing.weight,
              status: editing.status,
              role: editing.role === 'owner' ? 'owner' : editing.role || 'staff',
              modules: Array.isArray(editing.modules) ? editing.modules : ['cycle_count'],
            }
          : { name: '', username: '', password: '', weight: 100, status: 'active', role: 'staff', modules: ['cycle_count'] }
      );
    }
  }, [open, editing]);

  function toggleModule(key) {
    setForm((f) => {
      const has = f.modules.includes(key);
      return { ...f, modules: has ? f.modules.filter((m) => m !== key) : [...f.modules, key] };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        // Cannot change role of owner via API — server enforces too
        if (editing.role === 'owner') {
          delete payload.role;
          delete payload.modules;
        }
        await api(`employees/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('User diperbarui');
      } else {
        await api('employees', { method: 'POST', body: JSON.stringify(form) });
        toast.success('User ditambahkan');
      }
      onSaved();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const isOwnerEdit = editing?.role === 'owner';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit User' : 'User Baru'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nama</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Password {editing && <span className="text-xs text-muted-foreground">(kosongkan bila tidak diubah)</span>}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!editing}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              {isOwnerEdit ? (
                <Input value="Owner" disabled />
              ) : (
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Bobot (%)</Label>
              <Input
                type="number"
                min={0}
                max={500}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="inactive">Non-aktif</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isOwnerEdit && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" />
                <Label className="text-sm font-semibold">Permission Modules</Label>
              </div>
              <div className="text-xs text-muted-foreground -mt-1">
                Centang module yang boleh diakses user ini.
              </div>
              <div className="space-y-2 pt-1">
                {Object.values(MODULES_META).map((m) => {
                  const Icon = m.icon;
                  const checked = form.modules.includes(m.key);
                  const disabled = m.status === 'coming_soon';
                  return (
                    <label
                      key={m.key}
                      className={`flex items-center gap-3 p-2.5 rounded-md border transition cursor-pointer ${
                        checked
                          ? 'border-blue-500/40 bg-blue-500/10'
                          : 'border-white/10 hover:bg-white/[0.03]'
                      } ${disabled ? 'opacity-60' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleModule(m.key)}
                        className="w-4 h-4 rounded accent-blue-500"
                      />
                      <Icon className="w-4 h-4 text-blue-400" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{m.name}</div>
                      </div>
                      {m.status === 'coming_soon' && (
                        <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-500/40 text-amber-400">
                          Soon
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Settings ----------
function SettingsView() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ fast_interval_days: 7, medium_interval_days: 15, slow_interval_days: 30, working_start: '07:00', working_end: '22:00' });
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function load() {
    try {
      const d = await api('settings');
      setData(d);
      setForm({
        fast_interval_days: d.settings.fast_interval_days || 7,
        medium_interval_days: d.settings.medium_interval_days || 15,
        slow_interval_days: d.settings.slow_interval_days || 30,
        working_start: d.settings.working_start,
        working_end: d.settings.working_end,
      });
    } catch (e) {
      toast.error(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const preview = useMemo(() => {
    if (!data) return null;
    const fast = data.breakdown.fast.total;
    const medium = data.breakdown.medium.total;
    const slow = data.breakdown.slow.total;
    const dFast = Math.round(fast / Math.max(1, form.fast_interval_days));
    const dMedium = Math.round(medium / Math.max(1, form.medium_interval_days));
    const dSlow = Math.round(slow / Math.max(1, form.slow_interval_days));
    return { fast, medium, slow, dFast, dMedium, dSlow, total: dFast + dMedium + dSlow };
  }, [data, form]);

  async function save() {
    setSaving(true);
    try {
      await api('settings', { method: 'PUT', body: JSON.stringify(form) });
      toast.success('Setting disimpan');
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const r = await api('tasks/generate', { method: 'POST', body: JSON.stringify({ force: true }) });
      toast.success(`Tugas dibuat ulang: ${r.created || 0} SKU`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRegenerating(false);
    }
  }

  if (!data) return <Skeleton className="h-96 rounded-2xl" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Cycle Count Settings</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-1">Atur interval per kategori & jam kerja</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <CardTitle>Interval Counting</CardTitle>
            <CardDescription>Setiap berapa hari tiap kategori dihitung ulang</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: 'fast_interval_days', label: 'FAST', hint: 'mis. 7 hari' },
              { key: 'medium_interval_days', label: 'MEDIUM', hint: 'mis. 15 hari' },
              { key: 'slow_interval_days', label: 'SLOW', hint: 'mis. 30 hari' },
            ].map((c) => (
              <div key={c.key} className="flex items-center gap-4">
                <CategoryBadge cat={c.label} />
                <div className="text-xs text-muted-foreground w-16">setiap</div>
                <div className="flex-1">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={form[c.key]}
                    onChange={(e) => setForm({ ...form, [c.key]: Number(e.target.value) })}
                  />
                </div>
                <div className="text-xs text-muted-foreground w-20">hari</div>
              </div>
            ))}
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Jam Mulai (WITA)</Label>
                <Input value={form.working_start} onChange={(e) => setForm({ ...form, working_start: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Jam Selesai (WITA)</Label>
                <Input value={form.working_end} onChange={(e) => setForm({ ...form, working_end: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving} className="flex-1">
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Simpan Setting
              </Button>
              <Button variant="outline" onClick={regenerate} disabled={regenerating} className="gap-2">
                {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Regenerate
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-gradient-to-br from-blue-500/10 to-purple-500/5">
          <CardHeader>
            <CardTitle>Estimasi Daily Target</CardTitle>
            <CardDescription>Preview otomatis berdasarkan setting</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-6xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
              {preview?.total ?? 0}
            </div>
            <div className="text-sm text-muted-foreground">SKU harus dihitung setiap hari</div>
            <Separator />
            <div className="space-y-3">
              <PreviewRow label="FAST" total={preview?.fast || 0} daily={preview?.dFast || 0} days={form.fast_interval_days} />
              <PreviewRow label="MEDIUM" total={preview?.medium || 0} daily={preview?.dMedium || 0} days={form.medium_interval_days} />
              <PreviewRow label="SLOW" total={preview?.slow || 0} daily={preview?.dSlow || 0} days={form.slow_interval_days} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PreviewRow({ label, total, daily, days }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <CategoryBadge cat={label} />
      <div className="text-xs text-muted-foreground flex-1 text-center">
        {total.toLocaleString()} SKU · tiap {days} hari
      </div>
      <div className="text-sm font-semibold tabular-nums">→ {daily} / hari</div>
    </div>
  );
}

// ---------- Module: Order Management (Coming Soon placeholder) ----------
function OrderManagementView() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Order Management</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-1">
          Module 2 · Manajemen pesanan pembelian & penjualan
        </p>
      </div>

      <Card className="border-white/10 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-transparent overflow-hidden">
        <CardContent className="py-16 flex flex-col items-center text-center gap-4 relative">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] rounded-full bg-amber-500/10 blur-[100px]" />
          </div>
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/30 to-orange-500/20 border border-amber-500/30 flex items-center justify-center relative">
            <ShoppingCart className="w-10 h-10 text-amber-400" />
          </div>
          <div className="relative">
            <Badge variant="outline" className="border-amber-500/40 text-amber-400 mb-3">
              COMING SOON
            </Badge>
            <div className="text-2xl font-bold tracking-tight">Order Management</div>
            <div className="text-sm text-muted-foreground max-w-md mt-2">
              Module ini akan menangani purchase order, sales order, dan tracking pesanan.
              Belum tersedia — akan segera diaktifkan setelah module Cycle Count stabil di produksi.
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl w-full relative">
            {[
              { icon: FileSpreadsheet, label: 'PO / SO Entry' },
              { icon: Activity, label: 'Order Tracking' },
              { icon: BarChart3, label: 'Sales Report' },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.label} className="p-3 rounded-lg border border-white/5 bg-white/[0.02] text-xs text-muted-foreground flex items-center gap-2">
                  <Icon className="w-4 h-4 text-amber-400/60" />
                  {f.label}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MasterDataProductsView() {
  // Reuse the ImportView which already handles product list + import
  return <ImportView />;
}

function ReportsHistoryView() {
  // Reuse the HistoryView
  return <HistoryView />;
}

function NoAccessView({ user }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="border-white/10 bg-white/[0.02] max-w-md w-full">
        <CardContent className="py-10 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7 text-rose-400" />
          </div>
          <div className="text-lg font-semibold">Tidak ada akses module</div>
          <div className="text-sm text-muted-foreground mt-2">
            Halo <span className="text-white">{user?.name}</span>, akun Anda belum memiliki akses ke module apapun.
            Silakan hubungi Owner / Admin untuk mengaktifkan permission.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Landing view for Cycle Count module link (auto-routes to a sensible default)
function CycleCountLandingView({ user, onNav }) {
  useEffect(() => {
    // Auto-redirect to a proper sub-view based on role
    const target = isAdminRole(user) ? 'cc:dashboard' : 'cc:tasks';
    onNav(target);
  }, [user, onNav]);
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// Extract staff tasks content so it can render inside AppShell for cc:tasks view
function StaffTasksView({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(new Set());
  const [showHistory, setShowHistory] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const d = await api('tasks/mine');
      setData(d);
    } catch (e) {
      toast.error(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, []);

  async function toggle(task) {
    const action = task.completed ? 'uncomplete' : 'complete';
    setPending((p) => new Set(p).add(task.id));
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)),
    }));
    try {
      await api(`tasks/${task.id}/${action}`, { method: 'POST' });
    } catch (e) {
      toast.error(e.message);
      load(true);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(task.id);
        return n;
      });
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const tasks = data?.tasks || [];
  const completed = tasks.filter((t) => t.completed).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Halo,</div>
          <h1 className="text-2xl font-bold">{user.name}</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowHistory(true)}
          className="gap-2"
        >
          <History className="w-4 h-4" /> <span className="hidden sm:inline">Riwayat SKU</span>
        </Button>
      </div>

      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cari Riwayat SKU</DialogTitle>
            <div className="text-xs text-muted-foreground">
              Masukkan kode SKU atau nama produk untuk melihat siapa saja yang pernah menghitung
            </div>
          </DialogHeader>
          <SkuHistoryFinder compact />
        </DialogContent>
      </Dialog>

      {data?.is_closed && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-center gap-3 text-sm"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <div>
            <div className="font-semibold text-rose-300">Session sudah ditutup</div>
            <div className="text-xs text-rose-300/70">
              Di luar jam kerja {data?.working?.start} – {data?.working?.end} WITA. Centang SKU baru bisa besok.
            </div>
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-transparent p-4 sm:p-6 flex flex-col sm:flex-row items-center gap-4 sm:gap-6"
      >
        <CircularProgress value={pct} />
        <div className="text-center sm:text-left">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Today&apos;s Progress</div>
          <div className="text-3xl sm:text-4xl font-bold mt-1 tabular-nums">
            {completed} / {total}
          </div>
          <div className="text-sm text-muted-foreground mt-1">SKU Completed</div>
          <div className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5 justify-center sm:justify-start">
            <Clock className="w-3 h-3" /> {data.date} · {data.time} WITA
          </div>
        </div>
      </motion.div>

      {total === 0 ? (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="py-16 text-center">
            <Sparkles className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
            <div className="font-semibold">Tidak ada tugas hari ini</div>
            <div className="text-xs text-muted-foreground mt-1">Nikmati harimu</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {tasks.map((t, idx) => {
              const busy = pending.has(t.id);
              return (
                <motion.button
                  key={t.id}
                  onClick={() => toggle(t)}
                  disabled={busy}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition ${
                    t.completed
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="shrink-0">
                    {t.completed ? (
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                        <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                      </motion.div>
                    ) : (
                      <Circle className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-xs text-muted-foreground">{t.sku_code}</div>
                      {t.is_backlog && (
                        <Badge variant="outline" className="border-rose-500/40 text-rose-400 text-[9px] py-0">
                          BACKLOG
                        </Badge>
                      )}
                      <CategoryBadge cat={t.category} />
                    </div>
                    <div className={`font-medium mt-0.5 ${t.completed ? 'line-through text-muted-foreground' : ''}`}>
                      {t.product_name}
                    </div>
                  </div>
                  {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ---------- Staff View ----------
function StaffScreen({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(new Set());
  const [showHistory, setShowHistory] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const d = await api('tasks/mine');
      setData(d);
    } catch (e) {
      toast.error(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, []);

  async function toggle(task) {
    const action = task.completed ? 'uncomplete' : 'complete';
    setPending((p) => new Set(p).add(task.id));
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)),
    }));
    try {
      await api(`tasks/${task.id}/${action}`, { method: 'POST' });
    } catch (e) {
      toast.error(e.message);
      load(true);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(task.id);
        return n;
      });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen p-6 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const tasks = data?.tasks || [];
  const completed = tasks.filter((t) => t.completed).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#09090b] relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full bg-blue-500/5 blur-[100px]" />
      </div>

      <div className="max-w-2xl mx-auto p-6 relative">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-muted-foreground">Halo,</div>
            <h1 className="text-2xl font-bold">{user.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory(true)}
              className="gap-2"
            >
              <History className="w-4 h-4" /> Riwayat SKU
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogout} className="gap-2 text-muted-foreground">
              <LogOut className="w-4 h-4" /> Keluar
            </Button>
          </div>
        </div>

        <Dialog open={showHistory} onOpenChange={setShowHistory}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Cari Riwayat SKU</DialogTitle>
              <div className="text-xs text-muted-foreground">
                Masukkan kode SKU atau nama produk untuk melihat siapa saja yang pernah menghitung
              </div>
            </DialogHeader>
            <SkuHistoryFinder compact />
          </DialogContent>
        </Dialog>

        {data?.is_closed && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-center gap-3 text-sm"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <div>
              <div className="font-semibold text-rose-300">Session sudah ditutup</div>
              <div className="text-xs text-rose-300/70">
                Di luar jam kerja {data?.working?.start} – {data?.working?.end} WITA. Centang SKU baru bisa besok.
              </div>
            </div>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-transparent p-4 sm:p-6 mb-6 flex flex-col sm:flex-row items-center gap-4 sm:gap-6"
        >
          <CircularProgress value={pct} />
          <div className="text-center sm:text-left">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Today&apos;s Progress</div>
            <div className="text-3xl sm:text-4xl font-bold mt-1 tabular-nums">
              {completed} / {total}
            </div>
            <div className="text-sm text-muted-foreground mt-1">SKU Completed</div>
            <div className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5 justify-center sm:justify-start">
              <Clock className="w-3 h-3" /> {data.date} · {data.time} WITA
            </div>
          </div>
        </motion.div>

        {total === 0 ? (
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="py-16 text-center">
              <Sparkles className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
              <div className="font-semibold">Tidak ada tugas hari ini</div>
              <div className="text-xs text-muted-foreground mt-1">Nikmati harimu</div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {tasks.map((t, idx) => {
                const busy = pending.has(t.id);
                return (
                  <motion.button
                    key={t.id}
                    onClick={() => toggle(t)}
                    disabled={busy}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition ${
                      t.completed
                        ? 'bg-emerald-500/5 border-emerald-500/20'
                        : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="shrink-0">
                      {t.completed ? (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                        </motion.div>
                      ) : (
                        <Circle className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <div className="font-mono text-xs text-muted-foreground">{t.sku_code}</div>
                        {t.is_backlog && (
                          <Badge variant="outline" className="border-rose-500/40 text-rose-400 text-[9px] py-0">
                            BACKLOG
                          </Badge>
                        )}
                        <CategoryBadge cat={t.category} />
                      </div>
                      <div className={`font-medium mt-0.5 ${t.completed ? 'line-through text-muted-foreground' : ''}`}>
                        {t.product_name}
                      </div>
                    </div>
                    {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Root App ----------
function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState('dashboard');

  useEffect(() => {
    const token = localStorage.getItem('cc_token');
    if (!token) {
      setChecking(false);
      return;
    }
    api('auth/me')
      .then((d) => {
        setUser(d.user);
        setView(getDefaultView(d.user));
      })
      .catch(() => localStorage.removeItem('cc_token'))
      .finally(() => setChecking(false));
  }, []);

  function handleLogin(u) {
    setUser(u);
    setView(getDefaultView(u));
  }

  async function logout() {
    try {
      await api('auth/logout', { method: 'POST' });
    } catch {}
    localStorage.removeItem('cc_token');
    setUser(null);
    setView('dashboard');
  }

  // Guard the current view against permissions (in case user or perms changed)
  function canView(key) {
    if (!user) return false;
    // Flatten allowed nav items
    const flat = [];
    for (const s of buildNav(user)) {
      for (const it of s.items) {
        if (it.children) it.children.forEach((c) => flat.push(c.key));
        else flat.push(it.key);
      }
    }
    return flat.includes(key);
  }

  function safeNav(key) {
    if (canView(key)) setView(key);
    else toast.error('Anda tidak memiliki akses ke halaman ini');
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // Preserve original workflow: staff with ONLY cycle_count access -> keep StaffScreen
  const mods = userModules(user);
  if (
    user.role === 'staff' &&
    mods.length === 1 &&
    mods[0] === 'cycle_count'
  ) {
    return <StaffScreen user={user} onLogout={logout} />;
  }

  // No access at all
  if (mods.length === 0 && user.role !== 'owner') {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-black text-white text-[10px] tracking-tight">
              MIS
            </div>
            <div className="text-sm font-semibold">Merdeka Inventory System</div>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="gap-2">
            <LogOut className="w-4 h-4" /> Keluar
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <NoAccessView user={user} />
        </div>
      </div>
    );
  }

  // Default: full AppShell with modular sidebar
  const currentAllowed = canView(view);
  const activeView = currentAllowed ? view : getDefaultView(user);

  const content = (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeView}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
      >
        {activeView === 'dashboard' && <DashboardView />}
        {activeView === 'cc:dashboard' && <DashboardView />}
        {activeView === 'cc:tasks' && <StaffTasksView user={user} />}
        {activeView === 'cc:import' && <ImportView />}
        {activeView === 'cc:settings' && <SettingsView />}
        {activeView === 'cc:history' && <HistoryView />}
        {activeView.startsWith('om:') && (
          <OrderManagementModule view={activeView} user={user} />
        )}
        {activeView === 'mod:order_management' && (
          <OrderManagementModule view="om:dashboard" user={user} />
        )}
        {activeView === 'rp:history' && <ReportsHistoryView />}
        {activeView === 'ad:users' && <EmployeesView />}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <>
      {/* Desktop: sidebar + main */}
      <div className="hidden md:flex min-h-screen bg-[#09090b]">
        <Sidebar user={user} active={activeView} onNav={safeNav} onLogout={logout} />
        <main className="flex-1 p-8 overflow-x-hidden min-w-0">
          {content}
        </main>
      </div>

      {/* Mobile: sticky header + drawer + bottom nav */}
      <div className="md:hidden">
        <MobileShell user={user} active={activeView} onNav={safeNav} onLogout={logout}>
          {content}
        </MobileShell>
      </div>
    </>
  );
}

export default App;
