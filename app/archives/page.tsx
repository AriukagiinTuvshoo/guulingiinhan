'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, ArchiveListPage } from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';

const PAGE_SIZE = 12;

function formatDate(value: string | null) {
  if (!value) return 'Огноогүй';
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('mn-MN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function visibilityLabel(value: string) {
  if (value === 'private') return 'Зөвхөн би';
  if (value === 'public') return 'Нийтийн';
  return 'Гэр бүлийнхэн';
}

function ArchivesPageContent() {
  const router = useRouter();
  const { families, currentFamily, familyId, contextError } = useAppShellContext();
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [query, setQuery] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [year, setYear] = useState('');
  const [mediaType, setMediaType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const familyRequestRef = useRef(0);
  const archiveRequestRef = useRef(0);
  const familyAbortRef = useRef<AbortController | null>(null);
  const archiveAbortRef = useRef<AbortController | null>(null);

  const loadArchives = useCallback(async (
    fid: string,
    page = 1,
    q = query,
    dateValue = documentDate,
    yearValue = year,
    typeValue = mediaType,
  ) => {
    if (!fid) return;
    const requestId = ++archiveRequestRef.current;
    archiveAbortRef.current?.abort();
    const controller = new AbortController();
    archiveAbortRef.current = controller;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
      });
      const safeQuery = q.replace(/\s+/g, ' ').trim();
      if (safeQuery) params.set('q', safeQuery);
      if (dateValue) params.set('document_date', dateValue);
      if (yearValue) params.set('year', yearValue);
      if (typeValue !== 'all') params.set('media_type', typeValue);
      const result = await api<ArchiveListPage>(`/families/${fid}/archives?${params.toString()}`, { signal: controller.signal });
      if (requestId !== archiveRequestRef.current) return;
      setArchives(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== archiveRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError('Архивийг ачааллахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      if (requestId === archiveRequestRef.current) {
        setLoading(false);
        setBusy(false);
      }
    }
  }, [router, query, documentDate, year, mediaType]);

  useEffect(() => {
    archiveAbortRef.current?.abort();
    archiveRequestRef.current += 1;
    setArchives(null);
    setError('');
  }, [familyId]);

  useEffect(() => {
    if (!familyId) return;
    void loadArchives(familyId, 1);
  }, [familyId, loadArchives]);

  function chooseFamily(next: string) {
    if (!families.some((item) => item.id === next) || next === familyId) return;
    archiveAbortRef.current?.abort();
    archiveRequestRef.current += 1;
    setArchives(null);
    setError('');
    router.replace(`/archives?family=${encodeURIComponent(next)}`);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!familyId) return;
    void loadArchives(familyId, 1, query, documentDate);
  }

  function resetFilters() {
    setQuery('');
    setDocumentDate('');
    setYear(''); setMediaType('all');
    if (familyId) void loadArchives(familyId, 1, '', '', '', 'all');
  }

  const page = archives?.page ?? 1;
  const pageCount = archives ? Math.max(1, Math.ceil(archives.total / PAGE_SIZE)) : 1;
  const family = currentFamily;
  const canCreate = family?.role === 'owner' || family?.role === 'editor';

  return (
    <main className="archive-page">
      <section className="archive-shell">
        <nav className="archive-breadcrumb" aria-label="Замын мөр">
          <Link href={family ? `/dashboard?family=${encodeURIComponent(family.id)}` : '/dashboard'}>← Dashboard</Link>
          <span>Архив</span>
        </nav>

        <header className="archive-hero">
          <div>
            <p className="archive-eyebrow">ГУУЛИНГИЙНХАН · FAMILY ARCHIVE</p>
            <h1>Гэр бүлийн архив</h1>
            <p>Гэр бүлийн түүхийг баталгаажуулах баримт, эх сурвалж, албан ёсны тэмдэглэлүүдийг нэгэн тайван архивт төвлөрүүлнэ.</p>
          </div>
          <div className="archive-hero-actions">
            {families.length > 1 && (
              <label className="archive-family-picker">
                <span>Гэр бүл</span>
                <select value={familyId} onChange={(event) => chooseFamily(event.target.value)} aria-label="Гэр бүл сонгох">
                  {families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            {familyId && canCreate && (
              <Link
                className="archive-primary"
                href={`/archives/new?family=${encodeURIComponent(familyId)}`}
              >
                + Баримт нэмэх
              </Link>
            )}
          </div>
        </header>

        {contextError && <div className="archive-alert" role="alert"><span>{contextError}</span><button type="button" onClick={() => window.location.reload()}>Дахин ачаалах</button></div>}
        {error && (
          <div className="archive-alert" role="alert">
            <span>{error}</span>
            <div className="archive-alert-actions">
              <button type="button" onClick={() => window.location.reload()}>Гэр бүлийн орчныг дахин ачаалах</button>
              {familyId && <button type="button" onClick={() => void loadArchives(familyId, page, query, documentDate)} disabled={busy}>Архивийг дахин ачаалах</button>}
            </div>
          </div>
        )}

        <form className="archive-filters" onSubmit={search} aria-label="Архив хайх">
          <label>
            <span>Гарчиг эсвэл тайлбар</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Жишээ нь: гэрчилгээ, захидал, 1978…"
            />
          </label>
          <label>
            <span>Баримтын огноо</span>
            <input
              type="date"
              value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)}
            />
          </label>
          <label><span>Он</span><input type="number" min={1} max={9998} value={year} onChange={(event) => setYear(event.target.value)} placeholder="1978" /></label>
          <label><span>Төрөл</span><select value={mediaType} onChange={(event) => setMediaType(event.target.value)}><option value="all">Бүгд</option><option value="image">📷 Зурагтай</option><option value="text">📝 Бичвэр</option></select></label>
          <div className="archive-filter-actions">
            <button type="submit" className="archive-primary" disabled={!familyId || busy}>Хайх</button>
            {(query || documentDate || year || mediaType !== 'all') && (
              <button type="button" className="archive-secondary" onClick={resetFilters} disabled={busy}>Цэвэрлэх</button>
            )}
          </div>
        </form>

        {loading && !archives ? (
          <section className="archive-state" aria-live="polite">
            <span className="archive-state-mark" aria-hidden="true" />
            <p className="archive-eyebrow">FAMILY ARCHIVE</p>
            <h2>Баримтуудыг нээж байна…</h2>
            <p>Таны одоогийн гэр бүлийн орчинд хандах боломжтой материалуудыг ачаалж байна.</p>
          </section>
        ) : !families.length ? (
          <section className="archive-state">
            <p className="archive-eyebrow">ГЭР БҮЛИЙН ОРОН ЗАЙ</p>
            <h2>Хандах боломжтой гэр бүл алга.</h2>
            <p>Архив харахын өмнө гэр бүлийн орчинд гишүүнээрээ хандах шаардлагатай.</p>
            <Link className="archive-secondary archive-link-button" href="/families">Гэр бүлүүд рүү очих</Link>
          </section>
        ) : archives && archives.items.length === 0 ? (
          <section className="archive-state">
            <p className="archive-eyebrow">ARCHIVE · ХООСОН</p>
            <h2>Одоогоор архивын материал олдсонгүй.</h2>
            <p>{query || documentDate || year || mediaType !== 'all' ? 'Таны хайлтын нөхцөлд тохирох материал байхгүй байна.' : 'Гэр бүлийн баримт, эх сурвалжаа энд бүртгэж эхлээрэй.'}</p>
            {query || documentDate || year || mediaType !== 'all' ? (
              <button type="button" className="archive-secondary" onClick={resetFilters}>Бүх материалыг харах</button>
            ) : canCreate ? (
              <Link className="archive-primary archive-link-button" href={`/archives/new?family=${encodeURIComponent(familyId)}`}>Анхны баримт нэмэх</Link>
            ) : null}
          </section>
        ) : (
          <>
            <div className="archive-results-heading">
              <div>
                <p className="archive-eyebrow">ОДООГИЙН ОРЧИН · {family?.name ?? 'Гэр бүл'}</p>
                <h2>Баримт, эх сурвалж</h2>
              </div>
              <span>{archives?.total ?? 0} материал{busy ? ' · шинэчилж байна…' : ''}</span>
            </div>

            <section className="archive-grid" aria-busy={busy} aria-label="Архивын материалууд">
              {archives?.items.map((archive) => (
                <article className="archive-card" key={archive.id}>
                  <div className="archive-paper">
                    <span className="archive-paper-label">ARCHIVE</span>
                    <span className="archive-paper-rule" aria-hidden="true" />
                    <strong>{archive.title.slice(0, 1).toUpperCase()}</strong>
                  </div>
                  <div className="archive-card-body">
                    <div className="archive-card-meta">
                      <time dateTime={archive.document_date ?? undefined}>{formatDate(archive.document_date)}</time>
                      <span>{visibilityLabel(archive.visibility)}</span>
                    </div>
                    <h3>{archive.title}</h3>
                    <p>{archive.description || 'Тайлбар оруулаагүй байна.'}</p>
                    <dl className="archive-card-facts">
                      <div><dt>Байршил</dt><dd>{archive.place || 'Бүртгэгдээгүй'}</dd></div>
                      <div><dt>Хадгалсан</dt><dd>{archive.author_name}</dd></div>
                      <div><dt>Холбоотой хүн</dt><dd>{archive.related_people_count}</dd></div>
                    </dl>
                    <div className="archive-card-footer">
                      <small>Шинэчилсэн {formatDateTime(archive.updated_at)}</small>
                      <Link href={`/archives/${archive.id}?family=${encodeURIComponent(familyId)}`}>Дэлгэрэнгүй →</Link>
                    </div>
                  </div>
                </article>
              ))}
            </section>

            {archives && archives.total > PAGE_SIZE && (
              <nav className="archive-pagination" aria-label="Архивын хуудаслалт">
                <button type="button" disabled={page <= 1 || busy} onClick={() => void loadArchives(familyId, page - 1, query, documentDate)}>← Өмнөх</button>
                <span>{page} / {pageCount}</span>
                <button type="button" disabled={!archives.has_next || busy} onClick={() => void loadArchives(familyId, page + 1, query, documentDate)}>Дараагийн →</button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}


export default function ArchivesPage() {
  return (
    <Suspense fallback={<main className="archive-page"><section className="archive-shell archive-state" aria-live="polite"><p className="archive-eyebrow">FAMILY ARCHIVE</p><h1>Архивийг нээж байна…</h1></section></main>}>
      <ArchivesPageContent />
    </Suspense>
  );
}
