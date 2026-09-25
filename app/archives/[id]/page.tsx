'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, Archive, Family } from '../../../lib/api';

export default function ArchiveDetailPage() {
  const [familyId, setFamilyId] = useState('');
  const [archive, setArchive] = useState<Archive | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const canMutate = family?.role === 'owner' || family?.role === 'editor';

  async function load(fid: string, archiveId: string) {
    setLoading(true);
    setError('');
    try {
      setArchive(await api<Archive>('/families/' + fid + '/archives/' + archiveId));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Архивийг ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fid = params.get('family') ?? '';
    const archiveId = window.location.pathname.split('/').filter(Boolean).at(-1) ?? '';
    setFamilyId(fid);
    if (!fid || !archiveId) {
      setLoading(false);
      setError('Архивийн хаяг буруу байна.');
      return;
    }
    api<Family>('/families/' + fid).then(setFamily).catch(() => undefined);
    void load(fid, archiveId);
  }, []);

  useEffect(() => {
    if (showDeleteDialog) cancelRef.current?.focus();
  }, [showDeleteDialog]);

  async function remove() {
    if (!archive || busy) return;
    setBusy(true);
    setError('');
    try {
      await api<void>('/families/' + familyId + '/archives/' + archive.id, { method: 'DELETE' });
      window.location.href = '/archives?family=' + encodeURIComponent(familyId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Архивийг устгаж чадсангүй.');
      setBusy(false);
      setShowDeleteDialog(false);
    }
  }

  if (loading) {
    return (
      <main className="stories-page">
        <section className="stories-shell stories-state" aria-live="polite">
          <span className="people-spinner" aria-hidden="true" />
          <p>Архивийг ачаалж байна…</p>
        </section>
      </main>
    );
  }

  if (!archive) {
    return (
      <main className="stories-page">
        <section className="stories-shell">
          <div className="error stories-error" role="alert">{error || 'Архив олдсонгүй.'}</div>
          <Link className="button" href={'/archives?family=' + encodeURIComponent(familyId)}>← Архив</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="stories-page">
      <article className="stories-shell story-detail">
        <nav className="story-breadcrumb" aria-label="Байршил">
          <Link href={'/archives?family=' + encodeURIComponent(familyId)}>← Архив</Link>
          {family && <span>{family.name}</span>}
        </nav>

        {error && <div className="error stories-error" role="alert">{error}</div>}

        <header className="story-detail-header">
          <p className="eyebrow">FAMILY ARCHIVE</p>
          <h1>{archive.title}</h1>
          <div className="story-detail-meta">
            <span>{archive.document_date ?? 'Огноогүй'}</span>
            {archive.place && <span>· {archive.place}</span>}
            <span>· {archive.author_name}</span>
            <span>· {archive.visibility === 'private' ? 'Зөвхөн би' : archive.visibility === 'public' ? 'Нийтийн' : 'Гэр бүлийнхэн'}</span>
          </div>
          {canMutate && (
            <div className="story-detail-actions">
              <button type="button" onClick={() => setShowDeleteDialog(true)} disabled={busy}>Архив устгах</button>
            </div>
          )}
        </header>

        <section className="story-body" aria-label="Архивийн тайлбар">
          <p>{archive.description || 'Тайлбар оруулаагүй байна.'}</p>
        </section>

        <section className="card story-related">
          <div className="story-section-heading">
            <div><p className="eyebrow">RELATED PEOPLE</p><h2>Холбоотой хүмүүс</h2></div>
            <span>{archive.related_people_count}</span>
          </div>
          {archive.related_people.length ? (
            <div className="story-related-grid">
              {archive.related_people.map((person) => (
                <Link
                  className="story-related-person"
                  key={person.id}
                  href={'/profile?family=' + encodeURIComponent(familyId) + '&person=' + encodeURIComponent(person.id)}
                >
                  <span className="personavatar small" aria-hidden="true">
                    {[person.last_name, person.first_name].filter(Boolean).map((value) => value.slice(0, 1)).join('').toUpperCase() || '?'}
                  </span>
                  <span>{[person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ') || 'Нэргүй хүн'}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="profile-empty">Холбоотой хүн бүртгэгдээгүй байна.</p>
          )}
        </section>

        <section className="card story-related">
          <div className="story-section-heading">
            <div><p className="eyebrow">SOURCE</p><h2>Баримтын эх сурвалж</h2></div>
          </div>
          <p className="profile-note">Энэ foundation дээр баримтын metadata болон холбоосууд хадгалагдана. Файл upload, OCR болон document viewer дараагийн тусдаа feature байна.</p>
        </section>

        <footer className="profile-footer">
          <Link href={'/archives?family=' + encodeURIComponent(familyId)}>← Бүх архив</Link>
          {archive.related_people[0] && (
            <Link href={'/profile?family=' + encodeURIComponent(familyId) + '&person=' + encodeURIComponent(archive.related_people[0].id)}>
              Хүний профайл →
            </Link>
          )}
        </footer>
      </article>

      {showDeleteDialog && (
        <div className="story-dialog-backdrop" role="presentation">
          <section className="story-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-delete-title">
            <p className="eyebrow">DELETE ARCHIVE</p>
            <h2 id="archive-delete-title">Энэ архивийг устгах уу?</h2>
            <p>“{archive.title}” архивийн record болон холбоотой хүмүүсийн relation устна. Ургийн мод, гэрлэлт, удам, салаанд өөрчлөлт орохгүй.</p>
            <div className="story-dialog-actions">
              <button ref={cancelRef} type="button" onClick={() => setShowDeleteDialog(false)} disabled={busy}>Буцах</button>
              <button type="button" className="primary" onClick={() => void remove()} disabled={busy}>{busy ? 'Устгаж байна…' : 'Устгах'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
