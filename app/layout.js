import './globals.css'
import { Providers } from './providers'
import { Toaster } from 'sonner'

export const metadata = {
  title: 'Merdeka Inventory System',
  description: 'Merdeka Inventory System — Cycle Count & Order Management',
  applicationName: 'MIS',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MIS',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

const swRegister = `
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      // Check for updates every 30s while app is open
      setInterval(function(){ try { reg.update(); } catch(e){} }, 30000);
      // When new worker takes control, reload to get fresh HTML/JS
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function(){
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }).catch(function(){});
  });
}
`;

export default function RootLayout({ children }) {
  return (
    <html lang="id" className="dark" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#09090b" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MIS" />
        <link
          rel="apple-touch-icon"
          href="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%233b82f6'/%3E%3Cstop offset='1' stop-color='%23a855f7'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='512' height='512' rx='96' fill='url(%23g)'/%3E%3Ctext x='256' y='330' text-anchor='middle' font-family='Inter,Arial,sans-serif' font-size='190' font-weight='800' fill='white' letter-spacing='-4'%3EMIS%3C/text%3E%3C/svg%3E"
        />
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
        <script dangerouslySetInnerHTML={{ __html: swRegister }} />
      </head>
      <body className="bg-background text-foreground antialiased overscroll-y-none">
        <Providers>{children}</Providers>
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </body>
    </html>
  )
}
