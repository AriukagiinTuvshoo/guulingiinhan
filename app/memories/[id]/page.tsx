'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { API_BASE, ApiError, api, Family, MemoryListItem } from '../../../lib/api';

type MemoryPhoto = NonNullable<MemoryListItem['photos']>[number];
type MemoryDetail = Omit<MemoryListItem, 'photos'> & { photos: MemoryPhoto[] };

const monthNames = ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар', '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'];

function formatMemoryDate(value: string | null) {
  if (!value) return 'Огноогүй';
  const parts = value.split('-');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return parts.length === 3 && month >= 1 && month <= 12 && day ? `${parts[0]} оны ${monthNames[month - 1]} ${day}` : value;
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('mn-MN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function visibilityLabel(value: string) {
  if (value === 'private') return 'Зөвхөн би';
  if (value === 'public') return 'Нийтийн';
  return 'Гэр бүлийнхэн';
}

function photoUrl(path: string) {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ дурсамжид хандах эрхгүй байна.';
    if (cause.status === 404) return 'Дурсамж олдсонгүй.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}

function MemoryDetailPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const [families, setFamilies] = useState<Family[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [familyId, setFamilyId] = useState('');
  const [memoryId, setMemoryId] = useState('');
  const [memory, setMemory] = useState<MemoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const familyRequestRef = useRef(0);
  const memoryRequestRef = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const loadMemory = useCallback(async (fid: string, mid: string) => {
    const requestId = ++memoryRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<MemoryDetail>(`/families/${fid}/memories/${mid}`);
      if (requestId !== memoryRequestRef.current) return;
      setMemory(result);
    } catch (cause) {
      if (requestId !== memoryRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setMemory(null);
      setError(friendlyError(cause, 'Дурсамжийг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    } finally {
      if (requestId === memoryRequestRef.current) setLoading(false);
    }
  }, [router]);

  const loadFamilyContext = useCallback(async () => {
    const requestId = ++familyRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const items = await api<Family[]>('/families');
      if (requestId !== familyRequestRef.current) return;
      memoryRequestRef.current += 1;
      const mid = params.id ?? '';
      setMemoryId(mid);
      if (!items.length) {
        setFamily(null);
        setFamilyId('');
        setMemory(null);
        setLoading(false);
        setError('Танд одоогоор хандах боломжтой гэр бүл алга.');
        return;
      }
      const requested = searchParams.get('family') ?? '';
      const selected = requested ? items.find((item) => item.id === requested) ?? null : items[0];
      if (!selected) {
        setFamily(null);
        setFamilyId('');
        setMemory(null);
        setLoading(false);
        setError('Энэ гэр бүлийн дурсамжийг харах боломжгүй байна.');
        return;
      }
      setFamilies(items);
      setFamily(selected);
      setFamilyId(selected.id);
      if (!mid) {
        setLoading(false);
        setError('Дурсамжийн хаяг буруу байна.');
        return;
      }
      if (!requested) {
        router.replace(`/memories/${mid}?family=${encodeURIComponent(selected.id)}`);
      }
      await loadMemory(selected.id, mid);
    } catch (cause) {
      if (requestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setMemory(null);
      setLoading(false);
      setError(friendlyError(cause, 'Гэр бүлийн орчныг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    }
  }, [loadMemory, params.id, router, searchParams]);

  useEffect(() => {
    void loadFamilyContext();
  }, [loadFamilyContext]);

  useEffect(() => {
    if (showDelete) cancelRef.current?.focus();
  }, [showDelete]);

  async function removeMemory() {
    if (!familyId || !memoryId || busy) return;
    setBusy(true);
    setError('');
    try {
      await api<void>(`/families/${familyId}/memories/${memoryId}`, { method: 'DELETE' });
      router.replace(`/memories?family=${encodeURIComponent(familyId)}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(friendlyError(cause, 'Дурсамжийг устгах үед алдаа гарлаа. Дахин оролдоно уу.'));
      setShowDelete(false);
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="memories-page">
        <section className="memories-shell memory-detail-state" aria-live="polite">
          <span className="memory-state-mark" aria-hidden="true" />
          <p className="memories-eyebrow">MEMORY · LOADING</p>
          <h1>Дурсамжийг нээж байна…</h1>
        </section>
      </main>
    );
  }

  if (error && !memory) {
    return (
      <main className="memories-page">
        <section className="memories-shell">
          <div className="memories-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void loadFamilyContext()}>Дахин оролдох</button></div>
          <Link className="memories-secondary memories-link-button" href={familyId ? `/memories?family=${encodeURIComponent(familyId)}` : '/memories'}>← Бүх дурсамж</Link>
        </section>
      </main>
    );
  }

  if (!memory) return null;

  return (
    <main className="memories-page">
      <article className="memories-shell memory-detail">
        <nav className="memories-breadcrumb" aria-label="Замын мөр">
          <Link href={`/memories?family=${encodeURIComponent(familyId)}`}>← Бүх дурсамж</Link>
          <span>{family?.name ?? 'Гэр бүл'}</span>
        </nav>

        {error && <div className="memories-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void loadMemory(familyId, memoryId)}>Дахин оролдох</button></div>}

        <header className="memory-detail-header">
          <div>
            <p className="memories-eyebrow">ГЭР БҮЛИЙН ДУРСАМЖ · {family?.name ?? 'Гэр бүл'}</p>
            <p className="memory-detail-date">{formatMemoryDate(memory.memory_date)}</p>
            <h1>{memory.title}</h1>
            <div className="memory-detail-meta">
              <span>{visibilityLabel(memory.visibility)}</span>
              <span>· Хадгалсан {formatCreatedAt(memory.created_at)}</span>
              <span>· {memory.person_ids.length} холбоотой хүн</span>
            </div>
          </div>
          <button type="button" className="memories-danger" onClick={() => setShowDelete(true)} disabled={busy}>Дурсамж устгах</button>
        </header>

        <section className="memory-detail-body" aria-labelledby="memory-detail-content">
          <h2 id="memory-detail-content">Энэ мөчийн тухай</h2>
          {memory.description ? <p>{memory.description}</p> : <p className="memory-muted">Энэ дурсамжид нэмэлт тайлбар хадгалагдаагүй байна.</p>}
        </section>

        <section className="memory-detail-photos" aria-labelledby="memory-detail-photos-heading">
          <div className="memory-detail-section-heading">
            <div>
              <p className="memories-eyebrow">MEMORY PHOTOS</p>
              <h2 id="memory-detail-photos-heading">Зураг</h2>
            </div>
            <span>{memory.photos.length}</span>
          </div>
          {memory.photos.length ? (
            <div className="memory-detail-gallery">
              {memory.photos.map((photo) => (
                <figure key={photo.id}>
                  <img src={photoUrl(photo.content_url)} alt={photo.title ?? `${memory.title} дурсамжийн зураг`} loading="lazy" crossOrigin="use-credentials" onError={(event) => { const image = event.currentTarget; image.alt = 'Зураг ачааллах боломжгүй байна.'; image.style.display = 'none'; image.parentElement?.classList.add('memory-photo-fallback'); }} />
                  {photo.title && <figcaption>{photo.title}</figcaption>}
                </figure>
              ))}
            </div>
          ) : (
            <div className="memory-detail-no-photos">Энэ дурсамжид зураг хадгалагдаагүй байна.</div>
          )}
        </section>

        <section className="memory-detail-people" aria-labelledby="memory-detail-people-heading">
          <h2 id="memory-detail-people-heading">Холбоотой хүмүүс</h2>
          {memory.person_ids.length ? (
            <div className="memory-related-people">
              {memory.person_ids.map((personId) => (
                <Link key={personId} href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(personId)}`}>
                  Хүний профайлыг үзэх
                </Link>
              ))}
            </div>
          ) : <p className="memory-muted">Холбоотой хүн бүртгэгдээгүй байна.</p>}
        </section>

        <footer className="memory-detail-footer">
          <Link href={`/tree?family=${encodeURIComponent(familyId)}`}>← Удмын мод руу буцах</Link>
          <Link href={`/memories?family=${encodeURIComponent(familyId)}`}>← Дурсамжийн архив</Link>
          <span>Бүх өгөгдөл одоогийн family context болон backend authorization-аар шүүгдэнэ.</span>
        </footer>
      </article>

      {showDelete && (
        <div className="memory-dialog-backdrop" role="presentation">
          <section className="memory-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-delete-title" aria-describedby="memory-delete-description">
            <p className="memories-eyebrow">DELETE MEMORY</p>
            <h2 id="memory-delete-title">Энэ дурсамжийг устгах уу?</h2>
            <p id="memory-delete-description">“{memory.title}” дурсамж болон түүнтэй холбоотой memory photo өгөгдөл backend-ийн existing delete contract-ийн дагуу устгагдана.</p>
            <div className="memory-dialog-actions">
              <button ref={cancelRef} type="button" className="memories-secondary" onClick={() => setShowDelete(false)} disabled={busy}>Буцах</button>
              <button type="button" className="memories-danger" onClick={() => void removeMemory()} disabled={busy}>{busy ? 'Устгаж байна…' : 'Устгах'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}


export default function MemoryDetailPage() {
  return (
    <Suspense fallback={<main className="memories-page"><section className="memories-shell memory-detail-state" aria-live="polite"><span className="memory-state-mark" aria-hidden="true" /><p className="memories-eyebrow">MEMORY · LOADING</p><h1>Дурсамжийг нээж байна…</h1></section></main>}>
      <MemoryDetailPageContent />
    </Suspense>
  );
}
