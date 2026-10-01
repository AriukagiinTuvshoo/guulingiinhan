import type { Metadata } from 'next';
import DashboardPage from './dashboard/page';

export const metadata: Metadata = {
  title: 'ГУУЛИНГИЙНХАН — Миний удам · Манай түүх',
  description: 'Хувийн гэр бүлийн ургийн мод, хүмүүс, түүх, дурсамж, архивын нэгдсэн орчин.',
  robots: {
    index: false,
    follow: false,
  },
};

export default DashboardPage;
