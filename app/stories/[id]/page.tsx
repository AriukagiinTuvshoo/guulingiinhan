'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Family, Story } from '../../../lib/api';

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ түүхийг харах эрхгүй байна.';
    if (cause.status === 404) return 'Түүх олдсонгүй.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Холболтоо шалгаад дахин оролдоно уу.';
  }
  return fallback;
}

function StoryDetailPageContent() {
  const [familyId, setFamilyId] = useState('');
  const [storyId, setStoryId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const familyRequestRef = useRef(0);
  const storyRequestRef = useRef(0);
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  const canMutate = family?.role === 'owner' || family?.role === 'editor';

  const load = useCallback(async (fid: string, sid: string) => {
    const requestId = ++storyRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<Story>('/families/' + fid + '/stories/' + sid);
      if (requestId !== storyRequestRef.current) return;
      setStory(result);
    } catch (cause) {
      if (requestId !== storyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setStory(null);
      setError(friendlyError(cause, 'Түүхийг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    } finally {
      if (requestId === storyRequestRef.current) setLoading(false);
    }
  }, [router]);

  const loadFamilyContext = useCallback(async () => {
    const requestId = ++familyRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const items = await api<Family[]>('/families');
      if (requestId !== familyRequestRef.current) return;
      storyRequestRef.current += 1;
      const sid = params.id ?? '';
      setStoryId(sid);
      if (!items.length) {
        setFamily(null);
        setFamilyId('');
        setStory(null);
        setLoading(false);
        setError('Танд одоогоор хандах боломжтой гэр бүл алга.');
        return;
      }
      const requestedFamily = searchParams.get('family') ?? '';
      const selected = requestedFamily ? items.find((item) => item.id === requestedFamily) ?? null : items[0];
      if (!selected) {
        setFamily(null);
        setFamilyId('');
        setStory(null);
        setLoading(false);
        setError('Энэ гэр бүлийн түүхийг харах боломжгүй байна.');
        return;
      }
      setFamily(selected);
      setFamilyId(selected.id);
      if (!sid) {
        setLoading(false);
        setError('Түүхийн хаяг буруу байна.');
        return;
      }
      if (!requestedFamily) {
        router.replace('/stories/' + sid + '?family=' + encodeURIComponent(selected.id));
      }
      await load(selected.id, sid);
    } catch (cause) {
      if (requestId !== familyRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setStory(null);
      setLoading(false);
      setError(friendlyError(cause, 'Гэр бүлийн орчныг ачааллахад алдаа гарлаа. Дахин оролдоно уу.'));
    }
  }, [load, params.id, router, searchParams]);

  useEffect(() => {
    setFamily(null);
    setFamilyId('');
    setStory(null);
    setError('');
    storyRequestRef.current += 1;
    void loadFamilyContext();
  }, [loadFamilyContext]);

  useEffect(() => {
    if (showDeleteDialog) deleteCancelRef.current?.focus();
  }, [showDeleteDialog]);

  async function remove() {
    if (!story || busy) return;
    setBusy(true);
    setError('');
    try {
      await api<void>('/families/' + familyId + '/stories/' + story.id, { method: 'DELETE' });
      router.replace('/stories?family=' + encodeURIComponent(familyId));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(friendlyError(cause, 'Түүхийг устгах үед алдаа гарлаа. Дахин оролдоно уу.'));
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
          <div className="story-error-actions"><button type="button" onClick={() => void loadFamilyContext()}>Дахин оролдох</button><Link className="button" href={familyId ? '/stories?family=' + encodeURIComponent(familyId) : '/stories'}>← Манай түүх</Link></div>
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
          <p className="story-detail-year" aria-hidden="true">{story.event_date ? story.event_date.slice(0, 4) : '—'}</p>
          <p className="eyebrow">FAMILY STORY · {family?.name ?? 'Гэр бүл'}</p>
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

        <section className="story-reading" aria-labelledby="story-content-heading"><h2 id="story-content-heading" className="sr-only">Түүхийн агуулга</h2>
          {story.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </section>

        <section className="card story-related" aria-labelledby="story-related-heading">
          <div className="story-section-heading">
            <div><p className="eyebrow">RELATED PEOPLE</p><h2 id="story-related-heading">Холбоотой хүмүүс</h2></div>
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

        <footer className="story-detail-footer">
          <Link href={'/tree?family=' + encodeURIComponent(familyId)}>← Удмын мод руу буцах</Link>
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


export default function StoryDetailPage() {
  return (
    <Suspense fallback={<main className="stories-page"><section className="stories-shell stories-state" aria-live="polite"><span className="people-spinner" aria-hidden="true" /><p>Түүхийг ачаалж байна…</p></section></main>}>
      <StoryDetailPageContent />
    </Suspense>
  );
}
