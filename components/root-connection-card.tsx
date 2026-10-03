'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Connection = { status: string; person_name: string | null; target_name: string | null; person_id: string | null };

export default function RootConnectionCard({ familyId }: { familyId: string }) {
  const [state, setState] = useState<Connection | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setState(null); setError(false);
    void api<Connection>(`/families/${encodeURIComponent(familyId)}/root-connection`)
      .then((value) => { if (active) setState(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [familyId]);

  const link = `/ancestry/connect?family=${encodeURIComponent(familyId)}`;
  return <section aria-label="Үндэс модны холболт" style={{ background: '#fffaf0', border: '1px solid #d6c6a6', borderRadius: 16, padding: 22, margin: '20px 0', color: '#183a30' }}>
    <span style={{ color: '#9c7433', fontSize: 12, fontWeight: 700, letterSpacing: '.16em' }}>УДАМ УГСАА</span>
    <h2 style={{ fontFamily: 'Georgia,serif', fontSize: 'clamp(1.5rem,2.5vw,2rem)', margin: '8px 0' }}>Гэр бүлийн мод ↔ Нийтлэг үндэс</h2>
    {error ? <p role="alert">Холболтын төлөвийг ачаалж чадсангүй.</p> : !state ? <p role="status">Холболтыг шалгаж байна…</p> : state.status === 'approved' ? <p><strong>Холбогдсон:</strong> {state.person_name} → {state.target_name} салбар. Гэр бүлийн хувийн орчин хэвээр.</p> : state.status === 'pending' ? <p><strong>Хүлээгдэж байна:</strong> {state.person_name} → {state.target_name} хүсэлтийг админ шалгаж байна.</p> : state.status === 'rejected' ? <p>Өмнөх хүсэлт татгалзагдсан. Салбараа шалгаад дахин хүсэлт илгээж болно.</p> : <p>Танай гэр бүлийн мод нийтлэг үндэс модонд одоогоор холбогдоогүй байна.</p>}
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}><Link href={link}>{state?.status === 'approved' ? 'Холболтыг удирдах →' : 'Үндэс модтой холбох →'}</Link><Link href="/ancestry">Нийтлэг модыг харах →</Link></div>
  </section>;
}
