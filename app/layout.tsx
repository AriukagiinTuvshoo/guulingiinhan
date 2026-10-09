import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import './typography.css';
import './mvp.css';
import './profile/profile.css';
import './tree-3d.css';
import './family-map.css';
import './mobile-polish.css';
import './discovery.css';
import './mobile-shell.css';
import AppShell from '../components/app-shell';
import { InstallAppProvider } from '../components/install-app';

export const metadata: Metadata = {
  title: 'ГУУЛИНГИЙНХАН — Ургийн мод',
  description: 'Монгол гэр бүлийн ургийн мод, намтар, түүх, дурсамж.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Гуулингийнхан' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#103c2e' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="mn">
      <body>
        <Suspense fallback={<div role="status">Ачаалж байна…</div>}>
          <InstallAppProvider><AppShell>{children}</AppShell></InstallAppProvider>
        </Suspense>
      </body>
    </html>
  );
}
