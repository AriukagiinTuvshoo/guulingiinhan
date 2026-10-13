'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell, { type AdminIdentity } from '../../../components/admin-shell';
import AdminFamilyStudio from '../../../components/admin-family-studio';
import { api, ApiError, personName, type PersonDirectoryPage } from '../../../lib/api';
import styles from '../admin.module.css';
type Family = { id: string; name: string };
export default function AdminPeoplePage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [offset, setOffset] = useState(0);
  const [familyId, setFamilyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [people, setPeople] = useState<PersonDirectoryPage | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<AdminIdentity>('/admin/me').then(who => { if (active) setIdentity(who); })
      .catch(cause => { if (!active) return; if (cause instanceof ApiError && cause.status === 401) router.replace('/login'); else setError('Хүний бүртгэлийг админ удирдана.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router, revision]);
  useEffect(() => {
    if (!identity) return;
    let active = true;
    setLoading(true); setError('');
    api<Family[]>(`/admin/families?limit=50&offset=${offset}`).then(rows => {
      if (!active) return;
      setFamilies(rows); setFamilyId(previous => rows.some(row => row.id === previous) ? previous : rows[0]?.id || '');
    }).catch(() => { if (active) setError('Гэр бүлийн бүртгэлийг ачаалж чадсангүй.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identity, offset, revision]);
  useEffect(() => {
    setPeople(null);
    if (!identity || identity.role === 'SUPER_ADMIN' || !familyId) { setDirectoryLoading(false); return; }
    const controller = new AbortController();
    setDirectoryLoading(true);
    const timer = window.setTimeout(() => {
      setError('');
      const params = new URLSearchParams({ page: String(page), page_size: '24' });
      if (query.trim()) params.set('q', query.trim());
      api<PersonDirectoryPage>(`/families/${familyId}/people?${params}`, { signal: controller.signal })
        .then(rows => { if (!controller.signal.aborted) setPeople(rows); })
        .catch(cause => { if (!controller.signal.aborted) { setPeople(null); setError(cause instanceof ApiError && cause.status === 403 ? 'Энэ гэр бүлийн хувийн бүртгэлийг харах эрх хүрэхгүй. Өөрийн хандах эрхтэй гэр бүлээ сонгоно уу.' : 'Хүний бүртгэлийг ачаалж чадсангүй.'); } })
        .finally(() => { if (!controller.signal.aborted) setDirectoryLoading(false); });
    }, 240);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [identity, familyId, page, query, revision]);
  return <AdminShell active="people" title="Хүмүүсийн удирдлага" identity={identity}>
    <p className={styles.intro}>👥 Гэр бүлээ сонгож хүний бүртгэл, намтар болон холбоосыг шалгана. Аккаунт нь хүний удмын бүртгэлээс тусдаа хадгалагдана.</p>
    {error && <div className={styles.error} role="alert">{error}<div className={styles.panelActions}><button type="button" onClick={() => setRevision(value => value + 1)}>Дахин ачаалах</button></div></div>}
    {identity && <><div className={styles.panel}><label>Удирдах гэр бүл<select value={familyId} onChange={event => { setFamilyId(event.target.value); setPeople(null); setPage(1); setQuery(''); }}><option value="">Гэр бүл сонгох</option>{families.map(family => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label><div className={styles.pagination}><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - 50))}>Өмнөх гэр бүлүүд</button><span>Гэр бүлийн бүртгэл {families.length ? offset + 1 : 0}–{offset + families.length}</span><button type="button" disabled={families.length < 50 || loading} onClick={() => setOffset(value => value + 50)}>Дараах гэр бүлүүд</button></div></div>
      {loading && <p className={styles.state} role="status">Бүртгэлийг ачаалж байна…</p>}
      {!loading && familyId && identity.role === 'SUPER_ADMIN' && <AdminFamilyStudio key={familyId} familyId={familyId} onBack={() => router.push('/admin?section=families')} />}
      {familyId && identity.role !== 'SUPER_ADMIN' && <><p className={styles.muted}>Таны хандах эрхтэй мэдээлэл харагдана. Үндсэн бүртгэл болон холбоосын засварыг Ерөнхий админ гүйцэтгэнэ.</p><div className={styles.listToolbar}><label>Хүний нэрээр хайх<input type="search" value={query} maxLength={100} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label></div>{directoryLoading && <p className={styles.state} role="status">Хайлтын бүртгэлийг ачаалж байна…</p>}{!loading && !directoryLoading && people && <><div className={styles.list}>{people.items.map(person => <div key={person.id} className={styles.row}><div><strong>{personName(person)}</strong><span>{person.birth_date?.slice(0, 4) || 'Он тодорхойгүй'} · {person.is_alive ? 'Амьд' : 'Дурсгалд'}</span></div></div>)}</div>{!people.items.length && <p className={styles.state}>Тохирох бүртгэл алга.</p>}<div className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Өмнөх</button><span>{page}-р хуудас · {people.total} хүн</span><button disabled={!people.has_next} onClick={() => setPage(value => value + 1)}>Дараах</button></div></>}</>}
      {!loading && !families.length && !error && <p className={styles.state}>Идэвхтэй гэр бүлийн бүртгэл алга.</p>}
    </>}
  </AdminShell>;
}
