export default function RootLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      style={{
        minHeight: '72vh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px 20px',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 420,
          width: '100%',
          textAlign: 'center',
          padding: '28px 24px',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            margin: '0 auto 14px',
            borderRadius: '50%',
            border: '3px solid var(--gold-border)',
            borderTopColor: 'var(--ui-primary)',
            animation: 'people-spin 0.85s linear infinite',
          }}
        />
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>
          Ургийн мэдээллийг ачаалж байна…
        </p>
      </div>
    </main>
  );
}
