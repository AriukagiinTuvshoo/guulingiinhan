'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, ArchiveListPage, Family, Person } from '../../lib/api';

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
  const searchParams = useSearchParams();
  const requestedFamilyId = searchParams.get('family') ?? '';
  const requestedPersonId = searchParams.get('person') ?? '';
  const router = useRouter();
  const [family, setFamily] = useState<Family | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [personId, setPersonId] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [query, setQuery] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const familyRequestRef = useRef(0);
  const archiveRequestRef = useRef(0);

  const loadArchives = useCallback(async (
    fid: string,
    page = 1,
    q = query,
    dateValue = documentDate,
  ) => {
    if (!fid) return;
    const requestId = ++archiveRequestRef.current;
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
      const result = personId && !q && !dateValue ? await api<ArchiveListPage>(`/families/${fid}/persons/${personId}/archives?page=${page}&page_size=${PAGE_SIZE}`) : await api<ArchiveListPage>(`/families/${fid}/archives?${params.toString()}`);
      if (requestId !== archiveRequestRef.current) return;
      setArchives(result);
    } catch (cause) {
      if (requestId !== archiveRequestRef.current) return;
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
  }, [personId, router]);

  const loadFamilies = useCallback(async () => {
    const requestId = ++familyRequestRef.current;
    archiveRequestRef.current += 1;
    setLoading(true);
    setError('');
    setFamily(null);
    setFamilyId('');
    setArchives(null);
    try {
      const items = await api<Family[]>('/families');
      if (requestId !== familyRequestRef.current) return;
      setFamilies(items);
      if (!items.length) {
        setLoading(false);
        return;
      }
      if (requestedFamilyId) {
        const selected = items.find((item) => item.id === requestedFamilyId);
        if (!selected) {
          setLoading(false);
          setError('Сонгосон гэр бүлийн орчинд хандах боломжгүй байна.');
          return;
        }
        setFamily(selected);
        setFamilyId(selected.id);
        setPersonId(requestedPersonId);
        return;
      }
      const selected = items[0];
      setFamily(selected);
      setFamilyId(selected.id);
      router.replace(`/archives?family=${encodeURIComponent(selected.id)}`);
    } catch (cause) {
      if (requestId !== familyRequestRef.current) return;
      setLoading(false);
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError('Гэр бүлийн орчныг ачааллахад алдаа гарлаа. Дахин оролдоно уу.');
    }
  }, [requestedFamilyId, router]);

  useEffect(() => {
    void loadFamilies();
  }, [loadFamilies]);

  useEffect(() => {
    if (!familyId) return;
    void loadArchives(familyId, 1);
  }, [familyId, loadArchives, personId]);

  function chooseFamily(next: string) {
    archiveRequestRef.current += 1;
    const selected = families.find((item) => item.id === next) ?? null;
    setFamily(selected);
    setFamilyId(next);
    setArchives(null);
    setError('');
    const params = new URLSearchParams({ family: next }); if (personId) params.set('person', personId); router.replace(`/archives?${params.toString()}`);
  }

  useEffect(() => {
    if (!familyId || !personId) { setPerson(null); return; }
    const requestId = ++familyRequestRef.current;
    void api<Person>(`/families/${familyId}/persons/${personId}`).then((result) => { if (requestId === familyRequestRef.current) setPerson(result); }).catch(() => { if (requestId === familyRequestRef.current) setPerson(null); });
  }, [familyId, personId]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!familyId) return;
    void loadArchives(familyId, 1, query, documentDate);
  }

  function resetFilters() {
    setQuery('');
    setDocumentDate('');
    if (familyId) void loadArchives(familyId, 1, '', '');
  }

  const page = archives?.page ?? 1;
  const pageCount = archives ? Math.max(1, Math.ceil(archives.total / PAGE_SIZE)) : 1;
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

        {personId && person && <div className="archive-alert" role="status"><span>Хүний архив: <strong>{[person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ')}</strong></span><button type="button" onClick={() => { setPersonId(''); router.replace(`/archives?family=${encodeURIComponent(familyId)}`); }}>Шүүлтүүрийг арилгах</button></div>}

        {error && (
          <div className="archive-alert" role="alert">
            <span>{error}</span>
            <div className="archive-alert-actions">
              <button type="button" onClick={() => void loadFamilies()}>Гэр бүлийн орчныг дахин ачаалах</button>
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
          <div className="archive-filter-actions">
            <button type="submit" className="archive-primary" disabled={!familyId || busy}>Хайх</button>
            {(query || documentDate) && (
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
            <p>{query || documentDate ? 'Таны хайлтын нөхцөлд тохирох материал байхгүй байна.' : 'Гэр бүлийн баримт, эх сурвалжаа энд бүртгэж эхлээрэй.'}</p>
            {query || documentDate ? (
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
