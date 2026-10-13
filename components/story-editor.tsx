'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, MemoryListItem, MemoryPhotoPage, PersonSearchPage, Story } from '../lib/api';
import { useAppShellContext } from './app-shell';
import ProfilePhoto from './profile-photo';
import HeritageLinkPicker from './heritage-link-picker';
import { editHeritageText, heritageEditorText } from '../lib/heritage-links';
import { useParams } from 'next/navigation';

type Props = {
  mode: 'create' | 'edit';
  familyId?: string;
  storyId?: string;
};

type SelectedPerson = { id: string; name: string };

const visibilityOptions = [
  { value: 'family', label: 'Гэр бүлийнхэн' },
  { value: 'private', label: 'Зөвхөн би' },
  { value: 'public', label: 'Нийтийн' },
];
const STORY_PHOTO_TOKEN = /\[\[photo:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\|([^\]\n]{0,180}))?\]\]/g;

function personName(person: { first_name: string; last_name: string; middle_name: string | null }) {
  return [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ') || 'Нэргүй хүн';
}

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй.';
    if (cause.status === 404) return 'Мэдээлэл олдсонгүй.';
    if (cause.status === 422) return 'Гарчиг, агуулга болон бусад мэдээллээ шалгана уу.';
    if (cause.status === 409) return 'Энэ мэдээлэл давхар бүртгэгдэхээс хамгаалагдсан. Дахин оролдоно уу.';
  }
  return fallback;
}

function StoryEditorContent({ mode, familyId: requestedFamilyId = '', storyId: requestedStoryId = '' }: Props) {
  const { currentFamily: family, familyId, contextLoading, contextLoaded, contextError } = useAppShellContext();
  const [story, setStory] = useState<Story | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [place, setPlace] = useState('');
  const [visibility, setVisibility] = useState('family');
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<PersonSearchPage | null>(null);
  const [selectedPeople, setSelectedPeople] = useState<SelectedPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [photoAlbums, setPhotoAlbums] = useState<MemoryListItem[]>([]);
  const [photoMemoryPage, setPhotoMemoryPage] = useState(1);
  const [photoMemoriesHaveNext, setPhotoMemoriesHaveNext] = useState(false);
  const [photoPagesByMemory, setPhotoPagesByMemory] = useState<Record<string, MemoryPhotoPage>>({});
  const [photoMemoryLoading, setPhotoMemoryLoading] = useState('');
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const routeParams = useParams<{ id?: string }>();
  const loadRequestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const photoRequestRef = useRef(0);
  const personSearchRequestRef = useRef(0);
  const personSearchAbortRef = useRef<AbortController | null>(null);

  const snapshot = useMemo(
    () => JSON.stringify({ title, body, eventDate, place, visibility, people: selectedPeople.map((person) => person.id) }),
    [title, body, eventDate, place, visibility, selectedPeople],
  );
  const dirty = initialSnapshot !== '' && snapshot !== initialSnapshot;
  const canMutate = family?.role === 'owner' || family?.role === 'editor';
  const embeddedPhotos = Array.from(body.matchAll(STORY_PHOTO_TOKEN));

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++loadRequestRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    async function load() {
      const effectiveStoryId = requestedStoryId || routeParams.id || '';
      if (requestId !== loadRequestRef.current) return;
      setLoading(true);
      setError('');

      if (contextLoading || !contextLoaded) return;
      if (contextError) {
        setLoading(false);
        setError(contextError);
        return;
      }
      if (!family || !familyId) {
        setLoading(false);
        setError('Гэр бүлийн орчинд хандах боломжгүй байна.');
        return;
      }
      try {
        if (mode === 'create') {
          setStory(null);
          setInitialSnapshot(JSON.stringify({ title: '', body: '', eventDate: '', place: '', visibility: 'family', people: [] }));
          return;
        }
        if (!effectiveStoryId) {
          setError('Түүхийн хаяг буруу байна.');
          return;
        }
        const storyResult = await api<Story>('/families/' + familyId + '/stories/' + effectiveStoryId, { signal: controller.signal });
        if (cancelled || requestId !== loadRequestRef.current) return;
        setStory(storyResult);
        setTitle(storyResult.title);
        setBody(storyResult.body);
        setEventDate(storyResult.event_date ?? '');
        setPlace(storyResult.place ?? '');
        setVisibility(storyResult.visibility);
        setSelectedPeople(storyResult.related_people.map((person) => ({ id: person.id, name: personName(person) })));
        setInitialSnapshot(JSON.stringify({
          title: storyResult.title,
          body: storyResult.body,
          eventDate: storyResult.event_date ?? '',
          place: storyResult.place ?? '',
          visibility: storyResult.visibility,
          people: storyResult.related_people.map((person) => person.id),
        }));
      } catch (cause) {
        if (controller.signal.aborted || cancelled || requestId !== loadRequestRef.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          window.location.href = '/login';
          return;
        }
        setError(friendlyError(cause, 'Түүхийг ачаалж чадсангүй.'));
      } finally {
        if (!cancelled && requestId === loadRequestRef.current) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [contextError, contextLoaded, contextLoading, family, familyId, mode, requestedStoryId, routeParams.id]);

  useEffect(() => {
    const requestId = ++personSearchRequestRef.current;
    if (!familyId || !personQuery.trim()) {
      setPersonResults(null);
      return;
    }
    personSearchAbortRef.current?.abort();
    const controller = new AbortController();
    personSearchAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      void api<PersonSearchPage>(
        '/families/' + familyId + '/persons/search?q=' + encodeURIComponent(personQuery.trim()) + '&page=1&page_size=20',
        { signal: controller.signal },
      ).then((result) => {
        if (requestId === personSearchRequestRef.current) setPersonResults(result);
      }).catch(() => {
        if (requestId === personSearchRequestRef.current) setPersonResults(null);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      personSearchRequestRef.current += 1;
    };
  }, [familyId, personQuery]);

  useEffect(() => {
    photoRequestRef.current += 1;
    setPhotoAlbums([]);
    setPhotoMemoryPage(1);
    setPhotoMemoriesHaveNext(false);
    setPhotoPagesByMemory({});
    setPhotoMemoryLoading('');
    setPhotoLoading(false);
    setPhotoError('');
    setShowPhotoPicker(false);
  }, [familyId]);

  useEffect(() => () => {
    loadAbortRef.current?.abort();
    personSearchAbortRef.current?.abort();
  }, []);

  function cancel() {
    if (dirty && !window.confirm('Хадгалаагүй өөрчлөлт байна. Энэ хуудсыг орхих уу?')) return;
    if (mode === 'create') {
      window.location.href = '/stories?family=' + encodeURIComponent(familyId);
    } else {
      window.location.href = '/stories/' + encodeURIComponent(story?.id || requestedStoryId) + '?family=' + encodeURIComponent(familyId);
    }
  }

  function togglePerson(person: SelectedPerson) {
    setSelectedPeople((current) =>
      current.some((item) => item.id === person.id)
        ? current.filter((item) => item.id !== person.id)
        : [...current, person],
    );
  }

  function insertText(before: string, after = '', placeholder = 'текст') {
    const field = textareaRef.current;
    const editorialBody = heritageEditorText(body);
    const start = field?.selectionStart ?? editorialBody.length;
    const end = field?.selectionEnd ?? start;
    const selected = editorialBody.slice(start, end) || placeholder;
    const next = editorialBody.slice(0, start) + before + selected + after + editorialBody.slice(end);
    setBody(editHeritageText(next, body));
    window.requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  async function openPhotoPicker() {
    if (showPhotoPicker) { setShowPhotoPicker(false); return; }
    setShowPhotoPicker(true);
    if (!familyId || photoAlbums.length) return;
    const operationFamilyId = familyId;
    const requestId = ++photoRequestRef.current;
    setPhotoLoading(true);
    setPhotoError('');
    try {
      const result = await api<{ items: MemoryListItem[]; page: number; has_next: boolean }>(
        `/families/${operationFamilyId}/memories?page=1&page_size=18`,
      );
      if (requestId !== photoRequestRef.current) return;
      setPhotoAlbums(result.items);
      setPhotoMemoryPage(result.page);
      setPhotoMemoriesHaveNext(result.has_next);
    } catch {
      if (requestId !== photoRequestRef.current) return;
      setPhotoError('Гэр бүлийн зургийг ачаалж чадсангүй. Дахин оролдоно уу.');
    } finally {
      if (requestId === photoRequestRef.current) setPhotoLoading(false);
    }
  }

  async function loadNextPhotoMemories() {
    if (!familyId || photoLoading || photoMemoryLoading || !photoMemoriesHaveNext) return;
    const operationFamilyId = familyId;
    const requestId = ++photoRequestRef.current;
    setPhotoLoading(true);
    setPhotoError('');
    try {
      const page = photoMemoryPage + 1;
      const result = await api<{ items: MemoryListItem[]; page: number; has_next: boolean }>(
        `/families/${operationFamilyId}/memories?page=${page}&page_size=18`,
      );
      if (requestId !== photoRequestRef.current) return;
      setPhotoAlbums((current) => [...current, ...result.items.filter((item) => !current.some((old) => old.id === item.id))]);
      setPhotoMemoryPage(result.page);
      setPhotoMemoriesHaveNext(result.has_next);
    } catch {
      if (requestId !== photoRequestRef.current) return;
      setPhotoError('Дараагийн дурсамжийн зургийг ачаалж чадсангүй. Дахин оролдоно уу.');
    } finally {
      if (requestId === photoRequestRef.current) setPhotoLoading(false);
    }
  }

  async function loadMemoryPhotos(memoryId: string, page = 1) {
    if (!familyId || photoLoading || photoMemoryLoading) return;
    const operationFamilyId = familyId;
    const requestId = ++photoRequestRef.current;
    setPhotoMemoryLoading(memoryId);
    setPhotoError('');
    try {
      const result = await api<MemoryPhotoPage>(
        `/families/${operationFamilyId}/memories/${memoryId}/photos?page=${page}&page_size=24`,
      );
      if (requestId !== photoRequestRef.current) return;
      setPhotoPagesByMemory((current) => {
        const previous = current[memoryId];
        const items = page === 1 ? result.items : [...(previous?.items ?? []), ...result.items];
        return { ...current, [memoryId]: { ...result, items } };
      });
    } catch {
      if (requestId !== photoRequestRef.current) return;
      setPhotoError('Энэ дурсамжийн зургийг ачаалж чадсангүй. Дахин оролдоно уу.');
    } finally {
      if (requestId === photoRequestRef.current) setPhotoMemoryLoading('');
    }
  }

  function removeStoryPhoto(match: RegExpMatchArray) {
    const start = match.index ?? -1;
    if (start < 0) return;
    setBody((current) => current.slice(0, start) + current.slice(start + match[0].length));
  }

  function updateStoryPhotoCaption(match: RegExpMatchArray, caption: string) {
    const start = match.index ?? -1;
    if (start < 0) return;
    const cleanCaption = caption.replace(/[\]\n|]/g, ' ').slice(0, 180);
    const replacement = `[[photo:${match[1]}|${cleanCaption}]]`;
    setBody((current) => current.slice(0, start) + replacement + current.slice(start + match[0].length));
  }

  function insertPhoto(id: string, caption: string) {
    const cleanCaption = caption.replace(/[\]\n|]/g, ' ').slice(0, 180) || 'Гэр бүлийн зураг';
    const field = textareaRef.current;
    const editorialBody = heritageEditorText(body);
    const start = field?.selectionStart ?? editorialBody.length;
    const end = field?.selectionEnd ?? start;
    const token = `\n\n[[photo:${id}|${cleanCaption}]]\n\n`;
    setBody(editHeritageText(editorialBody.slice(0, start) + token + editorialBody.slice(end), body));
    window.requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(start + token.length, start + token.length); });
    setShowPhotoPicker(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || !cleanBody) {
      setError('Гарчиг болон түүхийн агуулга хоосон байж болохгүй.');
      return;
    }
    if (!familyId || !canMutate || saving) return;

    setSaving(true);
    setError('');
    try {
      const payload = {
        title: cleanTitle,
        body: cleanBody,
        event_date: eventDate || null,
        place: place.trim() || null,
        visibility,
        person_ids: selectedPeople.map((person) => person.id),
      };

      const saved = mode === 'create'
        ? await api<Story>('/families/' + familyId + '/stories', { method: 'POST', body: JSON.stringify(payload) })
        : await api<Story>('/families/' + familyId + '/stories/' + (story?.id || requestedStoryId), { method: 'PUT', body: JSON.stringify(payload) });

      setInitialSnapshot(JSON.stringify({
        title: saved.title,
        body: saved.body,
        eventDate: saved.event_date ?? '',
        place: saved.place ?? '',
        visibility: saved.visibility,
        people: saved.related_people.map((person) => person.id),
      }));
      window.location.href = '/stories/' + encodeURIComponent(saved.id) + '?family=' + encodeURIComponent(familyId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(friendlyError(cause, mode === 'create' ? 'Түүхийг хадгалах үед алдаа гарлаа. Дахин оролдоно уу.' : 'Түүхийг шинэчлэх үед алдаа гарлаа. Дахин оролдоно уу.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="stories-page"><section className="stories-shell stories-state"><span className="people-spinner" aria-hidden="true" /><p>Editor ачаалж байна…</p></section></main>;
  }

  if (error && !family) {
    return (
      <main className="stories-page">
        <section className="stories-shell">
          <div className="error" role="alert">{error}</div>
          <Link className="button" href="/stories">← Манай түүх</Link>
        </section>
      </main>
    );
  }

  if (!family) return null;

  if (!canMutate) {
    return (
      <main className="stories-page">
        <section className="stories-shell">
          <div className="error" role="alert">Энэ үйлдлийг хийх эрхгүй.</div>
          <Link className="button" href={'/stories?family=' + encodeURIComponent(familyId)}>← Манай түүх</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="stories-page">
      <section className="stories-shell story-editor-page">
        <nav className="story-breadcrumb" aria-label="Байршил">
          <Link href={'/stories?family=' + encodeURIComponent(familyId)}>← Манай түүх</Link>
          <span>{family.name}</span>
        </nav>

        <header className="story-editor-hero">
          <p className="eyebrow">FAMILY STORY · {mode === 'create' ? 'NEW' : 'EDIT'}</p>
          <h1>{mode === 'create' ? 'Шинэ түүх' : 'Түүхийг засах'}</h1>
          <p>Гэр бүлийн дурсамж, үйл явдал, огноо, газар болон холбоотой хүмүүсийг нэг түүх болгон хадгална.</p>
        </header>

        {error && <div className="error stories-error" role="alert" id="story-editor-error">{error}</div>}

        <form className="card story-editor-form" onSubmit={save} aria-describedby={error ? 'story-editor-error' : undefined}>
          <div className="story-form-grid">
            <label>
              Гарчиг *
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required aria-required="true" />
            </label>
            <label>
              Огноо
              <input value={eventDate} onChange={(event) => setEventDate(event.target.value)} type="date" />
            </label>
            <label>
              Газар
              <input value={place} onChange={(event) => setPlace(event.target.value)} maxLength={240} placeholder="Жишээ: Улаанбаатар" />
            </label>
            <label>
              Харагдац
              <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
                {visibilityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <div className="story-writing-field">
            <HeritageLinkPicker familyId={familyId} value={body} onChange={setBody} />
            <label htmlFor="story-body">Түүх *</label>
            <div className="story-writing-toolbar" role="toolbar" aria-label="Түүхийн бичвэр форматлах">
              <button type="button" onClick={() => insertText('\n## ', '', 'Дэд гарчиг')}>Гарчиг</button>
              <button type="button" onClick={() => insertText('**', '**', 'тод текст')} aria-label="Тод бичвэр"><strong>Б</strong></button>
              <button type="button" onClick={() => insertText('*', '*', 'налуу текст')} aria-label="Налуу бичвэр"><em>Н</em></button>
              <button type="button" onClick={() => insertText('\n- ', '', 'Жагсаалтын зүйл')}>Жагсаалт</button>
              <button type="button" onClick={() => insertText('\n> ', '', 'Ишлэл')}>Ишлэл</button>
              <button type="button" onClick={() => insertText('[', '](https://example.com)', 'холбоосын нэр')}>Холбоос</button>
              <button type="button" onClick={() => insertText('\n\n---\n\n', '', '')}>Зааг</button>
              <button type="button" onClick={() => void openPhotoPicker()} aria-expanded={showPhotoPicker}>📷 Зураг</button>
            </div>
            <textarea id="story-body" ref={textareaRef} value={heritageEditorText(body)} onChange={(event) => setBody(editHeritageText(event.target.value, body))} maxLength={100000} required aria-required="true" placeholder="Энэ үйл явдал хэрхэн болсон тухай бичнэ үү…" />
            <span className="story-field-hint">{body.length.toLocaleString()} / 100,000</span>
            {embeddedPhotos.length > 0 && <section className="story-inserted-photos" aria-label="Түүхэнд оруулсан зургууд">
              <h3>Түүхэнд оруулсан зураг · {embeddedPhotos.length}</h3>
              <ul>
                {embeddedPhotos.map((match, index) => (
                  <li key={`${match[1]}-${match.index}-${index}`}>
                    <ProfilePhoto
                      url={`/families/${familyId}/photos/${match[1]}/content?variant=thumbnail`}
                      name={match[2] || 'Гэр бүлийн зураг'}
                      fallback="Зураг харах боломжгүй"
                      className="story-inserted-photo-image"
                    />
                    <label>
                      <span>Зургийн тайлбар</span>
                      <input
                        value={match[2] ?? ''}
                        maxLength={180}
                        onChange={(event) => updateStoryPhotoCaption(match, event.target.value)}
                        aria-label={`Зураг ${index + 1}-ийн тайлбар`}
                      />
                    </label>
                    <button type="button" onClick={() => removeStoryPhoto(match)} aria-label={`Зураг ${index + 1}-ийг түүхээс хасах`}>
                      Зургийг хасах
                    </button>
                  </li>
                ))}
              </ul>
            </section>}
            {showPhotoPicker && <section className="story-photo-picker" aria-label="Дурсамжаас зураг сонгох">
              <p>Дурсамжид оруулсан зургаа сонгоно. Нийтийн түүхэнд зөвхөн нийтэд зөвшөөрсөн, насанд хүрсэн хүний зураг ашиглана.</p>
              {photoError && <p role="alert">{photoError}</p>}
              {photoLoading && <p role="status">Дурсамж ачаалж байна…</p>}
              {!photoLoading && photoAlbums.length === 0 && !photoError && <p>Зурагтай дурсамж алга. Эхлээд <Link href={`/memories?family=${encodeURIComponent(familyId)}`}>Дурсамж</Link> хэсэгт зураг нэмнэ үү.</p>}
              <div className="story-photo-albums">
                {photoAlbums.map((memory) => {
                  const photoPage = photoPagesByMemory[memory.id];
                  const photos = photoPage?.items ?? memory.photos ?? [];
                  return <section key={memory.id} className="story-photo-album">
                    <header><strong>{memory.title}</strong><span>{photoPage ? `${photoPage.total} зураг` : 'Дурсамж'}</span></header>
                    <div className="story-photo-options">
                      {photos.map((photo, index) => <button type="button" key={photo.id} onClick={() => insertPhoto(photo.id, photo.title || memory.title)}>
                        <ProfilePhoto url={photo.thumbnail_url} name={photo.title || `${memory.title} · зураг ${index + 1}`} fallback="Зураг харах боломжгүй" className="story-photo-option-image" />
                        <span>{photo.title || `Зураг ${index + 1}`}<small>{memory.title}</small></span>
                      </button>)}
                    </div>
                    {photoPage && !photoPage.items.length && <p>Энэ дурсамжид сонгож болох зураг алга.</p>}
                    {!photoPage && <button type="button" disabled={photoLoading || !!photoMemoryLoading} onClick={() => void loadMemoryPhotos(memory.id, 1)}>
                      {photoMemoryLoading === memory.id ? 'Зураг ачаалж байна…' : 'Энэ дурсамжийн бүх зургийг сонгох'}
                    </button>}
                    {photoPage?.has_next && <button type="button" disabled={photoLoading || !!photoMemoryLoading} onClick={() => void loadMemoryPhotos(memory.id, photoPage.page + 1)}>
                      {photoMemoryLoading === memory.id ? 'Ачаалж байна…' : 'Дараагийн зургууд'}
                    </button>}
                  </section>;
                })}
              </div>
              {photoMemoriesHaveNext && <button type="button" disabled={photoLoading || !!photoMemoryLoading} onClick={() => void loadNextPhotoMemories()}>
                {photoLoading ? 'Ачаалж байна…' : 'Дараагийн дурсамжууд'}
              </button>}
            </section>}
          </div>

          <fieldset className="story-people-fieldset">
            <legend>Холбоотой хүмүүс</legend>
            <label>
              Хүн хайх
              <input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Нэрээр хайх…" autoComplete="off" />
            </label>
            {selectedPeople.length > 0 && (
              <div className="story-people-chips" aria-label="Сонгосон хүмүүс">
                {selectedPeople.map((person) => (
                  <button type="button" key={person.id} onClick={() => togglePerson(person)} aria-label={person.name + ' холбоосыг хасах'}>
                    {person.name} ×
                  </button>
                ))}
              </div>
            )}
            {personQuery.trim().length >= 1 && personResults && (
              <div className="story-person-results" aria-live="polite">
                {personResults.items.length ? personResults.items.map((person) => {
                  const selected = selectedPeople.some((item) => item.id === person.id);
                  return (
                    <button type="button" key={person.id} aria-pressed={selected} onClick={() => togglePerson({ id: person.id, name: person.name })}>
                      {selected ? '✓ ' : '+ '}{person.name}{person.birth_year ? ' · ' + person.birth_year : ''}
                    </button>
                  );
                }) : <span>Тохирох хүн олдсонгүй.</span>}
              </div>
            )}
          </fieldset>

          <div className="story-editor-actions">
            <button type="button" onClick={cancel} disabled={saving}>Болих</button>
            <button className="primary" type="submit" disabled={saving || !familyId} aria-disabled={saving || !familyId}>
              {saving ? 'Хадгалж байна…' : mode === 'create' ? 'Түүх хадгалах' : 'Өөрчлөлтийг хадгалах'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}


export default function StoryEditor(props: Props) {
  return (
    <Suspense fallback={<main className="stories-page"><section className="stories-shell stories-state" aria-live="polite"><span className="people-spinner" aria-hidden="true" /><p>Editor ачаалж байна…</p></section></main>}>
      <StoryEditorContent {...props} />
    </Suspense>
  );
}
