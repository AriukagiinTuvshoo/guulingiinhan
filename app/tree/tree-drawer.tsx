'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  LifeEvent,
  Marriage,
  OralHistoryExtractOut,
  PersonProfile,
  personName,
  StoryListPage,
  TreePerson,
} from '../../lib/api';
import { ConfirmDialog } from '../../components/confirm-dialog';

type TabType = 'overview' | 'timeline' | 'oral_history' | 'stories';

interface TreeDrawerProps {
  familyId: string;
  personId: string;
  person: TreePerson | null;
  allPersons: TreePerson[];
  marriages: Marriage[];
  canEdit?: boolean;
  onSelectRelative: (relativeId: string) => void;
  onCenterPerson: (personId: string) => void;
  onOpenKinship: (personId: string) => void;
  onAddRelation: (relationType: 'parent' | 'child' | 'spouse' | 'sibling') => void;
  onRefreshTree?: (notice?: string) => Promise<void>;
  onClose: () => void;
  onDivorce: (marriageId: string) => Promise<void>;
  profileHref: (personId: string) => string;
}

const EVENT_TYPE_MAP: Record<string, { label: string; icon: string }> = {
  birth: { label: 'Мэндэлсэн (Төрсөн)', icon: '👶' },
  school: { label: 'Сургууль, боловсрол', icon: '🎓' },
  work: { label: 'Ажил хөдөлмөр, алба', icon: '💼' },
  marriage: { label: 'Гэр бүл, хурим', icon: '💍' },
  child_birth: { label: 'Үр хүүхэд мэндэлсэн', icon: '🍼' },
  award: { label: 'Гавьяа шагнал, цол', icon: '🏆' },
  move: { label: 'Шилжилт, нүүдэл', icon: '🏡' },
  death: { label: 'Тэнгэрт дэвшсэн', icon: '🕊️' },
  other: { label: 'Бусад үйл явдал', icon: '📜' },
};

function formatInitials(firstName?: string | null, lastName?: string | null) {
  return [lastName, firstName]
    .filter(Boolean)
    .map((val) => val!.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function calculateAge(birthDate?: string | null, deathDate?: string | null, isAlive?: boolean) {
  if (!birthDate) return null;
  const birthYear = parseInt(birthDate.slice(0, 4), 10);
  if (isNaN(birthYear)) return null;

  if (isAlive) {
    const currentYear = new Date().getFullYear();
    const age = currentYear - birthYear;
    return age > 0 ? `${age} настай` : null;
  }

  if (deathDate) {
    const deathYear = parseInt(deathDate.slice(0, 4), 10);
    if (!isNaN(deathYear)) {
      const age = deathYear - birthYear;
      return age >= 0 ? `${age} насалсан` : null;
    }
  }

  return null;
}

export function TreeDrawer({
  familyId,
  personId,
  person,
  allPersons,
  marriages,
  canEdit = false,
  onSelectRelative,
  onCenterPerson,
  onOpenKinship,
  onAddRelation,
  onRefreshTree,
  onClose,
  onDivorce,
  profileHref,
}: TreeDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [biography, setBiography] = useState('');
  const [bioEditing, setBioEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Life event add form
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({
    event_type: 'school',
    title: '',
    event_date: '',
    date_note: '',
    location: '',
    description: '',
  });

  // AI Oral History form
  const [oralNarrative, setOralNarrative] = useState('');
  const [oralAutoEvents, setOralAutoEvents] = useState(true);
  const [oralAutoBio, setOralAutoBio] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractedResult, setExtractedResult] = useState<OralHistoryExtractOut | null>(null);

  // Load detailed profile, biography, events, stories
  useEffect(() => {
    if (!familyId || !personId) return;

    let cancelled = false;
    setLoading(true);
    setError('');
    setNotice('');
    setBioEditing(false);
    setShowAddEvent(false);
    setExtractedResult(null);

    async function loadData() {
      try {
        const [profRes, bioRes, eventsRes, storiesRes] = await Promise.allSettled([
          api<PersonProfile>(`/families/${familyId}/persons/${personId}`),
          api<{ content: string }>(`/families/${familyId}/persons/${personId}/biography`),
          api<LifeEvent[]>(`/families/${familyId}/persons/${personId}/events`),
          api<StoryListPage>(`/families/${familyId}/stories?page=1&page_size=6&person_id=${encodeURIComponent(personId)}`),
        ]);

        if (cancelled) return;

        if (profRes.status === 'fulfilled') setProfile(profRes.value);
        if (bioRes.status === 'fulfilled') {
          setBiography(bioRes.value.content || '');
          setBioDraft(bioRes.value.content || '');
        }
        if (eventsRes.status === 'fulfilled') {
          // Sort events chronologically
          const sorted = [...eventsRes.value].sort((a, b) => {
            const dateA = a.event_date || '9999-12-31';
            const dateB = b.event_date || '9999-12-31';
            return dateA.localeCompare(dateB);
          });
          setEvents(sorted);
        }
        if (storiesRes.status === 'fulfilled') setStories(storiesRes.value);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Мэдээлэл ачаалахад алдаа гарлаа.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [familyId, personId]);

  // Save Biography
  async function handleSaveBiography(e: FormEvent) {
    e.preventDefault();
    if (!familyId || !personId || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/families/${familyId}/persons/${personId}/biography`, {
        method: 'PUT',
        body: JSON.stringify({ content: bioDraft }),
      });
      setBiography(bioDraft);
      setBioEditing(false);
      setNotice('Намтар амжилттай шинэчлэгдлээ.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Намтар хадгалахад алдаа гарлаа.');
    } finally {
      setBusy(false);
    }
  }

  // Create Life Event
  async function handleAddEvent(e: FormEvent) {
    e.preventDefault();
    if (!familyId || !personId || busy || !newEvent.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const created = await api<LifeEvent>(`/families/${familyId}/persons/${personId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: newEvent.event_type,
          title: newEvent.title.trim(),
          event_date: newEvent.event_date || null,
          date_note: newEvent.date_note.trim() || null,
          location: newEvent.location.trim() || null,
          description: newEvent.description.trim() || null,
        }),
      });

      setEvents((prev) =>
        [...prev, created].sort((a, b) => (a.event_date || '9999').localeCompare(b.event_date || '9999')),
      );
      setNewEvent({
        event_type: 'school',
        title: '',
        event_date: '',
        date_note: '',
        location: '',
        description: '',
      });
      setShowAddEvent(false);
      setNotice('Шинэ үйл явдал амжилттай нэмэгдлээ.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Үйл явдал нэмэхэд алдаа гарлаа.');
    } finally {
      setBusy(false);
    }
  }

  // Delete Life Event
  const [pendingDeleteEventId, setPendingDeleteEventId] = useState<string | null>(null);

  function handleDeleteEvent(eventId: string) {
    setPendingDeleteEventId(eventId);
  }

  async function confirmDeleteEvent() {
    if (!pendingDeleteEventId) return;
    const eventId = pendingDeleteEventId;
    setPendingDeleteEventId(null);
    setBusy(true);
    setError('');
    try {
      await api(`/families/${familyId}/persons/${personId}/events/${eventId}`, {
        method: 'DELETE',
      });
      setEvents((prev) => prev.filter((item) => item.id !== eventId));
      setNotice('Үйл явдал устгагдлаа.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Устгахад алдаа гарлаа.');
    } finally {
      setBusy(false);
    }
  }

  // Extract AI Oral History
  async function handleExtractOralHistory(e: FormEvent) {
    e.preventDefault();
    if (!familyId || !personId || extracting || oralNarrative.trim().length < 10) return;
    setExtracting(true);
    setError('');
    setNotice('');
    try {
      const res = await api<OralHistoryExtractOut>(
        `/families/${familyId}/persons/${personId}/oral-history/extract`,
        {
          method: 'POST',
          body: JSON.stringify({
            narrative_text: oralNarrative.trim(),
            auto_create_events: oralAutoEvents,
            update_biography: oralAutoBio,
          }),
        },
      );
      setExtractedResult(res);

      if (oralAutoEvents && res.created_events_count > 0) {
        // Refresh events list
        const updatedEvents = await api<LifeEvent[]>(`/families/${familyId}/persons/${personId}/events`);
        setEvents(
          updatedEvents.sort((a, b) => (a.event_date || '9999').localeCompare(b.event_date || '9999')),
        );
      }

      if (oralAutoBio && res.biography_updated) {
        setBiography(res.suggested_biography);
        setBioDraft(res.suggested_biography);
      }

      setNotice(
        `Аман түүхээс ${res.extracted_events.length} үйл явдал задлав. ${
          res.created_events_count ? `${res.created_events_count} үйл явдал он цагийн хэлхээсэнд нэмэгдлээ.` : ''
        }`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Аман түүхийг шинжлэхэд алдаа гарлаа.');
    } finally {
      setExtracting(false);
    }
  }

  if (!person) {
    return (
      <aside className="tree-drawer tree-drawer--empty" aria-label="Сонгосон хүний мэдээлэл">
        <div className="tree-drawer-empty-state">
          <span className="tree-drawer-empty-icon" aria-hidden="true">🌳</span>
          <h3>Хүн сонгогдоогүй байна</h3>
          <p>Удмын модны аль нэг хүн дээр дарж намтар, он цагийн хэлхээс, аман түүхийг харна уу.</p>
        </div>
      </aside>
    );
  }

  const displayName = personName(person) || 'Нэргүй хүн';
  const ageLabel = calculateAge(person.birth_date, person.death_date, person.is_alive);

  return (
    <aside className="tree-drawer" aria-label={`${displayName}-ийн мэдээллийн самбар`}>
      {/* Drawer Top Bar with Close button */}
      <div className="tree-drawer-topbar">
        <div className="tree-drawer-badge-group">
          <span className="tree-drawer-gen-pill">
            {person.gender === 'female' ? 'Эмэгтэй' : 'Эрэгтэй'}
          </span>
          {person.is_alive ? (
            <span className="tree-drawer-alive-pill is-alive">🟢 Амьд сэрүүн</span>
          ) : (
            <span className="tree-drawer-alive-pill is-deceased">🕊️ Бурхан болсон</span>
          )}
          {ageLabel && <span className="tree-drawer-age-pill">{ageLabel}</span>}
        </div>
        <button
          type="button"
          className="tree-drawer-close"
          onClick={onClose}
          aria-label="Самбарыг хаах"
        >
          ✕
        </button>
      </div>

      {/* Header Profile Identity */}
      <div className="tree-drawer-hero">
        <div className="tree-drawer-avatar" aria-hidden="true">
          {formatInitials(person.first_name, person.last_name)}
        </div>
        <div className="tree-drawer-hero-info">
          <h2>{displayName}</h2>
          <p className="tree-drawer-dates">
            {person.birth_date ? person.birth_date.slice(0, 4) : 'Огноогүй'}
            {' – '}
            {person.is_alive ? 'одоо' : person.death_date ? person.death_date.slice(0, 4) : 'тодорхойгүй'}
          </p>
          {(person.lineage_name || person.branch_name) && (
            <div className="tree-drawer-lineage">
              {person.lineage_name && <span>Овог/Удам: {person.lineage_name}</span>}
              {person.branch_name && <span>Салаа: {person.branch_name}</span>}
            </div>
          )}
          <div style={{ marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(person.can_edit ?? profile?.can_edit ?? profile?.can_edit_profile) ? (
              <span style={{ fontSize: '10px', background: 'var(--gold-soft)', color: 'var(--ui-accent-text)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                Засах эрхтэй
              </span>
            ) : (
              <span style={{ fontSize: '10px', background: 'var(--ui-surface-subtle)', color: 'var(--ui-text-muted)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                Зөвхөн харах эрхтэй
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="tree-drawer-actions">
        <button
          type="button"
          className="tree-action-pill is-kinship"
          onClick={() => onOpenKinship(person.id)}
          title="Энэ хүнийг бусад гишүүнтэй ураг холбоо шалгах"
        >
          Ураг шалгах
        </button>
        <button
          type="button"
          className="tree-action-pill"
          onClick={() => onCenterPerson(person.id)}
          title="Модон дээр голлуулан харуулах"
        >
          Төвлөрөх
        </button>
        {canEdit && (
          <>
            <button
              type="button"
              className="tree-action-pill"
              onClick={() => onAddRelation('parent')}
              title="Энэ хүнд эцэг эсвэл эх нэмэх / холбох"
            >
              + Эцэг/Эх
            </button>
            <button
              type="button"
              className="tree-action-pill"
              onClick={() => onAddRelation('child')}
              title="Энэ хүнд хүүхэд нэмэх / холбох"
            >
              + Хүүхэд
            </button>
            <button
              type="button"
              className="tree-action-pill"
              onClick={() => onAddRelation('spouse')}
              title="Энэ хүнд хань нэмэх / холбох"
            >
              + Хань
            </button>
            <button
              type="button"
              className="tree-action-pill"
              onClick={() => onAddRelation('sibling')}
              title="Энэ хүнд ах, эгч, дүү нэмэх / холбох"
            >
              + Ах/Дүү
            </button>
          </>
        )}
        <Link
          className="tree-action-pill is-link"
          href={profileHref(person.id)}
          title="Дэлгэрэнгүй профайл хуудас руу очих"
        >
          🔗 Профайл →
        </Link>
      </div>

      {/* Status Notifications */}
      {error && <div className="tree-drawer-alert is-error" role="alert">{error}</div>}
      {notice && <div className="tree-drawer-alert is-success" role="status">{notice}</div>}

      {/* Tab Navigation */}
      <nav className="tree-drawer-tabs" aria-label="Мэдээллийн төрөл">
        <button
          type="button"
          className={`tree-tab-btn ${activeTab === 'overview' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          📜 Намтар
        </button>
        <button
          type="button"
          className={`tree-tab-btn ${activeTab === 'timeline' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('timeline')}
        >
          ⏳ Он цаг ({events.length})
        </button>
        <button
          type="button"
          className={`tree-tab-btn ${activeTab === 'oral_history' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('oral_history')}
        >
          🎙️ Хууч яриа
        </button>
        <button
          type="button"
          className={`tree-tab-btn ${activeTab === 'stories' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('stories')}
        >
          📖 Түүх ({stories?.total ?? 0})
        </button>
      </nav>

      {/* Tab Content Body */}
      <div className="tree-drawer-body">
        {loading && (
          <div className="tree-drawer-loading">
            <span className="people-spinner" aria-hidden="true" />
            <p>Мэдээлэл ачаалж байна…</p>
          </div>
        )}

        {/* TAB 1: OVERVIEW & BIOGRAPHY */}
        {!loading && activeTab === 'overview' && (
          <div className="tree-drawer-section">
            {/* Relatives Quick Navigator */}
            {profile && (
              <div className="tree-relatives-box">
                <h4>Шууд ураг төрөл (дээр нь дарж модонд шилжинэ):</h4>

                {/* Parents */}
                <div className="tree-relatives-group">
                  <span className="tree-relatives-label">Эцэг/эх:</span>
                  <div className="tree-relatives-chips">
                    {profile.parents.length ? (
                      profile.parents.map((p) => (
                        <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <button
                            type="button"
                            className="tree-relative-chip"
                            onClick={() => onSelectRelative(p.id)}
                            title={`${personName(p)} руу шилжих`}
                          >
                            👤 {personName(p)}
                          </button>
                          {Boolean(person.can_edit ?? profile?.can_edit ?? profile?.can_edit_profile) && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await api(
                                    `/families/${familyId}/relationships/parent-child?parent_id=${encodeURIComponent(p.id)}&child_id=${encodeURIComponent(person.id)}`,
                                    { method: 'DELETE' },
                                  );
                                  setProfile((prev) =>
                                    prev ? { ...prev, parents: prev.parents.filter((x) => x.id !== p.id) } : prev,
                                  );
                                  if (onRefreshTree) await onRefreshTree('Эцэг эх-хүүхдийн холбоосыг салгалаа.');
                                } catch (err) {
                                  setError(err instanceof ApiError ? err.message : 'Холбоос салгахад алдаа гарлаа.');
                                }
                              }}
                              title={`${personName(p)} эцэг/эхийн холбоосыг салгах`}
                              style={{
                                border: 'none',
                                background: 'var(--ui-danger-bg)',
                                color: 'var(--ui-danger-text)',
                                borderRadius: '50%',
                                width: 20,
                                height: 20,
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))
                    ) : (
                      <em className="tree-muted">Бүртгэлгүй</em>
                    )}
                  </div>
                </div>

                {/* Spouses */}
                <div className="tree-relatives-group">
                  <span className="tree-relatives-label">Хань:</span>
                  <div className="tree-relatives-chips">
                    {profile.spouses.length ? (
                      profile.spouses.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="tree-relative-chip"
                          onClick={() => onSelectRelative(s.id)}
                          title={`${personName(s)} руу шилжих`}
                        >
                          💍 {personName(s)}
                        </button>
                      ))
                    ) : (
                      <em className="tree-muted">Бүртгэлгүй</em>
                    )}
                  </div>
                </div>

                {/* Children */}
                <div className="tree-relatives-group">
                  <span className="tree-relatives-label">Хүүхдүүд ({profile.children.length}):</span>
                  <div className="tree-relatives-chips">
                    {profile.children.length ? (
                      profile.children.map((c) => (
                        <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <button
                            type="button"
                            className="tree-relative-chip"
                            onClick={() => onSelectRelative(c.id)}
                            title={`${personName(c)} руу шилжих`}
                          >
                            👶 {personName(c)}
                          </button>
                          {Boolean(person.can_edit ?? profile?.can_edit ?? profile?.can_edit_profile) && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await api(
                                    `/families/${familyId}/relationships/parent-child?parent_id=${encodeURIComponent(person.id)}&child_id=${encodeURIComponent(c.id)}`,
                                    { method: 'DELETE' },
                                  );
                                  setProfile((prev) =>
                                    prev ? { ...prev, children: prev.children.filter((x) => x.id !== c.id) } : prev,
                                  );
                                  if (onRefreshTree) await onRefreshTree('Хүүхдийн холбоосыг салгалаа.');
                                } catch (err) {
                                  setError(err instanceof ApiError ? err.message : 'Холбоос салгахад алдаа гарлаа.');
                                }
                              }}
                              title={`${personName(c)} хүүхдийн холбоосыг салгах`}
                              style={{
                                border: 'none',
                                background: 'var(--ui-danger-bg)',
                                color: 'var(--ui-danger-text)',
                                borderRadius: '50%',
                                width: 20,
                                height: 20,
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))
                    ) : (
                      <em className="tree-muted">Бүртгэлгүй</em>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Marriages details */}
            {marriages.length > 0 && (
              <div className="tree-marriages-list">
                <h4>Гэрлэлтийн түүх</h4>
                {marriages.map((m) => {
                  const partnerId = m.person_1_id === personId ? m.person_2_id : m.person_1_id;
                  const partner = allPersons.find((p) => p.id === partnerId);
                  return (
                    <div key={m.id} className="tree-marriage-card">
                      <div>
                        <strong>{partner ? personName(partner) : 'Хань'}</strong>
                        <span>
                          {m.status === 'married' ? 'Одоо хамт' : m.status === 'divorced' ? 'Салсан' : 'Бэлэвсэн'}
                          {m.start_date ? ` · ${m.start_date}` : ''}
                        </span>
                      </div>
                      {m.status === 'married' && Boolean(person.can_edit ?? profile?.can_edit ?? profile?.can_edit_profile) && (
                        <button
                          type="button"
                          className="tree-button-tiny"
                          onClick={() => void onDivorce(m.id)}
                          disabled={busy}
                        >
                          Салалт бүртгэх
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Biography Section */}
            <div className="tree-bio-box">
              <div className="tree-bio-header">
                <h4>Товч намтар</h4>
                {Boolean(person.can_edit ?? profile?.can_edit ?? profile?.can_edit_profile) && (
                  <button
                    type="button"
                    className="tree-button-tiny"
                    onClick={() => {
                      setBioDraft(biography);
                      setBioEditing(!bioEditing);
                    }}
                  >
                    {bioEditing ? 'Болих' : '✏️ Засах'}
                  </button>
                )}
              </div>

              {bioEditing ? (
                <form onSubmit={handleSaveBiography} className="tree-bio-form">
                  <textarea
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value)}
                    placeholder="Энэ хүний тухай намтрыг энд бичнэ үү…"
                    rows={6}
                    maxLength={50000}
                    disabled={busy}
                  />
                  <div className="tree-form-actions">
                    <button
                      type="button"
                      className="tree-button tree-button--secondary"
                      onClick={() => setBioEditing(false)}
                      disabled={busy}
                    >
                      Болих
                    </button>
                    <button
                      type="submit"
                      className="tree-button tree-button--primary"
                      disabled={busy}
                    >
                      {busy ? 'Хадгалж байна…' : 'Хадгалах'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="tree-bio-content">
                  {biography ? (
                    <p className="tree-bio-text">{biography}</p>
                  ) : (
                    <p className="tree-bio-empty">
                      Намтар оруулаагүй байна. <em>“✏️ Засах”</em> товчоор шууд бичих эсвэл <em>“🎙️ Хууч яриа”</em> табаар тэмдэглэлээ оруулан цэгцлэх боломжтой.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LIFE TIMELINE */}
        {!loading && activeTab === 'timeline' && (
          <div className="tree-timeline-section">
            <div className="tree-timeline-header">
              <h4>Амьдралын үйл явдлын хэлхээс</h4>
              {Boolean(person.can_edit ?? profile?.can_edit ?? profile?.can_edit_profile) ? (
                <button
                  type="button"
                  className="tree-button-tiny"
                  onClick={() => setShowAddEvent(!showAddEvent)}
                >
                  {showAddEvent ? '✕ Хаах' : '+ Үйл явдал нэмэх'}
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--ui-text-muted)' }}>Харах горим</span>
              )}
            </div>

            {/* Add Event Form */}
            {showAddEvent && (
              <form onSubmit={handleAddEvent} className="tree-add-event-form">
                <h5>Шинэ үйл явдал бүртгэх</h5>
                <label>
                  Төрөл:
                  <select
                    value={newEvent.event_type}
                    onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })}
                  >
                    {Object.entries(EVENT_TYPE_MAP).map(([key, info]) => (
                      <option key={key} value={key}>
                        {info.icon} {info.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Үйл явдлын гарчиг:
                  <input
                    type="text"
                    required
                    maxLength={180}
                    placeholder="Жишээ: Их сургууль дүүргэв"
                    value={newEvent.title}
                    onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  />
                </label>

                <div className="tree-form-row">
                  <label>
                    Огноо:
                    <input
                      type="date"
                      value={newEvent.event_date}
                      onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })}
                    />
                  </label>
                  <label>
                    Цаг хугацааны тэмдэглэл:
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="Жишээ: 1978 оны хавар"
                      value={newEvent.date_note}
                      onChange={(e) => setNewEvent({ ...newEvent, date_note: e.target.value })}
                    />
                  </label>
                </div>

                <label>
                  Байршил / Газар нутаг:
                  <input
                    type="text"
                    maxLength={240}
                    placeholder="Жишээ: Улаанбаатар хот"
                    value={newEvent.location}
                    onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                  />
                </label>

                <label>
                  Дэлгэрэнгүй тайлбар:
                  <textarea
                    rows={3}
                    maxLength={10000}
                    placeholder="Үйл явдалтай холбоотой тэмдэглэл…"
                    value={newEvent.description}
                    onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                  />
                </label>

                <div className="tree-form-actions">
                  <button
                    type="button"
                    className="tree-button tree-button--secondary"
                    onClick={() => setShowAddEvent(false)}
                    disabled={busy}
                  >
                    Болих
                  </button>
                  <button
                    type="submit"
                    className="tree-button tree-button--primary"
                    disabled={busy}
                  >
                    {busy ? 'Нэмж байна…' : 'Үйл явдал нэмэх'}
                  </button>
                </div>
              </form>
            )}

            {/* Vertical Events Timeline */}
            {events.length === 0 ? (
              <div className="tree-timeline-empty">
                <p>Бүртгэлтэй үйл явдал алга байна.</p>
                <button
                  type="button"
                  className="tree-button tree-button--secondary"
                  onClick={() => setShowAddEvent(true)}
                >
                  Анхны үйл явдлыг нэмэх
                </button>
              </div>
            ) : (
              <div className="tree-timeline-list">
                {events.map((ev) => {
                  const typeInfo = EVENT_TYPE_MAP[ev.event_type] || EVENT_TYPE_MAP.other;
                  return (
                    <div key={ev.id} className="tree-timeline-item">
                      <div className="tree-timeline-badge" aria-hidden="true">
                        {typeInfo.icon}
                      </div>
                      <div className="tree-timeline-content">
                        <div className="tree-timeline-top">
                          <strong>{ev.title}</strong>
                          {Boolean(person.can_delete ?? profile?.can_delete ?? profile?.can_edit_profile) && (
                            <button
                              type="button"
                              className="tree-timeline-del"
                              onClick={() => handleDeleteEvent(ev.id)}
                              title="Устгах"
                              disabled={busy}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <div className="tree-timeline-meta">
                          <span className="tree-timeline-date">
                            {ev.event_date ? ev.event_date : ev.date_note || 'Огноогүй'}
                          </span>
                          {ev.location && (
                            <span className="tree-timeline-loc">📍 {ev.location}</span>
                          )}
                        </div>
                        {ev.description && (
                          <p className="tree-timeline-desc">{ev.description}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ORAL NARRATIVE & CHRONOLOGY ASSISTANT */}
        {!loading && activeTab === 'oral_history' && (
          <div className="tree-oral-section">
            <div className="tree-oral-intro">
              <h4>🎙️ Ахмад дээдсийн хууч яриа, дурсамж тэмдэглэл</h4>
              <p>
                Ахмад настнуудын хуучилсан яриа, дурсамж, тэмдэглэлээ энд сийрүүлэн оруулбал он цаг, ажил үйлс, амьдралын гол замуудыг тод ялган амьдралын цагийн хэлхээс болгон цэгцэлж өгнө.
              </p>
            </div>

            {!Boolean(person.can_edit ?? profile?.can_edit ?? profile?.can_edit_profile) ? (
              <div className="ui-callout" style={{ padding: '18px', textAlign: 'center', fontSize: '13px' }}>
                Та энэ гишүүний мэдээлэлд дурсамж оруулах эрхгүй байна (Зөвхөн админ эсвэл үүсгэсэн хэрэглэгч боломжтой).
              </div>
            ) : (
              <form onSubmit={handleExtractOralHistory} className="tree-oral-form">
              <label>
                Аман яриа, дурсамжийн эх бичвэр:
                <textarea
                  rows={5}
                  required
                  placeholder="Жишээ: Би 1954 онд Завхан аймгийн Тосонцэнгэл суманд төрсөн. 1972 онд 10 жилийн сургууль төгсөөд, 1978 онд МУИС дүүргэж багшаар ажилласан. 1980 онд гэрлэж 3 хүүхэдтэй болсон. 1990 онд Алтан гадас одон хүртсэн…"
                  value={oralNarrative}
                  onChange={(e) => setOralNarrative(e.target.value)}
                  disabled={extracting}
                />
              </label>

              <div className="tree-oral-options">
                <label className="tree-checkbox-label">
                  <input
                    type="checkbox"
                    checked={oralAutoEvents}
                    onChange={(e) => setOralAutoEvents(e.target.checked)}
                    disabled={extracting}
                  />
                  <span>Үйл явдлуудыг цагийн хэлхээс рүү шууд автоматаар оруулах</span>
                </label>
                <label className="tree-checkbox-label">
                  <input
                    type="checkbox"
                    checked={oralAutoBio}
                    onChange={(e) => setOralAutoBio(e.target.checked)}
                    disabled={extracting}
                  />
                  <span>Эмхэтгэсэн намтрыг шууд хадгалах</span>
                </label>
              </div>

              <button
                type="submit"
                className="tree-button tree-button--primary tree-oral-submit"
                disabled={extracting || oralNarrative.trim().length < 10}
              >
                {extracting ? 'Эмхэтгэж байна…' : '✨ Түүхээс он цаг цэгцлэх'}
              </button>
            </form>
            )}

            {/* Extracted Preview */}
            {extractedResult && (
              <div className="tree-oral-result">
                <h5>Шинжилгээний үр дүн:</h5>
                <p className="tree-oral-stats">
                  Илэрсэн үйл явдал: <strong>{extractedResult.extracted_events.length}</strong> · Үүсгэсэн: <strong>{extractedResult.created_events_count}</strong>
                </p>

                <div className="tree-oral-events-preview">
                  <h6>Илрүүлсэн үйл явдлууд:</h6>
                  {extractedResult.extracted_events.map((ev, i) => (
                    <div key={i} className="tree-oral-event-chip">
                      <span>{EVENT_TYPE_MAP[ev.event_type]?.icon || '📜'}</span>
                      <strong>{ev.title}</strong>
                      <small>{ev.event_date || ev.date_note || 'Огноогүй'}</small>
                      {ev.location && <em>📍 {ev.location}</em>}
                    </div>
                  ))}
                </div>

                <div className="tree-oral-bio-preview">
                  <h6>Боловсруулсан намтрын эх:</h6>
                  <pre>{extractedResult.suggested_biography}</pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: STORIES */}
        {!loading && activeTab === 'stories' && (
          <div className="tree-stories-section">
            <div className="tree-stories-header">
              <h4>Холбоотой гэр бүлийн түүхүүд</h4>
              <Link
                className="tree-button-tiny"
                href={`/stories?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(personId)}`}
              >
                + Түүх бичих
              </Link>
            </div>

            {stories && stories.items.length > 0 ? (
              <div className="tree-stories-list">
                {stories.items.map((s) => (
                  <Link
                    key={s.id}
                    className="tree-story-card"
                    href={`/stories/${s.id}?family=${encodeURIComponent(familyId)}`}
                  >
                    <strong>{s.title}</strong>
                    <span>
                      {s.event_date ?? 'Огноогүй'}
                      {s.place ? ` · ${s.place}` : ''}
                    </span>
                    {s.excerpt && <p>{s.excerpt}</p>}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="tree-stories-empty">
                <p>Энэ хүнтэй холбоотой гэр бүлийн түүх бүртгэгдээгүй байна.</p>
                <Link
                  className="tree-button tree-button--secondary"
                  href={`/stories?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(personId)}`}
                >
                  Анхны түүхийг бичих
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        isOpen={pendingDeleteEventId !== null}
        title="Үйл явдал устгах"
        message="Та энэ амьдралын үйл явдлыг устгахдаа итгэлтэй байна уу?"
        confirmLabel="Устгах"
        variant="danger"
        busy={busy}
        onConfirm={() => void confirmDeleteEvent()}
        onCancel={() => setPendingDeleteEventId(null)}
      />
    </aside>
  );
}
