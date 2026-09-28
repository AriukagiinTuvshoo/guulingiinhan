'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, Family, MemoryPage } from '../../lib/api';

const PAGE_SIZE = 12;

export default function MemoriesPage() {
  const [family, setFamily] = useState<Family | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [memories, setMemories] = useState<MemoryPage | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (fid: string, page = 1, q = query) => {
    if (!fid) return;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (q.trim()) params.set('q', q.trim());
      setMemories(await api<MemoryPage>('/families/' + fid + '/memories?' + params.toString()));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { window.location.href = '/login'; return; }
      setError(cause instanceof Error ? cause.message : 'Дурсамжуудыг ачаалж чадсангүй.');
    } finally { setLoading(false); setBusy(false); }
  }, [query]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('family') ?? '';
    api<Family[]>('/families').then((items) => {
      setFamilies(items);
      const selected = items.find((item) => item.id === requested) ?? items[0] ?? null;
      setFamily(selected); setFamilyId(selected?.id ?? '');
      if (selected && selected.id !== requested) window.history.replaceState(null, '', '/memories?family=' + encodeURIComponent(selected.id));
      if (!selected) setLoading(false);
    }).catch((cause) => {
      if (cause instanceof ApiError && cause.status === 401) { window.location.href = '/login'; return; }
      setLoading(false); setError(cause instanceof Error ? cause.message : 'Гэр бүлүүдийг ачаалж чадсангүй.');
    });
  }, []);

  useEffect(() => { if (familyId) void load(familyId, 1); }, [familyId, load]);

  const canMutate = family?.role === 'owner' || family?.role === 'editor';
  const pageNo = memories?.page ?? 1;

  return <main className="memories-page"><section className="memories-shell">
    <header className="memories-heading">
      <div>
        <Link href={family ? '/dashboard?family=' + encodeURIComponent(family.id) : '/dashboard'}>← Dashboard</Link>
        <p className="eyebrow">ГУУЛИНГИЙНХАН · FAMILY MEMORIES</p>
        <h1>Манай дурсамж</h1>
        <p>Гэр бүлийн зураг, дурсамж болон холбоотой хүмүүсийг тусдаа сан болгон хадгална.</p>
      </div>
      <div className="memories-actions">
        {families.length > 1 && <label><span>Гэр бүл</span><select value={familyId} onChange={e => { setFamily(families.find(x => x.id === e.target.value) ?? null); setFamilyId(e.target.value); setMemories(null); }}>{families.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {canMutate && familyId && <Link className="button primary" href={'/memories/new?family=' + encodeURIComponent(familyId)}>+ Дурсамж нэмэх</Link>}
      </div>
    </header>
    {error && <div className="error memories-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load(familyId, pageNo)}>Дахин оролдох</button></div>}
    <section className="memories-toolbar card" aria-label="Дурсамж хайх"><label>Дурсамж хайх<input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void load(familyId, 1); }} placeholder="Гарчиг эсвэл тайлбараар хайх…" /></label><button type="button" disabled={busy} onClick={() => void load(familyId, 1)}>Хайх</button></section>
    {loading && !memories ? <section className="memories-state card" aria-live="polite"><span className="people-spinner" aria-hidden="true" /><p>Дурсамжуудыг ачаалж байна…</p></section>
      : !families.length ? <section className="memories-state card"><h2>Гэр бүл олдсонгүй.</h2><p>Танд одоогоор хандах боломжтой гэр бүл алга.</p></section>
      : memories?.items.length === 0 ? <section className="memories-state card"><h2>Одоогоор дурсамж алга.</h2><p>Гэр бүлийнхээ чухал мөчийг хадгалж эхлээрэй.</p>{canMutate && <Link className="button primary" href={'/memories/new?family=' + encodeURIComponent(familyId)}>Анхны дурсамж нэмэх</Link>}</section>
      : <><div className="memories-results-head"><strong>{memories?.total ?? 0} дурсамж</strong>{busy && <span role="status">Шинэчилж байна…</span>}</div><div className="memory-grid">{memories?.items.map(memory => <article className="card memory-card" key={memory.id}><div className="memory-card-mark" aria-hidden="true">✦</div><div className="memory-card-meta"><span>{memory.memory_date ?? 'Огноогүй'}</span><span>{memory.visibility === 'private' ? 'Хувийн' : memory.visibility === 'public' ? 'Нийтийн' : 'Гэр бүлийн'}</span></div><h2>{memory.title}</h2><p>{memory.description || 'Тайлбар оруулаагүй байна.'}</p><footer><span>{memory.author_name}</span><span>{memory.related_people_count} хүн</span></footer><Link className="button memory-open" href={'/memories/' + memory.id + '?family=' + encodeURIComponent(familyId)}>Дурсамжийг үзэх →</Link></article>)}</div>{memories && memories.total > PAGE_SIZE && <nav className="stories-pagination" aria-label="Дурсамжийн хуудаслалт"><button disabled={pageNo <= 1 || busy} onClick={() => void load(familyId, pageNo - 1)}>← Өмнөх</button><span>{pageNo} / {Math.max(1, Math.ceil(memories.total / PAGE_SIZE))}</span><button disabled={!memories.has_next || busy} onClick={() => void load(familyId, pageNo + 1)}>Дараагийн →</button></nav>}</>}
  </section></main>;
}
