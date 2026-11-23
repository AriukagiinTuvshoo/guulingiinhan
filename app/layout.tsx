import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { Lora, Noto_Sans } from 'next/font/google';
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
import './heritage-theme-sync.css';
import AppShell from '../components/app-shell';
import { InstallAppProvider } from '../components/install-app';
import { FloatingThemeCorner } from '../components/theme-picker';
import { BRAND_THEME_COLOR } from '../lib/theme-tokens';

const lora = Lora({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-lora',
  display: 'swap',
});

const notoSans = Noto_Sans({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-sans',
  display: 'swap',
});

const THEME_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem('guulin-theme');var map={light:'mutuu',dark:'khush',parchment:'mutuu',emerald:'taiga',obsidian:'khush',mauve:'mutuu','deep-purple':'khush'};var t=map[raw]||raw;if(t!=='mutuu'&&t!=='khush'&&t!=='taiga'&&t!=='kheer'){t='mutuu';}document.documentElement.setAttribute('data-theme',t);if(raw&&map[raw]){localStorage.setItem('guulin-theme',t);}}catch(e){document.documentElement.setAttribute('data-theme','mutuu');}})();`;

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
    <html lang="mn" className={`${lora.variable} ${notoSans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Suspense fallback={<div role="status">Ачаалж байна…</div>}>
          <InstallAppProvider>
            <AppShell>{children}</AppShell>
            <FloatingThemeCorner />
          </InstallAppProvider>
        </Suspense>
      </body>
    </html>
  );
}
