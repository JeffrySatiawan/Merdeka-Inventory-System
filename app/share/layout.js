// /share is now a sub-route of the single unified PWA (Merdeka Share).
// No separate manifest — the root layout's dynamic manifest at /manifest.webmanifest applies.

export const metadata = {
  title: 'Merdeka Share',
  description: 'Share PDF resi ke Merdeka Inventory System',
};

export const viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function ShareLayout({ children }) {
  return <>{children}</>;
}
