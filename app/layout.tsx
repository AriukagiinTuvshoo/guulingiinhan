import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { Noto_Serif, Philosopher } from 'next/font/google';
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
import './mongol-heritage-theme.css';
import AppShell from '../components/app-shell';
import { InstallAppProvider } from '../components/install-app';
import { BRAND_THEME_COLOR } from '../lib/theme-tokens';

const philosopher = Philosopher({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-philosopher',
  display: 'swap',
});

const notoSerif = Noto_Serif({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-noto-serif',
  display: 'swap',
});

const THEME_INIT_SCRIPT = `(function(){try{var valid={mn:1,blue:1,ger:1,dark:1,paper:1};var raw=localStorage.getItem('gth')||localStorage.getItem('guulin-theme')||'mn';var th=valid[raw]?raw:(raw==='dark'||raw==='obsidian'||raw==='deep-purple'||raw==='khush'?'dark':'mn');document.documentElement.dataset.th=th;document.documentElement.setAttribute('data-theme',th==='dark'?'dark':'light');}catch(e){document.documentElement.dataset.th='mn';document.documentElement.setAttribute('data-theme','light');}})();`;

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
    <html
      lang="mn"
      className={`${philosopher.variable} ${notoSerif.variable}`}
      suppressHydrationWarning
    >
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
