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

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('guulin-theme');if(t==='parchment'||t==='mauve'||t==='deep-purple'||t==='emerald'||t==='obsidian'){document.documentElement.setAttribute('data-theme',t);}else{document.documentElement.setAttribute('data-theme','parchment');}}catch(e){}})();`;

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
