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
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--ui-bg)',
          color: 'var(--ui-text)',
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
            background: 'var(--ui-surface)',
            border: '1px solid var(--ui-border)',
            boxShadow: 'var(--ui-shadow-md)',
            textAlign: 'center',
          }}
        >
          <h1 style={{ margin: '0 0 10px', fontFamily: 'Georgia, serif', fontSize: 22 }}>
            Системийн төлөв шинэчлэх шаардлагатай
          </h1>
          <p style={{ margin: '0 0 20px', color: 'var(--ui-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
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
              background: 'var(--ui-primary)',
              color: 'var(--ui-primary-contrast)',
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
