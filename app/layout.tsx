import { Suspense } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import './mvp.css';
import './profile/profile.css';
import AppShell from '../components/app-shell';

export const metadata: Metadata = {
  title: 'ГУУЛИНГИЙНХАН — Ургийн мод',
  description: 'Монгол гэр бүлийн ургийн мод, намтар, түүх, дурсамж.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="mn">
      <body>
        <Suspense fallback={<div role="status">Ачаалж байна…</div>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
