import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px 16px',
        background: 'var(--bg, #f7f2e7)',
        color: 'var(--ink, #1f1a14)',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 480,
          textAlign: 'center',
          background: 'var(--card, #fffdf8)',
          border: '1px solid var(--border, #d8ccb4)',
          borderRadius: 24,
          padding: '40px 28px',
          boxShadow: '0 14px 40px rgba(0, 0, 0, 0.08)',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--gold, #c9962b)',
            marginBottom: 10,
          }}
        >
          ГУУЛИНГИЙНХАН · 404
        </div>
        <h1 style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontSize: 30, margin: '0 0 10px' }}>
          Хуудас олдсонгүй
        </h1>
        <p style={{ color: 'var(--muted, #6b6154)', fontSize: 14, lineHeight: 1.65, margin: '0 0 24px' }}>
          Таны хайсан зам олдсонгүй эсвэл шилжсэн байна. Удмын мод болон нүүр хуудас руу буцаж үргэлжлүүлнэ үү.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/tree" className="btn btn-primary">
            🌳 Удмын мод руу орох
          </Link>
          <Link href="/" className="btn btn-secondary">
            Нүүр хуудас
          </Link>
        </div>
      </section>
    </main>
  );
}
