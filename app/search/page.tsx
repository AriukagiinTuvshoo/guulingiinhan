'use client';
import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { api, ApiError, PersonDirectoryPage, PersonSearchPage, StoryListPage, ArchiveListPage, MemoryListPage } from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';
import DiscoveryState from '../../components/discovery-state';
type Kind = 'people' | 'stories' | 'memories' | 'archives';
type Group = { kind: Kind; items: { id: string; title: string; context: string; href: string }[]; total: number; hasNext: boolean; error: string };
const labels: Record<Kind, string> = { people: 'Хүмүүс', stories: 'Түүх', memories: 'Дурсамж', archives: 'Архив' };
const kinds = Object.keys(labels) as Kind[];
function SearchContent() {
  const { familyId, currentFamily, contextLoading, contextError } = useAppShellContext();
  const [q, setQ] = useState(''); const [kind, setKind] = useState<Kind | 'all'>('all'); const [year, setYear] = useState('');
  const [request, setRequest] = useState<{ q: string; kind: Kind | 'all'; year: string; page: number } | null>(null);
  const [groups, setGroups] = useState<Group[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => {
    setGroups([]); setBusy(false);
    if (!familyId || contextError || !request) return;
    const controller = new AbortController(); const options = { signal: controller.signal };
    const scope = `family=${encodeURIComponent(familyId)}`;
    const query = new URLSearchParams({ q: request.q, page: String(request.page), page_size: '12' });
    if (request.year) query.set('year', request.year);
    setBusy(true);
    void Promise.all((request.kind === 'all' ? kinds : [request.kind]).map(async (resource): Promise<Group> => {
      try {
        const base = `/families/${familyId}`;
        if (resource === 'people') {
          if (request.kind === 'people' && request.year) {
            const peopleQuery = new URLSearchParams(query); peopleQuery.delete('year'); peopleQuery.set('birth_year', request.year);
            const data = await api<PersonSearchPage>(`${base}/persons/search?${peopleQuery}`, options);
            return { kind: resource, total: data.total, hasNext: data.has_next, error: '', items: data.items.map(p => ({ id: p.id, title: p.name, context: [p.birth_year, p.branch_name].filter(Boolean).join(' · '), href: `/profile?${scope}&person=${p.id}` })) };
          }
          const peopleQuery = new URLSearchParams(query); peopleQuery.delete('year');
          const data = await api<PersonDirectoryPage>(`${base}/people?${peopleQuery}`, options);
          return { kind: resource, total: data.total, hasNext: data.has_next, error: '', items: data.items.map(p => ({ id: p.id, title: [p.last_name, p.first_name, p.middle_name].filter(Boolean).join(' '), context: [p.branch_name, p.birth_date?.slice(0, 4)].filter(Boolean).join(' · ') || currentFamily?.name || 'Гэр бүлийн хүн', href: `/profile?${scope}&person=${p.id}` })) };
        }
        if (resource === 'stories') {
          const data = await api<StoryListPage>(`${base}/stories?${query}`, options);
          return { kind: resource, total: data.total, hasNext: data.has_next, error: '', items: data.items.map(p => ({ id: p.id, title: p.title, context: [p.event_date, p.place, p.author_name].filter(Boolean).join(' · '), href: `/stories/${p.id}?${scope}` })) };
        }
        if (resource === 'archives') {
          const data = await api<ArchiveListPage>(`${base}/archives?${query}`, options);
          return { kind: resource, total: data.total, hasNext: data.has_next, error: '', items: data.items.map(p => ({ id: p.id, title: p.title, context: [p.document_date, p.place].filter(Boolean).join(' · ') || 'Архивын материал', href: `/archives/${p.id}?${scope}` })) };
        }
        const data = await api<MemoryListPage>(`${base}/memories?${query}`, options);
        return { kind: resource, total: data.total, hasNext: data.has_next, error: '', items: data.items.map(p => ({ id: p.id, title: p.title, context: p.memory_date || 'Огноо оруулаагүй', href: `/memories/${p.id}?${scope}` })) };
      } catch (cause) { return { kind: resource, total: 0, items: [], hasNext: false, error: cause instanceof ApiError ? cause.message : 'Хайлтыг ачаалж чадсангүй.' }; }
    })).then(results => { if (!controller.signal.aborted) { setGroups(results); setBusy(false); } });
    return () => controller.abort();
  }, [familyId, contextError, request, currentFamily?.name]);
  function search(event: FormEvent) { event.preventDefault(); setRequest({ q: q.trim(), kind, year, page: 1 }); }
  return <main className="discovery-page"><header className="discovery-heading"><p className="eyebrow">ГУУЛИНГИЙНХАН · ГЭР БҮЛИЙН САН</p><h1>Нэгдсэн хайлт</h1><p>{currentFamily?.name || 'Гэр бүл'} доторх хүмүүс, түүх, дурсамж, архивыг нэг дороос олно.</p></header>
    {contextLoading ? <DiscoveryState loading /> : contextError || !familyId ? <DiscoveryState error={contextError || 'Гэр бүлээ сонгоно уу.'} /> : <>
      <form className="discovery-form" onSubmit={search} role="search"><label className="discovery-query">Хайх үг<input type="search" value={q} required={kind === 'people' && Boolean(year)} maxLength={100} onChange={e => setQ(e.target.value)} placeholder="Нэр, гарчиг, дурсамж…" /></label><label>Төрөл<select value={kind} onChange={e => setKind(e.target.value as Kind | 'all')}><option value="all">Бүх төрөл</option>{kinds.map(k => <option key={k} value={k}>{labels[k]}</option>)}</select></label><label>{kind === 'people' ? 'Төрсөн он' : 'Үйл явдлын он'}<input inputMode="numeric" type="number" min="1" max="9998" value={year} onChange={e => setYear(e.target.value)} aria-describedby="search-year-help" /></label><button type="submit" className="primary" disabled={busy}>{busy ? 'Хайж байна…' : 'Хайх'}</button><p id="search-year-help" className="discovery-help">{kind === 'people' ? 'Төрсөн оноор шүүхдээ хүний нэрийн эхлэлийг мөн оруулна. Хамгаалагдсан хүүхдийн төрсөн оноор илэрц гаргахгүй.' : 'Он нь түүх, дурсамж, архивын огноонд хамаарна. Хүний нэрээр хайхдаа үгийн эхлэлийг оруулна.'}</p></form>
      {!request && <DiscoveryState><h2>Өв соёлын сангаа нээгээрэй</h2><p>Хайх үгээ оруулж эсвэл төрлөө сонгоод хайна уу.</p></DiscoveryState>}{busy && <DiscoveryState loading />}
      <div aria-live="polite">{groups.map(group => <section className="discovery-group" key={group.kind}><h2>{labels[group.kind]} <span className="discovery-count">{group.error ? 'Ачаалаагүй' : group.total}</span></h2>{group.error ? <p role="alert">{group.error}</p> : group.items.length ? <ul className="discovery-results">{group.items.map(item => <li key={item.id}><Link href={item.href}><strong>{item.title}</strong><small>{item.context}</small><span aria-hidden="true">→</span></Link></li>)}</ul> : <p>Тохирох илэрц олдсонгүй. Хайх үг эсвэл шүүлтүүрээ өөрчилж үзнэ үү.</p>}</section>)}</div>
      {request && !busy && groups.length > 0 && <nav className="discovery-pagination" aria-label="Хайлтын хуудас"><button type="button" disabled={request.page === 1} onClick={() => setRequest({ ...request, page: request.page - 1 })}>Өмнөх</button><span>{request.page} дахь хуудас · төрөл бүрээс 12 хүртэл</span><button type="button" disabled={!groups.some(g => g.hasNext)} onClick={() => setRequest({ ...request, page: request.page + 1 })}>Дараах</button>{groups.some(g => g.error) && <button type="button" onClick={() => setRequest({ ...request })}>Дахин оролдох</button>}</nav>}
    </>}</main>;
}
export default function SearchPage() { return <Suspense fallback={<DiscoveryState loading />}><SearchContent /></Suspense>; }
