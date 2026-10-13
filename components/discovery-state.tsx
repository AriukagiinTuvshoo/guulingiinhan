import Link from 'next/link';
export default function DiscoveryState({ loading, error, retry, children }: { loading?: boolean; error?: string; retry?: () => void; children?: React.ReactNode }) {
  if (loading) return <div className="discovery-state" role="status"><div className="discovery-skeleton" aria-hidden="true" /><p>Мэдээллийг ачаалж байна…</p></div>;
  if (error) return <div className="discovery-state" role="alert"><h2>Мэдээллийг ачаалж чадсангүй</h2><p>{error}</p>{retry && <button type="button" onClick={retry}>Дахин оролдох</button>}<Link href="/families">Гэр бүлээ сонгох →</Link></div>;
  return <div className="discovery-state">{children}</div>;
}
