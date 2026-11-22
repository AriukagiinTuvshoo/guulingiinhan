'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error boundary caught:', error);
  }, [error]);

  return (
    <html lang="mn">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#fbf9f4',
          color: '#1e293b',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <section
          role="alert"
          style={{
            maxWidth: 480,
            width: '100%',
            padding: '32px 28px',
            borderRadius: 16,
            background: '#ffffff',
            border: '1px solid #e2d9c8',
            boxShadow: '0 12px 32px rgba(0,0,0,0.06)',
            textAlign: 'center',
          }}
        >
          <h1 style={{ margin: '0 0 10px', fontFamily: 'Georgia, serif', fontSize: 22 }}>
            Системийн төлөв шинэчлэх шаардлагатай
          </h1>
          <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
            Аппликейшнийг дахин ачаалж үзнэ үү. Таны гэр бүлийн өгөгдөл аюулгүй хадгалагдсан.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: 42,
              padding: '0 24px',
              borderRadius: 10,
              border: 'none',
              background: '#b45309',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Дахин ачаалах
          </button>
        </section>
      </body>
    </html>
  );
}
