import ShareManifestSwapper from './ShareManifestSwapper';

export const metadata = {
  title: 'Merdeka Share',
  description: 'Share PDF resi ke Merdeka Inventory System',
  applicationName: 'Merdeka Share',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Merdeka Share',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
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
  return (
    <>
      <ShareManifestSwapper />
      {children}
    </>
  );
}
