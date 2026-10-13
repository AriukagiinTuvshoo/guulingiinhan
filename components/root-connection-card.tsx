'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import styles from './root-connection-card.module.css';

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

  const connected = state?.status === 'approved';
  const pending = state?.status === 'pending';
  const label = connected ? 'Холбогдсон' : pending ? 'Шалгаж байна' : state?.status === 'rejected' ? 'Татгалзсан' : 'Холбоогүй';
  const link = `/ancestry/connect?family=${encodeURIComponent(familyId)}`;

  return <section className={styles.card} aria-label="Үндэс модны холболт" aria-busy={!state && !error}>
    <div className={styles.heading}><div><span className={styles.eyebrow}>УДАМ УГСАА · ГЭР БҮЛИЙН ТОХИРГОО</span><h2>Гэр бүлийн мод ба нийтлэг үндэс</h2></div><strong className={styles.status} data-state={state?.status || 'loading'}>{error ? 'Ачаалсангүй' : !state ? 'Шалгаж байна' : label}</strong></div>
    {error ? <p role="alert">Холболтын төлөвийг ачаалж чадсангүй. Хуудсыг шинэчилж дахин оролдоно уу.</p> : !state ? <p role="status">Холболтыг шалгаж байна…</p> : <>
      <ol className={styles.path} aria-label="Удмын холболтын зам">
        <li><span>01 · МИНИЙ ОРЧИН</span><strong>Гэр бүлийн мод</strong><small>Танай хүмүүс, түүх, архив</small></li>
        <li className={connected ? styles.active : ''}><span>02 · НИЙТЛЭГ ОРЧИН</span><strong>Үндэс мод</strong><small>{connected ? `${state.target_name || 'Салбар'} хүний салбар` : pending ? 'Админы шалгалтыг хүлээж байна' : 'Холболт сонгоогүй'}</small></li>
      </ol>
      {connected ? <p><strong>{state.person_name || 'Таны хүн'}</strong> нь {state.target_name || 'сонгосон хүн'} хүний салбарт баталгаажсан. Гэр бүлийн хувийн агуулга нийтлэгдэхгүй.</p> : pending ? <p><strong>{state.person_name || 'Таны хүн'}</strong> → {state.target_name || 'сонгосон салбар'} хүсэлтийг админ шалгаж байна. Шийдвэр гарсны дараа төлөв шинэчлэгдэнэ.</p> : state.status === 'rejected' ? <p>Өмнөх хүсэлт татгалзагдсан. Зөв хүний салбарыг шалгаад дахин хүсэлт илгээнэ үү.</p> : <p>Гэр бүлийн мод танай хүрээнд байна. Та өөрийн баталгаажсан хүнийг сонгон нийтлэг үндэс модтой холбож болно.</p>}
    </>}
    <div className={styles.actions}><Link className={styles.primary} href={link}>{connected ? 'Холболтоо удирдах →' : pending ? 'Хүсэлтийн явц →' : 'Үндэс модтой холбох →'}</Link><Link href="/ancestry">Нийтлэг модыг харах →</Link><Link href={`/tree?family=${encodeURIComponent(familyId)}`}>Гэр бүлийн мод →</Link></div>
  </section>;
}
