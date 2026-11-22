'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error boundary caught:', error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: '75vh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px 20px',
      }}
    >
      <section
        className="card"
        role="alert"
        style={{
          maxWidth: 520,
          width: '100%',
          padding: '32px 28px',
          textAlign: 'center',
        }}
      >
        <h1 style={{ margin: '0 0 10px', fontFamily: 'Georgia, serif', fontSize: 24 }}>
          Уучлаарай, хуудсыг ачаалахад саатал гарлаа
        </h1>
        <p style={{ margin: '0 0 22px', color: 'var(--ui-text-muted)', fontSize: 14.5, lineHeight: 1.6 }}>
          Түр зуурын техникийн саатал үүссэн байж болзошгүй. Дахин оролдох эсвэл нүүр хуудас руу буцна уу.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="button primary"
            onClick={() => reset()}
            style={{ minHeight: 42, padding: '0 22px' }}
          >
            Дахин оролдох
          </button>
          <Link
            href="/"
            className="button secondary"
            style={{ minHeight: 42, padding: '0 20px', display: 'inline-flex', alignItems: 'center' }}
          >
            Нүүр хуудас руу буцах
          </Link>
        </div>
      </section>
    </main>
  );
}
