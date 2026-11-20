'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import '../admin.css';

type Content = { id: string; title: string };
type Page = { items: Content[]; total: number; page: number; page_size: number };
type Kind = 'stories' | 'archives' | 'memories';

function Pagination({ label, data, onPage }: { label: string; data: Page; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return <nav aria-label={`${label} хуудас`}><button disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>Өмнөх</button> <span>{data.page} / {pages} ({data.total})</span> <button disabled={data.page * data.page_size >= data.total} onClick={() => onPage(data.page + 1)}>Дараах</button></nav>;
}
function useContentPage(family: string, kind: Kind, page: number, revision: number, allowed: boolean) {
  const [data, setData] = useState<Page>({ items: [], page: 1, page_size: 25, total: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!family || !allowed) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    api<Page>(`/families/${encodeURIComponent(family)}/${kind}?page=${page}&page_size=25`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) { setData(value); setLoading(false); } })
      .catch(() => { if (!controller.signal.aborted) { setError('Агуулгыг ачаалж чадсангүй.'); setLoading(false); } });
    return () => controller.abort();
  }, [family, kind, page, revision, allowed]);
  return { data, error, loading };
}
export default function AdminContentPage() {
  const [family, setFamily] = useState('');
  const [revision, setRevision] = useState(0);
  const [storyPage, setStoryPage] = useState(1);
  const [memoryPage, setMemoryPage] = useState(1);
  const [archivePage, setArchivePage] = useState(1);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [memoryId, setMemoryId] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const stories = useContentPage(family, 'stories', storyPage, revision, allowed);
  const memories = useContentPage(family, 'memories', memoryPage, revision, allowed);
  const archives = useContentPage(family, 'archives', archivePage, revision, allowed);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('family') ?? '';
    const controller = new AbortController();
    if (!id) { setError('Гэр бүл сонгоно уу.'); setLoading(false); return; }
    setFamily(id);
    api<{ scopes: string[] }>(`/families/${encodeURIComponent(id)}/admin-access`, { signal: controller.signal }).then(async (access) => {
      if (!access.scopes.includes('manage_content')) throw new Error('forbidden');
      if (!controller.signal.aborted) { setAllowed(true); setLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setError('Агуулгыг ачаалж чадсангүй эсвэл эрхгүй.'); setLoading(false); } });
    return () => controller.abort();
  }, []);
  async function add(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      await api<Content>(`/families/${encodeURIComponent(family)}/stories`, { method: 'POST', body: JSON.stringify({ title, body, person_ids: [], visibility: 'family' }) });
      setStoryPage(1); setRevision((value) => value + 1); setTitle(''); setBody('');
    } catch { setError('Түүх нэмэж чадсангүй.'); } finally { setBusy(false); }
  }
  async function uploadPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !memoryId || !photo) return;
    const form = event.currentTarget;
    setBusy(true); setError(''); setNotice('');
    try { await api(`/families/${encodeURIComponent(family)}/memories/${encodeURIComponent(memoryId)}/photos`, { method: 'POST', headers: { 'Content-Type': photo.type, 'X-File-Name': encodeURIComponent(photo.name) }, body: photo }); setPhoto(null); setMemoryId(''); form.reset(); setNotice('Зураг хадгалагдлаа.'); }
    catch { setError('Зураг хадгалж чадсангүй.'); } finally { setBusy(false); }
  }
  async function remove(kind: 'stories' | 'archives' | 'memories', item: Content) {
    if (busy || !window.confirm(`“${item.title}” устгах уу?`)) return;
    setBusy(true); setError('');
    try {
      await api<void>(`/families/${encodeURIComponent(family)}/${kind}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const list = kind === 'stories' ? stories.data : kind === 'archives' ? archives.data : memories.data;
      const setPage = kind === 'stories' ? setStoryPage : kind === 'archives' ? setArchivePage : setMemoryPage;
      if (list.items.length === 1 && list.page > 1) setPage(list.page - 1);
      if (kind === 'memories' && memoryId === item.id) setMemoryId('');
      setRevision((value) => value + 1);
    } catch { setError('Устгаж чадсангүй. Эрх болон холбогдсон мэдээллийг шалгана уу.'); } finally { setBusy(false); }
  }
  return <main className="admin-console"><header className="admin-console__header"><h1>Агуулга</h1><Link href={`/admin?family=${encodeURIComponent(family)}`}>Удирдлага руу буцах</Link></header><section className="admin-console__content">
    {(loading || stories.loading || memories.loading || archives.loading) && <p role="status">Ачаалж байна…</p>}{(error || stories.error || memories.error || archives.error) && <p role="alert">{error || stories.error || memories.error || archives.error}</p>}{notice && <p role="status">{notice}</p>}
    {allowed && <><form className="admin-console__member" onSubmit={add}><label>Түүхийн гарчиг <input required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Түүх <textarea required value={body} onChange={(event) => setBody(event.target.value)} /></label><button disabled={busy}>Түүх нэмэх</button></form>
      <h2>Түүхүүд</h2><ul className="admin-console__audit">{stories.data.items.map((row) => <li key={row.id}><Link href={`/stories/${encodeURIComponent(row.id)}?family=${encodeURIComponent(family)}`}>{row.title}</Link><Link href={`/stories/${encodeURIComponent(row.id)}/edit?family=${encodeURIComponent(family)}`}>Засах</Link><button disabled={busy} onClick={() => void remove('stories', row)}>Устгах</button></li>)}</ul><Pagination label="Түүхийн" data={stories.data} onPage={setStoryPage} />
      <h2>Дурсамж</h2><ul className="admin-console__audit">{memories.data.items.map((row) => <li key={row.id}><Link href={`/memories/${encodeURIComponent(row.id)}?family=${encodeURIComponent(family)}`}>{row.title}</Link><button disabled={busy} onClick={() => void remove('memories', row)}>Устгах</button></li>)}</ul><Pagination label="Дурсамжийн" data={memories.data} onPage={(value) => { setMemoryId(''); setMemoryPage(value); }} />
      <form className="admin-console__member" onSubmit={uploadPhoto}><h2>Дурсамжид зураг нэмэх</h2><label>Дурсамж <select required value={memoryId} onChange={(event) => setMemoryId(event.target.value)}><option value="">Сонгоно уу</option>{memories.data.items.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label><label>Зураг <input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label><button disabled={busy || !memoryId || !photo}>Зураг нэмэх</button></form>
      <h2>Архив</h2><ul className="admin-console__audit">{archives.data.items.map((row) => <li key={row.id}><Link href={`/archives/${encodeURIComponent(row.id)}?family=${encodeURIComponent(family)}`}>{row.title}</Link><Link href={`/archives/${encodeURIComponent(row.id)}/edit?family=${encodeURIComponent(family)}`}>Засах</Link><button disabled={busy} onClick={() => void remove('archives', row)}>Устгах</button></li>)}</ul><Pagination label="Архивын" data={archives.data} onPage={setArchivePage} />
      <p><Link href={`/archives/new?family=${encodeURIComponent(family)}`}>Архив нэмэх</Link> · <Link href={`/memories?family=${encodeURIComponent(family)}`}>Дурсамж</Link></p>
    </>}
  </section></main>;
}
