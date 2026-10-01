import { Suspense } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import './mvp.css';
import AppShell from '../components/app-shell';
import ServiceWorkerRegistration from '../components/service-worker-registration';

export const metadata: Metadata = {
  title: 'ГУУЛИНГИЙНХАН — Ургийн мод',
  description: 'Монгол гэр бүлийн ургийн мод, намтар, түүх, дурсамж.',
  applicationName: 'Гуулингийнхан',
  appleWebApp: { capable: true, title: 'Гуулингийнхан', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="mn">
      <body>
        <ServiceWorkerRegistration />
        <Suspense fallback={children}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
