import './globals.css'
import { Providers } from './providers'
import { Toaster } from 'sonner'

export const metadata = {
  title: 'Merdeka Share',
  description: 'Merdeka Inventory System — Share PDF · Cycle Count · Order Management',
  applicationName: 'Merdeka Share',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Merdeka Share',
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
        <meta name="theme-color" content="#09090b" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MIS" />
        {/* Prefer real PNG icons over inline data-URIs — iOS Safari can be
            flaky about rendering data:image/svg+xml apple-touch-icons, which
            was leaving the home-screen icon blank/white for some users. Point
            to the same PNG assets the Android manifest uses so the branding
            is consistent across platforms. */}
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/mis-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icons/mis-512.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/mis-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icons/mis-512.png" />
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
