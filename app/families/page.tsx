'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, Family, User } from '../../lib/api';

export default function FamiliesPage() {
  const router = useRouter();
  const [families, setFamilies] = useState<Family[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.all([api<User>('/auth/me'), api<Family[]>('/families')])
      .then(([, data]) => { if (active) setFamilies(data); })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
        else setError(cause instanceof Error ? cause.message : 'Гэр бүлүүдийг ачаалж чадсангүй.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);
  return <main className="mvp"><section className="mvpbox">
    <div className="row space"><div><Link href="/dashboard">← Аппын нүүр</Link><h1 style={{ marginTop: 22 }}>Миний гэр бүлүүд</h1></div><div className="row"><Link className="button" href="/account/security">Нэвтрэх тохиргоо</Link><Link className="button" href="/onboarding">+ Гэр бүл үүсгэх</Link></div></div>
    {loading ? <p>Ачаалж байна…</p> : error ? <div className="error" role="alert">{error}</div> : families.length === 0 ? <div className="card" style={{ marginTop: 20 }}><h2>Ургийн модоо эхлүүлээрэй</h2><p>Эхлээд гэр бүл үүсгээд өөрийгөө нэмнэ.</p><Link className="button" href="/onboarding">Гэр бүл үүсгэх</Link></div> : <div className="cards">{families.map((family) => <article key={family.id} className="card"><span className="tag">{family.role}</span><h2>{family.name}</h2>{family.description && <p>{family.description}</p>}<div className="row"><button onClick={() => router.push(`/tree?family=${family.id}`)}>Ургийн мод нээх →</button>{family.role === 'owner' && <Link className="button" href={`/invite?family=${family.id}`}>Гишүүн урих</Link>}</div></article>)}</div>}
  </section></main>;
}
