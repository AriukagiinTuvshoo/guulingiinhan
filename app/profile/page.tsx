'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  api,
  ArchiveListPage,
  Family,
  Marriage,
  MemoryListItem,
  PersonProfile,
  StoryListPage,
  personName,
} from '../../lib/api';

type EventItem = {
  id: string;
  event_type: string;
  title: string;
  event_date: string | null;
  description: string | null;
};

type LoadResult<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

function initials(person: { first_name: string; last_name: string }) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function relationLife(person: { birth_date: string | null; is_alive: boolean; death_date: string | null }) {
  const birth = person.birth_date?.slice(0, 4);
  const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return person.is_alive ? `${birth} – одоо` : `${birth} – тодорхойгүй`;
  return 'Огноо тодорхойгүй';
}

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return 'Энэ мэдээлэлд хандах эрхгүй.';
    if (cause.status === 404) return 'Мэдээлэл олдсонгүй.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгана уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.';
  }
  return fallback;
}

function isRestricted(result: LoadResult<unknown>) {
  return result.status === 'rejected' && result.reason instanceof ApiError && [403, 404].includes(result.reason.status);
}

function ProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestRef = useRef(0);
  const mutationRef = useRef(0);

  const family = searchParams.get('family') ?? '';
  const id = searchParams.get('person') ?? '';

  const [familyInfo, setFamilyInfo] = useState<Family | null>(null);
  const [person, setPerson] = useState<PersonProfile | null>(null);
  const [biography, setBiography] = useState('');
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [memories, setMemories] = useState<MemoryListItem[]>([]);

  const [bioState, setBioState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [eventState, setEventState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [marriageState, setMarriageState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [storyState, setStoryState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [archiveState, setArchiveState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');
  const [memoryState, setMemoryState] = useState<'loading' | 'ready' | 'restricted' | 'error'>('loading');

  const [bioError, setBioError] = useState('');
  const [eventError, setEventError] = useState('');
  const [memoryError, setMemoryError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (fid: string, pid: string, requestId: number) => {
    setLoading(true);
    setError('');
    setNotice('');
    setEditing(false);
    setPerson(null);
    setFamilyInfo(null);
    setBiography('');
    setEvents([]);
    setMarriages([]);
    setStories(null);
    setArchives(null);
    setMemories([]);
    setBioState('loading');
    setEventState('loading');
    setMarriageState('loading');
    setStoryState('loading');
    setArchiveState('loading');
    setMemoryState('loading');
    setBioError('');
    setEventError('');
    setMemoryError('');

    const profileResult = await api<PersonProfile>(`/families/${fid}/persons/${pid}`).then(
      (value) => ({ status: 'fulfilled', value } as const),
      (reason) => ({ status: 'rejected', reason } as const),
    );

    if (requestId !== requestRef.current) return;

    if (profileResult.status === 'rejected') {
      throw profileResult.reason;
    }

    const [familyResult, bio, eventList, marriageList, storyPage, archivePage, memoryList] =
      await Promise.all([
        api<Family>(`/families/${fid}`).then(
          (value) => ({ status: 'fulfilled', value } as const),
          (reason) => ({ status: 'rejected', reason } as const),
        ),
        api<{ content: string }>(`/families/${fid}/persons/${pid}/biography`).then(
          (value) => ({ status: 'fulfilled', value } as const),
          (reason) => ({ status: 'rejected', reason } as const),
        ),
        api<EventItem[]>(`/families/${fid}/persons/${pid}/events`).then(
          (value) => ({ status: 'fulfilled', value } as const),
          (reason) => ({ status: 'rejected', reason } as const),
        ),
        api<Marriage[]>(`/families/${fid}/persons/${pid}/marriages`).then(
          (value) => ({ status: 'fulfilled', value } as const),
          (reason) => ({ status: 'rejected', reason } as const),
        ),
        api<StoryListPage>(
          `/families/${fid}/stories?page=1&page_size=5&person_id=${encodeURIComponent(pid)}`,
        ).then(
          (value) => ({ status: 'fulfilled', value } as const),
          (reason) => ({ status: 'rejected', reason } as const),
        ),
        api<ArchiveListPage>(`/families/${fid}/persons/${pid}/archives?page=1&page_size=5`).then(
          (value) => ({ status: 'fulfilled', value } as const),
          (reason) => ({ status: 'rejected', reason } as const),
        ),
        api<MemoryListItem[]>(`/families/${fid}/persons/${pid}/memories`).then(
          (value) => ({ status: 'fulfilled', value } as const),
          (reason) => ({ status: 'rejected', reason } as const),
        ),
      ]);

    if (requestId !== requestRef.current) return;

    setPerson(profileResult.value);
    if (familyResult.status === 'fulfilled') setFamilyInfo(familyResult.value);

    if (bio.status === 'fulfilled') {
      setBiography(bio.value.content);
      setBioState('ready');
    } else if (isRestricted(bio)) {
      setBioState('restricted');
    } else {
      setBioState('error');
      setBioError(friendlyError(bio.reason, 'Намтрыг ачаалж чадсангүй.'));
    }

    if (eventList.status === 'fulfilled') {
      setEvents(eventList.value);
      setEventState('ready');
    } else if (isRestricted(eventList)) {
      setEventState('restricted');
    } else {
      setEventState('error');
      setEventError(friendlyError(eventList.reason, 'Амьдралын үйл явдлыг ачаалж чадсангүй.'));
    }

    if (marriageList.status === 'fulfilled') {
      setMarriages(marriageList.value);
      setMarriageState('ready');
    } else {
      setMarriageState(isRestricted(marriageList) ? 'restricted' : 'error');
    }

    setStoryState(storyPage.status === 'fulfilled' ? 'ready' : isRestricted(storyPage) ? 'restricted' : 'error');
    if (storyPage.status === 'fulfilled') setStories(storyPage.value);

    setArchiveState(archivePage.status === 'fulfilled' ? 'ready' : isRestricted(archivePage) ? 'restricted' : 'error');
    if (archivePage.status === 'fulfilled') setArchives(archivePage.value);

    if (memoryList.status === 'fulfilled') {
      setMemories(memoryList.value);
      setMemoryState('ready');
    } else if (isRestricted(memoryList)) {
      setMemoryState('restricted');
      setMemoryError('Энэ хүний дурсамжийн мэдээлэл одоогоор харагдахгүй байна.');
    } else {
      setMemoryState('error');
      setMemoryError(friendlyError(memoryList.reason, 'Дурсамжийг ачаалж чадсангүй.'));
    }
  }, []);

  useEffect(() => {
    const requestId = ++requestRef.current;

    if (!family || !id) {
      setLoading(false);
      setPerson(null);
      setError('Гэр бүл болон хүний холбоос дутуу байна.');
      return;
    }

    void load(family, id, requestId)
      .catch((cause) => {
        if (requestId !== requestRef.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setPerson(null);
        setError(
          cause instanceof ApiError && [403, 404].includes(cause.status)
            ? 'Энэ хүн гэр бүлийн энэ орчинд олдсонгүй эсвэл харах эрхгүй байна.'
            : friendlyError(cause, 'Профайлыг ачаалж чадсангүй.'),
        );
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });

    return () => {
      requestRef.current += 1;
    };
  }, [family, id, load, router]);

  async function mutate(action: () => Promise<void>, successMessage: string) {
    const mutationId = ++mutationRef.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (mutationId !== mutationRef.current || !family || !id) return;
      setNotice(successMessage);
    } catch (cause) {
      if (mutationId !== mutationRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(friendlyError(cause, 'Өөрчлөлтийг хадгалж чадсангүй.'));
    } finally {
      if (mutationId === mutationRef.current) setBusy(false);
    }
  }

  async function saveBiography(event: FormEvent) {
    event.preventDefault();
    await mutate(
      async () => {
        await api(`/families/${family}/persons/${id}/biography`, {
          method: 'PUT',
          body: JSON.stringify({ content: biography }),
        });
      },
      'Намтар хадгалагдлаа.',
    );
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await mutate(
      async () => {
        await api(`/families/${family}/persons/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            first_name: values.get('first_name'),
            last_name: values.get('last_name'),
            gender: values.get('gender'),
            birth_date: values.get('birth_date') || null,
            birth_place: values.get('birth_place') || null,
            is_alive: values.get('is_alive') === 'true',
            death_date: values.get('death_date') || null,
            death_place: values.get('death_place') || null,
            visibility: values.get('visibility'),
          }),
        });
        const nextRequestId = ++requestRef.current;
        await load(family, id, nextRequestId);
      },
      'Профайл хадгалагдлаа.',
    );
    setEditing(false);
  }

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await mutate(
      async () => {
        await api(`/families/${family}/persons/${id}/events`, {
          method: 'POST',
          body: JSON.stringify({
            event_type: form.get('event_type'),
            title: form.get('title'),
            event_date: form.get('event_date') || null,
            description: form.get('description') || null,
          }),
        });
        const nextRequestId = ++requestRef.current;
        await load(family, id, nextRequestId);
      },
      'Үйл явдал нэмэгдлээ.',
    );
    formElement.reset();
  }

  function relationHref(personId: string) {
    return `/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(personId)}`;
  }

  function retryProfile() {
    const requestId = ++requestRef.current;
    void load(family, id, requestId).catch((cause) => {
      if (requestId !== requestRef.current) return;
      setError(friendlyError(cause, 'Профайлыг ачаалж чадсангүй.'));
    }).finally(() => {
      if (requestId === requestRef.current) setLoading(false);
    });
  }

  if (loading) {
    return (
      <main className="profile-page">
        <section className="profile-shell profile-state" aria-live="polite">
          <span className="people-spinner" aria-hidden="true" />
          <p>Профайлыг ачаалж байна…</p>
        </section>
      </main>
    );
  }

  if (!family || !id || !person) {
    return (
      <main className="profile-page">
        <section className="profile-shell profile-state" role="alert">
          <div className="personavatar large" aria-hidden="true">?</div>
          <h1>Профайл олдсонгүй</h1>
          <p>{error || 'Энэ хүний мэдээллийг одоогоор харах боломжгүй байна.'}</p>
          <div className="profile-actions">
            <Link className="button" href={family ? `/people?family=${encodeURIComponent(family)}` : '/people'}>
              Хүмүүс рүү буцах
            </Link>
            {family && id && <button type="button" onClick={retryProfile}>Дахин оролдох</button>}
          </div>
        </section>
      </main>
    );
  }

  const birthDeath = [
    person.birth_date ?? null,
    !person.is_alive ? person.death_date ?? 'нас барсан огноо тодорхойгүй' : null,
  ].filter(Boolean).join(' – ');

  const profilePhoto = person.profile_photo_url ? (
    <img
      className="personavatar profile-photo"
      src={person.profile_photo_url}
      alt={`${personName(person) || 'Хүний'}-ийн хөрөг`}
    />
  ) : (
    <span className="personavatar large" aria-hidden="true">{initials(person)}</span>
  );

  return (
    <main className="profile-page">
      <section className="profile-shell">
        <nav className="profile-nav" aria-label="Профайлын зам">
          <Link href={`/people?family=${encodeURIComponent(family)}`}>← Хүмүүс</Link>
          <span aria-hidden="true">/</span>
          <span>{familyInfo?.name ?? 'Гэр бүл'}</span>
          <span aria-hidden="true">/</span>
          <span>{personName(person) || 'Профайл'}</span>
        </nav>

        {error && <div className="error profile-alert" role="alert">{error}</div>}
        {notice && <div className="success profile-alert" role="status">{notice}</div>}

        <header className="profile-hero">
          {profilePhoto}
          <div className="profile-identity">
            <p className="eyebrow">ГУУЛИНГИЙНХАН · PERSON PROFILE</p>
            <h1>{personName(person) || 'Нэргүй хүн'}</h1>
            <p className="profile-life">{birthDeath || 'Амьдралын огноо бүртгэгдээгүй'}</p>
            {person.nickname && <p className="profile-nickname">“{person.nickname}”</p>}
            <p className="profile-note">
              {familyInfo?.name ?? 'Гэр бүлийн орчин'} · {person.lineage_name ?? 'Удам томилогдоогүй'}
              {person.branch_name ? ` · ${person.branch_name}` : ''}
            </p>
            <div className="profile-actions">
              <Link
                className="button primary"
                href={`/tree?family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}
              >
                Удмын модонд харах
              </Link>
              <button type="button" onClick={() => setEditing((value) => !value)} disabled={busy}>
                {editing ? 'Засахыг хаах' : 'Профайл засах'}
              </button>
            </div>
          </div>
        </header>

        <div className="profile-grid">
          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">IDENTITY</p><h2>Үндсэн мэдээлэл</h2></div>
            </div>
            <dl className="profile-facts">
              <div><dt>Нэр</dt><dd>{personName(person) || 'Нэргүй'}</dd></div>
              <div><dt>Хүйс</dt><dd>{person.gender === 'female' ? 'Эмэгтэй' : person.gender === 'male' ? 'Эрэгтэй' : person.gender === 'other' ? 'Бусад' : 'Тодорхойгүй'}</dd></div>
              <div><dt>Төрсөн</dt><dd>{person.birth_date ?? 'Мэдээлэл оруулаагүй байна'}</dd></div>
              <div><dt>Төрсөн газар</dt><dd>{person.birth_place ?? 'Мэдээлэл оруулаагүй байна'}</dd></div>
              <div><dt>Нас барсан</dt><dd>{person.is_alive ? 'Амьд' : person.death_date ?? 'Огноо тодорхойгүй'}</dd></div>
              {!person.is_alive && <div><dt>Нас барсан газар</dt><dd>{person.death_place ?? 'Мэдээлэл оруулаагүй байна'}</dd></div>}
              <div><dt>Нууцлал</dt><dd>{person.visibility === 'private' ? 'Хувийн' : person.visibility === 'public' ? 'Нийтийн' : 'Гэр бүлийн'}</dd></div>
            </dl>
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">LINEAGE</p><h2>Удам угсаа</h2></div>
              <Link href={`/tree?family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}>Модонд харах →</Link>
            </div>
            <dl className="profile-facts">
              <div><dt>Удам</dt><dd>{person.lineage_name ?? 'Томилогдоогүй'}</dd></div>
              <div><dt>Салаа</dt><dd>{person.branch_name ?? 'Томилогдоогүй'}</dd></div>
            </dl>
            <p className="profile-note">Удам, салаа нь зөвхөн explicit assignment-аас харагдана. Бусад мэдээллээс автоматаар таамаглахгүй.</p>
          </section>

          <section className="card profile-card profile-relationships">
            <div className="profile-card-heading">
              <div><p className="eyebrow">FAMILY RELATIONSHIPS</p><h2>Гэр бүлийн холбоо</h2></div>
            </div>
            <div className="relationship-columns">
              <div>
                <h3>Эцэг, эх</h3>
                {person.parents.length ? person.parents.map((item) => (
                  <Link className="relationship-item" key={item.id} href={relationHref(item.id)}>
                    <span className="personavatar small" aria-hidden="true">{initials(item)}</span>
                    <span><strong>{personName(item) || 'Нэргүй хүн'}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна.</p>}
              </div>
              <div>
                <h3>Хань</h3>
                {person.spouses.length ? person.spouses.map((item) => (
                  <Link className="relationship-item" key={item.id} href={relationHref(item.id)}>
                    <span className="personavatar small" aria-hidden="true">{initials(item)}</span>
                    <span><strong>{personName(item) || 'Нэргүй хүн'}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна.</p>}
              </div>
              <div className="relationship-children">
                <h3>Хүүхдүүд</h3>
                {person.children.length ? person.children.map((item) => (
                  <Link className="relationship-item" key={item.id} href={relationHref(item.id)}>
                    <span className="personavatar small" aria-hidden="true">{initials(item)}</span>
                    <span><strong>{personName(item) || 'Нэргүй хүн'}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна.</p>}
              </div>
            </div>
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">LIFE HISTORY</p><h2>Намтар</h2></div>
            </div>
            {bioState === 'loading' && <p className="profile-empty" role="status">Намтрыг ачаалж байна…</p>}
            {bioState === 'restricted' && <p className="profile-empty">Намтрын мэдээлэлд хандах эрх хязгаарлагдсан байна.</p>}
            {bioState === 'error' && (
              <div><p className="profile-empty" role="alert">{bioError}</p><button type="button" onClick={() => retryProfile()}>Дахин оролдох</button></div>
            )}
            {bioState === 'ready' && (
              <>
                <p className="profile-text">{biography || 'Намтар оруулаагүй байна.'}</p>
                <form onSubmit={saveBiography}>
                  <label>Намтар<textarea value={biography} onChange={(event) => setBiography(event.target.value)} maxLength={50000} disabled={busy} /></label>
                  <button className="primary" type="submit" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Намтар хадгалах'}</button>
                </form>
              </>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">TIMELINE</p><h2>Амьдралын үйл явдал</h2></div>
            </div>
            {eventState === 'loading' && <p className="profile-empty" role="status">Үйл явдлыг ачаалж байна…</p>}
            {eventState === 'restricted' && <p className="profile-empty">Амьдралын үйл явдлын мэдээлэлд хандах эрх хязгаарлагдсан байна.</p>}
            {eventState === 'error' && (
              <div><p className="profile-empty" role="alert">{eventError}</p><button type="button" onClick={() => retryProfile()}>Дахин оролдох</button></div>
            )}
            {eventState === 'ready' && (
              <>
                {events.length === 0 ? <p className="profile-empty">Үйл явдал бүртгээгүй байна.</p> : (
                  <div className="history-list">
                    {events.map((item) => (
                      <div className="history-item" key={item.id}>
                        <strong>{item.title}</strong>
                        <span>{item.event_date ?? 'Он тодорхойгүй'}</span>
                        {item.description && <small>{item.description}</small>}
                      </div>
                    ))}
                  </div>
                )}
                <form onSubmit={addEvent}>
                  <label>Төрөл<select name="event_type" defaultValue="other" disabled={busy}>
                    <option value="birth">Төрсөн</option>
                    <option value="school">Сургууль</option>
                    <option value="work">Ажил</option>
                    <option value="marriage">Гэрлэлт</option>
                    <option value="divorce">Салалт</option>
                    <option value="move">Нүүх</option>
                    <option value="child_birth">Хүүхэд төрсөн</option>
                    <option value="death">Нас барсан</option>
                    <option value="other">Бусад</option>
                  </select></label>
                  <label>Гарчиг<input name="title" required maxLength={180} disabled={busy} /></label>
                  <label>Огноо<input name="event_date" type="date" disabled={busy} /></label>
                  <label>Тайлбар<textarea name="description" maxLength={10000} disabled={busy} /></label>
                  <button className="primary" type="submit" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Үйл явдал нэмэх'}</button>
                </form>
              </>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">MARRIAGE</p><h2>Гэрлэлтийн түүх</h2></div>
            </div>
            {marriageState === 'loading' && <p className="profile-empty" role="status">Гэрлэлтийн түүхийг ачаалж байна…</p>}
            {marriageState === 'restricted' && <p className="profile-empty">Гэрлэлтийн мэдээлэлд хандах эрх хязгаарлагдсан байна.</p>}
            {marriageState === 'error' && <p className="profile-empty" role="alert">Гэрлэлтийн мэдээллийг ачаалж чадсангүй.</p>}
            {marriageState === 'ready' && (
              marriages.length === 0
                ? <p className="profile-empty">Гэрлэлтийн мэдээлэл бүртгээгүй байна.</p>
                : marriages.map((marriage) => (
                  <div className="history-item" key={marriage.id}>
                    <strong>{marriage.other_person ? personName(marriage.other_person) : 'Хань'}</strong>
                    <span>{marriage.status === 'married' ? 'Одоо хамт' : marriage.status === 'divorced' ? 'Салсан' : 'Бэлэвсэн'}</span>
                    <small>
                      {marriage.start_date ?? 'Эхэлсэн огноо тодорхойгүй'} – {marriage.end_date ?? (marriage.status === 'married' ? 'Одоо' : 'Дууссан огноо тодорхойгүй')}
                    </small>
                    {marriage.location && <small>{marriage.location}</small>}
                    {marriage.description && <small>{marriage.description}</small>}
                  </div>
                ))
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">FAMILY STORY</p><h2>Энэ хүнтэй холбоотой түүхүүд</h2></div>
              <Link href={`/stories?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>
            {storyState === 'loading' && <p className="profile-empty" role="status">Түүхүүдийг ачаалж байна…</p>}
            {storyState === 'restricted' && <p className="profile-empty">Түүхийн мэдээлэлд хандах эрх хязгаарлагдсан байна.</p>}
            {storyState === 'error' && <p className="profile-empty" role="alert">Түүхүүдийг ачаалж чадсангүй.</p>}
            {storyState === 'ready' && (
              stories?.items.length ? (
                <div className="history-list">
                  {stories.items.map((story) => (
                    <Link className="history-item" key={story.id} href={`/stories/${story.id}?family=${encodeURIComponent(family)}`}>
                      <strong>{story.title}</strong>
                      <span>{story.event_date ?? 'Огноогүй'}{story.place ? ` · ${story.place}` : ''}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="profile-empty">Энэ хүнтэй холбоотой түүх бүртгэгдээгүй байна.</p>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">FAMILY MEMORIES</p><h2>Энэ хүнтэй холбоотой дурсамж</h2></div>
              <Link href={`/memories?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>
            {memoryState === 'loading' && <p className="profile-empty" role="status">Дурсамжийг ачаалж байна…</p>}
            {memoryState === 'restricted' && <p className="profile-empty">{memoryError}</p>}
            {memoryState === 'error' && (
              <div><p className="profile-empty" role="alert">{memoryError}</p><button type="button" onClick={retryProfile}>Дахин оролдох</button></div>
            )}
            {memoryState === 'ready' && (
              memories.length === 0
                ? <p className="profile-empty">Энэ хүнтэй холбоотой дурсамж бүртгэгдээгүй байна.</p>
                : <div className="history-list">
                    {memories.map((memory) => (
                      <div className="history-item" key={memory.id}>
                        <strong>{memory.title}</strong>
                        <span>{memory.memory_date ?? 'Огноогүй'}</span>
                        {memory.description && <small>{memory.description}</small>}
                      </div>
                    ))}
                  </div>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">FAMILY ARCHIVE</p><h2>Энэ хүнтэй холбоотой архив</h2></div>
              <Link href={`/archives?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>
            {archiveState === 'loading' && <p className="profile-empty" role="status">Архивыг ачаалж байна…</p>}
            {archiveState === 'restricted' && <p className="profile-empty">Архивын мэдээлэлд хандах эрх хязгаарлагдсан байна.</p>}
            {archiveState === 'error' && <p className="profile-empty" role="alert">Архивыг ачаалж чадсангүй.</p>}
            {archiveState === 'ready' && (
              archives?.items.length ? (
                <div className="history-list">
                  {archives.items.map((archive) => (
                    <Link className="history-item" key={archive.id} href={`/archives/${archive.id}?family=${encodeURIComponent(family)}`}>
                      <strong>{archive.title}</strong>
                      <span>{archive.document_date ?? 'Огноогүй'}{archive.place ? ` · ${archive.place}` : ''}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="profile-empty">Энэ хүнтэй холбоотой архив бүртгэгдээгүй байна.</p>
            )}
          </section>
        </div>

        {editing && (
          <section className="card profile-card profile-editor">
            <div className="profile-card-heading"><div><p className="eyebrow">EDIT</p><h2>Хувийн мэдээлэл</h2></div></div>
            <form onSubmit={saveProfile}>
              <div className="profile-form-grid">
                <label>Нэр<input name="first_name" defaultValue={person.first_name} required maxLength={120} disabled={busy} /></label>
                <label>Овог<input name="last_name" defaultValue={person.last_name} maxLength={120} disabled={busy} /></label>
                <label>Хүйс<select name="gender" defaultValue={person.gender} disabled={busy}><option value="unknown">Тодорхойгүй</option><option value="female">Эмэгтэй</option><option value="male">Эрэгтэй</option><option value="other">Бусад</option></select></label>
                <label>Төрсөн огноо<input name="birth_date" type="date" defaultValue={person.birth_date ?? ''} disabled={busy} /></label>
                <label>Төрсөн газар<input name="birth_place" defaultValue={person.birth_place ?? ''} maxLength={240} disabled={busy} /></label>
                <label>Амьд эсэх<select name="is_alive" defaultValue={String(person.is_alive)} disabled={busy}><option value="true">Амьд</option><option value="false">Нас барсан</option></select></label>
                <label>Нас барсан огноо<input name="death_date" type="date" defaultValue={person.death_date ?? ''} disabled={busy} /></label>
                <label>Нас барсан газар<input name="death_place" defaultValue={person.death_place ?? ''} maxLength={240} disabled={busy} /></label>
                <label>Нууцлал<select name="visibility" defaultValue={person.visibility} disabled={busy}><option value="private">Зөвхөн би</option><option value="family">Гэр бүлийнхэн</option><option value="public">Нийтийн</option></select></label>
              </div>
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Профайл хадгалах'}</button>
            </form>
          </section>
        )}

        <footer className="profile-footer">
          <Link href={`/people?family=${encodeURIComponent(family)}`}>← Хүмүүс</Link>
          <Link href={`/tree?family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}>Удмын модонд харах →</Link>
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
