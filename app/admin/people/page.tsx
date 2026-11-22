'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminFamilyStudio from '../../../components/admin-family-studio';
import AdminShell, { type AdminIdentity } from '../../../components/admin-shell';
import {
  api,
  ApiError,
  BranchSummary,
  LineageSummary,
  Person,
  PersonDirectoryItem,
  PersonDirectoryPage,
  personName,
} from '../../../lib/api';
import '../admin.css';
import styles from '../admin.module.css';

type Access = { scopes: string[] };
type Marriage = {
  id: string;
  person_1_id: string;
  person_2_id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
};
type Profile = {
  first_name: string;
  last_name: string;
  middle_name: string;
  nickname: string;
  gender: string;
  birth_date: string;
  death_date: string;
  is_alive: boolean;
  visibility: string;
  short_description: string;
};
type GlobalFamily = { id: string; name: string };

const emptyProfile: Profile = {
  first_name: '',
  last_name: '',
  middle_name: '',
  nickname: '',
  gender: 'unknown',
  birth_date: '',
  death_date: '',
  is_alive: true,
  visibility: 'family',
  short_description: '',
};
const PAGE_SIZE = 25;

function profileFrom(person: Person): Profile {
  return {
    first_name: person.first_name,
    last_name: person.last_name,
    middle_name: person.middle_name ?? '',
    nickname: person.nickname ?? '',
    gender: person.gender,
    birth_date: person.birth_date ?? '',
    death_date: person.death_date ?? '',
    is_alive: person.is_alive,
    visibility: person.visibility,
    short_description: person.short_description ?? '',
  };
}

function GlobalAdminPeoplePage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [families, setFamilies] = useState<GlobalFamily[]>([]);
  const [offset, setOffset] = useState(0);
  const [familyId, setFamilyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [people, setPeople] = useState<PersonDirectoryPage | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    api<AdminIdentity>('/admin/me')
      .then((who) => {
        if (active) setIdentity(who);
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
        else setError('Хүний бүртгэлийг админ удирдана.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router, revision]);

  useEffect(() => {
    if (!identity) return;
    let active = true;
    setLoading(true);
    setError('');
    api<GlobalFamily[]>(`/admin/families?limit=50&offset=${offset}`)
      .then((rows) => {
        if (!active) return;
        setFamilies(rows);
        setFamilyId((previous) => (rows.some((row) => row.id === previous) ? previous : rows[0]?.id || ''));
      })
      .catch(() => {
        if (active) setError('Гэр бүлийн бүртгэлийг ачаалж чадсангүй.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [identity, offset, revision]);

  useEffect(() => {
    setPeople(null);
    if (!identity || identity.role === 'SUPER_ADMIN' || !familyId) {
      setDirectoryLoading(false);
      return;
    }
    const controller = new AbortController();
    setDirectoryLoading(true);
    const timer = window.setTimeout(() => {
      setError('');
      const params = new URLSearchParams({ page: String(page), page_size: '24' });
      if (query.trim()) params.set('q', query.trim());
      api<PersonDirectoryPage>(`/families/${familyId}/people?${params}`, { signal: controller.signal })
        .then((rows) => {
          if (!controller.signal.aborted) setPeople(rows);
        })
        .catch((cause) => {
          if (!controller.signal.aborted) {
            setPeople(null);
            setError(
              cause instanceof ApiError && cause.status === 403
                ? 'Энэ гэр бүлийн хувийн бүртгэлийг харах эрх хүрэхгүй. Өөрийн хандах эрхтэй гэр бүлээ сонгоно уу.'
                : 'Хүний бүртгэлийг ачаалж чадсангүй.',
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setDirectoryLoading(false);
        });
    }, 240);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [identity, familyId, page, query, revision]);

  return (
    <AdminShell active="people" title="Хүмүүсийн удирдлага" identity={identity}>
      <p className={styles.intro}>
        👥 Гэр бүлээ сонгож хүний бүртгэл, намтар болон холбоосыг шалгана. Аккаунт нь хүний удмын бүртгэлээс тусдаа
        хадгалагдана.
      </p>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <div className={styles.panelActions}>
            <button type="button" onClick={() => setRevision((value) => value + 1)}>
              Дахин ачаалах
            </button>
          </div>
        </div>
      )}
      {identity && (
        <>
          <div className={styles.panel}>
            <label>
              Удирдах гэр бүл
              <select
                value={familyId}
                onChange={(event) => {
                  setFamilyId(event.target.value);
                  setPeople(null);
                  setPage(1);
                  setQuery('');
                }}
              >
                <option value="">Гэр бүл сонгох</option>
                {families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.pagination}>
              <button
                type="button"
                disabled={offset === 0 || loading}
                onClick={() => setOffset((value) => Math.max(0, value - 50))}
              >
                Өмнөх гэр бүлүүд
              </button>
              <span>
                Гэр бүлийн бүртгэл {families.length ? offset + 1 : 0}–{offset + families.length}
              </span>
              <button
                type="button"
                disabled={families.length < 50 || loading}
                onClick={() => setOffset((value) => value + 50)}
              >
                Дараах гэр бүлүүд
              </button>
            </div>
          </div>
          {loading && (
            <p className={styles.state} role="status">
              Бүртгэлийг ачаалж байна…
            </p>
          )}
          {!loading && familyId && identity.role === 'SUPER_ADMIN' && (
            <AdminFamilyStudio key={familyId} familyId={familyId} onBack={() => router.push('/admin?section=families')} />
          )}
          {familyId && identity.role !== 'SUPER_ADMIN' && (
            <>
              <p className={styles.muted}>
                Таны хандах эрхтэй мэдээлэл харагдана. Үндсэн бүртгэл болон холбоосын засварыг Ерөнхий админ гүйцэтгэнэ.
              </p>
              <div className={styles.listToolbar}>
                <label>
                  Хүний нэрээр хайх
                  <input
                    type="search"
                    value={query}
                    maxLength={100}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              </div>
              {directoryLoading && (
                <p className={styles.state} role="status">
                  Хайлтын бүртгэлийг ачаалж байна…
                </p>
              )}
              {!loading && !directoryLoading && people && (
                <>
                  <div className={styles.list}>
                    {people.items.map((person) => (
                      <div key={person.id} className={styles.row}>
                        <div>
                          <strong>{personName(person)}</strong>
                          <span>
                            {person.birth_date?.slice(0, 4) || 'Он тодорхойгүй'} ·{' '}
                            {person.is_alive ? 'Амьд' : 'Дурсгалд'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!people.items.length && <p className={styles.state}>Тохирох бүртгэл алга.</p>}
                  <div className={styles.pagination}>
                    <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                      Өмнөх
                    </button>
                    <span>
                      {page}-р хуудас · {people.total} хүн
                    </span>
                    <button disabled={!people.has_next} onClick={() => setPage((value) => value + 1)}>
                      Дараах
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {!loading && !families.length && !error && <p className={styles.state}>Идэвхтэй гэр бүлийн бүртгэл алга.</p>}
        </>
      )}
    </AdminShell>
  );
}

function FamilyAdminPeoplePage() {
  const [family, setFamily] = useState('');
  const [people, setPeople] = useState<PersonDirectoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedPeople, setSelectedPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [child, setChild] = useState('');
  const [spouseOne, setSpouseOne] = useState('');
  const [spouseTwo, setSpouseTwo] = useState('');
  const [marriageDate, setMarriageDate] = useState('');
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [editPerson, setEditPerson] = useState('');
  const [editPick, setEditPick] = useState('');
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [lineages, setLineages] = useState<LineageSummary[]>([]);
  const [lineage, setLineage] = useState('');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branch, setBranch] = useState('');
  const [assignPerson, setAssignPerson] = useState('');
  const [bioPerson, setBioPerson] = useState('');
  const bioRequest = useRef(0);
  const [biography, setBiography] = useState('');
  const [bioLoading, setBioLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('family') ?? '';
    const controller = new AbortController();
    if (!id) {
      setError('Гэр бүл сонгоно уу.');
      setLoading(false);
      return;
    }
    setFamily(id);
    api<Access>(`/families/${encodeURIComponent(id)}/admin-access`, { signal: controller.signal })
      .then(async (access) => {
        if (!access.scopes.includes('manage_people')) throw new Error('forbidden');
        if (!controller.signal.aborted) {
          setAllowed(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Хүмүүсийг ачаалж чадсангүй эсвэл эрхгүй.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!family || !allowed) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (query.trim()) params.set('q', query.trim());
    setLoading(true);
    api<PersonDirectoryPage>(`/families/${encodeURIComponent(family)}/people?${params}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (page > 1 && result.items.length === 0 && result.total <= (page - 1) * PAGE_SIZE) {
          setPage(page - 1);
          return;
        }
        setPeople(result.items);
        setTotal(result.total);
        setHasNext(result.has_next);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Хүмүүсийг ачаалж чадсангүй.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [family, allowed, page, query, revision]);
  useEffect(() => {
    if (!family || !allowed) return;
    const controller = new AbortController();
    api<Marriage[]>(`/families/${encodeURIComponent(family)}/marriages`, { signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setMarriages(rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMarriages([]);
      });
    api<LineageSummary[]>(`/families/${encodeURIComponent(family)}/lineages`, { signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setLineages(rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLineages([]);
      });
    return () => controller.abort();
  }, [family, allowed, revision]);
  useEffect(() => {
    if (!lineage) {
      setBranches([]);
      setBranch('');
      return;
    }
    const controller = new AbortController();
    api<BranchSummary[]>(`/lineages/${encodeURIComponent(lineage)}/branches`, { signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setBranches(rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBranches([]);
      });
    return () => controller.abort();
  }, [lineage]);
  function remember(id: string) {
    const person = people.find((row) => row.id === id);
    if (person) setSelectedPeople((rows) => [...rows.filter((row) => row.id !== id), person]);
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api<Person>(`/families/${encodeURIComponent(family)}/persons`, {
        method: 'POST',
        body: JSON.stringify({ first_name: name }),
      });
      setName('');
      setPage(1);
      setRevision((value) => value + 1);
    } catch {
      setError('Хүн нэмэж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }
  async function detach(person: Person) {
    if (busy || !window.confirm('Энэ хүнийг гэр бүлээс салгах уу?')) return;
    setBusy(true);
    setError('');
    try {
      await api<void>(`/families/${encodeURIComponent(family)}/persons/${encodeURIComponent(person.id)}`, {
        method: 'DELETE',
      });
      setSelectedPeople((rows) => rows.filter((row) => row.id !== person.id));
      setRevision((value) => value + 1);
      if (editPerson === person.id) setEditPerson('');
      if (assignPerson === person.id) setAssignPerson('');
    } catch {
      setError('Салгаж чадсангүй. Холбоотой хамгаалалт, түүх, архив эсвэл guardian эрхийг шалгана уу.');
    } finally {
      setBusy(false);
    }
  }
  async function linkParent(event: FormEvent) {
    event.preventDefault();
    if (busy || !parent || !child) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<void>(`/families/${encodeURIComponent(family)}/relationships/parent-child`, {
        method: 'POST',
        body: JSON.stringify({ parent_id: parent, child_id: child }),
      });
      setNotice('Эцэг эх, хүүхдийн холбоо хадгалагдлаа.');
    } catch {
      setError('Холбоо үүсгэж чадсангүй. Эрх болон холбооны мэдээллийг шалгана уу.');
    } finally {
      setBusy(false);
    }
  }
  async function linkMarriage(event: FormEvent) {
    event.preventDefault();
    if (busy || !spouseOne || !spouseTwo) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<Marriage>(`/families/${encodeURIComponent(family)}/marriages`, {
        method: 'POST',
        body: JSON.stringify({
          person_1_id: spouseOne,
          person_2_id: spouseTwo,
          status: 'married',
          ...(marriageDate ? { start_date: marriageDate } : {}),
        }),
      });
      setNotice('Гэрлэлтийн холбоо хадгалагдлаа.');
      setRevision((value) => value + 1);
    } catch {
      setError('Гэрлэлт үүсгэж чадсангүй. Ижил хосын идэвхтэй холбоо байгаа эсэхийг шалгана уу.');
    } finally {
      setBusy(false);
    }
  }
  async function dissolveMarriage(marriage: Marriage) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<Marriage>(`/families/${encodeURIComponent(family)}/marriages/${encodeURIComponent(marriage.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'divorced' }),
      });
      setNotice('Гэрлэлтийн төлөв шинэчлэгдлээ.');
      setRevision((value) => value + 1);
    } catch {
      setError('Гэрлэлтийг шинэчилж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }
  function startEdit(personId: string) {
    if (!personId) return;
    const person =
      people.find((row) => row.id === personId) ?? selectedPeople.find((row) => row.id === personId) ?? null;
    if (!person) return;
    setEditPerson(personId);
    setProfile(profileFrom(person));
    setError('');
    setNotice('');
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (busy || !editPerson) return;
    setBusy(true);
    setError('');
    setNotice('');
    const body: Record<string, string | boolean> = {
      first_name: profile.first_name.trim(),
      last_name: profile.last_name.trim(),
      middle_name: profile.middle_name.trim(),
      nickname: profile.nickname.trim(),
      gender: profile.gender,
      is_alive: profile.is_alive,
      visibility: profile.visibility,
      short_description: profile.short_description.trim(),
      ...(profile.birth_date ? { birth_date: profile.birth_date } : {}),
      ...(profile.death_date ? { death_date: profile.death_date } : {}),
    };
    try {
      await api<Person>(`/families/${encodeURIComponent(family)}/persons/${encodeURIComponent(editPerson)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setNotice('Профайл шинэчлэгдлээ.');
      setRevision((value) => value + 1);
    } catch {
      setError('Профайл шинэчилж чадсангүй. Эрх, огнооны дараалал болон насанд хүрээгүй хамгаалалтыг шалгана уу.');
    } finally {
      setBusy(false);
    }
  }
  async function assignLineage(event: FormEvent) {
    event.preventDefault();
    if (busy || !assignPerson || !lineage) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(
        `/families/${encodeURIComponent(family)}/persons/${encodeURIComponent(assignPerson)}/lineage-assignment`,
        {
          method: 'PUT',
          body: JSON.stringify({ lineage_id: lineage, branch_id: branch || null }),
        },
      );
      setNotice('Удам угсааны оноолт хадгалагдлаа.');
      setRevision((value) => value + 1);
    } catch {
      setError('Оноолт хадгалаж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }
  async function clearLineage() {
    if (busy || !assignPerson) return;
    setBusy(true);
    setError('');
    try {
      await api<void>(
        `/families/${encodeURIComponent(family)}/persons/${encodeURIComponent(assignPerson)}/lineage-assignment`,
        { method: 'DELETE' },
      );
      setNotice('Оноолтыг устгалаа.');
      setRevision((value) => value + 1);
    } catch {
      setError('Оноолтыг устгаж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }
  async function loadBiography(personId: string) {
    const request = ++bioRequest.current;
    remember(personId);
    setBioPerson(personId);
    setBiography('');
    setError('');
    setNotice('');
    setBioLoading(!!personId);
    if (!personId) return;
    try {
      const data = await api<{ content: string }>(
        `/families/${encodeURIComponent(family)}/persons/${encodeURIComponent(personId)}/biography`,
      );
      if (request === bioRequest.current) setBiography(data.content);
    } catch {
      if (request === bioRequest.current) {
        setBioPerson('');
        setError('Намтар ачаалж чадсангүй.');
      }
    } finally {
      if (request === bioRequest.current) setBioLoading(false);
    }
  }
  async function saveBiography(event: FormEvent) {
    event.preventDefault();
    if (busy || bioLoading || !bioPerson) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<void>(`/families/${encodeURIComponent(family)}/persons/${encodeURIComponent(bioPerson)}/biography`, {
        method: 'PUT',
        body: JSON.stringify({ content: biography }),
      });
      setNotice('Намтар хадгалагдлаа.');
    } catch {
      setError('Намтар хадгалж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }
  const options = [...people, ...selectedPeople.filter((person) => !people.some((row) => row.id === person.id))];
  const nameFor = (id: string) => {
    const person = options.find((row) => row.id === id);
    return person ? `${person.last_name} ${person.first_name}`.trim() : `${id.slice(0, 8)}…`;
  };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <main className="admin-console">
      <header className="admin-console__header">
        <h1>Хүмүүс</h1>
        <Link href={`/admin?family=${encodeURIComponent(family)}`}>Удирдлага руу буцах</Link>
      </header>
      <section className="admin-console__content">
        {loading && <p role="status">Ачаалж байна…</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {allowed && (
          <>
            <form className="admin-console__member" onSubmit={add}>
              <label>
                Нэр <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <button disabled={busy}>Хүн нэмэх</button>
            </form>
            <form className="admin-console__member" onSubmit={linkParent}>
              <h2>Эцэг эх, хүүхэд холбох</h2>
              <label>
                Эцэг эсвэл эх{' '}
                <select
                  required
                  value={parent}
                  onChange={(event) => {
                    setParent(event.target.value);
                    remember(event.target.value);
                  }}
                >
                  <option value="">Сонгоно уу</option>
                  {options.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.last_name} {person.first_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Хүүхэд{' '}
                <select
                  required
                  value={child}
                  onChange={(event) => {
                    setChild(event.target.value);
                    remember(event.target.value);
                  }}
                >
                  <option value="">Сонгоно уу</option>
                  {options.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.last_name} {person.first_name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>Холбоо хадгалах</button>
            </form>
            <form className="admin-console__member" aria-label="Гэрлэлт холбох" onSubmit={linkMarriage}>
              <h2>Гэрлэлт холбох</h2>
              <label>
                Нэгдүгээр хүн{' '}
                <select
                  required
                  value={spouseOne}
                  onChange={(event) => {
                    setSpouseOne(event.target.value);
                    remember(event.target.value);
                  }}
                >
                  <option value="">Сонгоно уу</option>
                  {options.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.last_name} {person.first_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Хоёрдугаар хүн{' '}
                <select
                  required
                  value={spouseTwo}
                  onChange={(event) => {
                    setSpouseTwo(event.target.value);
                    remember(event.target.value);
                  }}
                >
                  <option value="">Сонгоно уу</option>
                  {options.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.last_name} {person.first_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Гэрлэсэн огноо{' '}
                <input type="date" value={marriageDate} onChange={(event) => setMarriageDate(event.target.value)} />
              </label>
              <button disabled={busy}>Гэрлэлт хадгалах</button>
            </form>
            <div className="admin-console__member">
              <h2>Гэрлэлтийн холбоосууд</h2>
              {!marriages.length ? (
                <p>Бүртгэлтэй гэрлэлт алга.</p>
              ) : (
                <ul className="admin-console__audit">
                  {marriages.map((marriage) => (
                    <li key={marriage.id}>
                      <span>
                        {nameFor(marriage.person_1_id)} · {nameFor(marriage.person_2_id)}
                      </span>
                      <strong>
                        {marriage.status === 'married'
                          ? 'Идэвхтэй'
                          : marriage.status === 'divorced'
                            ? 'Цуцалсан'
                            : 'Түлэргэн'}
                      </strong>
                      {marriage.start_date && <time dateTime={marriage.start_date}>{marriage.start_date}</time>}
                      {marriage.status === 'married' && (
                        <button disabled={busy} onClick={() => void dissolveMarriage(marriage)}>
                          Төлөв цуцлах
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {editPerson ? (
              <form className="admin-console__member" aria-label="Профайл засах" onSubmit={saveProfile}>
                <h2>Профайл засах — {nameFor(editPerson)}</h2>
                <label>
                  Овог{' '}
                  <input
                    maxLength={120}
                    value={profile.last_name}
                    onChange={(event) => setProfile({ ...profile, last_name: event.target.value })}
                  />
                </label>
                <label>
                  Нэр{' '}
                  <input
                    required
                    maxLength={120}
                    value={profile.first_name}
                    onChange={(event) => setProfile({ ...profile, first_name: event.target.value })}
                  />
                </label>
                <label>
                  Эцгийн нэр{' '}
                  <input
                    maxLength={120}
                    value={profile.middle_name}
                    onChange={(event) => setProfile({ ...profile, middle_name: event.target.value })}
                  />
                </label>
                <label>
                  Хоч{' '}
                  <input
                    maxLength={120}
                    value={profile.nickname}
                    onChange={(event) => setProfile({ ...profile, nickname: event.target.value })}
                  />
                </label>
                <label>
                  Хүйс{' '}
                  <select
                    value={profile.gender}
                    onChange={(event) => setProfile({ ...profile, gender: event.target.value })}
                  >
                    <option value="female">Эмэгтэй</option>
                    <option value="male">Эрэгтэй</option>
                    <option value="other">Бусад</option>
                    <option value="unknown">Тодорхойгүй</option>
                  </select>
                </label>
                <label>
                  Төрсөн огноо{' '}
                  <input
                    type="date"
                    value={profile.birth_date}
                    onChange={(event) => setProfile({ ...profile, birth_date: event.target.value })}
                  />
                </label>
                <label>
                  Амд эсэх{' '}
                  <select
                    value={profile.is_alive ? 'alive' : 'deceased'}
                    onChange={(event) => setProfile({ ...profile, is_alive: event.target.value === 'alive' })}
                  >
                    <option value="alive">Амд</option>
                    <option value="deceased">Нас барсан</option>
                  </select>
                </label>
                <label>
                  Нас барсан огноо{' '}
                  <input
                    type="date"
                    disabled={profile.is_alive}
                    value={profile.death_date}
                    onChange={(event) => setProfile({ ...profile, death_date: event.target.value })}
                  />
                </label>
                <label>
                  Харагдах байдал{' '}
                  <select
                    value={profile.visibility}
                    onChange={(event) => setProfile({ ...profile, visibility: event.target.value })}
                  >
                    <option value="family">Гэр бүл</option>
                    <option value="private">Хувийн</option>
                    <option value="public">Нийтийн</option>
                  </select>
                </label>
                <label>
                  Товч танилцуулга{' '}
                  <textarea
                    maxLength={1000}
                    value={profile.short_description}
                    onChange={(event) => setProfile({ ...profile, short_description: event.target.value })}
                  />
                </label>
                <div className="row">
                  <button className="primary" disabled={busy}>
                    Хадгалах
                  </button>
                  <button type="button" disabled={busy} onClick={() => setEditPerson('')}>
                    {'Болих'}
                  </button>
                </div>
              </form>
            ) : (
              <form
                className="admin-console__member"
                aria-label="Профайл засах"
                onSubmit={(event) => {
                  event.preventDefault();
                  startEdit(editPick);
                }}
              >
                <h2>Профайл засах</h2>
                <label>
                  Хүн{' '}
                  <select required value={editPick} onChange={(event) => setEditPick(event.target.value)}>
                    <option value="">Сонгоно уу</option>
                    {options.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.last_name} {person.first_name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={busy || !editPick}>
                  Засах хэсэг нээх
                </button>
              </form>
            )}
            <form className="admin-console__member" aria-label="Удам угсаанд оноох" onSubmit={assignLineage}>
              <h2>Удам угсаа, салаанд оноох</h2>
              <label>
                Хүн{' '}
                <select
                  required
                  value={assignPerson}
                  onChange={(event) => {
                    setAssignPerson(event.target.value);
                    remember(event.target.value);
                  }}
                >
                  <option value="">Сонгоно уу</option>
                  {options.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.last_name} {person.first_name}
                    </option>
                  ))}
                </select>
              </label>
              {!lineages.length ? (
                <p>Энэ гэр бүлд удам угсаа бүртгэлгүй. Эхлээд гэр бүлийн тохиргооноос нэмнэ үү.</p>
              ) : (
                <>
                  <label>
                    Удам угсаа{' '}
                    <select
                      required
                      value={lineage}
                      onChange={(event) => {
                        setLineage(event.target.value);
                        setBranch('');
                      }}
                    >
                      <option value="">Сонгоно уу</option>
                      {lineages.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Салаа{' '}
                    <select value={branch} onChange={(event) => setBranch(event.target.value)}>
                      <option value="">Сонгоогүй</option>
                      {branches.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="row">
                    <button disabled={busy}>Оноох</button>
                    <button type="button" disabled={busy || !assignPerson} onClick={() => void clearLineage()}>
                      Оноолт цэвэрлэх
                    </button>
                  </div>
                </>
              )}
            </form>
            <form className="admin-console__member" onSubmit={saveBiography}>
              <h2>Намтар</h2>
              <label>
                Хүн{' '}
                <select value={bioPerson} onChange={(event) => void loadBiography(event.target.value)}>
                  <option value="">Сонгоно уу</option>
                  {options.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.last_name} {person.first_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Намтар{' '}
                <textarea
                  value={biography}
                  disabled={!bioPerson || bioLoading}
                  onChange={(event) => setBiography(event.target.value)}
                />
              </label>
              <button disabled={busy || bioLoading || !bioPerson}>Намтар хадгалах</button>
            </form>
            <label>
              Хүн хайх{' '}
              <input
                maxLength={100}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <ul className="admin-console__audit">
              {people.map((person) => (
                <li key={person.id}>
                  <span>
                    {person.last_name} {person.first_name}
                    {person.lineage_name ? ` · ${person.lineage_name}` : ''}
                  </span>
                  <Link href={`/profile?family=${encodeURIComponent(family)}&person=${encodeURIComponent(person.id)}`}>
                    Профайл
                  </Link>
                  <button disabled={busy} onClick={() => startEdit(person.id)}>
                    Засах
                  </button>
                  <button disabled={busy} onClick={() => void detach(person)}>
                    Салгах
                  </button>
                </li>
              ))}
            </ul>
            <nav aria-label="Хүмүүсийн хуудас">
              <button disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>
                Өмнөх
              </button>{' '}
              <span>
                {page} / {totalPages} ({total})
              </span>{' '}
              <button disabled={loading || !hasNext} onClick={() => setPage(page + 1)}>
                Дараах
              </button>
            </nav>
          </>
        )}
      </section>
    </main>
  );
}

export default function AdminPeoplePage() {
  const [hasFamilyParam, setHasFamilyParam] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return Boolean(new URLSearchParams(window.location.search).get('family'));
  });

  useEffect(() => {
    const sync = () => {
      setHasFamilyParam(Boolean(new URLSearchParams(window.location.search).get('family')));
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  if (hasFamilyParam) {
    return <FamilyAdminPeoplePage />;
  }
  return <GlobalAdminPeoplePage />;
}
