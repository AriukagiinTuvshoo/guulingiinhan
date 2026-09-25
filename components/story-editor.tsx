'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, api, Family, PersonSearchPage, Story } from '../lib/api';

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

export default function StoryEditor({ mode, familyId: requestedFamilyId = '', storyId: requestedStoryId = '' }: Props) {
  const [families, setFamilies] = useState<Family[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [familyId, setFamilyId] = useState(requestedFamilyId);
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
  const [notice, setNotice] = useState('');
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const snapshot = useMemo(
    () => JSON.stringify({ title, body, eventDate, place, visibility, people: selectedPeople.map((person) => person.id) }),
    [title, body, eventDate, place, visibility, selectedPeople],
  );
  const dirty = initialSnapshot !== '' && snapshot !== initialSnapshot;
  const canMutate = family?.role === 'owner' || family?.role === 'editor';

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

    async function load() {
      const params = new URLSearchParams(window.location.search);
      const effectiveFamilyId = requestedFamilyId || params.get('family') || '';
      const effectiveStoryId = requestedStoryId || window.location.pathname.split('/').filter(Boolean).at(-2) || '';
      setLoading(true);
      setError('');
      try {
        if (mode === 'create') {
          const items = await api<Family[]>('/families');
          if (cancelled) return;
          setFamilies(items);
          const requested = effectiveFamilyId;
          const selected = items.find((item) => item.id === requested) ?? items[0] ?? null;
          setFamily(selected);
          setFamilyId(selected?.id ?? '');
          setInitialSnapshot(JSON.stringify({ title: '', body: '', eventDate: '', place: '', visibility: 'family', people: [] }));
          return;
        }

        if (!effectiveFamilyId || !effectiveStoryId) {
          setError('Түүхийн хаяг буруу байна.');
          return;
        }
        const [familyResult, storyResult] = await Promise.all([
          api<Family>('/families/' + effectiveFamilyId),
          api<Story>('/families/' + effectiveFamilyId + '/stories/' + effectiveStoryId),
        ]);
        if (cancelled) return;
        setFamily(familyResult);
        setFamilyId(effectiveFamilyId);
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
        if (cause instanceof ApiError && cause.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!cancelled) setError(friendlyError(cause, 'Түүхийг ачаалж чадсангүй.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [mode, requestedFamilyId, requestedStoryId]);

  useEffect(() => {
    if (!familyId || !personQuery.trim()) {
      setPersonResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api<PersonSearchPage>(
        '/families/' + familyId + '/persons/search?q=' + encodeURIComponent(personQuery.trim()) + '&page=1&page_size=20',
      ).then(setPersonResults).catch(() => setPersonResults(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [familyId, personQuery]);

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
    setNotice('');
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

      setNotice('Амжилттай хадгалагдлаа.');
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
        {notice && <div className="success stories-error" role="status">{notice}</div>}

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

          <label>
            Түүх *
            <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={100000} required aria-required="true" placeholder="Энэ үйл явдал хэрхэн болсон тухай бичнэ үү…" />
            <span className="story-field-hint">{body.length.toLocaleString()} / 100,000</span>
          </label>

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
