'use client';

import React, { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  API_BASE,
  api,
  Family,
  Marriage,
  Person,
  PersonSearchPage,
  TreeData,
  TreePerson,
  User,
  personName,
} from '../../lib/api';

type DashboardPerson = TreePerson & {
  generation: number | null;
};

type NormalizedTreeNode = {
  id: string;
  person: TreePerson;
  generation: number | null;
  parentIds: string[];
  childIds: string[];
  spouseIds: string[];
};

type NormalizedTree = {
  rootPersonId: string | null;
  nodes: Map<string, NormalizedTreeNode>;
  order: string[];
  parentChildRelationships: TreeData['parent_child_relationships'];
  marriages: Marriage[];
  truncated: boolean;
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

function resolveTreeRoot(
  tree: Pick<TreeData, 'persons' | 'root_person_id'>,
  userPersonId: string | null,
  selectedPersonId: string | null,
): string | null {
  const personIds = new Set(tree.persons.map((person) => person.id));

  if (userPersonId && personIds.has(userPersonId)) return userPersonId;
  if (selectedPersonId && personIds.has(selectedPersonId)) return selectedPersonId;
  if (tree.root_person_id && personIds.has(tree.root_person_id)) return tree.root_person_id;

  return [...personIds].sort((a, b) => a.localeCompare(b))[0] ?? null;
}

function resolveSelectedPersonId(
  tree: Pick<TreeData, 'persons'>,
  candidateId: string | null,
  fallbackId: string | null,
): string | null {
  const personIds = new Set(tree.persons.map((person) => person.id));

  if (candidateId && personIds.has(candidateId)) return candidateId;
  if (fallbackId && personIds.has(fallbackId)) return fallbackId;

  return [...personIds].sort((a, b) => a.localeCompare(b))[0] ?? null;
}

function deriveTreeGenerations(
  parentChildRelationships: TreeData['parent_child_relationships'],
  marriages: Marriage[],
  rootPersonId: string | null,
): Map<string, number> {
  const generations = new Map<string, number>();
  if (!rootPersonId) return generations;

  generations.set(rootPersonId, 0);

  let changed = true;
  while (changed) {
    changed = false;

    for (const edge of parentChildRelationships) {
      const parentGeneration = generations.get(edge.parent_id);
      const childGeneration = generations.get(edge.child_id);

      if (parentGeneration !== undefined && childGeneration === undefined) {
        generations.set(edge.child_id, parentGeneration + 1);
        changed = true;
      } else if (childGeneration !== undefined && parentGeneration === undefined) {
        generations.set(edge.parent_id, childGeneration - 1);
        changed = true;
      }
    }

    // Marriage only carries the already-known generation sideways. It never
    // increments/decrements generation and therefore never acts as ancestry.
    for (const marriage of marriages) {
      const firstGeneration = generations.get(marriage.person_1_id);
      const secondGeneration = generations.get(marriage.person_2_id);

      if (firstGeneration !== undefined && secondGeneration === undefined) {
        generations.set(marriage.person_2_id, firstGeneration);
        changed = true;
      } else if (secondGeneration !== undefined && firstGeneration === undefined) {
        generations.set(marriage.person_1_id, secondGeneration);
        changed = true;
      }
    }
  }

  return generations;
}

function normalizeTree(
  tree: TreeData,
  userPersonId: string | null,
  selectedPersonId: string | null,
): NormalizedTree {
  const personById = new Map<string, TreePerson>();
  for (const person of tree.persons) {
    if (!personById.has(person.id)) personById.set(person.id, person);
  }

  const personIds = new Set(personById.keys());

  const parentChildByKey = new Map<
    string,
    TreeData['parent_child_relationships'][number]
  >();
  for (const edge of [...tree.parent_child_relationships].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!personIds.has(edge.parent_id) || !personIds.has(edge.child_id)) continue;
    const key = edge.parent_id + ':' + edge.child_id + ':' + edge.relationship_type;
    if (!parentChildByKey.has(key)) parentChildByKey.set(key, edge);
  }

  const marriageByKey = new Map<string, Marriage>();
  for (const marriage of [...tree.marriages].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!personIds.has(marriage.person_1_id) || !personIds.has(marriage.person_2_id)) continue;
    const pair = [marriage.person_1_id, marriage.person_2_id].sort().join(':');
    const key =
      pair +
      ':' +
      marriage.status +
      ':' +
      (marriage.start_date ?? '') +
      ':' +
      (marriage.end_date ?? '');
    if (!marriageByKey.has(key)) marriageByKey.set(key, marriage);
  }

  const parentChildRelationships = [...parentChildByKey.values()];
  const marriages = [...marriageByKey.values()];
  const rootPersonId = resolveTreeRoot(tree, userPersonId, selectedPersonId);
  const generations = deriveTreeGenerations(
    parentChildRelationships,
    marriages,
    rootPersonId,
  );

  const nodes = new Map<string, NormalizedTreeNode>(
    [...personById.values()].map((person) => [
      person.id,
      {
        id: person.id,
        person,
        generation: generations.get(person.id) ?? null,
        parentIds: [],
        childIds: [],
        spouseIds: [],
      },
    ]),
  );

  for (const edge of parentChildRelationships) {
    nodes.get(edge.parent_id)?.childIds.push(edge.child_id);
    nodes.get(edge.child_id)?.parentIds.push(edge.parent_id);
  }

  for (const marriage of marriages) {
    nodes.get(marriage.person_1_id)?.spouseIds.push(marriage.person_2_id);
    nodes.get(marriage.person_2_id)?.spouseIds.push(marriage.person_1_id);
  }

  for (const node of nodes.values()) {
    node.parentIds = [...new Set(node.parentIds)];
    node.childIds = [...new Set(node.childIds)];
    node.spouseIds = [...new Set(node.spouseIds)];
  }

  return {
    rootPersonId,
    nodes,
    order: [...nodes.keys()],
    parentChildRelationships,
    marriages,
    truncated: Boolean(tree.meta?.truncated),
  };
}

function treeDistance(tree: NormalizedTree, rootPersonId: string | null): Map<string, number> {
  const distance = new Map<string, number>();
  if (!rootPersonId || !tree.nodes.has(rootPersonId)) return distance;

  const adjacency = new Map<string, string[]>();
  for (const node of tree.nodes.values()) {
    adjacency.set(node.id, [
      ...node.parentIds,
      ...node.childIds,
      ...node.spouseIds,
    ]);
  }

  distance.set(rootPersonId, 0);
  const queue = [rootPersonId];

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

  return distance;
}

type SlotAssignment = Map<string, (typeof positions)[number]>;

function slotIndex(slot: (typeof positions)[number]) {
  return positions.indexOf(slot);
}

const generationSlots: Record<string, (typeof positions)[number][]> = {
  '-2': ['p1', 'p2'],
  '-1': ['p3', 'p4'],
  '0': ['p5', 'p6'],
  '1': ['p7', 'p8', 'p9', 'p10'],
  '2': ['p11', 'p12'],
};

function compareTreePeople(a: TreePerson, b: TreePerson) {
  if (a.birth_date && b.birth_date && a.birth_date !== b.birth_date) {
    return a.birth_date.localeCompare(b.birth_date);
  }
  if (a.birth_date && !b.birth_date) return -1;
  if (!a.birth_date && b.birth_date) return 1;
  return a.id.localeCompare(b.id);
}

function relationshipRole(tree: NormalizedTree, personId: string): 'root' | 'parent' | 'child' | 'spouse' | 'related' {
  if (personId === tree.rootPersonId) return 'root';

  const root = tree.rootPersonId ? tree.nodes.get(tree.rootPersonId) : undefined;
  if (!root) return 'related';

  if (root.parentIds.includes(personId)) return 'parent';
  if (root.childIds.includes(personId)) return 'child';
  if (root.spouseIds.includes(personId)) return 'spouse';
  return 'related';
}

function visualPriority(role: ReturnType<typeof relationshipRole>) {
  return {
    root: 0,
    parent: 1,
    spouse: 2,
    child: 3,
    related: 4,
  }[role];
}

function preferredSlots(
  tree: NormalizedTree,
  node: NormalizedTreeNode,
): (typeof positions)[number][] {
  if (node.id === tree.rootPersonId) return ['p5', 'p6', ...positions];

  const role = relationshipRole(tree, node.id);
  const generation = node.generation;

  if (role === 'parent') {
    return [
      ...(generationSlots[String(generation)] ?? []),
      'p3',
      'p4',
      'p1',
      'p2',
      ...positions,
    ];
  }

  if (role === 'spouse') {
    return [
      'p6',
      'p4',
      ...(generationSlots[String(generation)] ?? []),
      'p3',
      'p5',
      ...positions,
    ];
  }

  if (role === 'child') {
    return [
      ...(generationSlots[String(generation)] ?? []),
      'p7',
      'p8',
      'p9',
      'p10',
      ...positions,
    ];
  }

  return [
    ...generationSlots[String(generation)] ?? [],
    ...positions,
  ];
}

function buildVisualSlotMap(
  tree: NormalizedTree,
  visiblePeople: DashboardPerson[],
): SlotAssignment {
  const assigned = new Map<string, (typeof positions)[number]>();
  const occupied = new Set<(typeof positions)[number]>();

  const ordered = [...visiblePeople].sort((a, b) => {
    const roleDifference =
      visualPriority(relationshipRole(tree, a.id)) -
      visualPriority(relationshipRole(tree, b.id));

    if (roleDifference !== 0) return roleDifference;

    const generationA = a.generation ?? Number.POSITIVE_INFINITY;
    const generationB = b.generation ?? Number.POSITIVE_INFINITY;

    if (generationA !== generationB) return generationA - generationB;

    return compareTreePeople(a, b);
  });

  for (const person of ordered) {
    const candidates = preferredSlots(tree, tree.nodes.get(person.id)!);
    const availableCandidate = candidates.find((candidate) => !occupied.has(candidate));

    const slot =
      availableCandidate ??
      positions
        .filter((candidate) => !occupied.has(candidate))
        .sort((a, b) => slotIndex(a) - slotIndex(b))[0];

    if (!slot) continue;

    assigned.set(person.id, slot);
    occupied.add(slot);
  }

  return assigned;
}

function pickDashboardPeople(
  tree: NormalizedTree,
  selectedPersonId: string | null,
  max = 12,
): DashboardPerson[] {
  const distance = treeDistance(tree, tree.rootPersonId);
  const selectedIds = new Set<string>();

  for (const id of [tree.rootPersonId, selectedPersonId]) {
    if (id && tree.nodes.has(id)) selectedIds.add(id);
  }

  const remainingIds = tree.order
    .filter((id) => !selectedIds.has(id))
    .sort((a, b) => {
      const roleDifference =
        visualPriority(relationshipRole(tree, a)) -
        visualPriority(relationshipRole(tree, b));

      if (roleDifference !== 0) return roleDifference;

      const generationA = tree.nodes.get(a)?.generation ?? Number.POSITIVE_INFINITY;
      const generationB = tree.nodes.get(b)?.generation ?? Number.POSITIVE_INFINITY;

      if (generationA !== generationB) return generationA - generationB;

      return (
        (distance.get(a) ?? Number.POSITIVE_INFINITY) -
          (distance.get(b) ?? Number.POSITIVE_INFINITY) ||
        compareTreePeople(tree.nodes.get(a)!.person, tree.nodes.get(b)!.person)
      );
    });

  for (const id of remainingIds) {
    if (selectedIds.size >= max) break;
    selectedIds.add(id);
  }

  return [...selectedIds]
    .map((id) => {
      const node = tree.nodes.get(id);
      return node ? { ...node.person, generation: node.generation } : null;
    })
    .filter((person): person is DashboardPerson => Boolean(person))
    .sort((a, b) => {
      const generationA = a.generation ?? Number.POSITIVE_INFINITY;
      const generationB = b.generation ?? Number.POSITIVE_INFINITY;

      if (generationA !== generationB) return generationA - generationB;

      return (
        (distance.get(a.id) ?? Number.POSITIVE_INFINITY) -
          (distance.get(b.id) ?? Number.POSITIVE_INFINITY) ||
        compareTreePeople(a, b)
      );
    })
    .slice(0, max);
}

function generationLabel(generation: number | null) {
  if (generation === null) return '—';
  if (generation > 0) return '+' + generation + ' үе';
  return generation + ' үе';
}

function ConnectorLayer({
  tree,
  visiblePeople,
  slotByPersonId,
}: {
  tree: NormalizedTree;
  visiblePeople: DashboardPerson[];
  slotByPersonId: SlotAssignment;
}) {
  const point = (slot: (typeof positions)[number]) => {
    const [x, y] = slotPoints[slot];
    return { x: (x / 100) * 950, y: (y / 100) * 640 };
  };

  return (
    <svg className="connectors" viewBox="0 0 950 640" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="#d0ac56" strokeWidth="2">
        {tree.parentChildRelationships.map((edge) => {
          const parentSlot = slotByPersonId.get(edge.parent_id);
          const childSlot = slotByPersonId.get(edge.child_id);
          if (!parentSlot || !childSlot) return null;

          const start = point(parentSlot);
          const end = point(childSlot);
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
          const firstSlot = slotByPersonId.get(marriage.person_1_id);
          const secondSlot = slotByPersonId.get(marriage.person_2_id);
          if (!firstSlot || !secondSlot) return null;

          const start = point(firstSlot);
          const end = point(secondSlot);

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

function DashboardContent() {
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
  const userPersonIdRef = React.useRef<string | null>(null);
  // Mirrors the canonical selectedId so async reloads can read the latest backend Person.id.
  const selectedPersonIdRef = React.useRef<string | null>(null);
  const loadRequestRef = React.useRef(0);

  const searchParams = useSearchParams();
  const familyIdFromUrl = searchParams.get('family') ?? '';

  const loadDashboard = useCallback(async (familyId: string, personId?: string) => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setError('');

    const contextPersonId = personId ?? selectedPersonIdRef.current ?? undefined;
    const queryParams = new URLSearchParams({ depth: '5' });
    if (contextPersonId) queryParams.set('person_id', contextPersonId);

    const [familyData, treeData, personData, memoryData] = await Promise.all([
      api<Family>('/families/' + familyId),
      api<TreeData>('/families/' + familyId + '/tree?' + queryParams.toString()),
      api<Person[]>('/families/' + familyId + '/persons'),
      api<MemorySummary[]>('/families/' + familyId + '/memories'),
    ]);

    if (requestId !== loadRequestRef.current) return null;

    const normalizedTree = normalizeTree(
      treeData,
      userPersonIdRef.current,
      contextPersonId ?? null,
    );

    setFamily(familyData);
    setTree(treeData);
    setPeople(personData);
    setMemories(memoryData.slice(0, 4));

    const nextSelected = resolveSelectedPersonId(
      treeData,
      contextPersonId ?? null,
      normalizedTree.rootPersonId,
    );

    setCanonicalSelectedPersonId(nextSelected);
    setTab('Тойм');
    setBiography('');
    setPhotosByPerson({});

    const photoEntries = await Promise.all(
      [...new Map(treeData.persons.map((treePerson) => [treePerson.id, treePerson])).values()].slice(0, 12).map(async (treePerson) => {
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

    if (requestId !== loadRequestRef.current) return null;
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
      if (requestId !== loadRequestRef.current) return null;
      setMemoryDetails(Object.fromEntries(detailEntries));
    } else {
      if (requestId !== loadRequestRef.current) return null;
      setMemoryDetails({});
    }

    return treeData;
  }, []);

  const refreshTreeAfterMutation = useCallback(
    async (familyId: string, preferredPersonId?: string) => {
      try {
        return await loadDashboard(familyId, preferredPersonId);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          throw cause;
        }

        setError(
          cause instanceof Error
            ? 'Мэдээлэл хадгалагдсан боловч ургийн модыг шинэчилж чадсангүй. ' + cause.message
            : 'Мэдээлэл хадгалагдсан боловч ургийн модыг шинэчилж чадсангүй.',
        );
        return null;
      }
    },
    [loadDashboard],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoading(true);
      setError('');

      try {
        setFamily(null);
        setTree({ persons: [], parent_child_relationships: [], marriages: [] });
        setPeople([]);
        setMemories([]);
        setMemoryDetails({});
        setPhotosByPerson({});
        setQuery('');
        setSearchResults(null);
        setCanonicalSelectedPersonId(null);

        const [me, familyList] = await Promise.all([
          api<User>('/auth/me'),
          api<Family[]>('/families'),
        ]);

        if (!active) return;

        setUser(me);
        userPersonIdRef.current = me.person_id;
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

        if (active && (!familyIdFromUrl || !requestedFamily)) {
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

  const normalizedTree = useMemo(
    () => normalizeTree(tree, userPersonIdRef.current, selectedId),
    [tree, selectedId],
  );

  const visiblePeople = useMemo(
    () => pickDashboardPeople(normalizedTree, selectedId, 12),
    [normalizedTree, selectedId],
  );

  const selected = useMemo(
    () =>
      selectedId && normalizedTree.nodes.has(selectedId)
        ? people.find((person) => person.id === selectedId) ?? null
        : null,
    [people, selectedId, normalizedTree],
  );

  const slotByPersonId = useMemo(
    () => buildVisualSlotMap(normalizedTree, visiblePeople),
    [normalizedTree, visiblePeople],
  );

  const maxGeneration = useMemo(
    () => Math.max(...visiblePeople.map((person) => Math.abs(person.generation ?? 0) + 1), 1),
    [visiblePeople],
  );

  const activeMarriageCount = useMemo(
    () => tree.marriages.filter((marriage) => marriage.status === 'married').length,
    [tree.marriages],
  );

  const visibleSelectedPhoto = selectedId
    ? photosByPerson[selectedId]?.[0]
    : undefined;

  function setCanonicalSelectedPersonId(personId: string | null) {
    selectedPersonIdRef.current = personId;
    setSelectedId(personId);
  }

  function choosePerson(personId: string) {
    if (!normalizedTree.nodes.has(personId)) return;

    setCanonicalSelectedPersonId(personId);
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

        const refreshedTree = await refreshTreeAfterMutation(family.id, updated.id);
        if (refreshedTree) {
          setNotice('Хүний мэдээлэл шинэчлэгдлээ.');
        }
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

        const refreshedTree = await refreshTreeAfterMutation(family.id, selected.id);
        if (refreshedTree?.persons.some((person) => person.id === created.id)) {
          setCanonicalSelectedPersonId(created.id);
          setNotice('Хүн ургийн модонд нэмэгдлээ.');
        }
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
            {normalizedTree.truncated && (
              <div className="muted" role="status" style={{ margin: '6px 10px 0', fontSize: 10 }}>
                Ургийн мод хэсэгчлэн ачааллагдсан · харагдаж буй мэдээлэл нь API-ийн хязгаарт багтсан хэсэг.
              </div>
            )}

            {error && !family ? (
              <div className="treecanvas empty-tree">
                <div className="empty-tree-card">
                  <TreeDeciduous size={42} />
                  <h2>Ургийн модыг ачаалж чадсангүй</h2>
                  <p>Бодит ургийн мэдээллийг одоогоор ачаалж чадсангүй. Дахин оролдоно уу.</p>
                  <button
                    className="button"
                    onClick={() => {
                      const retryFamily =
                        families.find((item) => item.id === familyIdFromUrl) ?? families[0];
                      if (retryFamily) {
                        void loadDashboard(
                          retryFamily.id,
                          selectedPersonIdRef.current ?? undefined,
                        );
                      }
                    }}
                  >
                    Дахин ачаалах
                  </button>
                </div>
              </div>
            ) : !tree.persons.length ? (
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
                  <ConnectorLayer
                    tree={normalizedTree}
                    visiblePeople={visiblePeople}
                    slotByPersonId={slotByPersonId}
                  />

                  {visiblePeople.map((person) => {
                    const photo = photosByPerson[person.id]?.[0];
                    const isSelected = selectedId === person.id;
                    return (
                      <button
                        key={person.id}
                        className={
                          'personnode ' +
                          (slotByPersonId.get(person.id) ?? positions[0]) +
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
                        {(person.lineage_name || person.branch_name) && (
                          <em
                            className="lineage-mark"
                            title={
                              person.branch_name
                                ? person.lineage_name
                                  ? person.lineage_name + ' · ' + person.branch_name
                                  : person.branch_name
                                : person.lineage_name ?? undefined
                            }
                          >
                            {person.branch_name ?? person.lineage_name}
                          </em>
                        )}
                        <i>
                          {generationLabel(person.generation)}
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


export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="mvp">
          <section className="mvpbox" style={{ maxWidth: 760 }}>
            Гэр бүлийн мэдээллийг ачаалж байна…
          </section>
        </main>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
