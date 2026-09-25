'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api, Family, PersonSearchPage, StoryListItem, StoryListPage } from '../../lib/api';

const PAGE_SIZE = 12;

export default function StoriesPage() {
  const [family, setFamily] = useState<Family | null>(null);
  const [familyId, setFamilyId] = useState('');
  const [families, setFamilies] = useState<Family[]>([]);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [query, setQuery] = useState('');
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<PersonSearchPage | null>(null);
  const [selectedPeople, setSelectedPeople] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  const loadStories = useCallback(async (fid: string, page = 1, q = query) => {
    if (!fid) return;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (q.trim()) params.set('q', q.trim());
      setStories(await api<StoryListPage>('/families/' + fid + '/stories?' + params.toString()));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Түүхүүдийг ачаалж чадсангүй.');
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
        const selected = items.find((item) => item.id === requested) ?? items[0];
        if (!selected) {
          setLoading(false);
          return;
        }
        setFamily(selected);
        setFamilyId(selected.id);
        if (selected.id !== requested) {
          window.history.replaceState(null, '', '/stories?family=' + encodeURIComponent(selected.id));
        }
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
    if (familyId) void loadStories(familyId, 1);
  }, [familyId, loadStories]);

  useEffect(() => {
    if (!familyId || personQuery.trim().length < 2) {
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

  async function createStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!familyId) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/families/' + familyId + '/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: String(form.get('title') ?? ''),
          body: String(form.get('body') ?? ''),
          event_date: form.get('event_date') || null,
          place: form.get('place') || null,
          visibility: String(form.get('visibility') ?? 'family'),
          person_ids: selectedPeople.map((person) => person.id),
        }),
      });
      event.currentTarget.reset();
      setSelectedPeople([]);
      setPersonQuery('');
      setShowEditor(false);
      await loadStories(familyId, 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Түүх хадгалж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  function chooseFamily(next: string) {
    const selected = families.find((item) => item.id === next) ?? null;
    setFamily(selected);
    setFamilyId(next);
    setStories(null);
    window.history.replaceState(null, '', '/stories?family=' + encodeURIComponent(next));
  }

  function togglePerson(person: { id: string; name: string }) {
    setSelectedPeople((current) =>
      current.some((item) => item.id === person.id)
        ? current.filter((item) => item.id !== person.id)
        : [...current, person],
    );
  }

  const page = stories?.page ?? 1;

  return (
    <main className="stories-page">
      <section className="stories-shell">
        <header className="stories-heading">
          <div>
            <Link href={family ? '/dashboard?family=' + encodeURIComponent(family.id) : '/dashboard'}>← Dashboard</Link>
            <p className="eyebrow">ГУУЛИНГИЙНХАН · FAMILY STORY</p>
            <h1>Манай түүх</h1>
            <p className="stories-lede">Гэр бүлийн үйл явдал, дурсамжит өгүүлэмж, огноо, газар болон холбоотой хүмүүсийг тусдаа түүхийн сан болгон хадгална.</p>
          </div>
          <div className="stories-actions">
            {families.length > 1 && (
              <label className="stories-family"><span>Гэр бүл</span><select value={familyId} onChange={(event) => chooseFamily(event.target.value)}>
                {families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
            )}
            {familyId && <button className="primary" type="button" onClick={() => setShowEditor((value) => !value)}>{showEditor ? 'Болих' : '+ Түүх нэмэх'}</button>}
          </div>
        </header>

        {error && <div className="error stories-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadStories(familyId, page)}>Дахин оролдох</button></div>}

        {showEditor && (
          <section className="card story-editor" aria-label="Түүх нэмэх">
            <div className="story-section-heading"><div><p className="eyebrow">NEW STORY</p><h2>Шинэ түүх</h2></div></div>
            <form onSubmit={createStory}>
              <div className="story-form-grid">
                <label>Гарчиг<input name="title" maxLength={180} required /></label>
                <label>Огноо<input name="event_date" type="date" /></label>
                <label>Газар<input name="place" maxLength={240} placeholder="Жишээ: Улаанбаатар" /></label>
                <label>Харагдах байдал<select name="visibility" defaultValue="family"><option value="family">Гэр бүлийнхэн</option><option value="private">Зөвхөн би</option><option value="public">Нийтийн</option></select></label>
              </div>
              <label>Түүх<textarea name="body" maxLength={100000} required placeholder="Энэ үйл явдал хэрхэн болсон тухай бичнэ үү…" /></label>
              <label>Холбоотой хүн хайх<input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Нэрээр хайх…" autoComplete="off" /></label>
              {selectedPeople.length > 0 && <div className="story-people-chips" aria-label="Сонгосон хүмүүс">{selectedPeople.map((person) => <button type="button" key={person.id} onClick={() => togglePerson(person)}>{person.name} ×</button>)}</div>}
              {personQuery.trim().length >= 2 && personResults && (
                <div className="story-person-results">
                  {personResults.items.length ? personResults.items.map((person) => {
                    const selected = selectedPeople.some((item) => item.id === person.id);
                    return <button type="button" key={person.id} aria-pressed={selected} onClick={() => togglePerson({ id: person.id, name: person.name })}>{selected ? '✓ ' : '+ '}{person.name}{person.birth_year ? ' · ' + person.birth_year : ''}</button>;
                  }) : <span>Тохирох хүн олдсонгүй.</span>}
                </div>
              )}
              <div className="story-form-actions"><button className="primary" type="submit" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Түүх хадгалах'}</button></div>
            </form>
          </section>
        )}

        <section className="stories-toolbar card" aria-label="Түүх хайх">
          <label>Түүх хайх<input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadStories(familyId, 1); }} placeholder="Гарчиг эсвэл агуулгаар хайх…" /></label>
          <button type="button" onClick={() => void loadStories(familyId, 1)} disabled={busy}>Хайх</button>
        </section>

        {loading && !stories ? (
          <section className="stories-state card" aria-live="polite"><span className="people-spinner" aria-hidden="true" /><p>Гэр бүлийн түүхийг ачаалж байна…</p></section>
        ) : !families.length ? (
          <section className="stories-state card"><h2>Гэр бүл олдсонгүй.</h2><p>Танд одоогоор хандах боломжтой гэр бүл алга.</p><Link className="button" href="/families">Гэр бүлүүд</Link></section>
        ) : stories && stories.items.length === 0 ? (
          <section className="stories-state card"><h2>Одоогоор гэр бүлийн түүх хадгалагдаагүй байна.</h2><p>Анхны түүхээ хадгалж, гэр бүлийнхээ чухал үйл явдлыг үлдээгээрэй.</p><button className="primary" type="button" onClick={() => setShowEditor(true)}>Анхны түүх нэмэх</button></section>
        ) : (
          <>
            <div className="stories-results-head"><strong>{stories?.total ?? 0} түүх</strong>{busy && <span role="status">Шинэчилж байна…</span>}</div>
            <div className="story-grid" aria-busy={busy}>
              {stories?.items.map((story: StoryListItem) => (
                <article className="card story-card" key={story.id}>
                  <div className="story-card-meta"><span>{story.event_date ?? 'Огноогүй'}</span>{story.place && <span>· {story.place}</span>}</div>
                  <h2>{story.title}</h2>
                  <p>{story.excerpt}</p>
                  <div className="story-card-footer"><span>{story.author_name}</span><span>{story.related_people_count} холбоотой хүн</span></div>
                  <Link className="button story-open" href={'/stories/' + story.id + '?family=' + encodeURIComponent(familyId)}>Түүхийг унших →</Link>
                </article>
              ))}
            </div>
            {stories && stories.total > PAGE_SIZE && (
              <nav className="stories-pagination" aria-label="Түүхийн хуудаслалт">
                <button type="button" disabled={page <= 1 || busy} onClick={() => void loadStories(familyId, page - 1)}>← Өмнөх</button>
                <span>{page} / {Math.max(1, Math.ceil(stories.total / PAGE_SIZE))}</span>
                <button type="button" disabled={!stories.has_next || busy} onClick={() => void loadStories(familyId, page + 1)}>Дараагийн →</button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}
