'use client';
import PersonTimeline from '../../components/person-timeline';

import Link from 'next/link';
import { ChangeEvent, FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Camera, Trash2 } from 'lucide-react';
import {
  ApiError,
  api,
  ArchiveListPage,
  Marriage,
  MemoryListItem,
  PersonProfile,
  StoryListPage,
  ProfileRelationPerson,
  personName,
} from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';
import ProfilePhoto from '../../components/profile-photo';
import { announcePhotoChange, IMAGE_ACCEPT, prepareImageUpload } from '../../lib/image-upload';

type EventItem = {
  id: string;
  event_type: string;
  title: string;
  event_date: string | null;
  description: string | null;
};

function relationName(person: ProfileRelationPerson) {
  return personName(person) || 'Нэргүй хүн';
}

function relationLife(person: ProfileRelationPerson) {
  const birth = person.birth_date?.slice(0, 4);
  const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return person.is_alive ? `${birth} – одоо` : `${birth} – тодорхойгүй`;
  return 'Огноо тодорхойгүй';
}

function initials(person: Pick<ProfileRelationPerson, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function ProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentFamily, familyId: contextFamilyId, contextLoading, contextLoaded, contextError } = useAppShellContext();
  const family = contextFamilyId;
  const profileRequestRef = useRef(0);
  const memoryRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const profileAbortRef = useRef<AbortController | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [id, setId] = useState('');
  const [person, setPerson] = useState<PersonProfile | null>(null);
  const [biography, setBiography] = useState('');
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [memoryState, setMemoryState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [memoryError, setMemoryError] = useState('');
  const [biographyState, setBiographyState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [eventState, setEventState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [marriageState, setMarriageState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [storyState, setStoryState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [archiveState, setArchiveState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [editingIsAlive, setEditingIsAlive] = useState(true);
  const [loading, setLoading] = useState(true);

  async function load(fid: string, pid: string, requestId?: number) {
    profileAbortRef.current?.abort();
    const controller = new AbortController();
    profileAbortRef.current = controller;
    const signal = controller.signal;

    setBiographyState('loading');
    setEventState('loading');
    setMarriageState('loading');
    setStoryState('loading');
    setArchiveState('loading');

    const profile = await api<PersonProfile>(`/families/${fid}/persons/${pid}`, { signal });
    if (requestId !== undefined && requestId !== profileRequestRef.current) return;

    setPerson(profile);
    setLoading(false);

    const [bio, eventList, marriageList, storyPage, archivePage] = await Promise.allSettled([
      api<{ content: string }>(`/families/${fid}/persons/${pid}/biography`, { signal }),
      api<EventItem[]>(`/families/${fid}/persons/${pid}/events`, { signal }),
      api<Marriage[]>(`/families/${fid}/persons/${pid}/marriages`, { signal }),
      api<StoryListPage>(`/families/${fid}/stories?page=1&page_size=5&person_id=${encodeURIComponent(pid)}`, { signal }),
      api<ArchiveListPage>(`/families/${fid}/persons/${pid}/archives?page=1&page_size=5`, { signal }),
    ]);

    if (requestId !== undefined && requestId !== profileRequestRef.current) return;

    if (bio.status === 'fulfilled') {
      setBiography(bio.value.content);
      setBiographyState('ready');
    } else if (bio.reason instanceof ApiError && [403, 404].includes(bio.reason.status)) {
      setBiography('');
      setBiographyState('restricted');
    } else {
      setBiographyState('error');
    }

    if (eventList.status === 'fulfilled') {
      setEvents(eventList.value);
      setEventState('ready');
    } else if (eventList.reason instanceof ApiError && [403, 404].includes(eventList.reason.status)) {
      setEvents([]);
      setEventState('restricted');
    } else {
      setEventState('error');
    }

    if (marriageList.status === 'fulfilled') {
      setMarriages(marriageList.value);
      setMarriageState('ready');
    } else if (marriageList.reason instanceof ApiError && [403, 404].includes(marriageList.reason.status)) {
      setMarriages([]);
      setMarriageState('restricted');
    } else {
      setMarriageState('error');
    }

    if (storyPage.status === 'fulfilled') {
      setStories(storyPage.value);
      setStoryState('ready');
    } else if (storyPage.reason instanceof ApiError && [403, 404].includes(storyPage.reason.status)) {
      setStories(null);
      setStoryState('restricted');
    } else {
      setStoryState('error');
    }

    if (archivePage.status === 'fulfilled') {
      setArchives(archivePage.value);
      setArchiveState('ready');
    } else if (archivePage.reason instanceof ApiError && [403, 404].includes(archivePage.reason.status)) {
      setArchives(null);
      setArchiveState('restricted');
    } else {
      setArchiveState('error');
    }
  }

  useEffect(() => {
    const pid = searchParams.get('person') ?? '';
    const requestId = ++profileRequestRef.current;
    memoryRequestRef.current += 1;
    mutationRequestRef.current += 1;
    setId(pid);
    setPerson(null);
    setBiography('');
    setMarriages([]);
    setEvents([]);
    setStories(null);
    setArchives(null);
    setMemories([]);
    setMemoryState('loading');
    setMemoryError('');
    setBiographyState('loading');
    setEventState('loading');
    setMarriageState('loading');
    setStoryState('loading');
    setArchiveState('loading');
    setEditing(false);
    setMutationBusy(false);
    setNotice('');

    if (contextLoading || !contextLoaded) {
      setLoading(true);
      return;
    }
    if (contextError) {
      setLoading(false);
      setError(contextError);
      return;
    }
    if (!currentFamily || !pid) {
      setLoading(false);
      setError(!pid ? 'Хүний хаяг буруу байна.' : 'Гэр бүлийн орчинд хандах боломжгүй байна.');
      return;
    }

    setLoading(true);
    setError('');
    load(currentFamily.id, pid, requestId)
      .catch((cause) => {
        if (requestId !== profileRequestRef.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(
          cause instanceof ApiError && [403, 404].includes(cause.status)
            ? 'Энэ хүний профайл олдсонгүй эсвэл харах эрхгүй байна.'
            : 'Профайлыг ачаалж чадсангүй. Дахин оролдоно уу.',
        );
      })
      .finally(() => {
        if (requestId === profileRequestRef.current) setLoading(false);
      });
  }, [contextError, contextLoaded, contextLoading, currentFamily, router, searchParams]);

  useEffect(() => () => profileAbortRef.current?.abort(), []);

  async function loadMemories(fid: string, pid: string) {
    const requestId = ++memoryRequestRef.current;
    setMemoryState('loading');
    setMemoryError('');
    try {
      const result = await api<MemoryListItem[]>(
        `/families/${fid}/persons/${pid}/memories`,
      );
      if (requestId !== memoryRequestRef.current) return;
      setMemories(result);
      setMemoryState('ready');
    } catch (cause) {
      if (requestId !== memoryRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) {
        setMemories([]);
        setMemoryState('restricted');
        setMemoryError('Энэ хүний дурсамжийн мэдээлэл одоогоор харагдахгүй байна.');
        return;
      }
      setMemoryState('error');
      setMemoryError('Дурсамжийг ачаалж чадсангүй. Дахин оролдоно уу.');
    }
  }

  async function retry() {
    if (!family || !id) return;
    const requestId = ++profileRequestRef.current;
    mutationRequestRef.current += 1;
    setLoading(true);
    setError('');
    setPerson(null);
    try {
      await load(family, id, requestId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(
        cause instanceof ApiError && [403, 404].includes(cause.status)
          ? 'Энэ хүний профайл олдсонгүй эсвэл харах эрхгүй байна.'
          : 'Профайлыг ачаалж чадсангүй. Дахин оролдоно уу.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!family || !id) return;
    void loadMemories(family, id);
  }, [family, id]);

  async function saveBiography(event: FormEvent) {
    event.preventDefault();
    if (!family || !id || mutationBusy) return;
    const requestId = profileRequestRef.current;
    const mutationId = ++mutationRequestRef.current;
    setMutationBusy(true);
    setError('');
    try {
      await api(`/families/${family}/persons/${id}/biography`, {
        method: 'PUT',
        body: JSON.stringify({ content: biography }),
      });
      if (requestId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      const refreshId = ++profileRequestRef.current;
      await load(family, id, refreshId);
      if (refreshId === profileRequestRef.current && mutationId === mutationRequestRef.current) setNotice('Намтар хадгалагдлаа.');
    } catch (cause) {
      if (requestId === profileRequestRef.current && mutationId === mutationRequestRef.current) setError(cause instanceof ApiError && [401,403,404,409,422].includes(cause.status) ? cause.message : 'Намтрыг хадгалж чадсангүй. Дахин оролдоно уу.');
    } finally {
      if (mutationId === mutationRequestRef.current) setMutationBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!family || !id || mutationBusy) return;
    const requestId = profileRequestRef.current;
    const mutationId = ++mutationRequestRef.current;
    setMutationBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await api(`/families/${family}/persons/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          first_name: values.get('first_name'),
          last_name: values.get('last_name'),
          gender: values.get('gender'),
          birth_date: values.get('birth_date') || null,
          birth_place: values.get('birth_place') || null,
          is_alive: editingIsAlive,
          death_date: editingIsAlive ? null : values.get('death_date') || null,
          death_place: editingIsAlive ? null : values.get('death_place') || null,
          visibility: values.get('visibility'),
        }),
      });
      if (requestId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      const refreshId = ++profileRequestRef.current;
      await load(family, id, refreshId);
      if (refreshId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      setEditing(false);
      setNotice('Профайл хадгалагдлаа.');
    } catch (cause) {
      if (requestId === profileRequestRef.current && mutationId === mutationRequestRef.current) setError(cause instanceof ApiError && [401,403,404,409,422].includes(cause.status) ? cause.message : 'Профайлыг хадгалж чадсангүй. Дахин оролдоно уу.');
    } finally {
      if (mutationId === mutationRequestRef.current) setMutationBusy(false);
    }
  }

  async function uploadProfilePhoto(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !family || !id || mutationBusy) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Зураг 10 MB-аас бага байх ёстой.');
      return;
    }
    const requestId = profileRequestRef.current;
    const mutationId = ++mutationRequestRef.current;
    setMutationBusy(true);
    setError('');
    try {
      const prepared = await prepareImageUpload(file);
      const result = await api<{ profile_photo_url: string }>(
        `/families/${family}/persons/${id}/profile-photo`,
        {
          method: 'POST',
          body: prepared,
          headers: { 'Content-Type': prepared.type, 'X-File-Name': encodeURIComponent(prepared.name) },
        },
      );
      if (requestId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      setPerson((current) => current ? { ...current, profile_photo_url: result.profile_photo_url } : current);
      announcePhotoChange({ endpoint: `/families/${family}/persons/${id}/profile-photo`, hasPhoto: true, url: result.profile_photo_url });
      setNotice('Профайл зургийг шинэчиллээ.');
    } catch (cause) {
      if (requestId === profileRequestRef.current && mutationId === mutationRequestRef.current) {
        setError(cause instanceof Error && !(cause instanceof ApiError) ? cause.message : cause instanceof ApiError && [401, 403, 404, 413, 415, 422, 429].includes(cause.status)
          ? cause.message
          : 'Зургийг хадгалж чадсангүй. Дахин оролдоно уу.');
      }
    } finally {
      if (mutationId === mutationRequestRef.current) setMutationBusy(false);
    }
  }

  async function removeProfilePhoto() {
    if (!family || !id || !person?.profile_photo_url || mutationBusy) return;
    const requestId = profileRequestRef.current;
    const mutationId = ++mutationRequestRef.current;
    setMutationBusy(true);
    setError('');
    try {
      await api<void>(`/families/${family}/persons/${id}/profile-photo`, { method: 'DELETE' });
      if (requestId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      setPerson((current) => current ? { ...current, profile_photo_url: null } : current);
      announcePhotoChange({ endpoint: `/families/${family}/persons/${id}/profile-photo`, hasPhoto: false, url: null });
      setNotice('Профайл зургийг устгалаа.');
    } catch (cause) {
      if (requestId === profileRequestRef.current && mutationId === mutationRequestRef.current) {
        setError(cause instanceof ApiError && [401, 403, 404].includes(cause.status)
          ? cause.message
          : 'Зургийг устгаж чадсангүй. Дахин оролдоно уу.');
      }
    } finally {
      if (mutationId === mutationRequestRef.current) setMutationBusy(false);
    }
  }

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!family || !id || mutationBusy) return;
    const requestId = profileRequestRef.current;
    const mutationId = ++mutationRequestRef.current;
    setMutationBusy(true);
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api(`/families/${family}/persons/${id}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: form.get('event_type'),
          title: form.get('title'),
          event_date: form.get('event_date') || null,
          description: form.get('description') || null,
        }),
      });
      if (requestId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      const refreshId = ++profileRequestRef.current;
      await load(family, id, refreshId);
      if (refreshId !== profileRequestRef.current || mutationId !== mutationRequestRef.current) return;
      formElement.reset();
      setNotice('Үйл явдал нэмэгдлээ.');
    } catch (cause) {
      if (requestId === profileRequestRef.current && mutationId === mutationRequestRef.current) setError(cause instanceof ApiError && [401,403,404,409,422].includes(cause.status) ? cause.message : 'Үйл явдал нэмж чадсангүй. Дахин оролдоно уу.');
    } finally {
      if (mutationId === mutationRequestRef.current) setMutationBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="profile-page">
        <section className="profile-shell profile-state" aria-live="polite">
          <span className="people-spinner" aria-hidden="true" />
          <h1 className="sr-only">Хүний профайл</h1>
          <p role="status">Профайлыг ачаалж байна…</p>
        </section>
      </main>
    );
  }

  if (!person) {
    return (
      <main className="profile-page">
        <section className="profile-shell profile-state">
          <div className="personavatar large" aria-hidden="true">?</div>
          <h1>Хүн олдсонгүй</h1>
          <p>{error || 'Энэ хүний мэдээллийг одоогоор харах боломжгүй байна.'}</p>
          <div className="profile-actions">
            <Link className="button" href={family ? `/people?family=${encodeURIComponent(family)}` : '/people'}>
              Хүмүүс рүү буцах
            </Link>
            <button type="button" onClick={() => void retry()}>Дахин оролдох</button>
          </div>
        </section>
      </main>
    );
  }

  const birthDeath = [
    person.birth_date ? person.birth_date : null,
    !person.is_alive ? person.death_date ?? 'нас барсан огноо тодорхойгүй' : null,
  ].filter(Boolean).join(' – ');

  return (
    <main className="profile-page">
      <section className="profile-shell">
        <nav className="profile-nav" aria-label="Профайлын зам">
          <Link href={`/people?family=${encodeURIComponent(family)}`}>← Хүмүүс</Link>
          <span aria-hidden="true">/</span>
          <span>{personName(person) || 'Профайл'}</span>
        </nav>

        {error && <div className="error profile-alert" role="alert">{error}</div>}
        {notice && <div className="success profile-alert" role="status">{notice}</div>}

        <header className="profile-hero">
          <div className="profile-portrait">
            <ProfilePhoto
              className="personavatar large profile-photo profile-photo-object"
              url={person.profile_photo_url}
              name={personName(person) || 'Нэргүй хүн'}
              fallback={initials(person)}
            />
            {person.can_edit_profile && (
              <div className="profile-photo-tools">
                <label className="profile-photo-upload" htmlFor="person-profile-photo">
                  <Camera size={15} aria-hidden="true" />
                  <span>{mutationBusy ? 'Хадгалж байна…' : 'Зураг оруулах'}</span>
                  <input
                    ref={photoInputRef}
                    id="person-profile-photo"
                    type="file"
                    accept={IMAGE_ACCEPT}
                    onChange={(event) => void uploadProfilePhoto(event)}
                    disabled={mutationBusy}
                    aria-label="JPEG, PNG эсвэл WebP зураг сонгох"
                  />
                </label>
                {person.profile_photo_url && (
                  <button
                    className="profile-photo-remove"
                    type="button"
                    onClick={() => void removeProfilePhoto()}
                    disabled={mutationBusy}
                    aria-label="Профайл зургийг устгах"
                    title="Зураг устгах"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="profile-identity">
            <p className="eyebrow">ГУУЛИНГИЙНХАН · ХҮНИЙ ТОВЧОО</p>
            <h1>{personName(person) || 'Нэргүй хүн'}</h1>
            <p className="profile-life">
              {birthDeath || 'Амьдралын огноо бүртгэгдээгүй'}
            </p>
            {person.nickname && <p className="profile-nickname">“{person.nickname}”</p>}
            <div className="profile-actions">
              <Link className="button primary" href={`/tree?view=family&family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}>
                Удмын модонд харах
              </Link>
              {person.can_edit_profile && (
                <button type="button" onClick={() => { setEditingIsAlive(person.is_alive); setEditing((value) => !value); }}>
                  {editing ? 'Засахыг хаах' : 'Мэдээлэл засах'}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="profile-grid">
          <div className="card profile-card profile-timeline-card"><PersonTimeline key={`${family}-${person.id}`} familyId={family} personId={person.id} /></div>
          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">ҮНДСЭН МЭДЭЭЛЭЛ</p><h2>Үндсэн мэдээлэл</h2></div>
            </div>
            <dl className="profile-facts">
              <div><dt>Нэр</dt><dd>{personName(person) || 'Нэргүй'}</dd></div>
              <div><dt>Хүйс</dt><dd>{person.gender === 'female' ? 'Эмэгтэй' : person.gender === 'male' ? 'Эрэгтэй' : person.gender === 'other' ? 'Бусад' : 'Тодорхойгүй'}</dd></div>
              <div><dt>Төрсөн</dt><dd>{person.birth_date ?? 'Мэдээлэл оруулаагүй байна'}</dd></div>
              <div><dt>Төрсөн газар</dt><dd>{person.birth_place ?? 'Мэдээлэл оруулаагүй байна'}</dd></div>
              {!person.is_alive && <div><dt>Нас барсан</dt><dd>{person.death_date ?? 'Огноо тодорхойгүй'}</dd></div>}
              {!person.is_alive && <div><dt>Нас барсан газар</dt><dd>{person.death_place ?? 'Мэдээлэл оруулаагүй байна'}</dd></div>}
              <div><dt>Нууцлал</dt><dd>{person.visibility === 'private' ? 'Хувийн' : person.visibility === 'public' ? 'Нийтийн' : 'Гэр бүлийн'}</dd></div>
            </dl>
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">УДАМ УГСАА</p><h2>Удам угсаа</h2></div>
            </div>
            <dl className="profile-facts">
              <div><dt>Удам</dt><dd>{person.lineage_name ?? 'Томилогдоогүй'}</dd></div>
              <div><dt>Салаа</dt><dd>{person.branch_name ?? 'Томилогдоогүй'}</dd></div>
            </dl>
            <p className="profile-note">Удам, салааны хуваарилалтыг админ бүртгэж баталгаажуулна.</p>
          </section>

          <section className="card profile-card profile-relationships">
            <div className="profile-card-heading">
              <div><p className="eyebrow">ГЭР БҮЛИЙН ХОЛБОО</p><h2>Гэр бүлийн холбоо</h2></div>
            </div>
            <div className="relationship-columns">
              <div>
                <h3>Эцэг, эх</h3>
                {person.parents.length ? person.parents.map((item) => (
                  <Link className="relationship-item" key={item.id} href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(item.id)}`}>
                    <ProfilePhoto className="personavatar small" url={item.profile_photo_url} name={relationName(item)} fallback={initials(item)} />
                    <span><strong>{relationName(item)}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна</p>}
              </div>
              <div>
                <h3>Хань</h3>
                {person.spouses.length ? person.spouses.map((item) => (
                  <Link className="relationship-item" key={item.id} href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(item.id)}`}>
                    <ProfilePhoto className="personavatar small" url={item.profile_photo_url} name={relationName(item)} fallback={initials(item)} />
                    <span><strong>{relationName(item)}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна</p>}
              </div>
              <div className="relationship-children">
                <h3>Хүүхдүүд</h3>
                {person.children.length ? person.children.map((item) => (
                  <Link className="relationship-item" key={item.id} href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(item.id)}`}>
                    <ProfilePhoto className="personavatar small" url={item.profile_photo_url} name={relationName(item)} fallback={initials(item)} />
                    <span><strong>{relationName(item)}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна</p>}
              </div>
            </div>
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">ГЭР БҮЛИЙН АРХИВ</p><h2>Энэ хүнтэй холбоотой архив</h2></div>
              <Link href={`/archives?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>
            {archiveState === 'loading' && <p className="profile-empty" role="status" aria-live="polite">Архивыг ачаалж байна…</p>}
            {archiveState === 'restricted' && <p className="profile-private" role="status">Энэ хүнтэй холбоотой архив одоогоор харагдахгүй байна.</p>}
            {archiveState === 'error' && <div className="profile-inline-error" role="alert"><p>Архивыг ачаалж чадсангүй.</p><button type="button" onClick={() => void retry()}>Дахин оролдох</button></div>}
            {archiveState === 'ready' && (
              archives?.items.length
                ? <div className="history-list">{archives.items.map((archive) => (
                    <Link className="history-item" key={archive.id} href={`/archives/${archive.id}?family=${encodeURIComponent(family)}`}>
                      <strong>{archive.title}</strong>
                      <span>{archive.document_date ?? 'Огноогүй'}{archive.place ? ` · ${archive.place}` : ''}</span>
                    </Link>
                  ))}</div>
                : <p className="profile-empty">Энэ хүнтэй холбоотой архив бүртгэгдээгүй байна.</p>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">ГЭР БҮЛИЙН ТҮҮХ</p><h2>Энэ хүнтэй холбоотой түүхүүд</h2></div>
              <Link href={`/stories?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>
            {storyState === 'loading' && <p className="profile-empty" role="status" aria-live="polite">Түүхүүдийг ачаалж байна…</p>}
            {storyState === 'restricted' && <p className="profile-private" role="status">Энэ хүнтэй холбоотой түүхүүд одоогоор харагдахгүй байна.</p>}
            {storyState === 'error' && <div className="profile-inline-error" role="alert"><p>Түүхүүдийг ачаалж чадсангүй.</p><button type="button" onClick={() => void retry()}>Дахин оролдох</button></div>}
            {storyState === 'ready' && (
              stories?.items.length
                ? <div className="history-list">{stories.items.slice(0, 5).map((story) => (
                    <Link className="history-item" key={story.id} href={`/stories/${story.id}?family=${encodeURIComponent(family)}`}>
                      <strong>{story.title}</strong>
                      <span>{story.event_date ?? 'Огноогүй'}{story.place ? ` · ${story.place}` : ''}</span>
                    </Link>
                  ))}</div>
                : <p className="profile-empty">Энэ хүнтэй холбоотой түүх бүртгэгдээгүй байна.</p>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">ГЭР БҮЛИЙН ДУРСАМЖ</p><h2>Энэ хүнтэй холбоотой дурсамж</h2></div>
              <Link href={`/memories?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>

            {memoryState === 'loading' && (
              <p className="profile-empty" role="status" aria-live="polite">
                Дурсамжийг ачаалж байна…
              </p>
            )}

            {memoryState === 'restricted' && (
              <p className="profile-private" role="status">{memoryError}</p>
            )}

            {memoryState === 'error' && (
              <div>
                <p className="profile-empty" role="alert">{memoryError}</p>
                <button type="button" onClick={() => void loadMemories(family, id)}>
                  Дахин оролдох
                </button>
              </div>
            )}

            {memoryState === 'ready' && memories.length === 0 && (
              <p className="profile-empty">
                Энэ хүнтэй холбоотой дурсамж бүртгэгдээгүй байна.
              </p>
            )}

            {memoryState === 'ready' && memories.length > 0 && (
              <div className="history-list">
                {memories.map((memory) => (
                  <div className="history-item" key={memory.id}>
                    <strong>{memory.title}</strong>
                    <span>
                      {memory.memory_date ?? 'Огноогүй'}
                      {memory.description ? ` · ${memory.description}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading"><div><p className="eyebrow">АМЬДРАЛЫН ТОВЧОО</p><h2>Намтар</h2></div></div>
            {biographyState === 'loading' && <p className="profile-empty" role="status" aria-live="polite">Намтрыг ачаалж байна…</p>}
            {biographyState === 'restricted' && <p className="profile-private" role="status">Энэ хүний намтар одоогоор харагдахгүй байна.</p>}
            {biographyState === 'error' && <div className="profile-inline-error" role="alert"><p>Намтрыг ачаалж чадсангүй.</p><button type="button" onClick={() => void retry()}>Дахин оролдох</button></div>}
            {biographyState === 'ready' && (
              <>
                <p className="profile-text">{biography || 'Намтар оруулаагүй байна.'}</p>
                <form onSubmit={saveBiography}>
                  <label>Намтар<textarea value={biography} onChange={(event) => setBiography(event.target.value)} maxLength={50000} /></label>
                  <button className="primary" type="submit" disabled={mutationBusy}>{mutationBusy ? "Хадгалж байна…" : "Намтар хадгалах"}</button>
                </form>
              </>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading"><div><p className="eyebrow">ГЭРЛЭЛТ</p><h2>Гэрлэлтийн түүх</h2></div></div>
            {marriageState === 'loading' && <p className="profile-empty" role="status" aria-live="polite">Гэрлэлтийн түүхийг ачаалж байна…</p>}
            {marriageState === 'restricted' && <p className="profile-private" role="status">Энэ хүний гэрлэлтийн мэдээлэл одоогоор харагдахгүй байна.</p>}
            {marriageState === 'error' && <div className="profile-inline-error" role="alert"><p>Гэрлэлтийн мэдээллийг ачаалж чадсангүй.</p><button type="button" onClick={() => void retry()}>Дахин оролдох</button></div>}
            {marriageState === 'ready' && (marriages.length === 0
              ? <p className="profile-empty">Гэрлэлтийн мэдээлэл бүртгээгүй байна.</p>
              : marriages.map((marriage) => (
                  <div className="history-item" key={marriage.id}>
                    <strong>{marriage.other_person ? personName(marriage.other_person) : 'Хань'}</strong>
                    <span>{marriage.status === 'married' ? 'Одоо хамт' : marriage.status === 'divorced' ? 'Салсан' : 'Бэлэвсэн'}</span>
                    <small>{marriage.start_date ?? 'Эхэлсэн огноо тодорхойгүй'} – {marriage.end_date ?? (marriage.status === 'married' ? 'Одоо' : 'Дууссан огноо тодорхойгүй')}</small>
                  </div>
                ))
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading"><div><p className="eyebrow">АМЬДРАЛЫН ҮЙЛ ЯВДАЛ</p><h2>Амьдралын үйл явдал</h2></div></div>
            {eventState === 'loading' && <p className="profile-empty" role="status" aria-live="polite">Амьдралын үйл явдлыг ачаалж байна…</p>}
            {eventState === 'restricted' && <p className="profile-private" role="status">Энэ хүний амьдралын үйл явдал одоогоор харагдахгүй байна.</p>}
            {eventState === 'error' && <div className="profile-inline-error" role="alert"><p>Амьдралын үйл явдлыг ачаалж чадсангүй.</p><button type="button" onClick={() => void retry()}>Дахин оролдох</button></div>}
            {eventState === 'ready' && (
              <>
                {events.length === 0 ? <p className="profile-empty">Үйл явдал бүртгээгүй байна.</p> : events.map((item) => (
                  <div className="history-item" key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.event_date ?? 'Он тодорхойгүй'}</span>
                    {item.description && <small>{item.description}</small>}
                  </div>
                ))}
                <form onSubmit={addEvent}>
                  <label>Төрөл<select name="event_type" defaultValue="other"><option value="school">Сургууль</option><option value="work">Ажил</option><option value="move">Нүүх</option><option value="marriage">Гэрлэлт</option><option value="divorce">Салалт</option><option value="child_birth">Хүүхэд төрсөн</option><option value="other">Бусад</option></select></label>
                  <label>Гарчиг<input name="title" required maxLength={180} /></label>
                  <label>Огноо<input name="event_date" type="date" /></label>
                  <label>Тайлбар<textarea name="description" maxLength={10000} /></label>
                  <button className="primary" type="submit" disabled={mutationBusy}>{mutationBusy ? "Хадгалж байна…" : "Үйл явдал нэмэх"}</button>
                </form>
              </>
            )}
          </section>
        </div>

        {editing && (
          <section className="card profile-card profile-editor">
            <div className="profile-card-heading"><div><p className="eyebrow">ЗАСВАРЛАХ</p><h2>Хувийн мэдээлэл</h2></div></div>
            <form onSubmit={saveProfile}>
              <div className="profile-form-grid">
                <label>Нэр<input name="first_name" defaultValue={person.first_name} required maxLength={120} /></label>
                <label>Овог<input name="last_name" defaultValue={person.last_name} maxLength={120} /></label>
                <label>Хүйс<select name="gender" defaultValue={person.gender}><option value="unknown">Тодорхойгүй</option><option value="female">Эмэгтэй</option><option value="male">Эрэгтэй</option><option value="other">Бусад</option></select></label>
                <label>Төрсөн огноо<input name="birth_date" type="date" defaultValue={person.birth_date ?? ''} /></label>
                <label>Төрсөн газар<input name="birth_place" defaultValue={person.birth_place ?? ''} maxLength={240} /></label>
                <label>Амьд эсэх<select name="is_alive" value={String(editingIsAlive)} onChange={(event) => setEditingIsAlive(event.target.value === 'true')}><option value="true">Амьд</option><option value="false">Нас барсан</option></select></label>
                {!editingIsAlive && <><label>Нас барсан огноо<input name="death_date" type="date" defaultValue={person.death_date ?? ''} /></label>
                <label>Нас барсан газар<input name="death_place" defaultValue={person.death_place ?? ''} maxLength={240} /></label></>}
                <label>Нууцлал<select name="visibility" defaultValue={person.visibility}><option value="private">Зөвхөн би</option><option value="family">Гэр бүлийнхэн</option><option value="public">Нийтийн</option></select></label>
              </div>
              <button className="primary" type="submit" disabled={mutationBusy}>{mutationBusy ? "Хадгалж байна…" : "Профайл хадгалах"}</button>
            </form>
          </section>
        )}

        <footer className="profile-footer">
          <Link href={`/people?family=${encodeURIComponent(family)}`}>← Хүмүүс</Link>
          <Link href={`/tree?view=family&family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}>Удмын модонд харах →</Link>
        </footer>
      </section>
    </main>
  );
}


export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <main className="profile-page">
          <section className="profile-shell profile-state" aria-live="polite">
            <span className="people-spinner" aria-hidden="true" />
            <p>Профайлыг ачаалж байна…</p>
          </section>
        </main>
      }
    >
      <ProfilePageContent />
    </Suspense>
  );
}
