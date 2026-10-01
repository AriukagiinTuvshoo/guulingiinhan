import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Гуулингийнхан — Гэр бүлийн өв',
    short_name: 'Гуулингийнхан',
    description: 'Гэр бүлийн хувийн ургийн мод, түүх, дурсамж.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f2e9',
    theme_color: '#143c2d',
    lang: 'mn',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
