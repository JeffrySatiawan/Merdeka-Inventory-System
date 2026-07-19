import './globals.css'
import { Providers } from './providers'
import { Toaster } from 'sonner'

export const metadata = {
  title: 'CycleCount — Pharmacy',
  description: 'Modern pharmacy cycle count management',
}

export default function RootLayout({ children }) {
  return (
    <html lang="id" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  )
}
