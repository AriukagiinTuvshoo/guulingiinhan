import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import './tokens.css';
import './globals.css';
import './turshilt-design.css';
import './typography.css';
import './mvp.css';
import './profile/profile.css';
import './tree-3d.css';
import './family-map.css';
import './mobile-polish.css';
import './discovery.css';
import './mobile-shell.css';
import './editorial-polish.css';
import AppShell from '../components/app-shell';
import { InstallAppProvider } from '../components/install-app';
import { BRAND_THEME_COLOR } from '../lib/theme-tokens';

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('guulin-theme');var next=(t==='dark'||t==='obsidian'||t==='deep-purple'||t==='emerald')?'dark':'light';document.documentElement.setAttribute('data-theme',next);if(t&&t!==next){localStorage.setItem('guulin-theme',next);}}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export const metadata: Metadata = {
  title: 'ГУУЛИНГИЙНХАН — Ургийн мод',
  description: 'Монгол гэр бүлийн ургийн мод, намтар, түүх, дурсамж.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Гуулингийнхан' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: BRAND_THEME_COLOR,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="mn" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Suspense fallback={<div role="status">Ачаалж байна…</div>}>
          <InstallAppProvider><AppShell>{children}</AppShell></InstallAppProvider>
        </Suspense>
      </body>
    </html>
  );
}
