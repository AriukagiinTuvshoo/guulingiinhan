'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, Family, StoryListPage } from '../../lib/api';

const PAGE_SIZE = 12;

export default function StoriesPage() {
  const [family, setFamily] = useState<Family | null>(null);
  const [familyId, setFamilyId] = useState('');
  const [families, setFamilies] = useState<Family[]>([]);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadStories = useCallback(async (fid: string, page = 1, q = query) => {
    if (!fid) return;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (q.trim()) params.set('q', q.trim());
      setStories(await api<StoryListPage>('/families/' + fid + '/stories?' + params.toString()));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Түүхүүдийг ачаалж чадсангүй.');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }, [query]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('family') ?? '';
    api<Family[]>('/families')
      .then((items) => {
        setFamilies(items);
        const selected = items.find((item) => item.id === requested) ?? items[0] ?? null;
        setFamily(selected);
        setFamilyId(selected?.id ?? '');
        if (selected && selected.id !== requested) {
          window.history.replaceState(null, '', '/stories?family=' + encodeURIComponent(selected.id));
        }
        if (!selected) setLoading(false);
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          window.location.href = '/login';
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : 'Гэр бүлүүдийг ачаалж чадсангүй.');
      });
  }, []);

  useEffect(() => {
    if (familyId) void loadStories(familyId, 1);
  }, [familyId, loadStories]);

  function chooseFamily(next: string) {
    const selected = families.find((item) => item.id === next) ?? null;
    setFamily(selected);
    setFamilyId(next);
    setStories(null);
    window.history.replaceState(null, '', '/stories?family=' + encodeURIComponent(next));
  }

  const page = stories?.page ?? 1;
  const canCreate = family?.role === 'owner' || family?.role === 'editor';

  return (
    <main className="stories-page">
      <section className="stories-shell">
        <header className="stories-heading">
          <div>
            <Link href={family ? '/dashboard?family=' + encodeURIComponent(family.id) : '/dashboard'}>← Dashboard</Link>
            <p className="eyebrow">ГУУЛИНГИЙНХАН · FAMILY STORY</p>
            <h1>Манай түүх</h1>
            <p className="stories-lede">Гэр бүлийн үйл явдал, дурсамжит өгүүлэмж, огноо, газар болон холбоотой хүмүүсийг тусдаа түүхийн сан болгон хадгална.</p>
          </div>
          <div className="stories-actions">
            {families.length > 1 && (
              <label className="stories-family">
                <span>Гэр бүл</span>
                <select value={familyId} onChange={(event) => chooseFamily(event.target.value)} aria-label="Гэр бүл сонгох">
                  {families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            {familyId && canCreate && (
              <Link className="button primary" href={'/stories/new?family=' + encodeURIComponent(familyId)}>+ Түүх нэмэх</Link>
            )}
          </div>
        </header>

        {error && <div className="error stories-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadStories(familyId, page)}>Дахин оролдох</button></div>}

        <section className="stories-toolbar card" aria-label="Түүх хайх">
          <label>
            Түүх хайх
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadStories(familyId, 1); }} placeholder="Гарчиг эсвэл агуулгаар хайх…" />
          </label>
          <button type="button" onClick={() => void loadStories(familyId, 1)} disabled={busy}>Хайх</button>
        </section>

        {loading && !stories ? (
          <section className="stories-state card" aria-live="polite"><span className="people-spinner" aria-hidden="true" /><p>Гэр бүлийн түүхийг ачаалж байна…</p></section>
        ) : !families.length ? (
          <section className="stories-state card"><h2>Гэр бүл олдсонгүй.</h2><p>Танд одоогоор хандах боломжтой гэр бүл алга.</p><Link className="button" href="/families">Гэр бүлүүд</Link></section>
        ) : stories && stories.items.length === 0 ? (
          <section className="stories-state card">
            <h2>Одоогоор гэр бүлийн түүх хадгалагдаагүй байна.</h2>
            <p>Анхны түүхээ хадгалж, гэр бүлийнхээ чухал үйл явдлыг үлдээгээрэй.</p>
            {canCreate && <Link className="button primary" href={'/stories/new?family=' + encodeURIComponent(familyId)}>Анхны түүх нэмэх</Link>}
          </section>
        ) : (
          <>
            <div className="stories-results-head"><strong>{stories?.total ?? 0} түүх</strong>{busy && <span role="status">Шинэчилж байна…</span>}</div>
            <div className="story-grid" aria-busy={busy}>
              {stories?.items.map((story) => (
                <article className="card story-card" key={story.id}>
                  <div className="story-card-meta"><span>{story.event_date ?? 'Огноогүй'}</span>{story.place && <span>· {story.place}</span>}</div>
                  <h2>{story.title}</h2>
                  <p>{story.excerpt}</p>
                  <div className="story-card-footer"><span>{story.author_name}</span><span>{story.related_people_count} холбоотой хүн</span></div>
                  <Link className="button story-open" href={'/stories/' + story.id + '?family=' + encodeURIComponent(familyId)}>Түүхийг унших →</Link>
                </article>
              ))}
            </div>
            {stories && stories.total > PAGE_SIZE && (
              <nav className="stories-pagination" aria-label="Түүхийн хуудаслалт">
                <button type="button" disabled={page <= 1 || busy} onClick={() => void loadStories(familyId, page - 1)}>← Өмнөх</button>
                <span>{page} / {Math.max(1, Math.ceil(stories.total / PAGE_SIZE))}</span>
                <button type="button" disabled={!stories.has_next || busy} onClick={() => void loadStories(familyId, page + 1)}>Дараагийн →</button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}
