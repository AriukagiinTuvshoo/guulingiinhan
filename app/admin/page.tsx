'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, api, Family } from '../../lib/api';
import './admin.css';

type AdminAccess = { owner: boolean; scopes: string[] };

type AuditEntry = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  created_at: string;
};

export default function AdminPage() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [selected, setSelected] = useState('');
  const [accessByFamily, setAccessByFamily] = useState<Record<string, AdminAccess>>({});
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    api<Family[]>('/families', { signal: controller.signal }).then(async (rows) => {
      const accesses = await Promise.all(rows.map(async (family) => ({
        family, access: await api<AdminAccess>(`/families/${encodeURIComponent(family.id)}/admin-access`, { signal: controller.signal }),
      })));
      if (controller.signal.aborted) return;
      const allowed = accesses.filter(({ access }) => access.owner || access.scopes.length > 0);
      setFamilies(allowed.map(({ family }) => family));
      setAccessByFamily(Object.fromEntries(allowed.map(({ family, access }) => [family.id, access])));
      const requested = new URLSearchParams(window.location.search).get('family');
      setSelected(allowed.find(({ family }) => family.id === requested)?.family.id ?? allowed[0]?.family.id ?? '');
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof ApiError && cause.status === 401 ? 'Нэвтрэх шаардлагатай.' : 'Гэр бүлийн жагсаалтыг ачаалж чадсангүй.');
      setLoading(false);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selected || !accessByFamily[selected]?.scopes.includes('view_audit')) return;
    const controller = new AbortController();
    api<AuditEntry[]>(`/families/${encodeURIComponent(selected)}/audit`, { signal: controller.signal })
      .then((rows) => { if (!controller.signal.aborted) { setEntries(rows); setError(''); } })
      .catch(() => { if (!controller.signal.aborted) { setEntries([]); setError('Үйлдлийн бүртгэлийг ачаалж чадсангүй.'); } });
    return () => controller.abort();
  }, [selected, accessByFamily]);

  function chooseFamily(value: string) {
    setEntries([]);
    setError('');
    setSelected(value);
  }

  return (
    <main className="admin-console">
      <header className="admin-console__header">
        <div><p>ГУУЛИНГИЙНХАН</p><h1>Удирдлага</h1></div>
        <Link href="/dashboard">Үндсэн хэсэг рүү буцах</Link>
      </header>
      <section className="admin-console__content">
        <h2>Үйлдлийн бүртгэл</h2>
        <p>Сонгосон гэр бүлийн сүүлийн 100 үйлдэл, зөвшөөрөлтэй хэрэглэгчид харагдана.</p>
        {loading && <p role="status">Ачаалж байна…</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && families.length === 0 && !error && <p>Удирдах эрхтэй гэр бүл алга.</p>}
        {families.length > 0 && <label>Гэр бүл <select value={selected} onChange={(event) => chooseFamily(event.target.value)}>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label>}
        {selected && <nav aria-label="Удирдлагын хэсгүүд" className="admin-console__nav">
          {accessByFamily[selected]?.scopes.includes('manage_trash') && <Link href={`/admin/trash?family=${encodeURIComponent(selected)}`}>Хогийн сав</Link>}
          {accessByFamily[selected]?.scopes.includes('manage_settings') && <Link href={`/admin/settings?family=${encodeURIComponent(selected)}`}>Гэр бүлийн тохиргоо</Link>}
          {accessByFamily[selected]?.scopes.includes('manage_members') && <Link href={`/admin/members?family=${encodeURIComponent(selected)}`}>Гишүүд ба урилга</Link>}
          {accessByFamily[selected]?.scopes.includes('manage_people') && <Link href={`/admin/people?family=${encodeURIComponent(selected)}`}>Хүмүүс</Link>}
          {accessByFamily[selected]?.scopes.includes('manage_content') && <Link href={`/admin/content?family=${encodeURIComponent(selected)}`}>Агуулга</Link>}
          {accessByFamily[selected]?.owner && <Link href={`/admin/permissions?family=${encodeURIComponent(selected)}`}>Админ эрх</Link>}
        </nav>}
        {selected && !accessByFamily[selected]?.scopes.includes('view_audit') && <p>Үйлдлийн бүртгэл харах эрхгүй.</p>}
        {selected && !error && accessByFamily[selected]?.scopes.includes('view_audit') && <ul className="admin-console__audit">{entries.map((entry) => <li key={entry.id}><strong>{entry.action}</strong><span>{entry.target_type}</span><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('mn-MN')}</time></li>)}</ul>}
      </section>
    </main>
  );
}
