'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, ArchiveListPage, Family } from '../../lib/api';

const PAGE_SIZE = 12;

export default function ArchivesPage() {
  const [family, setFamily] = useState<Family | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadArchives = useCallback(async (fid: string, page = 1, q = query) => {
    if (!fid) return;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
      });
      if (q.trim()) params.set('q', q.trim());
      setArchives(await api<ArchiveListPage>('/families/' + fid + '/archives?' + params.toString()));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Архивийг ачаалж чадсангүй.');
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
          window.history.replaceState(null, '', '/archives?family=' + encodeURIComponent(selected.id));
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
    if (familyId) void loadArchives(familyId, 1);
  }, [familyId, loadArchives]);

  function chooseFamily(next: string) {
    const selected = families.find((item) => item.id === next) ?? null;
    setFamily(selected);
    setFamilyId(next);
    setArchives(null);
    window.history.replaceState(null, '', '/archives?family=' + encodeURIComponent(next));
  }

  const page = archives?.page ?? 1;

  return (
    <main className="stories-page">
      <section className="stories-shell">
        <header className="stories-heading">
          <div>
            <Link href={family ? '/dashboard?family=' + encodeURIComponent(family.id) : '/dashboard'}>← Dashboard</Link>
            <p className="eyebrow">ГУУЛИНГИЙНХАН · FAMILY ARCHIVE</p>
            <h1>Гэр бүлийн архив</h1>
            <p className="stories-lede">
              Танай гэр бүлийн хадгалсан баримт, эх сурвалж, түүхэн материал энд нэг дор байна.
            </p>
          </div>
          {families.length > 1 && (
            <label className="stories-family">
              <span>Гэр бүл</span>
              <select value={familyId} onChange={(event) => chooseFamily(event.target.value)} aria-label="Гэр бүл сонгох">
                {families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
        </header>

        {error && (
          <div className="error stories-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadArchives(familyId, page)}>Дахин оролдох</button>
          </div>
        )}

        <section className="stories-toolbar card" aria-label="Архив хайх">
          <label>
            Архив хайх
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void loadArchives(familyId, 1); }}
              placeholder="Гарчиг эсвэл тайлбараар хайх…"
            />
          </label>
          <button type="button" onClick={() => void loadArchives(familyId, 1)} disabled={busy}>Хайх</button>
        </section>

        {loading && !archives ? (
          <section className="stories-state card" aria-live="polite">
            <span className="people-spinner" aria-hidden="true" />
            <p>Гэр бүлийн архивийг ачаалж байна…</p>
          </section>
        ) : !families.length ? (
          <section className="stories-state card">
            <h2>Гэр бүл олдсонгүй.</h2>
            <p>Танд одоогоор хандах боломжтой гэр бүл алга.</p>
            <Link className="button" href="/families">Гэр бүлүүд</Link>
          </section>
        ) : archives && archives.items.length === 0 ? (
          <section className="stories-state card">
            <h2>Одоогоор архивын материал хадгалагдаагүй байна.</h2>
            <p>Гэр бүлийн чухал баримт, эх сурвалжуудаа энд төвлөрүүлж болно.</p>
          </section>
        ) : (
          <>
            <div className="stories-results-head">
              <strong>{archives?.total ?? 0} архив</strong>
              {busy && <span role="status">Шинэчилж байна…</span>}
            </div>
            <div className="story-grid" aria-busy={busy}>
              {archives?.items.map((archive) => (
                <article className="card story-card" key={archive.id}>
                  <div className="story-card-meta">
                    <span>{archive.document_date ?? 'Огноогүй'}</span>
                    {archive.place && <span>· {archive.place}</span>}
                  </div>
                  <h2>{archive.title}</h2>
                  <p>{archive.description || 'Тайлбар оруулаагүй байна.'}</p>
                  <div className="story-card-footer">
                    <span>{archive.author_name}</span>
                    <span>{archive.related_people_count} холбоотой хүн</span>
                  </div>
                  <Link
                    className="button story-open"
                    href={'/archives/' + archive.id + '?family=' + encodeURIComponent(familyId)}
                  >
                    Баримтыг үзэх →
                  </Link>
                </article>
              ))}
            </div>
            {archives && archives.total > PAGE_SIZE && (
              <nav className="stories-pagination" aria-label="Архивын хуудаслалт">
                <button type="button" disabled={page <= 1 || busy} onClick={() => void loadArchives(familyId, page - 1)}>← Өмнөх</button>
                <span>{page} / {Math.max(1, Math.ceil(archives.total / PAGE_SIZE))}</span>
                <button type="button" disabled={!archives.has_next || busy} onClick={() => void loadArchives(familyId, page + 1)}>Дараагийн →</button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}
