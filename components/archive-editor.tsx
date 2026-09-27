'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Archive, Family, PersonSearchPage } from '../lib/api';

type SelectedPerson = { id: string; name: string };

function ArchiveEditorContent({ mode }: { mode: 'create' | 'edit' }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedFamilyId = searchParams.get('family') ?? '';
  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [archiveId, setArchiveId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [place, setPlace] = useState('');
  const [visibility, setVisibility] = useState('family');
  const [selected, setSelected] = useState<SelectedPerson[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonSearchPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const familyRequestRef = useRef(0);
  const archiveRequestRef = useRef(0);
  const peopleRequestRef = useRef(0);
  const familyAbortRef = useRef<AbortController | null>(null);
  const archiveAbortRef = useRef<AbortController | null>(null);
  const peopleAbortRef = useRef<AbortController | null>(null);
  const mutationRequestRef = useRef(0);

  useEffect(() => {
    const requestId = ++familyRequestRef.current;
    familyAbortRef.current?.abort();
    archiveAbortRef.current?.abort();
    peopleAbortRef.current?.abort();
    const controller = new AbortController();
    familyAbortRef.current = controller;
    archiveRequestRef.current += 1;
    setLoading(true); setReady(false); setFamily(null); setFamilyId(''); setArchiveId(''); setResults(null); setError('');
    const requestedArchiveId = mode === 'edit' ? window.location.pathname.split('/').filter(Boolean).at(-2) ?? '' : '';
    async function load() {
      try {
        const families = await api<Family[]>('/families', { signal: controller.signal });
        if (requestId !== familyRequestRef.current) return;
        if (!families.length) { setLoading(false); setError('Танд хандах боломжтой гэр бүл олдсонгүй.'); return; }
        const currentFamily = requestedFamilyId ? families.find((item) => item.id === requestedFamilyId) : families[0];
        if (!currentFamily) { setLoading(false); setError('Сонгосон гэр бүлийн орчинд хандах боломжгүй байна.'); return; }
        setFamilyId(currentFamily.id); setFamily(currentFamily);
        if (!requestedFamilyId) router.replace(`/archives/${mode === 'edit' ? requestedArchiveId + '/edit' : 'new'}?family=${encodeURIComponent(currentFamily.id)}`);
        if (currentFamily.role !== 'owner' && currentFamily.role !== 'editor') { setLoading(false); return; }
        if (mode === 'edit') {
          if (!requestedArchiveId) { setLoading(false); setError('Архивийн хаяг буруу байна.'); return; }
          const archiveRequestId = ++archiveRequestRef.current;
          archiveAbortRef.current?.abort();
          const archiveController = new AbortController();
          archiveAbortRef.current = archiveController;
          setArchiveId(requestedArchiveId);
          const archive = await api<Archive>(`/families/${currentFamily.id}/archives/${requestedArchiveId}`, { signal: archiveController.signal });
          if (requestId !== familyRequestRef.current || archiveRequestId !== archiveRequestRef.current) return;
          setTitle(archive.title); setDescription(archive.description ?? ''); setDocumentDate(archive.document_date ?? ''); setPlace(archive.place ?? ''); setVisibility(archive.visibility);
          setSelected(archive.related_people.map((person) => ({ id: person.id, name: [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ') })));
        }
        if (requestId === familyRequestRef.current) setReady(true);
      } catch (cause) {
        if (controller.signal.aborted || requestId !== familyRequestRef.current) return;
        if (cause instanceof ApiError && cause.status === 401) { router.replace('/login'); return; }
        setLoading(false);
        setError(cause instanceof ApiError && cause.status === 403 ? 'Энэ архивын үйлдлийг хийх эрхгүй байна.' : cause instanceof ApiError && cause.status === 404 ? 'Архивын материал олдсонгүй.' : 'Архивийн editor-ийг ачаалж чадсангүй. Дахин оролдоно уу.');
      } finally {
        if (requestId === familyRequestRef.current) setLoading(false);
      }
    }
    void load();
    return () => {
      familyAbortRef.current?.abort();
      archiveAbortRef.current?.abort();
      peopleAbortRef.current?.abort();
      archiveRequestRef.current += 1;
    };
  }, [mode, requestedFamilyId, router]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !familyId) { setResults(null); return; }
    const requestId = ++peopleRequestRef.current;
    peopleAbortRef.current?.abort();
    const controller = new AbortController();
    peopleAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      api<PersonSearchPage>('/families/' + familyId + '/persons/search?q=' + encodeURIComponent(trimmed) + '&page=1&page_size=10', { signal: controller.signal })
        .then((result) => { if (requestId === peopleRequestRef.current) setResults(result); })
        .catch(() => { if (!controller.signal.aborted && requestId === peopleRequestRef.current) setResults(null); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); peopleRequestRef.current += 1; };
  }, [query, familyId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty && !saving) event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, saving]);

  function markDirty() {
    setDirty(true);
    setError('');
  }

  function togglePerson(person: SelectedPerson) {
    setSelected((current) =>
      current.some((item) => item.id === person.id)
        ? current.filter((item) => item.id !== person.id)
        : [...current, person],
    );
    markDirty();
  }

  function cancel() {
    if (dirty && !window.confirm('Хадгалаагүй өөрчлөлт байна. Гарах уу?')) return;
    window.location.href =
      mode === 'edit'
        ? '/archives/' + archiveId + '?family=' + encodeURIComponent(familyId)
        : '/archives?family=' + encodeURIComponent(familyId);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Архивийн гарчиг хоосон байж болохгүй.');
      return;
    }
    if (documentDate && Number.isNaN(Date.parse(documentDate))) {
      setError('Баримтын огноо буруу байна.');
      return;
    }

    const mutationId = ++mutationRequestRef.current;
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: cleanTitle,
        description: description.trim() || null,
        document_date: documentDate || null,
        place: place.trim() || null,
        visibility,
        person_ids: selected.map((person) => person.id),
      };
      const result =
        mode === 'create'
          ? await api<Archive>('/families/' + familyId + '/archives', {
              method: 'POST',
              body: JSON.stringify(payload),
            })
          : await api<Archive>('/families/' + familyId + '/archives/' + archiveId, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });

      if (mutationId !== mutationRequestRef.current) return;
      setDirty(false);
      window.location.href =
        '/archives/' + result.id + '?family=' + encodeURIComponent(familyId) + '&saved=1';
    } catch (cause) {
      if (mutationId !== mutationRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(
        cause instanceof ApiError && cause.status === 403
          ? 'Энэ архивыг хадгалах эрхгүй байна.'
          : cause instanceof ApiError && cause.status === 404
            ? 'Архивын материал олдсонгүй.'
            : 'Архивийг хадгалах үед алдаа гарлаа. Дахин оролдоно уу.',
      );
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="stories-page">
        <section className="stories-shell stories-state card" aria-live="polite">
          <span className="people-spinner" aria-hidden="true" />
          <p>Архивийн editor-ийг ачаалж байна…</p>
        </section>
      </main>
    );
  }

  if (!family || !ready) {
    return (
      <main className="stories-page">
        <section className="stories-shell stories-state card">
          <h2>{family && mode === 'edit' ? 'Архивийг ачаалж чадсангүй.' : 'Гэр бүлийг ачаалж чадсангүй.'}</h2>
          <p>{error || 'Дахин оролдоно уу.'}</p>
          <Link className="button" href={'/archives?family=' + encodeURIComponent(familyId)}>← Архив</Link>
        </section>
      </main>
    );
  }

  if (family.role !== 'owner' && family.role !== 'editor') {
    return (
      <main className="stories-page">
        <section className="stories-shell stories-state card">
          <h2>Энэ үйлдлийг хийх эрхгүй.</h2>
          <p>Архив нэмэх, засах эрх owner эсвэл editor гишүүнд байна.</p>
          <Link className="button" href={'/archives?family=' + encodeURIComponent(familyId)}>
            ← Архив
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="stories-page">
      <section className="stories-shell story-editor-page">
        <nav className="story-breadcrumb" aria-label="Байршил">
          <Link href={'/archives?family=' + encodeURIComponent(familyId)}>← Архив</Link>
          <span>{family.name}</span>
        </nav>

        <header className="story-editor-hero">
          <p className="eyebrow">ГУУЛИНГИЙНХАН · FAMILY ARCHIVE · {mode === 'create' ? 'NEW' : 'EDIT'}</p>
          <h1>{mode === 'create' ? 'Шинэ архив' : 'Архивийг засах'}</h1>
          <p>Гэр бүлийн түүхэн баримтын metadata, огноо, газар болон холбоотой хүмүүсийг хадгална.</p>
        </header>

        {error && (
          <div className="error stories-error" role="alert" id="archive-editor-error">
            <span>{error}</span>
            {mode === 'edit' && archiveId && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                disabled={saving}
              >
                Дахин оролдох
              </button>
            )}
          </div>
        )}

        <form
          className="card story-editor-form"
          onSubmit={save}
          aria-describedby={error ? 'archive-editor-error' : undefined}
        >
          <label>
            Гарчиг *
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markDirty();
              }}
              maxLength={180}
              required
              autoFocus
              aria-required="true"
            />
          </label>

          <label>
            Тайлбар
            <textarea
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                markDirty();
              }}
              maxLength={20000}
              rows={8}
            />
            <span className="story-field-hint">Хоосон байж болно</span>
          </label>

          <div className="story-form-grid">
            <label>
              Баримтын огноо
              <input
                type="date"
                value={documentDate}
                onChange={(event) => {
                  setDocumentDate(event.target.value);
                  markDirty();
                }}
              />
            </label>

            <label>
              Газар
              <input
                value={place}
                onChange={(event) => {
                  setPlace(event.target.value);
                  markDirty();
                }}
                maxLength={240}
                placeholder="Жишээ: Улаанбаатар"
              />
            </label>

            <label>
              Харагдац
              <select
                value={visibility}
                onChange={(event) => {
                  setVisibility(event.target.value);
                  markDirty();
                }}
              >
                <option value="private">Зөвхөн би</option>
                <option value="family">Гэр бүлийнхэн</option>
                <option value="public">Нийтийн</option>
              </select>
            </label>

            <div aria-hidden="true" />
          </div>

          <fieldset className="story-people-fieldset">
            <legend>Холбоотой хүмүүс</legend>
            <label>
              Хүн хайх
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Нэрээр хайх…"
                autoComplete="off"
                aria-describedby="archive-person-help"
              />
            </label>
            <p id="archive-person-help" className="story-field-hint">
              Зөвхөн энэ гэр бүлийн харагдах хүмүүсээс сонгоно.
            </p>

            {selected.length > 0 && (
              <div className="story-people-chips" aria-label="Сонгосон хүмүүс">
                {selected.map((person) => (
                  <button
                    type="button"
                    key={person.id}
                    onClick={() => togglePerson(person)}
                    aria-label={person.name + ' хасах'}
                  >
                    {person.name} ×
                  </button>
                ))}
              </div>
            )}

            {results && (
              <div className="story-person-results" aria-live="polite">
                {results.items.length ? (
                  results.items.map((person) => {
                    const selectedAlready = selected.some((item) => item.id === person.id);
                    return (
                      <button
                        type="button"
                        key={person.id}
                        aria-pressed={selectedAlready}
                        onClick={() =>
                          togglePerson({ id: person.id, name: person.name || 'Нэргүй хүн' })
                        }
                      >
                        {selectedAlready ? '✓ ' : '+ '}
                        {person.name || 'Нэргүй хүн'}
                      </button>
                    );
                  })
                ) : (
                  <span>Хүн олдсонгүй.</span>
                )}
              </div>
            )}
          </fieldset>

          <div className="story-editor-actions">
            <button type="button" onClick={cancel} disabled={saving}>
              Болих
            </button>
            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Хадгалж байна…' : 'Хадгалах'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default function ArchiveEditor(props: { mode: 'create' | 'edit' }) {
  return (
    <Suspense fallback={<main className="stories-page"><section className="stories-shell stories-state card" aria-live="polite"><span className="people-spinner" aria-hidden="true" /><p>Архивийн editor-ийг ачаалж байна…</p></section></main>}>
      <ArchiveEditorContent {...props} />
    </Suspense>
  );
}
