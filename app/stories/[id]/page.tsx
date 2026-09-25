'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api, Family, PersonSearchPage, Story } from '../../../lib/api';

export default function StoryDetailPage() {
  const [familyId, setFamilyId] = useState('');
  const [storyId, setStoryId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<PersonSearchPage | null>(null);
  const [selectedPeople, setSelectedPeople] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load(fid: string, sid: string) {
    setLoading(true);
    setError('');
    try {
      const result = await api<Story>('/families/' + fid + '/stories/' + sid);
      setStory(result);
      setSelectedPeople(result.related_people.map((person) => ({ id: person.id, name: [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ') })));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Түүхийг ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fid = params.get('family') ?? '';
    const sid = window.location.pathname.split('/').filter(Boolean).at(-1) ?? '';
    setFamilyId(fid);
    setStoryId(sid);
    if (!fid || !sid) {
      setLoading(false);
      setError('Түүхийн хаяг буруу байна.');
      return;
    }
    api<Family>('/families/' + fid).then(setFamily).catch(() => undefined);
    void load(fid, sid);
  }, []);

  useEffect(() => {
    if (!familyId || !personQuery.trim()) {
      setPersonResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api<PersonSearchPage>('/families/' + familyId + '/persons/search?q=' + encodeURIComponent(personQuery.trim()) + '&page=1&page_size=20')
        .then(setPersonResults)
        .catch(() => setPersonResults(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [familyId, personQuery]);

  function togglePerson(person: { id: string; name: string }) {
    setSelectedPeople((current) => current.some((item) => item.id === person.id) ? current.filter((item) => item.id !== person.id) : [...current, person]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!story) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/families/' + familyId + '/stories/' + story.id, {
        method: 'PUT',
        body: JSON.stringify({
          title: String(form.get('title') ?? ''),
          body: String(form.get('body') ?? ''),
          event_date: form.get('event_date') || null,
          place: form.get('place') || null,
          visibility: String(form.get('visibility') ?? 'family'),
          person_ids: selectedPeople.map((person) => person.id),
        }),
      });
      setEditing(false);
      await load(familyId, story.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Түүхийг хадгалж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!story || !window.confirm('Энэ түүхийг устгах уу?')) return;
    setBusy(true);
    setError('');
    try {
      await api('/families/' + familyId + '/stories/' + story.id, { method: 'DELETE' });
      window.location.href = '/stories?family=' + encodeURIComponent(familyId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Түүхийг устгаж чадсангүй.');
      setBusy(false);
    }
  }

  if (loading) return <main className="stories-page"><section className="stories-shell stories-state"><span className="people-spinner" aria-hidden="true" /><p>Түүхийг ачаалж байна…</p></section></main>;
  if (error && !story) return <main className="stories-page"><section className="stories-shell"><div className="error" role="alert">{error}</div><Link className="button" href={'/stories?family=' + encodeURIComponent(familyId)}>← Түүхүүд</Link></section></main>;
  if (!story) return null;

  return (
    <main className="stories-page">
      <article className="stories-shell story-detail">
        <nav className="story-breadcrumb"><Link href={'/stories?family=' + encodeURIComponent(familyId)}>← Манай түүх</Link>{family && <span>{family.name}</span>}</nav>
        {error && <div className="error stories-error" role="alert">{error}</div>}
        <header className="story-detail-header">
          <p className="eyebrow">FAMILY STORY</p>
          <h1>{story.title}</h1>
          <div className="story-detail-meta"><span>{story.event_date ?? 'Огноогүй'}</span>{story.place && <span>· {story.place}</span>}<span>· {story.author_name}</span></div>
          <div className="story-detail-actions"><button type="button" onClick={() => setEditing((value) => !value)}>{editing ? 'Болих' : 'Засах'}</button><button type="button" onClick={() => void remove()} disabled={busy}>Устгах</button></div>
        </header>

        {editing ? (
          <section className="card story-editor">
            <form onSubmit={save}>
              <div className="story-form-grid">
                <label>Гарчиг<input name="title" defaultValue={story.title} maxLength={180} required /></label>
                <label>Огноо<input name="event_date" type="date" defaultValue={story.event_date ?? ''} /></label>
                <label>Газар<input name="place" defaultValue={story.place ?? ''} maxLength={240} /></label>
                <label>Харагдах байдал<select name="visibility" defaultValue={story.visibility}><option value="family">Гэр бүлийнхэн</option><option value="private">Зөвхөн би</option><option value="public">Нийтийн</option></select></label>
              </div>
              <label>Түүх<textarea name="body" defaultValue={story.body} maxLength={100000} required /></label>
              <label>Холбоотой хүн хайх<input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Нэрээр хайх…" autoComplete="off" /></label>
              {selectedPeople.length > 0 && <div className="story-people-chips">{selectedPeople.map((person) => <button type="button" key={person.id} onClick={() => togglePerson(person)}>{person.name} ×</button>)}</div>}
              {personQuery.trim() && personResults && <div className="story-person-results">{personResults.items.map((person) => <button type="button" key={person.id} onClick={() => togglePerson({ id: person.id, name: person.name })}>+ {person.name}</button>)}</div>}
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Өөрчлөлтийг хадгалах'}</button>
            </form>
          </section>
        ) : (
          <>
            <section className="story-body" aria-label="Түүхийн агуулга">
              {story.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </section>
            <section className="card story-related">
              <div className="story-section-heading"><div><p className="eyebrow">RELATED PEOPLE</p><h2>Холбоотой хүмүүс</h2></div><span>{story.related_people_count}</span></div>
              {story.related_people.length ? (
                <div className="story-related-grid">
                  {story.related_people.map((person) => (
                    <Link className="story-related-person" key={person.id} href={'/profile?family=' + encodeURIComponent(familyId) + '&person=' + encodeURIComponent(person.id)}>
                      <span className="personavatar small" aria-hidden="true">{[person.last_name, person.first_name].filter(Boolean).map((v) => v.slice(0,1)).join('').toUpperCase() || '?'}</span>
                      <span>{[person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ') || 'Нэргүй хүн'}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="profile-empty">Холбоотой хүн бүртгэгдээгүй байна.</p>}
            </section>
            <footer className="profile-footer"><Link href={'/stories?family=' + encodeURIComponent(familyId)}>← Бүх түүх</Link>{story.related_people[0] && <Link href={'/profile?family=' + encodeURIComponent(familyId) + '&person=' + encodeURIComponent(story.related_people[0].id)}>Хүний профайл →</Link>}</footer>
          </>
        )}
      </article>
    </main>
  );
}
