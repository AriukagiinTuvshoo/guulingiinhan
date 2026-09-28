'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Archive } from '../../../lib/api';
import { useAppShellContext } from '../../../components/app-shell';

function formatDate(value: string | null) {
  if (!value) return 'Огноогүй';
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : value;
}
function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('mn-MN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}
function visibilityLabel(value: string) {
  if (value === 'private') return 'Зөвхөн би';
  if (value === 'public') return 'Нийтийн';
  return 'Гэр бүлийнхэн';
}

function ArchiveDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const archiveId = params.id ?? '';
  const searchParams = useSearchParams();
  const saved = searchParams.get('saved') === '1';
  const { currentFamily: family, familyId, contextLoading, contextLoaded, contextError } = useAppShellContext();
  const [archive, setArchive] = useState<Archive | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [notice, setNotice] = useState('');
  const familyRequestRef = useRef(0);
  const archiveRequestRef = useRef(0);
  const familyAbortRef = useRef<AbortController | null>(null);
  const archiveAbortRef = useRef<AbortController | null>(null);
  const mutationRequestRef = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const canMutate = family?.role === 'owner' || family?.role === 'editor';

  const loadArchive = useCallback(async (fid: string, id: string) => {
    const requestId = ++archiveRequestRef.current;
    archiveAbortRef.current?.abort();
    const controller = new AbortController();
    archiveAbortRef.current = controller;
    setLoading(true);
    setError('');
    setArchive(null);
    try {
      const result = await api<Archive>(`/families/${fid}/archives/${id}`, { signal: controller.signal });
      if (requestId !== archiveRequestRef.current) return;
      setArchive(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== archiveRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) { router.replace('/login'); return; }
      setError(cause instanceof ApiError && cause.status === 404
        ? 'Энэ архивын материал олдсонгүй.'
        : cause instanceof ApiError && cause.status === 403
          ? 'Энэ архивын материалд хандах эрхгүй байна.'
          : 'Архивийг ачааллахад алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      if (requestId === archiveRequestRef.current) setLoading(false);
    }
  }, [router]);

  const loadFamilyContext = useCallback(async () => {
    const requestId = ++familyRequestRef.current;
    archiveRequestRef.current += 1;
    archiveAbortRef.current?.abort();
    setLoading(true);
    setError('');
    setArchive(null);
    if (!archiveId) {
      setLoading(false);
      setError('Архивийн хаяг буруу байна.');
      return;
    }
    if (contextLoading || !contextLoaded) return;
    if (contextError) {
      setLoading(false);
      setError(contextError);
      return;
    }
    if (!family) {
      setLoading(false);
      setError('Гэр бүлийн орчинд хандах боломжгүй байна.');
      return;
    }
    if (requestId !== familyRequestRef.current) return;
    if (saved) setNotice('Архив хадгалагдлаа.');
    await loadArchive(family.id, archiveId);
  }, [archiveId, contextError, contextLoaded, contextLoading, family, loadArchive, saved]);

  useEffect(() => {
    void loadFamilyContext();
    return () => {
      familyRequestRef.current += 1;
      archiveAbortRef.current?.abort();
      mutationRequestRef.current += 1;
    };
  }, [loadFamilyContext]);
  useEffect(() => {
    if (!showDeleteDialog) return;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        setShowDeleteDialog(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, showDeleteDialog]);

  async function remove() {
    if (!archive || busy || !familyId) return;
    const mutationId = ++mutationRequestRef.current;
    setBusy(true);
    setError('');
    try {
      await api<void>(`/families/${familyId}/archives/${archive.id}`, { method: 'DELETE' });
      if (mutationId !== mutationRequestRef.current) return;
      router.replace(`/archives?family=${encodeURIComponent(familyId)}`);
    } catch (cause) {
      if (mutationId !== mutationRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) { router.replace('/login'); return; }
      setError(cause instanceof ApiError && cause.status === 403
        ? 'Энэ архивыг устгах эрхгүй байна.'
        : cause instanceof ApiError && cause.status === 404
          ? 'Архивын материал аль хэдийн устсан эсвэл олдсонгүй.'
          : 'Архивийг устгах үед алдаа гарлаа. Дахин оролдоно уу.');
      setBusy(false);
      setShowDeleteDialog(false);
    }
  }

  if (loading) {
    return (
      <main className="archive-page">
        <section className="archive-shell archive-detail-state" aria-live="polite">
          <span className="archive-state-mark" aria-hidden="true" />
          <p className="archive-eyebrow">FAMILY ARCHIVE · LOADING</p>
          <h1>Баримтыг нээж байна…</h1>
        </section>
      </main>
    );
  }

  if (error && !archive) {
    return (
      <main className="archive-page">
        <section className="archive-shell">
          <div className="archive-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadFamilyContext()}>Дахин оролдох</button>
          </div>
          <Link className="archive-secondary archive-link-button" href={familyId ? `/archives?family=${encodeURIComponent(familyId)}` : '/archives'}>← Бүх архив</Link>
        </section>
      </main>
    );
  }

  if (!archive) return null;

  return (
    <main className="archive-page">
      <article className="archive-shell archive-detail">
        <nav className="archive-breadcrumb" aria-label="Замын мөр">
          <Link href={`/archives?family=${encodeURIComponent(familyId)}`}>← Бүх архив</Link>
          <span>{family?.name ?? 'Гэр бүл'}</span>
        </nav>

        {error && (
          <div className="archive-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadArchive(familyId, archive.id)}>Дахин оролдох</button>
          </div>
        )}

        {notice && (
          <div className="archive-notice" role="status" aria-live="polite">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Мэдэгдлийг хаах">×</button>
          </div>
        )}

        <header className="archive-detail-header">
          <div className="archive-detail-intro">
            <p className="archive-eyebrow">FAMILY ARCHIVE · {family?.name ?? 'Гэр бүл'}</p>
            <p className="archive-detail-date">{formatDate(archive.document_date)}</p>
            <h1>{archive.title}</h1>
            <div className="archive-detail-meta">
              <span>{visibilityLabel(archive.visibility)}</span>
              <span>· Хадгалсан {archive.author_name}</span>
              <span>· Шинэчилсэн {formatDateTime(archive.updated_at)}</span>
            </div>
          </div>
          {canMutate && (
            <div className="archive-detail-actions">
              <Link className="archive-secondary" href={`/archives/${archive.id}/edit?family=${encodeURIComponent(familyId)}`}>Засах</Link>
              <button type="button" className="archive-danger" onClick={() => setShowDeleteDialog(true)} disabled={busy}>Архив устгах</button>
            </div>
          )}
        </header>

        <section className="archive-record" aria-labelledby="archive-record-heading">
          <div>
            <p className="archive-eyebrow">RECORD</p>
            <h2 id="archive-record-heading">Баримтын бүртгэл</h2>
          </div>
          <dl className="archive-detail-facts">
            <div><dt>Огноо</dt><dd>{formatDate(archive.document_date)}</dd></div>
            <div><dt>Байршил</dt><dd>{archive.place || 'Бүртгэгдээгүй'}</dd></div>
            <div><dt>Харагдах байдал</dt><dd>{visibilityLabel(archive.visibility)}</dd></div>
            <div><dt>Үүсгэсэн</dt><dd>{formatDateTime(archive.created_at)}</dd></div>
            <div><dt>Шинэчилсэн</dt><dd>{formatDateTime(archive.updated_at)}</dd></div>
          </dl>
        </section>

        <section className="archive-description" aria-labelledby="archive-description-heading">
          <p className="archive-eyebrow">DESCRIPTION</p>
          <h2 id="archive-description-heading">Тайлбар</h2>
          {archive.description ? <p>{archive.description}</p> : <p className="archive-muted">Энэ архивт тайлбар хадгалагдаагүй байна.</p>}
        </section>

        <section className="archive-related" aria-labelledby="archive-related-heading">
          <div className="archive-related-heading">
            <div>
              <p className="archive-eyebrow">RELATED PEOPLE</p>
              <h2 id="archive-related-heading">Холбоотой хүмүүс</h2>
            </div>
            <span>{archive.related_people_count}</span>
          </div>
          {archive.related_people.length ? (
            <div className="archive-related-grid">
              {archive.related_people.map((person) => (
                <Link
                  key={person.id}
                  className="archive-person-link"
                  href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                >
                  <span className="archive-person-mark" aria-hidden="true">
                    {[person.last_name, person.first_name].filter(Boolean).map((value) => value.slice(0, 1)).join('').toUpperCase() || '?'}
                  </span>
                  <span>{[person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ') || 'Нэргүй хүн'}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="archive-muted">Холбоотой хүн бүртгэгдээгүй байна.</p>
          )}
        </section>

        <section className="archive-source-note" aria-labelledby="archive-source-heading">
          <p className="archive-eyebrow">SOURCE MATERIAL</p>
          <h2 id="archive-source-heading">Эх материал</h2>
          <p>Одоогийн Archive API нь баримтын metadata-г дэмждэг бөгөөд файл, attachment эсвэл document viewer-ийн талбар expose хийхгүй байна. Тиймээс энэ дэлгэц хадгалагдсан record-ийг л харуулна.</p>
        </section>

        <footer className="archive-detail-footer">
          <Link href={`/archives?family=${encodeURIComponent(familyId)}`}>← Архивын сан</Link>
          {archive.related_people[0] && (
            <Link href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(archive.related_people[0].id)}`}>Хүний профайл →</Link>
          )}
        </footer>
      </article>

      {showDeleteDialog && (
        <div className="archive-dialog-backdrop" role="presentation">
          <section
            className="archive-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-delete-title"
            aria-describedby="archive-delete-description"
          >
            <p className="archive-eyebrow">DELETE ARCHIVE</p>
            <h2 id="archive-delete-title">Энэ архивийг устгах уу?</h2>
            <p id="archive-delete-description">“{archive.title}” record болон түүний холбоотой хүмүүсийн холбоос backend-ийн existing delete contract-ийн дагуу устна.</p>
            <div className="archive-dialog-actions">
              <button ref={cancelRef} type="button" className="archive-secondary" onClick={() => setShowDeleteDialog(false)} disabled={busy}>Буцах</button>
              <button type="button" className="archive-danger" onClick={() => void remove()} disabled={busy}>{busy ? 'Устгаж байна…' : 'Устгах'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function ArchiveDetailPage() {
  return (
    <Suspense fallback={<main className="archive-page"><section className="archive-shell archive-detail-state" aria-live="polite"><span className="archive-state-mark" aria-hidden="true" /><p className="archive-eyebrow">FAMILY ARCHIVE · LOADING</p><h1>Баримтыг нээж байна…</h1></section></main>}>
      <ArchiveDetailContent />
    </Suspense>
  );
}
