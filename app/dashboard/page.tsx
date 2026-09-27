'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BookOpen,
  GitFork,
  Heart,
  Search,
  TreeDeciduous,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  api,
  ArchiveListPage,
  Family,
  Marriage,
  MemoryListItem,
  Person,
  PersonSearchPage,
  StoryListPage,
  TreeData,
  TreePerson,
  User,
  personName,
} from '../../lib/api';

type TreeNode = {
  id: string;
  person: TreePerson;
  generation: number;
  parents: string[];
  children: string[];
  spouses: string[];
};

type PreviewTree = {
  rootId: string | null;
  nodes: Map<string, TreeNode>;
  marriages: Marriage[];
};

type ActivityItem =
  | { kind: 'story'; id: string; title: string; date: string; meta: string }
  | { kind: 'memory'; id: string; title: string; date: string; meta: string }
  | { kind: 'archive'; id: string; title: string; date: string; meta: string };


const previewSlots = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'] as const;

const previewPoints: Record<(typeof previewSlots)[number], [number, number]> = {
  p1: [24, 10],
  p2: [64, 10],
  p3: [14, 35],
  p4: [42, 35],
  p5: [70, 35],
  p6: [35, 56],
  p7: [58, 56],
  p8: [22, 81],
  p9: [46, 81],
  p10: [70, 81],
};

function initials(person: Pick<Person, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function fullName(person: Pick<Person, 'first_name' | 'last_name' | 'middle_name'>) {
  return personName(person) || 'Нэргүй хүн';
}

function generationLabel(generation: number) {
  if (generation === 0) return 'Төв хүн';
  if (generation < 0) return Math.abs(generation) + ' үеийн өмнө';
  return generation + ' үеийн үргэлжлэл';
}

function buildPreviewTree(tree: TreeData, preferredRootId: string | null): PreviewTree {
  const personById = new Map<string, TreePerson>();
  for (const person of tree.persons) personById.set(person.id, person);

  const nodes = new Map<string, TreeNode>();
  for (const person of personById.values()) {
    nodes.set(person.id, {
      id: person.id,
      person,
      generation: 0,
      parents: [],
      children: [],
      spouses: [],
    });
  }

  const marriages = tree.marriages.filter(
    (marriage) => personById.has(marriage.person_1_id) && personById.has(marriage.person_2_id),
  );

  for (const edge of tree.parent_child_relationships) {
    if (!nodes.has(edge.parent_id) || !nodes.has(edge.child_id)) continue;
    nodes.get(edge.parent_id)?.children.push(edge.child_id);
    nodes.get(edge.child_id)?.parents.push(edge.parent_id);
  }

  for (const marriage of marriages) {
    nodes.get(marriage.person_1_id)?.spouses.push(marriage.person_2_id);
    nodes.get(marriage.person_2_id)?.spouses.push(marriage.person_1_id);
  }

  const rootId =
    (preferredRootId && nodes.has(preferredRootId) ? preferredRootId : null) ??
    (tree.root_person_id && nodes.has(tree.root_person_id) ? tree.root_person_id : null) ??
    [...nodes.keys()][0] ??
    null;

  if (!rootId) return { rootId: null, nodes, marriages };

  nodes.get(rootId)!.generation = 0;
  const queue = [rootId];
  const seen = new Set([rootId]);

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) break;
    const current = nodes.get(currentId);
    if (!current) continue;

    for (const parentId of current.parents) {
      const parent = nodes.get(parentId);
      if (!parent) continue;
      parent.generation = Math.min(parent.generation, current.generation - 1);
      if (!seen.has(parentId)) {
        seen.add(parentId);
        queue.push(parentId);
      }
    }

    for (const spouseId of current.spouses) {
      const spouse = nodes.get(spouseId);
      if (!spouse) continue;
      spouse.generation = current.generation;
      if (!seen.has(spouseId)) {
        seen.add(spouseId);
        queue.push(spouseId);
      }
    }

    for (const childId of current.children) {
      const child = nodes.get(childId);
      if (!child) continue;
      child.generation = Math.max(child.generation, current.generation + 1);
      if (!seen.has(childId)) {
        seen.add(childId);
        queue.push(childId);
      }
    }
  }

  return { rootId, nodes, marriages };
}

function treeDistance(tree: PreviewTree) {
  const distance = new Map<string, number>();
  if (!tree.rootId) return distance;
  distance.set(tree.rootId, 0);
  const queue = [tree.rootId];

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) break;
    const current = tree.nodes.get(currentId);
    if (!current) continue;

    const nextIds = [...current.parents, ...current.children, ...current.spouses];
    for (const nextId of nextIds) {
      if (!distance.has(nextId)) {
        distance.set(nextId, (distance.get(currentId) ?? 0) + 1);
        queue.push(nextId);
      }
    }
  }

  return distance;
}

function pickPreviewPeople(tree: PreviewTree, max = 10) {
  if (!tree.rootId) return [];
  const distance = treeDistance(tree);
  const root = tree.nodes.get(tree.rootId);
  if (!root) return [];

  const ids = new Set<string>([
    tree.rootId,
    ...root.parents,
    ...root.spouses,
    ...root.children,
  ]);

  [...tree.nodes.keys()]
    .sort((a, b) => {
      const da = distance.get(a) ?? Number.POSITIVE_INFINITY;
      const db = distance.get(b) ?? Number.POSITIVE_INFINITY;
      return da - db || a.localeCompare(b);
    })
    .forEach((id) => {
      if (ids.size < max) ids.add(id);
    });

  return [...ids]
    .map((id) => tree.nodes.get(id))
    .filter((node): node is TreeNode => Boolean(node))
    .sort((a, b) => {
      if (a.generation !== b.generation) return a.generation - b.generation;
      if (a.id === tree.rootId) return -1;
      if (b.id === tree.rootId) return 1;
      return a.person.id.localeCompare(b.person.id);
    })
    .slice(0, max);
}

function assignSlots(nodes: TreeNode[]) {
  const result = new Map<string, (typeof previewSlots)[number]>();
  const used = new Set<string>();

  const preferred = (node: TreeNode) => {
    if (node.id === nodes.find((item) => item.id === node.id)?.id && node.generation === 0) {
      return ['p6', 'p7', ...previewSlots];
    }
    if (node.generation < 0) return ['p1', 'p2', 'p3', 'p4', ...previewSlots];
    if (node.generation > 0) return ['p8', 'p9', 'p10', 'p7', ...previewSlots];
    return ['p5', 'p6', 'p7', ...previewSlots];
  };

  for (const node of nodes) {
    const slot = preferred(node).find((candidate) => !used.has(candidate));
    if (!slot) continue;
    used.add(slot);
    result.set(node.id, slot as (typeof previewSlots)[number]);
  }

  return result;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('mn-MN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function activityDate(value: string | null | undefined) {
  return value ? value : '';
}

function activityMeta(kind: ActivityItem['kind'], item: ActivityItem) {
  if (kind === 'story') return item.meta || 'Манай түүх';
  if (kind === 'memory') return item.meta || 'Дурсамж';
  return item.meta || 'Архив';
}

function QuickAction({
  icon: Icon,
  label,
  href,
  description,
}: {
  icon: typeof Users;
  label: string;
  href: string;
  description: string;
}) {
  return (
    <Link className="homev2-quick-action" href={href}>
      <span className="homev2-quick-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

function TreePreview({
  tree,
  familyId,
  onOpenProfile,
}: {
  tree: PreviewTree;
  familyId: string;
  onOpenProfile: (personId: string) => void;
}) {
  const people = useMemo(() => pickPreviewPeople(tree, 10), [tree]);
  const slots = useMemo(() => assignSlots(people), [people]);

  if (!people.length) {
    return (
      <div className="homev2-tree-empty">
        <TreeDeciduous size={34} aria-hidden="true" />
        <h3>Удмын мод одоогоор хоосон байна</h3>
        <p>Гэр бүлийн хүмүүсээ нэмээд модоо бага багаар ургуулж эхлээрэй.</p>
        <Link className="homev2-button homev2-button--light" href={'/people?family=' + encodeURIComponent(familyId)}>
          Хүмүүс рүү очих
        </Link>
      </div>
    );
  }

  const point = (slot: (typeof previewSlots)[number]) => {
    const [x, y] = previewPoints[slot];
    return { x: (x / 100) * 900, y: (y / 100) * 520 };
  };

  return (
    <div className="homev2-tree-viewport">
      <div className="homev2-tree">
      <div className="homev2-tree-backdrop" />
      <svg className="homev2-tree-connectors" viewBox="0 0 900 520" preserveAspectRatio="none" aria-hidden="true">
        {tree.marriages.map((marriage) => {
          const a = slots.get(marriage.person_1_id);
          const b = slots.get(marriage.person_2_id);
          if (!a || !b) return null;
          const start = point(a);
          const end = point(b);
          return (
            <g key={'m-' + marriage.id}>
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
              <circle cx={(start.x + end.x) / 2} cy={(start.y + end.y) / 2} r="4" />
            </g>
          );
        })}
        {people.flatMap((node) =>
          node.children.flatMap((childId) => {
            const a = slots.get(node.id);
            const b = slots.get(childId);
            if (!a || !b) return [];
            const start = point(a);
            const end = point(b);
            const midY = (start.y + end.y) / 2;
            return [
              <path
                key={'c-' + node.id + '-' + childId}
                d={
                  'M ' +
                  start.x +
                  ' ' +
                  start.y +
                  ' C ' +
                  start.x +
                  ' ' +
                  midY +
                  ', ' +
                  end.x +
                  ' ' +
                  midY +
                  ', ' +
                  end.x +
                  ' ' +
                  end.y
                }
              />,
            ];
          }),
        )}
      </svg>

      {people.map((node) => {
        const slot = slots.get(node.id);
        if (!slot) return null;
        const isRoot = node.id === tree.rootId;
        return (
          <button
            className={'homev2-tree-node ' + (isRoot ? 'homev2-tree-node--root' : '')}
            key={node.id}
            style={{ left: previewPoints[slot][0] + '%', top: previewPoints[slot][1] + '%' }}
            onClick={() => onOpenProfile(node.id)}
            aria-label={fullName(node.person) + ' профайл нээх'}
          >
            <span className="homev2-node-avatar" aria-hidden="true">
              {initials({
                first_name: node.person.first_name,
                last_name: node.person.last_name,
              })}
            </span>
            <strong>{fullName(node.person)}</strong>
            <small>
              {node.person.birth_date?.slice(0, 4) ?? '—'}{' '}
              {node.person.is_alive ? '—' : node.person.death_date?.slice(0, 4) ?? '?'}
            </small>
            {(node.person.branch_name || node.person.lineage_name) && (
              <em>{node.person.branch_name ?? node.person.lineage_name}</em>
            )}
            <span className="homev2-node-generation">{generationLabel(node.generation)}</span>
          </button>
        );
      })}

      <div className="homev2-tree-caption">
        <span><TreeDeciduous size={14} /> Ургийн модны хураангуй</span>
        <Link href={'/tree?family=' + encodeURIComponent(familyId)}>
          Удмын модыг бүтнээр харах <ArrowRight size={14} />
        </Link>
      </div>
      </div>
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const familyIdFromUrl = searchParams.get('family') ?? '';

  const [user, setUser] = useState<User | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [tree, setTree] = useState<TreeData>({ persons: [], parent_child_relationships: [], marriages: [] });
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [stories, setStories] = useState<StoryListPage | null>(null);
  const [archives, setArchives] = useState<ArchiveListPage | null>(null);
  const [storyError, setStoryError] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<PersonSearchPage | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dashboardRequestRef = useRef(0);
  const searchRequestRef = useRef(0);

  const loadDashboard = useCallback(
    async (familyId: string, currentUser: User) => {
      const requestId = dashboardRequestRef.current;
      setRefreshing(true);
      setError('');
      setFamily(null);
      setPeople([]);
      setTree({ persons: [], parent_child_relationships: [], marriages: [] });
      setMemories([]);
      setMemoryCount(0);
      setStories(null);
      setArchives(null);
      setStoryError('');
      setArchiveError('');

      try {
        const [familyData, peopleData, treeData, memoryData] = await Promise.all([
          api<Family>('/families/' + familyId),
          api<Person[]>('/families/' + familyId + '/persons'),
          api<TreeData>('/families/' + familyId + '/tree?depth=5'),
          api<MemoryListItem[]>('/families/' + familyId + '/memories'),
        ]);

        if (requestId !== dashboardRequestRef.current) return null;
        setFamily(familyData);
        setPeople(peopleData);
        setTree(treeData);
        setMemoryCount(memoryData.length);
        setMemories(memoryData.slice(0, 6));

        const [storiesResult, archivesResult] = await Promise.all([
          api<StoryListPage>('/families/' + familyId + '/stories?page=1&page_size=4')
            .then((value) => ({ value, error: '' }))
            .catch((cause) => ({ value: null, error: cause instanceof ApiError && cause.status === 403 ? 'Түүхийн мэдээлэлд хандах эрхгүй байна.' : 'Түүхийн мэдээллийг ачаалж чадсангүй.' })),
          api<ArchiveListPage>('/families/' + familyId + '/archives?page=1&page_size=4')
            .then((value) => ({ value, error: '' }))
            .catch((cause) => ({ value: null, error: cause instanceof ApiError && cause.status === 403 ? 'Архивын мэдээлэлд хандах эрхгүй байна.' : 'Архивын мэдээллийг ачаалж чадсангүй.' })),
        ]);
        if (requestId !== dashboardRequestRef.current) return null;
        setStories(storiesResult.value);
        setArchives(archivesResult.value);
        setStoryError(storiesResult.error);
        setArchiveError(archivesResult.error);

        if (currentUser.person_id && peopleData.some((person) => person.id === currentUser.person_id)) {
          return currentUser.person_id;
        }
        return treeData.root_person_id && peopleData.some((person) => person.id === treeData.root_person_id)
          ? treeData.root_person_id
          : peopleData[0]?.id ?? null;
      } catch (cause) {
        if (requestId !== dashboardRequestRef.current) return null;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return null;
        }
        setError(cause instanceof Error ? cause.message : 'Гэр бүлийн мэдээллийг ачаалж чадсангүй.');
        return null;
      } finally {
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const requestId = ++dashboardRequestRef.current;
      setLoading(true);
      setError('');
      setFamily(null);
      setPeople([]);
      setTree({ persons: [], parent_child_relationships: [], marriages: [] });
      setMemories([]);
      setMemoryCount(0);
      setStories(null);
      setArchives(null);
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
          return;
        }

        const requestedFamily = familyIdFromUrl
          ? familyList.find((item) => item.id === familyIdFromUrl) ?? null
          : null;
        if (familyIdFromUrl && !requestedFamily) {
          setFamily(null);
          setPeople([]);
          setTree({ persons: [], parent_child_relationships: [], marriages: [] });
          setMemories([]);
          setMemoryCount(0);
          setStories(null);
          setArchives(null);
          setError('Энэ гэр бүлийн орчинд хандах эрхгүй эсвэл гэр бүл олдсонгүй.');
          return;
        }
        const nextFamily = requestedFamily ?? familyList[0];
        await loadDashboard(nextFamily.id, me);

        if (active && !familyIdFromUrl) {
          router.replace('/dashboard?family=' + encodeURIComponent(nextFamily.id));
        }
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Нэвтрэлтийг шалгаж чадсангүй.');
      } finally {
        if (active && requestId === dashboardRequestRef.current) setLoading(false);
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [familyIdFromUrl, loadDashboard, router]);

  useEffect(() => {
    if (!family?.id || !search.trim()) {
      setSearchResults(null);
      setSearchBusy(false);
      return;
    }

    const timer = window.setTimeout(() => {
      const requestId = ++searchRequestRef.current;
      setSearchBusy(true);
      api<PersonSearchPage>(
        '/families/' +
          family.id +
          '/persons/search?q=' +
          encodeURIComponent(search.trim()) +
          '&page=1&page_size=10',
      )
        .then(setSearchResults)
        .catch((cause) => {
          if (cause instanceof ApiError && cause.status === 401) {
            router.replace('/login');
            return;
          }
          if (requestId === searchRequestRef.current) setSearchResults(null);
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) setSearchBusy(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      searchRequestRef.current += 1;
    };
  }, [family?.id, router, search]);

  const previewTree = useMemo(
    () => buildPreviewTree(tree, user?.person_id && people.some((person) => person.id === user.person_id) ? user.person_id : null),
    [people, tree, user?.person_id],
  );

  const activity = useMemo<ActivityItem[]>(() => {
    const result: ActivityItem[] = [];

    for (const item of stories?.items ?? []) {
      result.push({
        kind: 'story',
        id: item.id,
        title: item.title,
        date: activityDate(item.created_at),
        meta: item.author_name || 'Манай түүх',
      });
    }

    for (const item of memories) {
      result.push({
        kind: 'memory',
        id: item.id,
        title: item.title,
        date: activityDate(item.created_at),
        meta: item.person_names?.slice(0, 2).join(' · ') || 'Дурсамж',
      });
    }

    for (const item of archives?.items ?? []) {
      result.push({
        kind: 'archive',
        id: item.id,
        title: item.title,
        date: activityDate(item.created_at),
        meta: item.author_name || 'Архив',
      });
    }

    return result
      .filter((item) => item.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [archives, memories, stories]);

  function openProfile(personId: string) {
    if (!family) return;
    router.push('/profile?family=' + encodeURIComponent(family.id) + '&person=' + encodeURIComponent(personId));
  }

  if (loading) {
    return (
      <main className="homev2-shell">
        <div className="homev2-loading" aria-busy="true" aria-live="polite">
          <div className="homev2-loading__line homev2-loading__line--wide" />
          <div className="homev2-loading__line" />
          <div className="homev2-loading__grid">
            <div className="homev2-loading__block" />
            <div className="homev2-loading__block" />
            <div className="homev2-loading__block" />
          </div>
          <span>Гэр бүлийн орон зайг ачаалж байна…</span>
        </div>
      </main>
    );
  }

  if (error && !families.length) {
    return (
      <main className="homev2-shell">
        <section className="homev2-state homev2-state--error" role="alert">
          <TreeDeciduous size={36} />
          <h1>Гэр бүлийн мэдээллийг ачаалж чадсангүй</h1>
          <p>Холболт эсвэл нэвтрэлтийн төлөвөө шалгаад дахин оролдоно уу.</p>
          <button className="homev2-button homev2-button--dark" onClick={() => window.location.reload()}>
            Дахин оролдох
          </button>
        </section>
      </main>
    );
  }

  if (!families.length) {
    return (
      <main className="homev2-shell">
        <section className="homev2-state">
          <TreeDeciduous size={42} />
          <p className="homev2-eyebrow">ГУУЛИНГИЙНХАН</p>
          <h1>Гэр бүлийн түүхээ эндээс эхлүүлээрэй.</h1>
          <p>Одоогоор танд харагдах гэр бүл алга. Эхлээд гэр бүлээ үүсгээд өөрийн хүмүүсээ нэмнэ.</p>
          <Link className="homev2-button homev2-button--dark" href="/onboarding">
            Гэр бүл үүсгэх
          </Link>
        </section>
      </main>
    );
  }

  return (
    <div className="homev2-app">
      <div className="homev2-layout">
        <main className="homev2-main">
          <div className="homev2-dashboard-toolbar" aria-label="Dashboard хэрэгслүүд">
            <div className="homev2-search">
              <Search size={17} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Гэр бүлийн хүн хайх…"
                aria-label="Гэр бүлийн хүн хайх"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Хайлтыг арилгах">
                  <X size={15} />
                </button>
              )}
              {search && (
                <div className="homev2-search-results">
                  {searchBusy ? (
                    <span aria-live="polite">Хайж байна…</span>
                  ) : searchResults?.items.length ? (
                    searchResults.items.map((result) => (
                      <button type="button" key={result.id} onClick={() => openProfile(result.id)}>
                        <span className="homev2-search-avatar">{result.name.slice(0, 2).toUpperCase()}</span>
                        <span>
                          <strong>{result.name}</strong>
                          <small>{result.birth_year ?? '—'}</small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <span>{searchResults ? 'Хүн олдсонгүй.' : 'Нэрээр хайж байна…'}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="homev2-inline-alert" role="alert">
              <span>{error}</span>
              <button onClick={() => window.location.reload()}>Дахин ачаалах</button>
            </div>
          )}

          {(storyError || archiveError) && (
            <div className="homev2-inline-alert" role="alert">
              <span>{[storyError, archiveError].filter(Boolean).join(' ')}</span>
              <button onClick={() => window.location.reload()}>Дахин ачаалах</button>
            </div>
          )}

          <section className="homev2-hero">
            <div>
              <p className="homev2-eyebrow">МАНАЙ ГЭР БҮЛ</p>
              <h1>{family?.name}</h1>
              <p className="homev2-hero-copy">
                Түүх, хүмүүс, дурсамж, өвийг нэг дороос хараарай.
              </p>
              {user?.display_name && <p className="homev2-welcome">Тавтай морил, {user.display_name}.</p>}
            </div>
            <div className="homev2-hero-meta">
              <span className="homev2-context-pill"><TreeDeciduous size={15} /> Family context</span>
              <Link href={'/tree?family=' + encodeURIComponent(family?.id ?? '')}>Мод руу орох <ArrowRight size={15} /></Link>
            </div>
          </section>

          <section className="homev2-tree-card" aria-labelledby="home-tree-title">
            <div className="homev2-section-header">
              <div>
                <p className="homev2-eyebrow">THE FAMILY TREE</p>
                <h2 id="home-tree-title">Удмын модны хураангуй</h2>
                <p>Хүнийг сонгоход тухайн хүний бодит профайл нээгдэнэ.</p>
              </div>
              <Link className="homev2-text-link" href={'/tree?family=' + encodeURIComponent(family?.id ?? '')}>
                Удмын модыг бүтнээр харах <ArrowRight size={15} />
              </Link>
            </div>
            <TreePreview tree={previewTree} familyId={family?.id ?? ''} onOpenProfile={openProfile} />
          </section>

          <section className="homev2-grid homev2-grid--split">
            <div className="homev2-panel">
              <div className="homev2-section-header homev2-section-header--compact">
                <div>
                  <p className="homev2-eyebrow">БҮХИЙ Л ЗҮЙЛ НЭГ ДОР</p>
                  <h2>Хурдан үйлдлүүд</h2>
                </div>
              </div>
              <div className="homev2-actions">
                <QuickAction icon={Users} label="Хүмүүс" description="Гэр бүлийн хүмүүс" href={'/people?family=' + encodeURIComponent(family?.id ?? '')} />
                <QuickAction icon={GitFork} label="Удмын мод" description="Бүх холбоосууд" href={'/tree?family=' + encodeURIComponent(family?.id ?? '')} />
                <QuickAction icon={BookOpen} label="Манай түүх" description="Түүх, үйл явдлууд" href={'/stories?family=' + encodeURIComponent(family?.id ?? '')} />
                <QuickAction icon={Heart} label="Дурсамж" description="Гэр бүлийн дурсамж" href={'/memories?family=' + encodeURIComponent(family?.id ?? '')} />
                <QuickAction icon={Archive} label="Архив" description="Баримтын metadata" href={'/archives?family=' + encodeURIComponent(family?.id ?? '')} />
              </div>
            </div>

            <div className="homev2-panel homev2-panel--snapshot">
              <div className="homev2-section-header homev2-section-header--compact">
                <div>
                  <p className="homev2-eyebrow">FAMILY SNAPSHOT</p>
                  <h2>Манай гэр бүл</h2>
                </div>
              </div>
              <div className="homev2-stats">
                <div><strong>{people.length}</strong><span>Хүн</span></div>
                <div><strong>{stories?.total ?? '—'}</strong><span>Түүх</span></div>
                <div><strong>{memoryCount}</strong><span>Дурсамж</span></div>
                <div><strong>{archives?.total ?? '—'}</strong><span>Архив</span></div>
              </div>
            </div>
          </section>

          <section className="homev2-panel" aria-labelledby="recent-title">
            <div className="homev2-section-header">
              <div>
                <p className="homev2-eyebrow">RECENT</p>
                <h2 id="recent-title">Сүүлийн үеийн</h2>
                <p>Одоогийн family context дээрх бодит агуулгаас.</p>
              </div>
              <div className="homev2-recent-links">
                <Link href={'/stories?family=' + encodeURIComponent(family?.id ?? '')}>Түүх <ArrowRight size={14} /></Link>
                <Link href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}>Дурсамж <ArrowRight size={14} /></Link>
                <Link href={'/archives?family=' + encodeURIComponent(family?.id ?? '')}>Архив <ArrowRight size={14} /></Link>
              </div>
            </div>

            {activity.length ? (
              <div className="homev2-activity">
                {activity.map((item) => {
                  const href =
                    item.kind === 'story'
                      ? '/stories/' + encodeURIComponent(item.id) + '?family=' + encodeURIComponent(family?.id ?? '')
                      : item.kind === 'archive'
                        ? '/archives/' + encodeURIComponent(item.id) + '?family=' + encodeURIComponent(family?.id ?? '')
                        : '/memories?family=' + encodeURIComponent(family?.id ?? '');

                  const icon = item.kind === 'story' ? <BookOpen size={17} /> : item.kind === 'archive' ? <Archive size={17} /> : <Heart size={17} />;

                  return (
                    <Link className="homev2-activity-item" href={href} key={item.kind + '-' + item.id}>
                      <span className="homev2-activity-icon" aria-hidden="true">{icon}</span>
                      <span className="homev2-activity-copy">
                        <strong>{item.title}</strong>
                        <small>{activityMeta(item.kind, item)} · {formatDate(item.date)}</small>
                      </span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="homev2-empty-content">
                <Heart size={26} aria-hidden="true" />
                <strong>Одоогоор энд мэдээлэл алга.</strong>
                <span>Гэр бүлийн түүхээ бага багаар нэмээрэй.</span>
              </div>
            )}
          </section>

          <section className="homev2-grid homev2-grid--content">
            <div className="homev2-panel">
              <div className="homev2-section-header homev2-section-header--compact">
                <div>
                  <p className="homev2-eyebrow">MEMORIES</p>
                  <h2>Сүүлийн дурсамж</h2>
                </div>
                <Link className="homev2-text-link" href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}>
                  Бүгдийг харах <ArrowRight size={14} />
                </Link>
              </div>
              {memories.length ? (
                <div className="homev2-list">
                  {memories.slice(0, 4).map((memory) => (
                    <Link className="homev2-list-row" key={memory.id} href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}>
                      <span className="homev2-list-icon" aria-hidden="true"><Heart size={16} /></span>
                      <span><strong>{memory.title}</strong><small>{memory.memory_date ?? 'Огноогүй'}</small></span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="homev2-empty-content homev2-empty-content--small">
                  <strong>Одоогоор хадгалсан дурсамж алга.</strong>
                  <Link className="homev2-text-link" href={'/memories?family=' + encodeURIComponent(family?.id ?? '')}>Дурсамж руу очих</Link>
                </div>
              )}
            </div>

            <div className="homev2-panel">
              <div className="homev2-section-header homev2-section-header--compact">
                <div>
                  <p className="homev2-eyebrow">YOUR PLACE</p>
                  <h2>Эндээс үргэлжлүүлээрэй</h2>
                </div>
              </div>
              {user?.person_id && people.some((person) => person.id === user.person_id) ? (
                <div className="homev2-continue">
                  <span className="homev2-continue-avatar">
                    {initials({ first_name: user.display_name, last_name: '' })}
                  </span>
                  <div>
                    <strong>{people.find((person) => person.id === user.person_id)?.first_name ? fullName(people.find((person) => person.id === user.person_id)!) : user.display_name}</strong>
                    <span>Таны family profile</span>
                  </div>
                  <button className="homev2-button homev2-button--dark" onClick={() => openProfile(user.person_id!)}>
                    Профайл <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="homev2-empty-content homev2-empty-content--small">
                  <strong>Таны profile энэ family-д холбогдоогүй байна.</strong>
                  <Link className="homev2-text-link" href={'/people?family=' + encodeURIComponent(family?.id ?? '')}>Хүмүүс рүү очих</Link>
                </div>
              )}
            </div>
          </section>

          {notice && (
            <div className="homev2-toast" role="status">
              <span>{notice}</span>
              <button onClick={() => setNotice('')} aria-label="Мэдэгдлийг хаах"><X size={14} /></button>
            </div>
          )}

          {refreshing && <div className="homev2-refresh" role="status">Шинэчилж байна…</div>}
        </main>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="homev2-shell">
          <div className="homev2-loading"><span>Гэр бүлийн орон зайг ачаалж байна…</span></div>
        </main>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
