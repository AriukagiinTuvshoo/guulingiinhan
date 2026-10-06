'use client';

import Link from 'next/link';
import MemoryInteractions from '../../../components/memory-interactions';
import ProtectedImageViewer from '../../../components/protected-image-viewer';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { API_BASE, ApiError, api, MemoryListItem, MemoryPhoto, MemoryPhotoPage } from '../../../lib/api';
import { useAppShellContext } from '../../../components/app-shell';
import MemoryPhotoInput from '../../../components/memory-photo-input';
import { memoryDraftError } from '../../../lib/memory-draft';

type MemoryDetail = Omit<MemoryListItem, 'photos'> & {
  photos: MemoryPhoto[];
  photos_total: number;
  photos_has_next: boolean;
  author_name?: string;
  can_edit: boolean;
};

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
    if (cause.status === 400) return 'Оруулсан мэдээллээ шалгана уу.';
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ дурсамжид хандах эрхгүй байна.';
    if (cause.status === 404) return 'Дурсамж олдсонгүй.';
    if (cause.status === 409) return 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна. Дахин оролдоно уу.';
    if (cause.status === 413) return 'Зургийн хэмжээ серверийн зөвшөөрсөн хязгаараас хэтэрсэн байна.';
    if (cause.status === 415) return 'Зургийн файл гэмтсэн эсвэл JPEG, PNG, WebP төрлүүдийн аль нь ч биш байна.';
    if (cause.status === 422) return 'Оруулсан мэдээлэл эсвэл зурагны төрлийг шалгана уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 503) return 'Зургийг хадгалах үйлчилгээ түр ажиллахгүй байна. Файлаа дахин оролдоорой.';
    if (cause.status >= 500) return 'Сервер түр алдаа гаргалаа. Дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}

function MemoryDetailPageContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { currentFamily: family, familyId, contextLoading, contextLoaded, contextError } = useAppShellContext();
  const [memoryId, setMemoryId] = useState('');
  const [memory, setMemory] = useState<MemoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editVisibility, setEditVisibility] = useState('family');
  const [editPeople, setEditPeople] = useState<{ id: string; name: string }[]>([]);
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<{ items: { id: string; name: string; birth_year: number | null }[]; page: number; page_size: number; total: number; has_next: boolean } | null>(null);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const [editDirty, setEditDirty] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [failedPhotoIds, setFailedPhotoIds] = useState<Set<string>>(() => new Set());
  const [photoPageLoading, setPhotoPageLoading] = useState(false);
  const [photoUploadFiles, setPhotoUploadFiles] = useState<File[]>([]);
  const [photoUploadBusy, setPhotoUploadBusy] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [photoUploadStatus, setPhotoUploadStatus] = useState('');
  const [editingPhotoId, setEditingPhotoId] = useState('');
  const [editPhotoTitle, setEditPhotoTitle] = useState('');
  const [editPhotoDescription, setEditPhotoDescription] = useState('');
  const [editPhotoDate, setEditPhotoDate] = useState('');
  const [photoEditBusy, setPhotoEditBusy] = useState(false);
  const familyRequestRef = useRef(0);
  const memoryRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const editRequestRef = useRef(0);
  const personRequestRef = useRef(0);
  const personAbortRef = useRef<AbortController | null>(null);
  const familyAbortRef = useRef<AbortController | null>(null);
  const memoryAbortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const editTitleRef = useRef<HTMLInputElement>(null);

  const loadMemory = useCallback(async (fid: string, mid: string) => {
    const requestId = ++memoryRequestRef.current;
    memoryAbortRef.current?.abort();
    const controller = new AbortController();
    memoryAbortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await api<MemoryDetail>(`/families/${fid}/memories/${mid}`, { signal: controller.signal });
      if (requestId !== memoryRequestRef.current) return;
      setMemory(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== memoryRequestRef.current) return;
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

  async function loadMorePhotos() {
    if (!memory || !familyId || photoPageLoading || !memory.photos_has_next) return;
    setPhotoPageLoading(true);
    setError('');
    try {
      const nextPage = (memory.photos_page ?? 1) + 1;
      const result = await api<MemoryPhotoPage>(
        `/families/${familyId}/memories/${memory.id}/photos?page=${nextPage}&page_size=24`,
      );
      setMemory((current) => current ? {
        ...current,
        photos: [...current.photos, ...result.items],
        photos_page: result.page,
        photos_page_size: result.page_size,
        photos_total: result.total,
        photos_has_next: result.has_next,
      } : current);
    } catch (cause) {
      setError(friendlyError(cause, 'Дараагийн зургуудыг ачаалж чадсангүй. Дахин оролдоно уу.'));
    } finally {
      setPhotoPageLoading(false);
    }
  }

  async function uploadPhotos() {
    if (!memory || !familyId || !memory.can_edit || photoUploadBusy || !photoUploadFiles.length) return;
    const invalid = memoryDraftError('Дурсамж', memory.visibility, photoUploadFiles);
    if (invalid) {
      setPhotoUploadError(invalid);
      return;
    }
    const files = [...photoUploadFiles];
    setPhotoUploadBusy(true);
    setPhotoUploadError('');
    let completed = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setPhotoUploadStatus(`Зураг хадгалж байна… ${index + 1}/${files.length}`);
        await api<MemoryPhoto>(`/families/${familyId}/memories/${memory.id}/photos`, {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        });
        completed += 1;
        setPhotoUploadFiles((current) => current.filter((item) => item !== file));
      }
      setPhotoUploadFiles([]);
      setPhotoUploadStatus(`${completed} зураг хадгалагдлаа.`);
      await loadMemory(familyId, memory.id);
    } catch (cause) {
      const remaining = files.slice(completed);
      setPhotoUploadFiles(remaining);
      setPhotoUploadError(`${friendlyError(cause, 'Зарим зураг хадгалагдсангүй.')}${completed ? ` ${completed} зураг хадгалагдсан. Үлдсэн ${remaining.length}-ийг дахин оролдоорой.` : ''}`);
      setPhotoUploadStatus('');
    } finally {
      setPhotoUploadBusy(false);
    }
  }

  async function deletePhoto(photo: MemoryPhoto) {
    if (!memory || !familyId || !memory.can_edit || photoUploadBusy || photoEditBusy) return;
    if (!window.confirm('Энэ зургийг устгах уу? Дурсамж өөрөө хадгалагдана.')) return;
    setError('');
    try {
      await api<void>(`/families/${familyId}/photos/${photo.id}`, { method: 'DELETE' });
      await loadMemory(familyId, memory.id);
    } catch (cause) {
      setError(friendlyError(cause, 'Зургийг устгаж чадсангүй. Дахин оролдоно уу.'));
    }
  }

  function beginPhotoEdit(photo: MemoryPhoto) {
    setEditingPhotoId(photo.id);
    setEditPhotoTitle(photo.title ?? '');
    setEditPhotoDescription(photo.description ?? '');
    setEditPhotoDate(photo.photo_date ?? '');
    setPhotoUploadError('');
  }

  async function savePhotoEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memory || !familyId || !editingPhotoId || photoEditBusy) return;
    setPhotoEditBusy(true);
    setPhotoUploadError('');
    try {
      const updated = await api<MemoryPhoto>(`/families/${familyId}/photos/${editingPhotoId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editPhotoTitle.trim() || null,
          description: editPhotoDescription.trim() || null,
          photo_date: editPhotoDate || null,
        }),
      });
      setMemory((current) => current ? {
        ...current,
        photos: current.photos.map((photo) => photo.id === editingPhotoId ? { ...photo, ...updated } : photo),
      } : current);
      setEditingPhotoId('');
    } catch (cause) {
      setPhotoUploadError(friendlyError(cause, 'Зургийн мэдээллийг хадгалж чадсангүй.'));
    } finally {
      setPhotoEditBusy(false);
    }
  }

  const loadFamilyContext = useCallback(async () => {
    const mid = params.id ?? '';
    const requestId = ++familyRequestRef.current;
    memoryRequestRef.current += 1;
    memoryAbortRef.current?.abort();
    setMemoryId(mid);
    setMemory(null);
    setError('');
    if (!mid) {
      setLoading(false);
      setError('Дурсамжийн хаяг буруу байна.');
      return;
    }
    if (contextLoading || !contextLoaded) {
      setLoading(true);
      return;
    }
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
    await loadMemory(family.id, mid);
  }, [contextError, contextLoaded, contextLoading, family, loadMemory, params.id]);

  useEffect(() => {
    void loadFamilyContext();
    return () => {
      familyRequestRef.current += 1;
      familyAbortRef.current?.abort();
      memoryAbortRef.current?.abort();
      personAbortRef.current?.abort();
    };
  }, [loadFamilyContext]);

  useEffect(() => () => {
    familyAbortRef.current?.abort();
    memoryAbortRef.current?.abort();
    personAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!editing) return;
    editTitleRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !editDirty || editSaving) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editing, editDirty, editSaving]);

  useEffect(() => {
    const safeQuery = personQuery.replace(/\s+/g, ' ').trim();
    personAbortRef.current?.abort();
    if (!editing || !familyId || !safeQuery) {
      personRequestRef.current += 1;
      setPersonResults(null);
      return;
    }
    const requestId = ++personRequestRef.current;
    const controller = new AbortController();
    personAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      void api<{ items: { id: string; name: string; birth_year: number | null }[]; page: number; page_size: number; total: number; has_next: boolean }>(
        `/families/${familyId}/persons/search?q=${encodeURIComponent(safeQuery)}&page=1&page_size=20`,
        { signal: controller.signal },
      ).then((result) => {
        if (requestId !== personRequestRef.current) return;
        setPersonResults(result);
      }).catch((cause) => {
        if (controller.signal.aborted || requestId !== personRequestRef.current) return;
        setEditError(friendlyError(cause, 'Хүн хайхад алдаа гарлаа. Дахин оролдоно уу.'));
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (personAbortRef.current === controller) personAbortRef.current = null;
    };
  }, [editing, familyId, personQuery]);

  function beginEdit() {
    if (!memory || editSaving) return;
    setEditTitle(memory.title);
    setEditDescription(memory.description ?? '');
    setEditDate(memory.memory_date ?? '');
    setEditVisibility(memory.visibility);
    setEditPeople(memory.person_ids.map((id, index) => ({ id, name: memory.person_names?.[index] ?? `Person ID: ${id.slice(0, 8)}…` })));
    setPersonQuery('');
    setPersonResults(null);
    setEditError('');
    setEditSuccess('');
    setEditDirty(false);
    setEditing(true);
  }

  function toggleEditPerson(person: { id: string; name: string }) {
    setEditPeople((current) => current.some((item) => item.id === person.id)
      ? current.filter((item) => item.id !== person.id)
      : current.length >= 100 ? current : [...current, person]);
    setEditDirty(true);
  }

  function cancelEdit() {
    if (editDirty && !window.confirm('Хадгалаагүй өөрчлөлт байна. Гарах уу?')) return;
    personAbortRef.current?.abort();
    personRequestRef.current += 1;
    setEditing(false);
    setEditError('');
    setEditSuccess('');
    setPersonQuery('');
    setPersonResults(null);
    setEditDirty(false);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!familyId || !memoryId || editSaving) return;
    if (!editTitle.trim()) {
      setEditError('Гарчиг хоосон байж болохгүй.');
      return;
    }
    const requestId = ++editRequestRef.current;
    const operationFamilyId = familyId;
    const operationMemoryId = memoryId;
    const operationFamilyRequestId = familyRequestRef.current;
    setEditSaving(true);
    setEditError('');
    setEditSuccess('');
    try {
      await api<MemoryDetail>(`/families/${operationFamilyId}/memories/${operationMemoryId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          memory_date: editDate || null,
          visibility: editVisibility,
          person_ids: editPeople.map((person) => person.id),
        }),
      });
      if (requestId !== editRequestRef.current || operationFamilyRequestId !== familyRequestRef.current || operationFamilyId !== familyId) return;
      const refreshed = await api<MemoryDetail>(`/families/${operationFamilyId}/memories/${operationMemoryId}`);
      if (requestId !== editRequestRef.current || operationFamilyRequestId !== familyRequestRef.current || operationFamilyId !== familyId) return;
      setMemory(refreshed);
      setEditing(false);
      setEditDirty(false);
      setEditSuccess('Дурсамж амжилттай шинэчлэгдлээ.');
    } catch (cause) {
      if (requestId !== editRequestRef.current || operationFamilyRequestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setEditError(friendlyError(cause, 'Дурсамжийг хадгалж чадсангүй. Дахин оролдоно уу.'));
    } finally {
      if (requestId === editRequestRef.current) setEditSaving(false);
    }
  }

  useEffect(() => {
    if (showDelete) cancelRef.current?.focus();
  }, [showDelete]);

  async function removeMemory() {
    if (!familyId || !memoryId || busy) return;
    const requestId = ++mutationRequestRef.current;
    const operationFamilyId = familyId;
    const operationFamilyRequestId = familyRequestRef.current;
    setBusy(true);
    setError('');
    try {
      await api<void>(`/families/${operationFamilyId}/memories/${memoryId}`, { method: 'DELETE' });
      if (requestId !== mutationRequestRef.current || operationFamilyRequestId !== familyRequestRef.current || operationFamilyId !== familyId) return;
      router.replace(`/memories?family=${encodeURIComponent(operationFamilyId)}`);
    } catch (cause) {
      if (requestId !== mutationRequestRef.current || operationFamilyRequestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        setBusy(false);
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
              {memory.author_name && <span>· Нэмсэн {memory.author_name}</span>}
            </div>
          </div>
          {memory.can_edit && <div className="memory-detail-header-actions">
            <button type="button" className="memories-secondary" onClick={beginEdit} disabled={busy || editSaving}>Засах</button>
            <button type="button" className="memories-danger" onClick={() => setShowDelete(true)} disabled={busy || editSaving}>Дурсамж устгах</button>
          </div>}
        </header>

        {editSuccess && <div className="memories-success" role="status" aria-live="polite">{editSuccess}</div>}

        {editing && (
          <section className="memory-composer memory-edit-form-shell" aria-labelledby="memory-edit-heading">
            <div className="memory-composer-heading">
              <div>
                <p className="memories-eyebrow">FAMILY MEMORIES · EDIT</p>
                <h2 id="memory-edit-heading">Дурсамжийг засах</h2>
              </div>
              <span>Дурсамжийн тайлбар болон харагдах хүрээг өөрчилж хадгалаарай.</span>
            </div>
            {editError && <div className="memories-alert" role="alert" id="memory-edit-error"><span>{editError}</span></div>}
            <form className="memory-composer-form" onSubmit={saveEdit} aria-describedby={editError ? 'memory-edit-error' : undefined}>
              <label>
                <span>Гарчиг *</span>
                <input ref={editTitleRef} value={editTitle} onChange={(event) => { setEditTitle(event.target.value); setEditDirty(true); }} maxLength={180} required />
              </label>
              <label>
                <span>Огноо</span>
                <input type="date" value={editDate} onChange={(event) => { setEditDate(event.target.value); setEditDirty(true); }} />
              </label>
              <label>
                <span>Харагдац</span>
                <select value={editVisibility} onChange={(event) => { setEditVisibility(event.target.value); setEditDirty(true); }}>
                  <option value="private">Зөвхөн би</option>
                  <option value="family">Гэр бүлийнхэн</option>
                  <option value="public">Нийтийн</option>
                </select>
              </label>
              <label className="memory-composer-wide">
                <span>Тайлбар</span>
                <textarea value={editDescription} onChange={(event) => { setEditDescription(event.target.value); setEditDirty(true); }} maxLength={20000} rows={8} />
              </label>
              <fieldset className="memory-composer-wide memory-edit-people">
                <legend>Холбоотой хүмүүс</legend>
                <label>
                  <span>Хүн хайх</span>
                  <input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Нэрээр хайх…" autoComplete="off" />
                </label>
                {editPeople.length > 0 && (
                  <div className="memory-selected-people" aria-label="Сонгосон холбоотой хүмүүс">
                    {editPeople.map((person) => (
                      <button type="button" key={person.id} onClick={() => toggleEditPerson(person)} aria-label={`${person.name} холбоосыг хасах`}>
                        {person.name} ×
                      </button>
                    ))}
                  </div>
                )}
                {personResults && (
                  <div className="memory-person-results" aria-live="polite">
                    {personResults.items.length ? personResults.items.map((person) => {
                      const selected = editPeople.some((item) => item.id === person.id);
                      return (
                        <button type="button" key={person.id} aria-pressed={selected} onClick={() => toggleEditPerson({ id: person.id, name: person.name })}>
                          {selected ? '✓ ' : '+ '}{person.name}
                        </button>
                      );
                    }) : <p>Хүн олдсонгүй.</p>}
                  </div>
                )}
              </fieldset>
              <div className="memory-composer-actions">
                <button type="button" className="memories-secondary" onClick={cancelEdit} disabled={editSaving}>Болих</button>
                <button type="submit" className="memories-primary" disabled={editSaving} aria-busy={editSaving}>
                  {editSaving ? 'Хадгалж байна…' : 'Хадгалах'}
                </button>
              </div>
            </form>
          </section>
        )}

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
            <span>{memory.photos_total} зураг</span>
          </div>
          {memory.photos.length ? (
            <div className="memory-detail-gallery">
              {memory.photos.map((photo) => (
                <figure key={photo.id}>
                  <ProtectedImageViewer thumbnail={photo.thumbnail_url} original={photo.content_url} caption={photo.title ?? `${memory.title} дурсамжийн зураг`} />
                  <figcaption>
                    <strong>{photo.title || 'Гэр бүлийн зураг'}</strong>
                    {photo.photo_date && <span> · {formatMemoryDate(photo.photo_date)}</span>}
                    {photo.description && <p>{photo.description}</p>}
                    {!!photo.person_names?.length && <small>👨‍👩‍👧 {photo.person_names.join(' · ')}</small>}
                  </figcaption>
                  {memory.can_edit && <div className="memory-photo-actions">
                    <button type="button" onClick={() => beginPhotoEdit(photo)} aria-expanded={editingPhotoId === photo.id}>Зургийн мэдээлэл засах</button>
                    <button type="button" onClick={() => void deletePhoto(photo)} disabled={photoEditBusy || photoUploadBusy}>Зургийг устгах</button>
                  </div>}
                  {editingPhotoId === photo.id && <form className="memory-photo-edit" onSubmit={savePhotoEdit}>
                    <label>Зургийн тайлбар<input value={editPhotoTitle} onChange={(event) => setEditPhotoTitle(event.target.value)} maxLength={180} /></label>
                    <label>Огноо<input type="date" value={editPhotoDate} onChange={(event) => setEditPhotoDate(event.target.value)} /></label>
                    <label>Нэмэлт мэдээлэл<textarea value={editPhotoDescription} onChange={(event) => setEditPhotoDescription(event.target.value)} maxLength={2000} rows={3} /></label>
                    <div><button type="submit" disabled={photoEditBusy}>{photoEditBusy ? 'Хадгалж байна…' : 'Хадгалах'}</button><button type="button" onClick={() => setEditingPhotoId('')} disabled={photoEditBusy}>Болих</button></div>
                  </form>}
                </figure>
              ))}
            </div>
          ) : (
            <div className="memory-detail-no-photos">Энэ дурсамжид зураг хадгалагдаагүй байна.</div>
          )}
          {memory.photos_has_next && <button className="memories-secondary memory-photo-more" type="button" onClick={() => void loadMorePhotos()} disabled={photoPageLoading}>
            {photoPageLoading ? 'Дараагийн зураг ачаалж байна…' : `Дараагийн зургууд · ${memory.photos.length}/${memory.photos_total}`}
          </button>}
          {memory.can_edit && <section className="memory-detail-upload" aria-labelledby="memory-photo-upload-heading">
            <h3 id="memory-photo-upload-heading">📷 Зураг нэмэх</h3>
            <p>Зураг хадгалах үед дурсамжийн эрх болон холбогдсон хүмүүсийн зөвшөөрлийг дахин шалгана.</p>
            {photoUploadError && <div role="alert" className="memories-alert">{photoUploadError}</div>}
            {photoUploadStatus && <p role="status" aria-live="polite">{photoUploadStatus}</p>}
            <MemoryPhotoInput id="memory-detail-photos-input" files={photoUploadFiles} onChange={setPhotoUploadFiles} disabled={photoUploadBusy} label="Нэмэх зураг сонгох" />
            <button type="button" className="memories-primary" onClick={() => void uploadPhotos()} disabled={photoUploadBusy || !photoUploadFiles.length}>
              {photoUploadBusy ? 'Зураг хадгалж байна…' : photoUploadError ? 'Үлдсэн зургийг дахин оролдох' : 'Сонгосон зургийг хадгалах'}
            </button>
          </section>}
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

        <MemoryInteractions key={memory.id} memoryId={memory.id} />
        <footer className="memory-detail-footer">
          <Link href={`/tree?family=${encodeURIComponent(familyId)}`}>← Удмын мод руу буцах</Link>
          <Link href={`/memories?family=${encodeURIComponent(familyId)}`}>← Дурсамжийн архив</Link>
          <span>Гэр бүлийн дурсамж, бидний хамтын өв.</span>
        </footer>
      </article>

      {showDelete && (
        <div className="memory-dialog-backdrop" role="presentation">
          <section className="memory-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-delete-title" aria-describedby="memory-delete-description">
            <p className="memories-eyebrow">DELETE MEMORY</p>
            <h2 id="memory-delete-title">Энэ дурсамжийг устгах уу?</h2>
            <p id="memory-delete-description">“{memory.title}” дурсамж болон түүнд хавсаргасан зургууд устгагдана. Энэ үйлдлийг буцаах боломжгүй.</p>
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
