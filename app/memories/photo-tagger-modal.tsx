'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError, API_BASE, PersonSearchPage } from '../../lib/api';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { useFocusTrap } from '../../lib/use-focus-trap';

export type PhotoItem = {
  id: string;
  title: string | null;
  thumbnail_url: string;
  content_url: string;
  person_ids?: string[];
  tagged_people?: { id: string; name: string }[];
};

interface PhotoTaggerModalProps {
  isOpen: boolean;
  photo: PhotoItem | null;
  familyId: string;
  memoryTitle: string;
  knownPeople?: { id: string; name: string }[];
  canEdit: boolean;
  onClose: () => void;
  onTagsUpdated: (photoId: string, newPersonIds: string[]) => void;
  onPhotoDeleted?: (photoId: string) => void;
}

function photoUrl(path: string) {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

export function PhotoTaggerModal({
  isOpen,
  photo,
  familyId,
  memoryTitle,
  knownPeople = [],
  canEdit,
  onClose,
  onTagsUpdated,
  onPhotoDeleted,
}: PhotoTaggerModalProps) {
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [taggedPeople, setTaggedPeople] = useState<{ id: string; name: string }[]>([]);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(Boolean(isOpen && photo), dialogRef, {
    onEscape: onClose,
    disabled: confirmDeleteOpen || busy,
  });

  // Sync state when active photo changes
  useEffect(() => {
    if (!photo) return;
    const initialIds = photo.person_ids || [];
    setPersonIds(initialIds);

    // Resolve known names
    const resolved: { id: string; name: string }[] = [];
    for (const pid of initialIds) {
      const match = knownPeople.find((p) => p.id === pid);
      resolved.push(match || { id: pid, name: `Хүн #${pid.slice(0, 6)}` });
    }
    setTaggedPeople(resolved);
    setIsAddingTag(false);
    setError('');
    setNotice('');
  }, [photo, knownPeople]);

  // Search people in family when searchQuery changes
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !familyId) {
      setSearchResults([]);
      return;
    }

    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void api<PersonSearchPage>(
        `/families/${familyId}/persons/search?q=${encodeURIComponent(q)}&page=1&page_size=15`,
      )
        .then((res) => {
          if (active) {
            setSearchResults(res.items.map((item) => ({ id: item.id, name: item.name })));
          }
        })
        .catch(() => {
          if (active) setSearchResults([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, familyId]);

  if (!isOpen || !photo) return null;

  async function handleAddTag(person: { id: string; name: string }) {
    if (personIds.includes(person.id)) return;
    const nextIds = [...personIds, person.id];
    setBusy(true);
    setError('');
    try {
      await api(`/families/${familyId}/photos/${photo!.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ person_ids: nextIds }),
      });
      setPersonIds(nextIds);
      setTaggedPeople((prev) => [...prev, person]);
      onTagsUpdated(photo!.id, nextIds);
      setSearchQuery('');
      setIsAddingTag(false);
      setNotice(`${person.name} амжилттай таглагдлаа.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Таг нэмэхэд алдаа гарлаа.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveTag(targetPersonId: string) {
    const nextIds = personIds.filter((id) => id !== targetPersonId);
    setBusy(true);
    setError('');
    try {
      await api(`/families/${familyId}/photos/${photo!.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ person_ids: nextIds }),
      });
      setPersonIds(nextIds);
      setTaggedPeople((prev) => prev.filter((p) => p.id !== targetPersonId));
      onTagsUpdated(photo!.id, nextIds);
      setNotice('Таг хасагдлаа.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Таг хасахад алдаа гарлаа.');
    } finally {
      setBusy(false);
    }
  }

  function handleDeletePhoto() {
    setConfirmDeleteOpen(true);
  }

  async function confirmDeletePhoto() {
    setConfirmDeleteOpen(false);
    setBusy(true);
    setError('');
    try {
      await api(`/families/${familyId}/photos/${photo!.id}`, {
        method: 'DELETE',
      });
      if (onPhotoDeleted) onPhotoDeleted(photo!.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Зургийг устгахад алдаа гарлаа.');
      setBusy(false);
    }
  }

  return (
    <div className="photo-modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="photo-modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-modal-title"
      >
        {/* Header */}
        <div className="photo-modal-header">
          <div>
            <h3 id="photo-modal-title">
              {photo.title || memoryTitle || 'Гэр бүлийн түүхэн зураг'}
            </h3>
            <p className="photo-modal-subtitle">
              {memoryTitle ? `Дурсамж: ${memoryTitle}` : 'Зургийн нарийвчилсан үзүүлэлт ба таглагдсан хүмүүс'}
            </p>
          </div>
          <button
            type="button"
            className="photo-modal-close"
            onClick={onClose}
            aria-label="Хаах"
          >
            ✕
          </button>
        </div>

        {/* Alerts */}
        {error && <div className="photo-modal-alert is-error" role="alert">{error}</div>}
        {notice && <div className="photo-modal-alert is-success" role="status">{notice}</div>}

        {/* Content: 2-column on desktop, stacked on mobile */}
        <div className="photo-modal-content">
          {/* Main Photo Display Area */}
          <div className="photo-modal-image-wrap">
            <img
              src={photoUrl(photo.content_url)}
              alt={photo.title || memoryTitle}
              className="photo-modal-img"
              crossOrigin="use-credentials"
            />
          </div>

          {/* Sidebar / Info & People Tagging */}
          <div className="photo-modal-sidebar">
            <div className="photo-modal-section">
              <div className="photo-modal-section-title">
                <h4>Зурагт орсон хүмүүс ({taggedPeople.length})</h4>
                {canEdit && !isAddingTag && (
                  <button
                    type="button"
                    className="photo-tag-btn-add"
                    onClick={() => setIsAddingTag(true)}
                  >
                    + Хүн таглах
                  </button>
                )}
              </div>

              {/* Tag Search / Add Form */}
              {isAddingTag && (
                <div className="photo-add-tag-box">
                  <div className="photo-search-input-wrap">
                    <input
                      type="text"
                      placeholder="Ургийн хүнээ нэрээр хайх…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="photo-tag-btn-cancel"
                      onClick={() => {
                        setIsAddingTag(false);
                        setSearchQuery('');
                      }}
                    >
                      Болих
                    </button>
                  </div>

                  {searching && <p className="photo-search-loading">Хайж байна…</p>}

                  {searchResults.length > 0 && (
                    <div className="photo-search-dropdown">
                      {searchResults.map((person) => {
                        const isAlreadyTagged = personIds.includes(person.id);
                        return (
                          <button
                            key={person.id}
                            type="button"
                            className="photo-search-item"
                            disabled={isAlreadyTagged || busy}
                            onClick={() => void handleAddTag(person)}
                          >
                            <span>👤 {person.name}</span>
                            {isAlreadyTagged && <em>(Таглагдсан)</em>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!searching && searchQuery && searchResults.length === 0 && (
                    <p className="photo-search-empty">Хүн олдсонгүй.</p>
                  )}
                </div>
              )}

              {/* Tagged People Chips */}
              <div className="photo-tagged-list">
                {taggedPeople.length === 0 ? (
                  <p className="photo-tagged-empty">
                    Энэ зурагт одоогоор хүн таглагдаагүй байна.{' '}
                    {canEdit && 'Дээрх "+ Хүн таглах" товчоор өвөг дээдсээ нэрлээрэй.'}
                  </p>
                ) : (
                  taggedPeople.map((person) => (
                    <div key={person.id} className="photo-tagged-card">
                      <div className="photo-tagged-name">
                        <span className="photo-person-avatar">
                          {person.name.slice(0, 1)}
                        </span>
                        <strong>{person.name}</strong>
                      </div>
                      <div className="photo-tagged-actions">
                        <Link
                          href={`/tree?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                          className="photo-link-chip is-tree"
                          title="Удмын модон дээр харах"
                        >
                          🌳 Модонд
                        </Link>
                        <Link
                          href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                          className="photo-link-chip"
                          title="Хувийн профайлыг нээх"
                        >
                          👤 Профайл
                        </Link>
                        {canEdit && (
                          <button
                            type="button"
                            className="photo-tag-del-btn"
                            onClick={() => void handleRemoveTag(person.id)}
                            disabled={busy}
                            title="Энэ хүний тагийг хасах"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Photo Danger Actions */}
            {canEdit && onPhotoDeleted && (
              <div className="photo-modal-footer">
                <button
                  type="button"
                  className="photo-delete-btn"
                  onClick={() => void handleDeletePhoto()}
                  disabled={busy}
                >
                  🗑️ Зургийг устгах
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        title="Зургийг устгах"
        message="Та энэ зургийг бүр мөсөн устгахдаа итгэлтэй байна уу?"
        confirmLabel="Устгах"
        variant="danger"
        busy={busy}
        onConfirm={() => void confirmDeletePhoto()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
