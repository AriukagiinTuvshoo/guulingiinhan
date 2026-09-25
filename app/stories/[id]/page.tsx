'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, Family, Story } from '../../../lib/api';

export default function StoryDetailPage() {
  const [familyId, setFamilyId] = useState('');
  const [storyId, setStoryId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  const canMutate = family?.role === 'owner' || family?.role === 'editor';

  async function load(fid: string, sid: string) {
    setLoading(true);
    setError('');
    try {
      const result = await api<Story>('/families/' + fid + '/stories/' + sid);
      setStory(result);
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
    if (showDeleteDialog) deleteCancelRef.current?.focus();
  }, [showDeleteDialog]);

  async function remove() {
    if (!story || busy) return;
    setBusy(true);
    setError('');
    try {
      await api<void>('/families/' + familyId + '/stories/' + story.id, { method: 'DELETE' });
      window.location.href = '/stories?family=' + encodeURIComponent(familyId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Түүхийг устгах үед алдаа гарлаа. Дахин оролдоно уу.');
      setBusy(false);
      setShowDeleteDialog(false);
    }
  }

  if (loading) {
    return <main className="stories-page"><section className="stories-shell stories-state"><span className="people-spinner" aria-hidden="true" /><p>Түүхийг ачаалж байна…</p></section></main>;
  }

  if (error && !story) {
    return (
      <main className="stories-page">
        <section className="stories-shell">
          <div className="error" role="alert">{error}</div>
          <Link className="button" href={'/stories?family=' + encodeURIComponent(familyId)}>← Түүхүүд</Link>
        </section>
      </main>
    );
  }

  if (!story) return null;

  return (
    <main className="stories-page">
      <article className="stories-shell story-detail">
        <nav className="story-breadcrumb" aria-label="Байршил">
          <Link href={'/stories?family=' + encodeURIComponent(familyId)}>← Манай түүх</Link>
          {family && <span>{family.name}</span>}
        </nav>

        {error && <div className="error stories-error" role="alert">{error}</div>}

        <header className="story-detail-header">
          <p className="eyebrow">FAMILY STORY</p>
          <h1>{story.title}</h1>
          <div className="story-detail-meta">
            <span>{story.event_date ?? 'Огноогүй'}</span>
            {story.place && <span>· {story.place}</span>}
            <span>· {story.author_name}</span>
            <span>· {story.visibility === 'private' ? 'Зөвхөн би' : story.visibility === 'public' ? 'Нийтийн' : 'Гэр бүлийнхэн'}</span>
          </div>
          {canMutate && (
            <div className="story-detail-actions">
              <Link className="button" href={'/stories/' + story.id + '/edit?family=' + encodeURIComponent(familyId)}>Засах</Link>
              <button type="button" onClick={() => setShowDeleteDialog(true)} disabled={busy}>Түүх устгах</button>
            </div>
          )}
        </header>

        <section className="story-body" aria-label="Түүхийн агуулга">
          {story.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </section>

        <section className="card story-related">
          <div className="story-section-heading">
            <div><p className="eyebrow">RELATED PEOPLE</p><h2>Холбоотой хүмүүс</h2></div>
            <span>{story.related_people_count}</span>
          </div>
          {story.related_people.length ? (
            <div className="story-related-grid">
              {story.related_people.map((person) => (
                <Link className="story-related-person" key={person.id} href={'/profile?family=' + encodeURIComponent(familyId) + '&person=' + encodeURIComponent(person.id)}>
                  <span className="personavatar small" aria-hidden="true">{[person.last_name, person.first_name].filter(Boolean).map((value) => value.slice(0, 1)).join('').toUpperCase() || '?'}</span>
                  <span>{[person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ') || 'Нэргүй хүн'}</span>
                </Link>
              ))}
            </div>
          ) : <p className="profile-empty">Холбоотой хүн бүртгэгдээгүй байна.</p>}
        </section>

        <footer className="profile-footer">
          <Link href={'/stories?family=' + encodeURIComponent(familyId)}>← Бүх түүх</Link>
          {story.related_people[0] && <Link href={'/profile?family=' + encodeURIComponent(familyId) + '&person=' + encodeURIComponent(story.related_people[0].id)}>Хүний профайл →</Link>}
        </footer>
      </article>

      {showDeleteDialog && (
        <div className="story-dialog-backdrop" role="presentation">
          <section className="story-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="story-delete-title" aria-describedby="story-delete-description">
            <p className="eyebrow">DELETE STORY</p>
            <h2 id="story-delete-title">Энэ түүхийг устгах уу?</h2>
            <p id="story-delete-description">“{story.title}” түүхийг устгавал Story болон холбоотой StoryPerson холбоосууд устна. Ургийн модны мэдээлэлд өөрчлөлт орохгүй.</p>
            <div className="story-dialog-actions">
              <button ref={deleteCancelRef} type="button" onClick={() => setShowDeleteDialog(false)} disabled={busy}>Буцах</button>
              <button type="button" className="primary" onClick={() => void remove()} disabled={busy}>{busy ? 'Устгаж байна…' : 'Устгах'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
