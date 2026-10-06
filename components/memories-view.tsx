'use client';

import Link from 'next/link';
import MemoryInteractions from './memory-interactions';
import ContextualPersonSearch from './contextual-person-search';
import HeritageBranchFilter from './heritage-branch-filter';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, ApiError, api, MemoryListItem, PersonSearchPage } from '../lib/api';
import { memoryDraftError } from '../lib/memory-draft';
import { useAppShellContext } from './app-shell';

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ гэр бүлийн дурсамжид хандах эрхгүй байна.';
    if (cause.status === 404) return 'Дурсамж олдсонгүй.';
    if (cause.status === 409) return 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна. Дахин оролдоно уу.';
    if (cause.status === 413) return 'Зургийн хэмжээ серверийн зөвшөөрсөн хязгаараас хэтэрсэн байна.';
    if (cause.status === 422) return 'Оруулсан мэдээлэл эсвэл зурагны төрлийг шалгана уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}

const PAGE_SIZE = 18;

type MemoryPhoto = NonNullable<MemoryListItem['photos']>[number];
type MemoryListPage = {
  items: MemoryListItem[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};
type SelectedPerson = { id: string; name: string };

const monthNames = ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар', '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'];

function formatMemoryDate(value: string | null) {
  if (!value) return 'Огноогүй';
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return month >= 1 && month <= 12 && day ? `${parts[0]} оны ${monthNames[month - 1]} ${day}` : value;
}

function formatCreatedAt(value: string) {
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

function photoUrl(path: string) {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

function initials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')
    .toUpperCase() || 'Д';
}

function MemoriesPageContent({ createMode = false }: { createMode?: boolean }) {
  const router = useRouter();
  const { families, currentFamily: family, familyId, contextError, contextLoading } = useAppShellContext();
  const [memories, setMemories] = useState<MemoryListPage | null>(null);
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<PersonSearchPage | null>(null);
  const [personPage, setPersonPage] = useState(1);
  const [selectedPeople, setSelectedPeople] = useState<SelectedPerson[]>([]);
  const [showComposer, setShowComposer] = useState(createMode);
  const [partialMemoryId, setPartialMemoryId] = useState('');
  const [loading, setLoading] = useState(!createMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [composerError, setComposerError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [memoryPage, setMemoryPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', year: '', memory_date: '', person_id: '', branch_id: '' });
  const [filterPersonName, setFilterPersonName] = useState('');
  const [failedPhotoIds, setFailedPhotoIds] = useState<Set<string>>(() => new Set());
  const familyRequestRef = useRef(0);
  const memoryRequestRef = useRef(0);
  const personRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const familyAbortRef = useRef<AbortController | null>(null);
  const memoryAbortRef = useRef<AbortController | null>(null);
  const personAbortRef = useRef<AbortController | null>(null);

  const loadMemories = useCallback(async (fid: string, page = 1) => {
    if (!fid) return;
    const requestId = ++memoryRequestRef.current;
    memoryAbortRef.current?.abort();
    const controller = new AbortController();
    memoryAbortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      Object.entries(filters).forEach(([key, value]) => { if (value.trim()) query.set(key, value.trim()); });
      const result = await api<MemoryListPage>(`/families/${fid}/memories?${query}`, { signal: controller.signal });
      if (requestId !== memoryRequestRef.current) return;
      setMemoryPage(result.page);
      setMemories(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== memoryRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(friendlyError(cause, 'Дурсамжийг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    } finally {
      if (requestId === memoryRequestRef.current) setLoading(false);
    }
  }, [router, filters]);

  useEffect(() => {
    familyRequestRef.current += 1;
    memoryAbortRef.current?.abort();
    personAbortRef.current?.abort();
    memoryRequestRef.current += 1;
    personRequestRef.current += 1;
    setMemories(null);
    setPersonResults(null);
    setSelectedPeople([]);
    setPartialMemoryId('');
    setError('');
    setComposerError('');
    setShowComposer(createMode);
    if (!familyId || createMode) { setLoading(false); return; }
    void loadMemories(familyId, 1);
  }, [familyId, loadMemories, createMode]);

  useEffect(() => () => {
    familyAbortRef.current?.abort();
    memoryAbortRef.current?.abort();
    personAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const safeQuery = personQuery.replace(/\s+/g, ' ').trim();
    personAbortRef.current?.abort();
    if (!familyId || !safeQuery) {
      personRequestRef.current += 1;
      setPersonResults(null);
      return;
    }
    const requestId = ++personRequestRef.current;
    const controller = new AbortController();
    personAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      void api<PersonSearchPage>(`/families/${familyId}/persons/search?q=${encodeURIComponent(safeQuery)}&page=1&page_size=20`, { signal: controller.signal })
        .then((result) => {
          if (requestId !== personRequestRef.current) return;
          setPersonResults(result);
          setPersonPage(1);
        })
        .catch((cause) => {
          if (controller.signal.aborted || requestId !== personRequestRef.current) return;
          setComposerError(friendlyError(cause, 'Хайлт хийхэд алдаа гарлаа. Дахин оролдоно уу.'));
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (personAbortRef.current === controller) personAbortRef.current = null;
    };
  }, [familyId, personQuery]);

  function chooseFamily(next: string) {
    familyRequestRef.current += 1;
    memoryRequestRef.current += 1;
    personRequestRef.current += 1;
    familyAbortRef.current?.abort();
    memoryAbortRef.current?.abort();
    personAbortRef.current?.abort();
    const selected = families.find((item) => item.id === next) ?? null;
    if (!selected) return;

    setFilters({ q: '', year: '', memory_date: '', person_id: '', branch_id: '' });
    setFilterPersonName('');
    setMemories(null);
    setMemoryPage(1);
    setSelectedPeople([]);
    setPersonQuery('');
    setPersonResults(null);
    setPersonPage(1);
    setShowComposer(false);
    setFailedPhotoIds(new Set());
    setError('');
    setComposerError('');
    router.replace(`/memories${createMode ? '/new' : ''}?family=${encodeURIComponent(next)}`);
  }

  function togglePerson(person: SelectedPerson) {
    setSelectedPeople((current) => current.some((item) => item.id === person.id)
      ? current.filter((item) => item.id !== person.id)
      : current.length >= 100 ? current : [...current, person]);
  }

  async function loadMorePeople() {
    if (!familyId || !personResults?.has_next) return;
    const safeQuery = personQuery.replace(/\s+/g, ' ').trim();
    const nextPage = personPage + 1;
    const requestId = ++personRequestRef.current;
    personAbortRef.current?.abort();
    const controller = new AbortController();
    personAbortRef.current = controller;
    try {
      const next = await api<PersonSearchPage>(`/families/${familyId}/persons/search?q=${encodeURIComponent(safeQuery)}&page=${nextPage}&page_size=20`, { signal: controller.signal });
      if (requestId !== personRequestRef.current) return;
      setPersonResults((current) => current ? { ...next, items: [...current.items, ...next.items] } : next);
      setPersonPage(nextPage);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== personRequestRef.current) return;
      setComposerError(friendlyError(cause, 'Үр дүнг ачаалж чадсангүй. Дахин оролдоно уу.'));
    }
  }

  async function createMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!familyId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const operationFamilyId = familyId;
    const operationFamilyRequestId = familyRequestRef.current;
    const mutationRequestId = ++mutationRequestRef.current;
    setBusy(true);
    setComposerError('');
    setUploadStatus('');
    const files = form.getAll('photos').filter((value): value is File => value instanceof File && value.size > 0);
    const title = String(form.get('title') ?? '').trim();
    const visibility = String(form.get('visibility') ?? 'family');
    const validationError = memoryDraftError(title, visibility, files);
    if (validationError) {
      setComposerError(validationError);
      setBusy(false);
      return;
    }
    let createdId = '';
    try {
      const created = await api<{ id: string }>(`/families/${familyId}/memories`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: String(form.get('description') ?? '').trim() || null,
          memory_date: String(form.get('memory_date') ?? '') || null,
          visibility,
          person_ids: selectedPeople.map((person) => person.id),
        }),
      });
      createdId = created.id;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadStatus(`Зураг хадгалж байна… ${index + 1}/${files.length}`);
        const saved = await api<MemoryPhoto>(`/families/${familyId}/memories/${created.id}/photos`, {
          method: 'POST',
          body: file,
          headers: {
            'Content-Type': file.type,
            'X-File-Name': encodeURIComponent(file.name),
          },
        });
        if (selectedPeople.length) {
          await api(`/families/${familyId}/photos/${saved.id}/tags`, {
            method: 'PUT',
            body: JSON.stringify({ person_ids: selectedPeople.map((person) => person.id) }),
          });
        }
      }
      if (operationFamilyRequestId !== familyRequestRef.current) return;
      formElement.reset();
      setSelectedPeople([]);
      setPersonQuery('');
      setPersonResults(null);
      setShowComposer(false);
      setUploadStatus('');
      if (createMode) { router.push(`/memories/${created.id}?family=${encodeURIComponent(operationFamilyId)}`); return; }
      await loadMemories(operationFamilyId, 1);
    } catch (cause) {
      if (operationFamilyRequestId === familyRequestRef.current) {
        if (createdId) {
          setPartialMemoryId(createdId); setShowComposer(false); setUploadStatus('');
          setComposerError('Дурсамж хадгалагдсан боловч зарим зураг хадгалагдсангүй. Дурсамжаа нээгээд дутуу зургийг нэмнэ үү. Дахин дурсамж үүсгэх шаардлагагүй.');
          if (!createMode) await loadMemories(operationFamilyId, 1);
        } else setComposerError(friendlyError(cause, 'Дурсамж хадгалж чадсангүй.'));
      }
    } finally {
      if (mutationRequestId === mutationRequestRef.current) setBusy(false);
    }
  }

  const currentPage = memoryPage;
  const pageCount = memories ? Math.max(1, Math.ceil(memories.total / PAGE_SIZE)) : 1;

  return (
    <main className="memories-page">
      <section className="memories-shell">
        <nav className="memories-breadcrumb" aria-label="Замын мөр">
          <Link href={family ? `/dashboard?family=${encodeURIComponent(family.id)}` : '/dashboard'}>← Dashboard</Link>
          <span>Дурсамж</span>
        </nav>

        <header className="memories-hero">
          <div>
            <p className="memories-eyebrow">ГУУЛИНГИЙНХАН · MEMORY ARCHIVE</p>
            <h1>{createMode ? 'Шинэ дурсамж' : 'Гэр бүлийн дурсамж'}</h1>
            <p>Өдөр тутмын жижиг мөчөөс эхлээд үе дамжин үлдэх гэрэл зураг, тэмдэглэлүүдээ гэр бүлийнхээ орчинд цэгцтэй хадгал.</p>
          </div>
          <div className="memories-hero-actions">
            {families.length > 0 && (
              <label className="memories-family-picker">
                <span>Гэр бүл</span>
                <select value={familyId} onChange={(event) => chooseFamily(event.target.value)} aria-label="Гэр бүл сонгох" disabled={busy}>
                  <option value="">Гэр бүл сонгох</option>
                  {families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            {familyId && !createMode && (
              <button
                type="button"
                className="memories-primary"
                onClick={() => setShowComposer((value) => !value)}
                aria-expanded={showComposer}
                aria-controls="memory-composer"
              >
                {showComposer ? 'Нэмэх хэсгийг хаах' : '+ Дурсамж нэмэх'}
              </button>
            )}
          </div>
        </header>

        {contextError && <div className="memories-alert" role="alert"><span>{contextError}</span><button type="button" onClick={() => window.location.reload()}>Дахин ачаалах</button></div>}
        {error && (
          <div className="memories-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadMemories(familyId, currentPage)} disabled={loading}>Дахин оролдох</button>
          </div>
        )}

        {composerError && (
          <div id="memory-create-error" className="memories-alert memories-alert--composer" role="alert">
            <span>{composerError}</span>
            <button type="button" onClick={() => setComposerError('')}>Хаах</button>
          </div>
        )}

        {partialMemoryId && <Link className="memories-primary memories-link-button" href={`/memories/${partialMemoryId}?family=${encodeURIComponent(familyId)}`}>Хадгалагдсан дурсамжийг нээх →</Link>}
        {createMode && !familyId && <section className="memory-state" role="status"><h2>{contextLoading ? 'Гэр бүлийн орчныг шалгаж байна…' : 'Гэр бүлээ сонгоно уу.'}</h2><p>Дурсамжийг ямар гэр бүлд хадгалахаа дээрх сонголтоор батална.</p></section>}
        {showComposer && familyId && (
          <section id="memory-composer" className="memory-composer" aria-labelledby="memory-composer-heading">
            <div className="memory-composer-heading">
              <div>
                <p className="memories-eyebrow">НОМЫН ХУУДАС · НЭМЭХ</p>
                <h2 id="memory-composer-heading">Шинэ дурсамж</h2>
              </div>
              <span>Зөвхөн одоогийн гэр бүлийн орчинд хадгалагдана.</span>
            </div>
            <form key={familyId} className="memory-composer-form" onSubmit={createMemory} aria-describedby={composerError ? 'memory-create-error' : undefined}>
              <label>
                <span>Гарчиг *</span>
                <input name="title" maxLength={180} required placeholder="Жишээ нь: Зуны наадмын өдөр" />
              </label>
              <label>
                <span>Огноо</span>
                <input name="memory_date" type="date" />
              </label>
              <label className="memory-composer-wide">
                <span>Тайлбар</span>
                <textarea name="description" maxLength={20000} rows={5} placeholder="Энэ мөчийн тухай санаанд үлдсэн зүйлс…" />
              </label>
              <label>
                <span>Зураг</span>
                <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="memory-photo-help" />
                <small id="memory-photo-help">Зураг заавал биш. JPEG, PNG, WebP; нэг зураг 10 MB-аас ихгүй, нэг удаад 20 хүртэл.</small>
              </label>
              <label>
                <span>Харагдах байдал</span>
                <select name="visibility" defaultValue="family">
                  <option value="family">Гэр бүлийнхэн</option>
                  <option value="private">Зөвхөн би</option>
                  <option value="public">Нийтийн</option>
                </select>
              </label>
              <label className="memory-composer-wide">
                <span>Холбоотой хүн</span>
                <input
                  value={personQuery}
                  onChange={(event) => setPersonQuery(event.target.value)}
                  placeholder="Нэрээр хайх…"
                  aria-describedby="memory-person-help"
                />
                <small id="memory-person-help">Дурсамжтай холбоотой хүмүүсийг нэрээр хайж сонгоно уу.</small>
              </label>
              {selectedPeople.length > 0 && (
                <div className="memory-selected-people" aria-label="Сонгосон хүмүүс">
                  {selectedPeople.map((person) => (
                    <button key={person.id} type="button" onClick={() => togglePerson(person)} aria-label={`${person.name} холбоосыг хасах`}>
                      {person.name} ×
                    </button>
                  ))}
                </div>
              )}
              {personQuery.trim() && personResults && (
                <div className="memory-person-results" aria-label="Хайлтын үр дүн">
                  {personResults.items.length ? personResults.items.map((person) => {
                    const selected = selectedPeople.some((item) => item.id === person.id);
                    return (
                      <button key={person.id} type="button" aria-pressed={selected} onClick={() => togglePerson({ id: person.id, name: person.name })}>
                        {selected ? '✓ ' : '+ '}{person.name}{person.birth_year ? ` · ${person.birth_year}` : ''}<small>{person.branch_name ?? person.family_name}</small>
                      </button>
                    );
                  }) : <p>Тохирох хүн олдсонгүй.</p>}
                  {personResults.has_next && <button type="button" className="memory-person-more" onClick={() => void loadMorePeople()}>Дараагийн үр дүн</button>}
                </div>
              )}
              {personQuery.trim() && !personResults && <p className="memory-search-status" role="status">Хайж байна…</p>}
              <div className="memory-composer-actions">
                <button type="button" className="memories-secondary" onClick={() => createMode ? router.push(`/memories?family=${encodeURIComponent(familyId)}`) : setShowComposer(false)} disabled={busy}>Буцах</button>
                <button type="submit" className="memories-primary" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Дурсамж хадгалах'}</button>
              </div>
            </form>
            {uploadStatus && <p className="memory-upload-status" role="status" aria-live="polite">{uploadStatus}</p>}
          </section>
        )}

        {!createMode && familyId && <form className="heritage-filters" onSubmit={(event) => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          setFilters((current) => ({ ...current, q: String(values.get('q') ?? ''), year: String(values.get('year') ?? ''), memory_date: String(values.get('memory_date') ?? '') }));
        }}>
          <label>Дурсамж хайх<input name="q" maxLength={120} placeholder="Гарчиг, тайлбар…" /></label>
          <label>Он<input name="year" type="number" min={1} max={9998} placeholder="1998" /></label>
          <label>Огноо<input name="memory_date" type="date" /></label>
          <HeritageBranchFilter key={`branch-${familyId}`} familyId={familyId} value={filters.branch_id} onChange={(branch_id) => setFilters((current) => ({ ...current, branch_id }))} />
          <ContextualPersonSearch key={familyId} familyId={familyId} onSelect={(id, name) => { setFilterPersonName(name); setFilters((current) => ({ ...current, person_id: id })); }} />
          {filters.person_id && <button type="button" onClick={() => { setFilters((current) => ({ ...current, person_id: '' })); setFilterPersonName(''); }}>{filterPersonName} ×</button>}
          <button type="submit">Хайх</button>
          <button type="reset" onClick={() => { setFilterPersonName(''); setFilters({ q: '', year: '', memory_date: '', person_id: '', branch_id: '' }); }}>Цэвэрлэх</button>
        </form>}
        {!createMode && (loading && !memories ? (
          <section className="memory-state" aria-live="polite">
            <span className="memory-state-mark" aria-hidden="true" />
            <p className="memories-eyebrow">MEMORIES</p>
            <h2>Дурсамжийн хуудсыг нээж байна…</h2>
            <p>Гэр бүлийн тань хадгалсан мөчүүдийг аюулгүйгээр ачаалж байна.</p>
          </section>
        ) : !families.length ? (
          <section className="memory-state">
            <p className="memories-eyebrow">ГЭР БҮЛИЙН ОРОН ЗАЙ</p>
            <h2>Хандах боломжтой гэр бүл алга.</h2>
            <p>Дурсамж харахын өмнө гэр бүлийн орчинд гишүүнээрээ хандах шаардлагатай.</p>
            <Link className="memories-secondary memories-link-button" href="/families">Гэр бүлүүд рүү очих</Link>
          </section>
        ) : memories && memories.items.length === 0 ? (
          <section className="memory-state">
            <p className="memories-eyebrow">MEMORY ARCHIVE · ХООСОН</p>
            <h2>{Object.values(filters).some(Boolean) ? 'Хайлтад тохирох дурсамж алга.' : 'Одоогоор дурсамж хадгалагдаагүй байна.'}</h2>
            <p>Эхний дурсамжаа нэмээд гэр бүлийн тань өдөр тутмын мөчүүдийг энэ архивт үлдээгээрэй.</p>
            <button type="button" className="memories-primary" onClick={() => setShowComposer(true)} aria-controls="memory-composer">Анхны дурсамж нэмэх</button>
          </section>
        ) : (
          <>
            <div className="memories-results-heading">
              <div>
                <p className="memories-eyebrow">ОДООГИЙН ОРЧИН · {family?.name ?? 'Гэр бүл'}</p>
                <h2>Хадгалсан мөчүүд</h2>
              </div>
              <span>{memories?.total ?? 0} дурсамж</span>
            </div>

            <section className="memory-grid" aria-busy={loading} aria-label="Гэр бүлийн дурсамжууд">
              {memories?.items.map((memory) => (
                <article className="memory-card" key={memory.id}>
                  {memory.photos?.length ? (
                    <div className={`memory-card-gallery memory-card-gallery--${Math.min(memory.photos.length, 3)}`} aria-label={`${memory.photos.length} зураг`}>
                      {memory.photos.slice(0, 3).map((photo) => failedPhotoIds.has(photo.id) ? (
                        <span key={photo.id} className="memory-photo-fallback" role="status">Зураг ачааллах боломжгүй байна.</span>
                      ) : (
                        <img
                          key={photo.id}
                          src={photoUrl(photo.thumbnail_url)}
                          alt={photo.title ?? `${memory.title} дурсамжийн зураг`}
                          loading="lazy"
                          crossOrigin="use-credentials"
                          onError={() => setFailedPhotoIds((current) => {
                            const next = new Set(current);
                            next.add(photo.id);
                            return next;
                          })}
                        />
                      ))}
                      {memory.photos.length > 3 && <span className="memory-photo-count">+{memory.photos.length - 3}</span>}
                    </div>
                  ) : (
                    <div className="memory-card-paper" aria-hidden="true">
                      <span>{initials(memory.title)}</span>
                    </div>
                  )}

                  <div className="memory-card-body">
                    <div className="memory-card-meta">
                      <time dateTime={memory.memory_date ?? undefined}>{formatMemoryDate(memory.memory_date)}</time>
                      <span>{visibilityLabel(memory.visibility)}</span>
                    </div>
                    <h3>{memory.title}</h3>
                    {memory.description && <p>{memory.description}</p>}
                    <div className="memory-card-footer">
                      <span>{memory.person_names?.length ? memory.person_ids.map((personId, index) => (
                        <Link key={personId} href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(personId)}`} className="memory-person-link">
                          {memory.person_names?.[index] ?? 'Холбоотой хүн'}
                        </Link>
                      )) : 'Холбоотой хүнгүй'}</span>
                      <small>{memory.author_name ? `${memory.author_name} · ` : ''}Хадгалсан {formatCreatedAt(memory.created_at)}</small>
                    </div>
                    <Link className="memory-card-link" href={`/memories/${memory.id}?family=${encodeURIComponent(familyId)}`}>Дурсамжийг үзэх →</Link>
                  </div>
                  <MemoryInteractions memoryId={memory.id} initial={memory.like_count !== undefined ? { liked: memory.liked ?? false, like_count: memory.like_count, comment_count: memory.comment_count ?? 0 } : undefined} />
                </article>
              ))}
            </section>

            {memories && memories.total > PAGE_SIZE && (
              <nav className="memory-pagination" aria-label="Дурсамжийн хуудаслалт">
                <button type="button" disabled={currentPage <= 1 || loading} onClick={() => void loadMemories(familyId, currentPage - 1)}>← Өмнөх</button>
                <span>{currentPage} / {pageCount}</span>
                <button type="button" disabled={!memories.has_next || loading} onClick={() => void loadMemories(familyId, currentPage + 1)}>Дараагийн →</button>
              </nav>
            )}
          </>
        ))}
      </section>
    </main>
  );
}


export default function MemoriesView({ createMode = false }: { createMode?: boolean }) {
  return (
    <Suspense fallback={<main className="memories-page"><section className="memories-shell memory-state" aria-live="polite"><span className="memory-state-mark" aria-hidden="true" /><p className="memories-eyebrow">MEMORIES</p><h1>Дурсамжийг ачаалж байна…</h1></section></main>}>
      <MemoriesPageContent createMode={createMode} />
    </Suspense>
  );
}
