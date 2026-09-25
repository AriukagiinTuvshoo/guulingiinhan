'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  BookOpen,
  CalendarDays,
  Camera,
  ChevronDown,
  FileText,
  GitFork,
  Heart,
  Home,
  MapPin,
  Maximize,
  Menu,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Search,
  Settings,
  TreeDeciduous,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  API_BASE,
  api,
  Family,
  Person,
  PersonSearchPage,
  TreeData,
  User,
  personName,
} from '../../lib/api';

type DashboardPerson = Person & {
  generation: number;
};

type MemorySummary = {
  id: string;
  title: string;
  description: string | null;
  memory_date: string | null;
  visibility: string;
  person_ids: string[];
  person_names?: string[];
  created_at: string;
};

type MemoryDetail = MemorySummary & {
  photos?: {
    id: string;
    title: string | null;
    thumbnail_url: string;
    content_url: string;
    person_ids: string[];
  }[];
};

type ModalMode = 'add' | 'edit';

const nav = [
  ['Нүүр', Home],
  ['Ургийн мод', GitFork],
  ['Хүмүүс', Network],
  ['Storybook', BookOpen],
  ['Архив', Archive],
  ['Чат', MessageSquare],
  ['Календарь', CalendarDays],
  ['Газар зүй', MapPin],
  ['Тохиргоо', Settings],
] as const;

const positions = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12'] as const;

const slotPoints: Record<(typeof positions)[number], [number, number]> = {
  p1: [37, 11],
  p2: [66, 11],
  p3: [22, 35],
  p4: [39, 35],
  p5: [57, 35],
  p6: [74, 35],
  p7: [29, 63],
  p8: [62, 63],
  p9: [25, 88],
  p10: [43, 88],
  p11: [60, 88],
  p12: [78, 88],
};

const profileTabs = [
  ['Тойм', FileText],
  ['Намтар', BookOpen],
  ['Зураг', Camera],
  ['Бичиг', Archive],
] as const;

function initials(person: Pick<Person, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function displayName(person: Pick<Person, 'first_name' | 'last_name' | 'middle_name'>) {
  return personName(person) || 'Нэргүй хүн';
}

function visibilityLabel(value: string) {
  return value === 'private' ? 'Зөвхөн би' : value === 'public' ? 'Нийтийн' : 'Гэр бүлийнхэн';
}

function relativeGenerations(tree: TreeData, rootId: string | null): Map<string, number> {
  const levels = new Map<string, number>();
  if (!rootId) return levels;

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();

  for (const edge of tree.parent_child_relationships) {
    parents.set(edge.child_id, [...(parents.get(edge.child_id) ?? []), edge.parent_id]);
    children.set(edge.parent_id, [...(children.get(edge.parent_id) ?? []), edge.child_id]);
  }

  for (const marriage of tree.marriages) {
    spouses.set(marriage.person_1_id, [
      ...(spouses.get(marriage.person_1_id) ?? []),
      marriage.person_2_id,
    ]);
    spouses.set(marriage.person_2_id, [
      ...(spouses.get(marriage.person_2_id) ?? []),
      marriage.person_1_id,
    ]);
  }

  const queue: Array<[string, number]> = [[rootId, 2]];
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;

    const [personId, level] = current;
    if (levels.has(personId)) continue;

    levels.set(personId, Math.max(1, Math.min(4, level)));

    for (const parentId of parents.get(personId) ?? []) {
      if (!levels.has(parentId)) queue.push([parentId, level - 1]);
    }

    for (const childId of children.get(personId) ?? []) {
      if (!levels.has(childId)) queue.push([childId, level + 1]);
    }

    for (const spouseId of spouses.get(personId) ?? []) {
      if (!levels.has(spouseId)) queue.push([spouseId, level]);
    }
  }

  return levels;
}

function pickDashboardPeople(tree: TreeData, people: Person[], max = 12): DashboardPerson[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const rootId = tree.root_person_id ?? tree.persons[0]?.id ?? null;
  if (!rootId) return [];

  const levels = relativeGenerations(tree, rootId);
  const distance = new Map<string, number>([[rootId, 0]]);
  const adjacency = new Map<string, string[]>();

  for (const edge of tree.parent_child_relationships) {
    adjacency.set(edge.parent_id, [...(adjacency.get(edge.parent_id) ?? []), edge.child_id]);
    adjacency.set(edge.child_id, [...(adjacency.get(edge.child_id) ?? []), edge.parent_id]);
  }

  for (const marriage of tree.marriages) {
    adjacency.set(marriage.person_1_id, [
      ...(adjacency.get(marriage.person_1_id) ?? []),
      marriage.person_2_id,
    ]);
    adjacency.set(marriage.person_2_id, [
      ...(adjacency.get(marriage.person_2_id) ?? []),
      marriage.person_1_id,
    ]);
  }

  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;

    for (const next of adjacency.get(current) ?? []) {
      if (!distance.has(next)) {
        distance.set(next, (distance.get(current) ?? 0) + 1);
        queue.push(next);
      }
    }
  }

  const treeIds = tree.persons.map((person) => person.id);
  const orderedIds = [...new Set(treeIds)]
    .filter((id) => byId.has(id))
    .sort((a, b) => (distance.get(a) ?? 999) - (distance.get(b) ?? 999));

  const selectedIds = new Set(orderedIds.slice(0, max));
  if (!selectedIds.has(rootId) && byId.has(rootId)) selectedIds.add(rootId);

  return [...selectedIds]
    .map((id) => {
      const person = byId.get(id);
      return person ? { ...person, generation: levels.get(id) ?? 2 } : null;
    })
    .filter((person): person is DashboardPerson => Boolean(person))
    .sort(
      (a, b) =>
        a.generation - b.generation ||
        (distance.get(a.id) ?? 999) - (distance.get(b.id) ?? 999),
    )
    .slice(0, max);
}

function ConnectorLayer({
  tree,
  visiblePeople,
}: {
  tree: TreeData;
  visiblePeople: DashboardPerson[];
}) {
  const slotById = new Map(
    visiblePeople.map((person, index) => [person.id, positions[index] ?? positions[0]]),
  );

  const point = (position: (typeof positions)[number]) => {
    const [x, y] = slotPoints[position];
    return { x: (x / 100) * 950, y: (y / 100) * 640 };
  };

  return (
    <svg className="connectors" viewBox="0 0 950 640" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="#d0ac56" strokeWidth="2">
        {tree.parent_child_relationships.map((edge) => {
          const parentPosition = slotById.get(edge.parent_id);
          const childPosition = slotById.get(edge.child_id);
          if (!parentPosition || !childPosition) return null;

          const start = point(parentPosition);
          const end = point(childPosition);
          const middleY = (start.y + end.y) / 2;

          return (
            <path
              key={edge.id}
              d={
                'M ' +
                start.x +
                ' ' +
                start.y +
                ' C ' +
                start.x +
                ' ' +
                middleY +
                ', ' +
                end.x +
                ' ' +
                middleY +
                ', ' +
                end.x +
                ' ' +
                end.y
              }
            />
          );
        })}
      </g>

      <g fill="none" stroke="#e7cd78" strokeWidth="2" strokeDasharray="5 4">
        {tree.marriages.map((marriage) => {
          const firstPosition = slotById.get(marriage.person_1_id);
          const secondPosition = slotById.get(marriage.person_2_id);
          if (!firstPosition || !secondPosition) return null;

          const start = point(firstPosition);
          const end = point(secondPosition);

          return (
            <g key={'marriage-' + marriage.id}>
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
              <circle
                cx={(start.x + end.x) / 2}
                cy={(start.y + end.y) / 2}
                r="5"
                fill="#d0ac56"
                stroke="none"
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [tree, setTree] = useState<TreeData>({
    persons: [],
    parent_child_relationships: [],
    marriages: [],
  });
  const [people, setPeople] = useState<Person[]>([]);
  const [memories, setMemories] = useState<MemorySummary[]>([]);
  const [memoryDetails, setMemoryDetails] = useState<Record<string, MemoryDetail>>({});
  const [photosByPerson, setPhotosByPerson] = useState<Record<string, string[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PersonSearchPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [menu, setMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState('Тойм');
  const [biography, setBiography] = useState('');
  const [biographyLoading, setBiographyLoading] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);

  const familyIdFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('family') ?? '';
  }, []);

  const loadDashboard = useCallback(async (familyId: string, personId?: string) => {
    setError('');

    const queryParams = new URLSearchParams({ depth: '5' });
    if (personId) queryParams.set('person_id', personId);

    const [familyData, treeData, personData, memoryData] = await Promise.all([
      api<Family>('/families/' + familyId),
      api<TreeData>('/families/' + familyId + '/tree?' + queryParams.toString()),
      api<Person[]>('/families/' + familyId + '/persons'),
      api<MemorySummary[]>('/families/' + familyId + '/memories'),
    ]);

    setFamily(familyData);
    setTree(treeData);
    setPeople(personData);
    setMemories(memoryData.slice(0, 4));

    const availableIds = new Set(treeData.persons.map((person) => person.id));
    const preferredId = personId ?? treeData.root_person_id ?? treeData.persons[0]?.id ?? null;
    const nextSelected =
      preferredId && availableIds.has(preferredId)
        ? preferredId
        : treeData.persons[0]?.id ?? null;

    setSelectedId(nextSelected);
    setTab('Тойм');
    setBiography('');
    setPhotosByPerson({});

    const photoEntries = await Promise.all(
      treeData.persons.slice(0, 12).map(async (treePerson) => {
        try {
          const result = await api<{ items: { id: string; thumbnail_url: string }[] }>(
            '/families/' +
              familyId +
              '/persons/' +
              treePerson.id +
              '/photos?page=1&page_size=25',
          );
          return [treePerson.id, result.items.map((item) => item.thumbnail_url)] as const;
        } catch {
          return [treePerson.id, []] as const;
        }
      }),
    );
    setPhotosByPerson(Object.fromEntries(photoEntries));

    if (memoryData.length) {
      const detailEntries = await Promise.all(
        memoryData.slice(0, 4).map(async (memory) => {
          try {
            const detail = await api<MemoryDetail>(
              '/families/' + familyId + '/memories/' + memory.id,
            );
            return [memory.id, detail] as const;
          } catch {
            return [memory.id, memory] as const;
          }
        }),
      );
      setMemoryDetails(Object.fromEntries(detailEntries));
    } else {
      setMemoryDetails({});
    }

    return treeData;
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoading(true);
      setError('');

      try {
        const [me, familyList] = await Promise.all([
          api<User>('/auth/me'),
          api<Family[]>('/families'),
        ]);

        if (!active) return;

        setUser(me);
        setFamilies(familyList);

        if (!familyList.length) {
          setFamily(null);
          setTree({ persons: [], parent_child_relationships: [], marriages: [] });
          setPeople([]);
          setMemories([]);
          return;
        }

        const requestedFamily = familyList.find((item) => item.id === familyIdFromUrl);
        const nextFamily = requestedFamily ?? familyList[0];
        const preferredPerson =
          requestedFamily && me.person_id ? me.person_id : undefined;

        await loadDashboard(nextFamily.id, preferredPerson);

        if (active && !familyIdFromUrl) {
          window.history.replaceState(
            null,
            '',
            '/dashboard?family=' + encodeURIComponent(nextFamily.id),
          );
        }
      } catch (cause) {
        if (!active) return;

        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
        } else {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Гэр бүлийн мэдээллийг ачаалж чадсангүй.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [familyIdFromUrl, loadDashboard, router]);

  useEffect(() => {
    if (!family?.id || !query.trim()) {
      setSearchResults(null);
      setSearchBusy(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setSearchBusy(true);
      api<PersonSearchPage>(
        '/families/' +
          family.id +
          '/persons/search?q=' +
          encodeURIComponent(query.trim()) +
          '&page=1&page_size=25',
      )
        .then(setSearchResults)
        .catch((cause) =>
          setError(cause instanceof Error ? cause.message : 'Хайлт хийхэд алдаа гарлаа.'),
        )
        .finally(() => setSearchBusy(false));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [family?.id, query]);

  useEffect(() => {
    if (!family?.id || !selectedId) return;

    let active = true;
    setBiographyLoading(true);

    api<{ content: string }>(
      '/families/' + family.id + '/persons/' + selectedId + '/biography',
    )
      .then((result) => {
        if (active) setBiography(result.content);
      })
      .catch(() => {
        if (active) setBiography('');
      })
      .finally(() => {
        if (active) setBiographyLoading(false);
      });

    return () => {
      active = false;
    };
  }, [family?.id, selectedId]);

  const visiblePeople = useMemo(
    () => pickDashboardPeople(tree, people, 12),
    [tree, people],
  );

  const selected = useMemo(
    () => people.find((person) => person.id === selectedId) ?? null,
    [people, selectedId],
  );

  const maxGeneration = useMemo(
    () => Math.max(...visiblePeople.map((person) => person.generation), 1),
    [visiblePeople],
  );

  const activeMarriageCount = useMemo(
    () => tree.marriages.filter((marriage) => marriage.status === 'married').length,
    [tree.marriages],
  );

  const visibleSelectedPhoto = selectedId
    ? photosByPerson[selectedId]?.[0]
    : undefined;

  function choosePerson(personId: string) {
    setSelectedId(personId);
    setQuery('');
    setSearchResults(null);
    setTab('Тойм');
  }

  async function selectSearchResult(personId: string) {
    if (!family) return;

    setRefreshing(true);
    setError('');

    try {
      await loadDashboard(family.id, personId);
      setQuery('');
      setSearchResults(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
      } else {
        setError(
          cause instanceof Error ? cause.message : 'Хүний мэдээллийг нээж чадсангүй.',
        );
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function submitPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!family || !selected) return;

    const form = new FormData(event.currentTarget);
    setRefreshing(true);
    setError('');

    try {
      if (modal === 'edit') {
        const updated = await api<Person>(
          '/families/' + family.id + '/persons/' + selected.id,
          {
            method: 'PATCH',
            body: JSON.stringify({
              first_name: String(form.get('first_name') ?? '').trim(),
              last_name: String(form.get('last_name') ?? '').trim(),
              gender: String(form.get('gender') ?? 'unknown'),
              birth_date: form.get('birth_date') || null,
              birth_place: form.get('birth_place') || null,
              is_alive: form.get('is_alive') === 'true',
              death_date: form.get('death_date') || null,
              death_place: form.get('death_place') || null,
              visibility: String(form.get('visibility') ?? 'family'),
            }),
          },
        );

        await loadDashboard(family.id, updated.id);
        setNotice('Хүний мэдээлэл шинэчлэгдлээ.');
      } else {
        const fullName = String(form.get('name') ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const relation = String(form.get('relation') ?? '');

        if (!fullName.length || !relation) return;

        const created = await api<Person>(
          '/families/' + family.id + '/persons',
          {
            method: 'POST',
            body: JSON.stringify({
              first_name: fullName.at(-1) ?? '',
              last_name: fullName.slice(0, -1).join(' '),
              gender: form.get('gender') || 'unknown',
              birth_date: form.get('birth_date') || null,
              visibility: 'family',
            }),
          },
        );

        if (relation === 'spouse') {
          await api(
            '/families/' + family.id + '/marriages',
            {
              method: 'POST',
              body: JSON.stringify({
                person_1_id: selected.id,
                person_2_id: created.id,
                status: 'married',
                start_date: form.get('start_date') || null,
              }),
            },
          );
        } else {
          await api(
            '/families/' + family.id + '/relationships/parent-child',
            {
              method: 'POST',
              body: JSON.stringify({
                parent_id: relation === 'parent' ? created.id : selected.id,
                child_id: relation === 'parent' ? selected.id : created.id,
                relationship_type: form.get('relationship_type') || 'biological',
              }),
            },
          );
        }

        await loadDashboard(family.id, selected.id);
        setSelectedId(created.id);
        setNotice('Хүн ургийн модонд нэмэгдлээ.');
      }

      setModal(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
      } else {
        setError(cause instanceof Error ? cause.message : 'Мэдээллийг хадгалж чадсангүй.');
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
      router.replace('/login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Гарах үед алдаа гарлаа.');
    }
  }

  if (loading) {
    return (
      <main className="mvp">
        <section className="mvpbox" style={{ maxWidth: 760 }}>
          Гэр бүлийн мэдээллийг ачаалж байна…
        </section>
      </main>
    );
  }

  if (error && !family && !families.length) {
    return (
      <main className="mvp">
        <section className="mvpbox" style={{ maxWidth: 760 }}>
          <div className="error" role="alert">{error}</div>
          <Link className="button" href="/login" style={{ marginTop: 16 }}>Нэвтрэх</Link>
        </section>
      </main>
    );
  }

  if (!families.length) {
    return (
      <main className="mvp">
        <section className="mvpbox" style={{ maxWidth: 760 }}>
          <Link href="/families">← Гэр бүлүүд</Link>
          <h1 style={{ marginTop: 22 }}>Ургийн модоо эхлүүлээрэй</h1>
          <p>Танд одоогоор гэр бүл үүсээгүй байна. Эхлээд гэр бүлээ үүсгээд өөрийгөө нэмнэ.</p>
          <Link className="button" href="/onboarding">Гэр бүл үүсгэх</Link>
        </section>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="hamb"
          onClick={() => setMobileNav((value) => !value)}
          aria-label="Цэс"
        >
          <Menu />
        </button>

        <div className="brand">
          <div className="brandmark"><TreeDeciduous /></div>
          <div>
            <div className="brandname">ГУУЛИНГИЙНХАН</div>
            <small>Миний удам · Манай түүх · Ирээдүйд өвлүүлнэ</small>
          </div>
        </div>

        <div className="auth-shortcuts">
          <Link href="/families">Гэр бүлүүд</Link>
        </div>

        <div className="searchbox">
          <Search size={19} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Хүн, овог, газар, он, баримтаар хайх..."
            aria-label="Гэр бүлийн хүн хайх"
          />

          {query && (
            <button onClick={() => setQuery('')} aria-label="Хайлтыг арилгах">
              <X size={15} />
            </button>
          )}

          {query && (
            <div className="searchresults">
              {searchBusy ? (
                <span className="noresult">Хайж байна…</span>
              ) : searchResults?.items.length ? (
                searchResults.items.map((result) => (
                  <button key={result.id} onClick={() => void selectSearchResult(result.id)}>
                    <span className="personavatar small">
                      {result.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      {result.name}
                      <small>{result.birth_year ?? '—'}</small>
                    </span>
                  </button>
                ))
              ) : (
                <span className="noresult">
                  {searchResults ? 'Хүн олдсонгүй' : 'Нэрээр хайж байна…'}
                </span>
              )}
            </div>
          )}
        </div>

        <button
          className="iconbutton notify"
          onClick={() => setNotice('Одоогоор шинэ мэдэгдэл алга')}
          aria-label="Мэдэгдэл"
        >
          <Bell size={19} />
        </button>

        <button
          className="userpill"
          onClick={() => setMenu((value) => !value)}
          aria-label="Хэрэглэгчийн цэс"
        >
          <span className="personavatar tiny">
            {user ? initials({ first_name: user.display_name, last_name: '' }) : '?'}
          </span>
          <span>{user?.display_name ?? 'Хэрэглэгч'}</span>
          <ChevronDown size={15} />
        </button>

        {menu && (
          <div className="usermenu">
            <strong>{user?.display_name ?? 'Хэрэглэгч'}</strong>
            <button
              onClick={() => {
                setMenu(false);
                if (user?.person_id) choosePerson(user.person_id);
              }}
            >
              Миний профайл
            </button>
            <Link href="/families" onClick={() => setMenu(false)}>Гэр бүлүүд</Link>
            <button onClick={() => void logout()}>Гарах</button>
          </div>
        )}
      </header>

      <div className="layout">
        <aside className={'sidebar ' + (mobileNav ? 'show' : '')}>
          <div className="sideitems">
            {nav.map(([label, Icon]) => (
              <button
                key={label}
                className={label === 'Ургийн мод' ? 'active' : ''}
                onClick={() => {
                  setMobileNav(false);
                  if (label !== 'Ургийн мод') {
                    setNotice(label + ' хэсэг тун удахгүй');
                  }
                }}
              >
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="sidequote">
            Өнгөрсөн түүхээ<br />
            танин мэдэж, өнөөдрийн<br />
            дурсамжаа ирээдүйд<br />
            өвлүүлэн үлдээе.
            <b>⌁</b>
          </div>
        </aside>

        <main className="main">
          <section className="treepanel">
            <div className="treehead">
              <div className="tree-title">
                <div className="brandmark small"><TreeDeciduous /></div>
                <div>
                  <h1>Ургийн мод</h1>
                  <span>
                    {maxGeneration} үе · {tree.persons.length} хүн · {activeMarriageCount} гэрлэлт
                  </span>
                </div>
              </div>

              <div className="viewtabs">
                <button className="sel">3D харагдац</button>
                <button onClick={() => setNotice('Жагсаалтын харагдац удахгүй')}>Жагсаалт</button>
                <i />
                <button onClick={() => setNotice('Таймлайн харагдац удахгүй')}>Таймлайн</button>
              </div>

              <div className="treecontrols">
                <button onClick={() => setNotice('Үе сонголтыг дараагийн шатанд өргөтгөнө')}>
                  {['I', 'II', 'III', 'IV'][Math.min(maxGeneration - 1, 3)]} үе
                  <ChevronDown size={14} />
                </button>
                <div>
                  <button onClick={() => setZoom((value) => Math.max(.75, value - .1))}>
                    <Minus />
                  </button>
                  <button onClick={() => setZoom((value) => Math.min(1.3, value + .1))}>
                    <Plus />
                  </button>
                  <button onClick={() => setZoom(1)}>
                    <Maximize />
                  </button>
                </div>
              </div>
            </div>

            {error && <div className="error" role="alert" style={{ margin: 10 }}>{error}</div>}

            {!tree.persons.length ? (
              <div className="treecanvas empty-tree">
                <div className="empty-tree-card">
                  <TreeDeciduous size={42} />
                  <h2>Одоогоор хүн нэмэгдээгүй байна</h2>
                  <p>Гэр бүлийн модоо эхлүүлэхийн тулд өөрийгөө эсвэл анхны гэр бүлийн гишүүнээ нэмнэ үү.</p>
                  <Link className="button" href="/onboarding">Ургийн модоо эхлүүлэх</Link>
                </div>
              </div>
            ) : (
              <div className="treecanvas">
                <div className="scenery" />
                <div className="forest" />

                <div className="treeworld" style={{ transform: 'scale(' + zoom + ')' }}>
                  <ConnectorLayer tree={tree} visiblePeople={visiblePeople} />

                  {visiblePeople.map((person, index) => {
                    const photo = photosByPerson[person.id]?.[0];
                    const isSelected = selectedId === person.id;
                    return (
                      <button
                        key={person.id}
                        className={
                          'personnode ' +
                          (positions[index] ?? positions[0]) +
                          (isSelected ? ' chosen' : '')
                        }
                        onClick={() => choosePerson(person.id)}
                      >
                        {photo ? (
                          <img
                            src={API_BASE + photo}
                            alt=""
                            crossOrigin="use-credentials"
                          />
                        ) : (
                          <span className="personavatar">{initials(person)}</span>
                        )}
                        <strong>{displayName(person)}</strong>
                        <span>
                          {person.birth_date?.slice(0, 4) ?? '—'}{' '}
                          {person.is_alive
                            ? '–'
                            : '– ' + (person.death_date?.slice(0, 4) ?? '?')}
                        </span>
                        <i>
                          {['I үе', 'II үе', 'III үе', 'IV үе'][Math.min(person.generation - 1, 3)]}
                        </i>
                      </button>
                    );
                  })}
                </div>

                <div className="zoomdock">
                  <button onClick={() => setZoom(1)}><MapPin /></button>
                  <button onClick={() => setZoom((value) => Math.min(1.3, value + .1))}>+</button>
                  <button onClick={() => setZoom((value) => Math.max(.75, value - .1))}>−</button>
                  <button onClick={() => setZoom(1)}><Maximize /></button>
                </div>

                <div className="generationbar">
                  <span>Үеийн сонголт:</span>
                  {['X', 'IX', 'VIII', 'VII', 'VI', 'V', 'IV', 'III', 'II', 'I'].map(
                    (generation) => (
                      <button
                        key={generation}
                        className={generation === 'VII' ? 'selected' : ''}
                        onClick={() =>
                          setNotice(
                            generation + ' үеийн харагдацын шүүлтүүр дараагийн шатанд',
                          )
                        }
                      >
                        {generation}
                      </button>
                    ),
                  )}
                  <span className="range">
                    Өнгөрсөн <input type="range" aria-label="Үеийн хязгаар" /> Ирээдүй →
                  </span>
                </div>
              </div>
            )}

            <section className="bottomrow">
              <div className="recent">
                <div className="sectiontop">
                  <h3>Сүүлд нэмэгдсэн дурсамж</h3>
                  <Link href={family ? '/memories?family=' + family.id : '/memories'}>
                    Бүгдийг харах →
                  </Link>
                </div>

                <div className="memorycards">
                  {memories.length ? (
                    memories.map((memory) => {
                      const detail = memoryDetails[memory.id];
                      const photo = detail?.photos?.[0]?.thumbnail_url;

                      return (
                        <button
                          className="memory"
                          key={memory.id}
                          onClick={() =>
                            router.push(
                              family ? '/memories?family=' + family.id : '/memories',
                            )
                          }
                        >
                          {photo ? (
                            <img
                              src={API_BASE + photo}
                              alt=""
                              crossOrigin="use-credentials"
                            />
                          ) : (
                            <div className="memoryplaceholder">
                              <BookOpen size={22} />
                            </div>
                          )}
                          <strong>{memory.title}</strong>
                          <small>◷ {memory.memory_date ?? 'Огноогүй'}</small>
                        </button>
                      );
                    })
                  ) : (
                    <div className="empty-memory">
                      Одоогоор хадгалсан дурсамж алга.
                    </div>
                  )}
                </div>
              </div>

              <div className="addcall">
                <TreeDeciduous />
                <p>
                  {selected
                    ? '“' + displayName(selected) + '” дээрээс гэр бүлийн холбоогоо үргэлжлүүлээрэй.'
                    : 'Гэр бүлийн модоо өөрийн бодит мэдээллээр эхлүүлээрэй.'}
                </p>
                <button
                  onClick={() => setModal('add')}
                  disabled={!selected || refreshing}
                >
                  Шинэ хүн нэмэх <Plus size={15} />
                </button>
              </div>

              <div className="promo">
                <div className="promo-placeholder">
                  <TreeDeciduous size={38} />
                  <span>Ургийн мод</span>
                  <small>үеийн үед ургасаар...</small>
                </div>
              </div>
            </section>
          </section>
        </main>

        <aside className="profile">
          <div className="profiletop">
            <button
              className="dots"
              onClick={() => setNotice('Нэмэлт үйлдлүүд дараагийн шатанд')}
              aria-label="Нэмэлт үйлдэл"
            >
              <MoreHorizontal />
            </button>

            {selected ? (
              <>
                <div className="identity">
                  {visibleSelectedPhoto ? (
                    <img
                      src={API_BASE + visibleSelectedPhoto}
                      alt=""
                      crossOrigin="use-credentials"
                    />
                  ) : (
                    <span className="personavatar large">{initials(selected)}</span>
                  )}

                  <div>
                    <h2>
                      {displayName(selected)}
                      <button
                        onClick={() => setModal('edit')}
                        aria-label="Хүний мэдээлэл засах"
                      >
                        <Pencil size={13} />
                      </button>
                    </h2>

                    <span>
                      {selected.birth_date?.slice(0, 4) ?? 'Төрсөн он тодорхойгүй'}{' '}
                      {selected.is_alive
                        ? '–'
                        : '– ' + (selected.death_date?.slice(0, 4) ?? '?')}
                    </span>

                    <i>
                      {[
                        'I үе',
                        'II үе',
                        'III үе',
                        'IV үе',
                      ][
                        Math.min(
                          (visiblePeople.find((person) => person.id === selected.id)?.generation ??
                            2) - 1,
                          3,
                        )
                      ]}
                    </i>

                    <div className="tags">
                      <b>
                        {selected.gender === 'male'
                          ? 'Эрэгтэй'
                          : selected.gender === 'female'
                            ? 'Эмэгтэй'
                            : 'Тодорхойгүй'}
                      </b>
                      <b>{selected.is_alive ? 'Амьд' : 'Нас барсан'}</b>
                      <b>{visibilityLabel(selected.visibility)}</b>
                    </div>
                  </div>
                </div>

                <div className="ptabs">
                  {profileTabs.map(([label, Icon]) => (
                    <button
                      key={label}
                      className={tab === label ? 'on' : ''}
                      onClick={() => setTab(label)}
                    >
                      <Icon size={17} />
                      {label}
                    </button>
                  ))}
                </div>

                {tab === 'Тойм' && (
                  <div className="facts">
                    <div>
                      <CalendarDays />
                      <span>Төрсөн он</span>
                      <strong>{selected.birth_date?.slice(0, 4) ?? '—'}</strong>
                    </div>
                    <div>
                      <MapPin />
                      <span>Төрсөн газар</span>
                      <strong>{selected.birth_place ?? 'Тодорхойгүй'}</strong>
                    </div>
                    <div>
                      <Users />
                      <span>Эцэг/эх</span>
                      <strong>
                        {
                          tree.parent_child_relationships.filter(
                            (edge) => edge.child_id === selected.id,
                          ).length
                        }
                      </strong>
                    </div>
                    <div>
                      <Heart />
                      <span>Хань</span>
                      <strong>
                        {
                          tree.marriages.filter(
                            (marriage) =>
                              marriage.person_1_id === selected.id ||
                              marriage.person_2_id === selected.id,
                          ).length
                        }
                      </strong>
                    </div>
                    <div>
                      <Users />
                      <span>Хүүхэд</span>
                      <strong>
                        {
                          tree.parent_child_relationships.filter(
                            (edge) => edge.parent_id === selected.id,
                          ).length
                        }
                      </strong>
                    </div>
                    <div>
                      <MapPin />
                      <span>Харагдах байдал</span>
                      <strong>{visibilityLabel(selected.visibility)}</strong>
                    </div>
                  </div>
                )}

                {tab === 'Намтар' && (
                  <div className="biography">
                    <h3>Товч намтар</h3>
                    {biographyLoading ? (
                      <p>Намтрыг ачаалж байна…</p>
                    ) : (
                      <p>
                        {biography || 'Энэ хүний намтрыг хараахан оруулаагүй байна.'}
                      </p>
                    )}
                    <Link
                      className="button"
                      href={
                        family
                          ? '/profile?family=' + family.id + '&person=' + selected.id
                          : '/profile'
                      }
                    >
                      Намтар засах <Pencil size={14} />
                    </Link>
                  </div>
                )}

                {tab === 'Зураг' && (
                  <div className="biography">
                    {visibleSelectedPhoto ? (
                      <img
                        className="profilephoto"
                        src={API_BASE + visibleSelectedPhoto}
                        alt=""
                        crossOrigin="use-credentials"
                      />
                    ) : (
                      <span className="personavatar photo-empty">{initials(selected)}</span>
                    )}
                    <p>
                      {photosByPerson[selected.id]?.length
                        ? photosByPerson[selected.id].length +
                          ' хүртэлх зураг харагдаж байна.'
                        : 'Энэ хүний харагдах зураг одоогоор алга.'}
                    </p>
                    <Link
                      className="button"
                      href={family ? '/memories?family=' + family.id : '/memories'}
                    >
                      Дурсамжийн зураг үзэх <Camera size={14} />
                    </Link>
                  </div>
                )}

                {tab === 'Бичиг' && (
                  <div className="biography">
                    <p>Холбоотой архивын баримт одоогоор алга.</p>
                    <button
                      onClick={() =>
                        setNotice('Архивын баримтын модуль дараагийн шатанд')
                      }
                    >
                      Баримт нэмэх <Plus size={14} />
                    </button>
                  </div>
                )}

                <Link
                  className="profilelink"
                  href={
                    family
                      ? '/profile?family=' + family.id + '&person=' + selected.id
                      : '/profile'
                  }
                >
                  Дэлгэрэнгүй профайл <span>→</span>
                </Link>

                <div className="stats">
                  <div>
                    <Camera />
                    <b>{photosByPerson[selected.id]?.length ?? 0}</b>
                    <span>Зураг</span>
                  </div>
                  <div>
                    <FileText />
                    <b>0</b>
                    <span>Түүх</span>
                  </div>
                  <div>
                    <BookOpen />
                    <b>0</b>
                    <span>Видео</span>
                  </div>
                  <div>
                    <Heart />
                    <b>0</b>
                    <span>Дуу</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-profile">
                <Users size={36} />
                <p>Сонгосон хүн алга.</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {notice && (
        <div className="toast">
          {notice}
          <button onClick={() => setNotice('')} aria-label="Мэдэгдлийг хаах">
            <X size={14} />
          </button>
        </div>
      )}

      {modal && selected && (
        <div
          className="overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <form className="modal" onSubmit={submitPerson}>
            <button
              type="button"
              className="close"
              onClick={() => setModal(null)}
              aria-label="Хаах"
            >
              <X />
            </button>

            <div className="brandmark"><TreeDeciduous /></div>

            <h2>
              {modal === 'edit' ? 'Хүний мэдээлэл засах' : 'Ургийн модонд хүн нэмэх'}
            </h2>

            <p>
              {modal === 'edit'
                ? 'Одоо байгаа бодит мэдээллийг шинэчилнэ.'
                : displayName(selected) + '-тай холбоог сонгоно уу.'}
            </p>

            {modal === 'add' ? (
              <>
                <label>
                  Холбоо
                  <select name="relation" defaultValue="child">
                    <option value="child">Хүүхэд</option>
                    <option value="parent">Эцэг эх</option>
                    <option value="spouse">Хань</option>
                  </select>
                </label>

                <label>
                  Холбооны төрөл
                  <select name="relationship_type" defaultValue="biological">
                    <option value="biological">Төрсөн</option>
                    <option value="adoptive">Үрчилсэн</option>
                  </select>
                </label>

                <label>
                  Овог, нэр
                  <input
                    name="name"
                    required
                    maxLength={360}
                    placeholder="Жишээ: Доржийн Бат"
                  />
                </label>

                <label>
                  Төрсөн огноо
                  <input name="birth_date" type="date" />
                </label>

                <label>
                  Хүйс
                  <select name="gender" defaultValue="unknown">
                    <option value="unknown">Тодорхойгүй</option>
                    <option value="male">Эрэгтэй</option>
                    <option value="female">Эмэгтэй</option>
                    <option value="other">Бусад</option>
                  </select>
                </label>

                <label>
                  Гэрлэсэн огноо
                  <input name="start_date" type="date" />
                </label>
              </>
            ) : (
              <>
                <label>
                  Нэр
                  <input
                    name="first_name"
                    required
                    maxLength={120}
                    defaultValue={selected.first_name}
                  />
                </label>

                <label>
                  Овог
                  <input
                    name="last_name"
                    maxLength={120}
                    defaultValue={selected.last_name}
                  />
                </label>

                <label>
                  Төрсөн огноо
                  <input
                    name="birth_date"
                    type="date"
                    defaultValue={selected.birth_date ?? ''}
                  />
                </label>

                <label>
                  Төрсөн газар
                  <input
                    name="birth_place"
                    maxLength={240}
                    defaultValue={selected.birth_place ?? ''}
                  />
                </label>

                <label>
                  Хүйс
                  <select name="gender" defaultValue={selected.gender}>
                    <option value="unknown">Тодорхойгүй</option>
                    <option value="male">Эрэгтэй</option>
                    <option value="female">Эмэгтэй</option>
                    <option value="other">Бусад</option>
                  </select>
                </label>

                <label>
                  Амьд эсэх
                  <select name="is_alive" defaultValue={String(selected.is_alive)}>
                    <option value="true">Амьд</option>
                    <option value="false">Нас барсан</option>
                  </select>
                </label>

                <label>
                  Нас барсан огноо
                  <input
                    name="death_date"
                    type="date"
                    defaultValue={selected.death_date ?? ''}
                  />
                </label>

                <label>
                  Нас барсан газар
                  <input
                    name="death_place"
                    maxLength={240}
                    defaultValue={selected.death_place ?? ''}
                  />
                </label>

                <label>
                  Нууцлал
                  <select name="visibility" defaultValue={selected.visibility}>
                    <option value="private">Зөвхөн би</option>
                    <option value="family">Гэр бүлийнхэн</option>
                    <option value="public">Нийтийн</option>
                  </select>
                </label>
              </>
            )}

            <button className="submit" disabled={refreshing}>
              {refreshing
                ? 'Хадгалж байна…'
                : modal === 'edit'
                  ? 'Мэдээлэл хадгалах'
                  : 'Нэмэх'}
              <Plus size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
