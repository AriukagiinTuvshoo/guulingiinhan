'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

export default function ProfilePage() {
  const router = useRouter();
  const [family, setFamily] = useState('');
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load(fid: string, pid: string) {
    const profile = await api<PersonProfile>(`/families/${fid}/persons/${pid}`);
    const [bio, eventList, marriageList, storyPage, archivePage] = await Promise.allSettled([
      api<{ content: string }>(`/families/${fid}/persons/${pid}/biography`),
      api<EventItem[]>(`/families/${fid}/persons/${pid}/events`),
      api<Marriage[]>(`/families/${fid}/persons/${pid}/marriages`),
      api<StoryListPage>(`/families/${fid}/stories?page=1&page_size=5&person_id=${encodeURIComponent(pid)}`),
      api<ArchiveListPage>(`/families/${fid}/persons/${pid}/archives?page=1&page_size=5`),
    ]);

    const unexpectedFailure = [bio, eventList, marriageList, storyPage, archivePage].find(
      (result) =>
        result.status === 'rejected' &&
        !(result.reason instanceof ApiError && [403, 404].includes(result.reason.status)),
    );
    if (unexpectedFailure?.status === 'rejected') {
      throw unexpectedFailure.reason;
    }

    setPerson(profile);
    setBiography(bio.status === 'fulfilled' ? bio.value.content : '');
    setEvents(eventList.status === 'fulfilled' ? eventList.value : []);
    setStories(storyPage.status === 'fulfilled' ? storyPage.value : null);
    setArchives(archivePage.status === 'fulfilled' ? archivePage.value : null);
    setMarriages(marriageList.status === 'fulfilled' ? marriageList.value : []);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fid = params.get('family') ?? '';
    const pid = params.get('person') ?? '';
    setFamily(fid);
    setId(pid);

    if (!fid || !pid) {
      router.replace('/people');
      return;
    }

    setLoading(true);
    setError('');
    load(fid, pid)
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(
          cause instanceof ApiError && [403, 404].includes(cause.status)
            ? 'Энэ хүний профайл олдсонгүй эсвэл харах эрхгүй байна.'
            : cause instanceof Error
              ? cause.message
              : 'Профайлыг ачаалж чадсангүй.',
        );
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function loadMemories(fid: string, pid: string) {
    setMemoryState('loading');
    setMemoryError('');
    try {
      const result = await api<MemoryListItem[]>(
        `/families/${fid}/persons/${pid}/memories`,
      );
      setMemories(result);
      setMemoryState('ready');
    } catch (cause) {
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
      setMemoryError(
        cause instanceof Error
          ? cause.message
          : 'Дурсамжийг ачаалж чадсангүй.',
      );
    }
  }

  async function retry() {
    if (!family || !id) return;
    setLoading(true);
    setError('');
    try {
      await load(family, id);
    } catch (cause) {
      setError(
        cause instanceof ApiError && [403, 404].includes(cause.status)
          ? 'Энэ хүний профайл олдсонгүй эсвэл харах эрхгүй байна.'
          : cause instanceof Error
            ? cause.message
            : 'Профайлыг ачаалж чадсангүй.',
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
    setError('');
    try {
      await api(`/families/${family}/persons/${id}/biography`, {
        method: 'PUT',
        body: JSON.stringify({ content: biography }),
      });
      setNotice('Намтар хадгалагдлаа.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Намтрыг хадгалж чадсангүй.');
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          is_alive: values.get('is_alive') === 'true',
          death_date: values.get('death_date') || null,
          death_place: values.get('death_place') || null,
          visibility: values.get('visibility'),
        }),
      });
      await load(family, id);
      setEditing(false);
      setNotice('Профайл хадгалагдлаа.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Профайлыг хадгалж чадсангүй.');
    }
  }

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      await load(family, id);
      formElement.reset();
      setNotice('Үйл явдал нэмэгдлээ.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Үйл явдал нэмж чадсангүй.');
    }
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
          {person.profile_photo_url ? (
            <img
              className="personavatar profile-photo"
              src={person.profile_photo_url}
              alt={`${personName(person)}-ийн хөрөг`}
            />
          ) : (
            <span className="personavatar large" aria-hidden="true">{initials(person)}</span>
          )}
          <div className="profile-identity">
            <p className="eyebrow">ГУУЛИНГИЙНХАН · PERSON PROFILE</p>
            <h1>{personName(person) || 'Нэргүй хүн'}</h1>
            <p className="profile-life">
              {birthDeath || 'Амьдралын огноо бүртгэгдээгүй'}
            </p>
            {person.nickname && <p className="profile-nickname">“{person.nickname}”</p>}
            <div className="profile-actions">
              <Link className="button primary" href={`/tree?family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}>
                Удмын модонд харах
              </Link>
              <button type="button" onClick={() => setEditing((value) => !value)}>
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
                  <Link className="relationship-item" key={item.id} href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(item.id)}`}>
                    <span className="personavatar small" aria-hidden="true">{initials(item)}</span>
                    <span><strong>{relationName(item)}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна</p>}
              </div>
              <div>
                <h3>Хань</h3>
                {person.spouses.length ? person.spouses.map((item) => (
                  <Link className="relationship-item" key={item.id} href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(item.id)}`}>
                    <span className="personavatar small" aria-hidden="true">{initials(item)}</span>
                    <span><strong>{relationName(item)}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна</p>}
              </div>
              <div className="relationship-children">
                <h3>Хүүхдүүд</h3>
                {person.children.length ? person.children.map((item) => (
                  <Link className="relationship-item" key={item.id} href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(item.id)}`}>
                    <span className="personavatar small" aria-hidden="true">{initials(item)}</span>
                    <span><strong>{relationName(item)}</strong><small>{relationLife(item)}</small></span>
                  </Link>
                )) : <p className="profile-empty">Мэдээлэл оруулаагүй байна</p>}
              </div>
            </div>
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">FAMILY ARCHIVE</p><h2>Энэ хүнтэй холбоотой архив</h2></div>
              <Link href={`/archives?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>
            {archives?.items.length ? (
              <div className="history-list">
                {archives.items.map((archive) => (
                  <Link className="history-item" key={archive.id} href={`/archives/${archive.id}?family=${encodeURIComponent(family)}`}>
                    <strong>{archive.title}</strong>
                    <span>{archive.document_date ?? 'Огноогүй'}{archive.place ? ` · ${archive.place}` : ''}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="profile-empty">Энэ хүнтэй холбоотой архив бүртгэгдээгүй байна.</p>
            )}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">FAMILY STORY</p><h2>Энэ хүнтэй холбоотой түүхүүд</h2></div>
              <Link href={`/stories?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>
            {stories?.items.length ? (
              <div className="history-list">
                {stories.items.slice(0, 5).map((story) => (
                  <Link className="history-item" key={story.id} href={`/stories/${story.id}?family=${encodeURIComponent(family)}`}>
                    <strong>{story.title}</strong>
                    <span>{story.event_date ?? 'Огноогүй'}{story.place ? ` · ${story.place}` : ''}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="profile-empty">Энэ хүнтэй холбоотой түүх бүртгэгдээгүй байна.</p>}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading">
              <div><p className="eyebrow">FAMILY MEMORIES</p><h2>Энэ хүнтэй холбоотой дурсамж</h2></div>
              <Link href={`/memories?family=${encodeURIComponent(family)}`}>Бүгд →</Link>
            </div>

            {memoryState === 'loading' && (
              <p className="profile-empty" role="status" aria-live="polite">
                Дурсамжийг ачаалж байна…
              </p>
            )}

            {memoryState === 'restricted' && (
              <div>
                <p className="profile-empty">{memoryError}</p>
                <button type="button" onClick={() => void loadMemories(family, id)}>
                  Дахин оролдох
                </button>
              </div>
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
            <div className="profile-card-heading"><div><p className="eyebrow">LIFE HISTORY</p><h2>Намтар</h2></div></div>
            <p className="profile-text">{biography || 'Намтар оруулаагүй байна.'}</p>
            <form onSubmit={saveBiography}>
              <label>Намтар<textarea value={biography} onChange={(event) => setBiography(event.target.value)} maxLength={50000} /></label>
              <button className="primary" type="submit">Намтар хадгалах</button>
            </form>
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading"><div><p className="eyebrow">MARRIAGE</p><h2>Гэрлэлтийн түүх</h2></div></div>
            {marriages.length === 0 ? <p className="profile-empty">Гэрлэлтийн мэдээлэл бүртгээгүй байна.</p> : marriages.map((marriage) => (
              <div className="history-item" key={marriage.id}>
                <strong>{marriage.other_person ? personName(marriage.other_person) : 'Хань'}</strong>
                <span>{marriage.status === 'married' ? 'Одоо хамт' : marriage.status === 'divorced' ? 'Салсан' : 'Бэлэвсэн'}</span>
                <small>{marriage.start_date ?? 'Эхэлсэн огноо тодорхойгүй'} – {marriage.end_date ?? (marriage.status === 'married' ? 'Одоо' : 'Дууссан огноо тодорхойгүй')}</small>
              </div>
            ))}
          </section>

          <section className="card profile-card">
            <div className="profile-card-heading"><div><p className="eyebrow">TIMELINE</p><h2>Амьдралын үйл явдал</h2></div></div>
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
              <button className="primary" type="submit">Үйл явдал нэмэх</button>
            </form>
          </section>
        </div>

        {editing && (
          <section className="card profile-card profile-editor">
            <div className="profile-card-heading"><div><p className="eyebrow">EDIT</p><h2>Хувийн мэдээлэл</h2></div></div>
            <form onSubmit={saveProfile}>
              <div className="profile-form-grid">
                <label>Нэр<input name="first_name" defaultValue={person.first_name} required maxLength={120} /></label>
                <label>Овог<input name="last_name" defaultValue={person.last_name} maxLength={120} /></label>
                <label>Хүйс<select name="gender" defaultValue={person.gender}><option value="unknown">Тодорхойгүй</option><option value="female">Эмэгтэй</option><option value="male">Эрэгтэй</option><option value="other">Бусад</option></select></label>
                <label>Төрсөн огноо<input name="birth_date" type="date" defaultValue={person.birth_date ?? ''} /></label>
                <label>Төрсөн газар<input name="birth_place" defaultValue={person.birth_place ?? ''} maxLength={240} /></label>
                <label>Амьд эсэх<select name="is_alive" defaultValue={String(person.is_alive)}><option value="true">Амьд</option><option value="false">Нас барсан</option></select></label>
                <label>Нас барсан огноо<input name="death_date" type="date" defaultValue={person.death_date ?? ''} /></label>
                <label>Нас барсан газар<input name="death_place" defaultValue={person.death_place ?? ''} maxLength={240} /></label>
                <label>Нууцлал<select name="visibility" defaultValue={person.visibility}><option value="private">Зөвхөн би</option><option value="family">Гэр бүлийнхэн</option><option value="public">Нийтийн</option></select></label>
              </div>
              <button className="primary" type="submit">Профайл хадгалах</button>
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
