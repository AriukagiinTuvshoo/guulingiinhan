'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  api,
  Marriage,
  Person,
  PersonSearchPage,
  personName,
  TreeData,
  TreePerson,
} from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';
import ProfilePhoto from '../../components/profile-photo';

const Tree3DScene = dynamic(() => import('../../components/tree-3d-scene'), {
  ssr: false,
  loading: () => <div className="tree-3d-loading" role="status">3D удмын зураглалыг ачаалж байна…</div>,
});

type RelationKind = 'parent' | 'child' | 'spouse';
type LinkRequest = { id: string; person_id: string; user_id: string; user_name: string; person_name: string; status: string; created_at: string };

type LayoutNode = {
  id: string;
  person: TreePerson;
  generation: number;
  x: number;
  y: number;
};

type TreeLayout = {
  nodes: LayoutNode[];
  width: number;
  height: number;
  generations: number;
};

const TREE_NODE_WIDTH = 212;
const TREE_NODE_HEIGHT = 214;
const TREE_X_GAP = 48;
const TREE_Y_GAP = 82;
const TREE_PAD_X = 62;
const TREE_PAD_Y = 58;

const EMPTY_TREE: TreeData = {
  persons: [],
  parent_child_relationships: [],
  marriages: [],
};

function initials(person: Pick<TreePerson, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function lifeSummary(person: TreePerson) {
  const birth = person.birth_date?.slice(0, 4);
  const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return birth + ' – ' + death;
  if (birth) return person.is_alive ? birth + ' – одоо' : birth + ' – ?';
  return 'Огноо тодорхойгүй';
}

function generationLabel(generation: number) {
  return generation === 0 ? 'Төв үе' : generation < 0 ? Math.abs(generation) + ' үеийн өмнө' : generation + ' үеийн үргэлжлэл';
}

function parentLinkLabel(type: string) {
  return type === 'step' ? 'Дагавар холбоо' : type === 'adoptive' ? 'Үрчилсэн холбоо' : 'Төрсөн холбоо';
}

function treeFriendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай. Дахин нэвтэрнэ үү.';
    if (cause.status === 403) return 'Энэ удмын модонд хандах эрхгүй байна.';
    if (cause.status === 404) return 'Удмын мод эсвэл сонгосон хүн олдсонгүй.';
    if (cause.status === 409) return 'Энэ үйлдэл одоогоор зөрчилтэй байна. Дахин оролдоно уу.';
    if (cause.status === 422) return 'Удмын модны хүсэлт буруу байна. Дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон хүсэлт байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 503) return 'Удмын модны үйлчилгээ түр боломжгүй байна. Дараа дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}

function buildTreeLayout(tree: TreeData): TreeLayout {
  if (!tree.persons.length) return { nodes: [], width: 920, height: 420, generations: 0 };

  const personIds = new Set(tree.persons.map((person) => person.id));
  const generationById = new Map<string, number>();
  const adjacency = new Map<string, { id: string; delta: number }[]>();

  for (const person of tree.persons) adjacency.set(person.id, []);

  for (const edge of tree.parent_child_relationships) {
    if (!personIds.has(edge.parent_id) || !personIds.has(edge.child_id)) continue;
    adjacency.get(edge.parent_id)?.push({ id: edge.child_id, delta: 1 });
    adjacency.get(edge.child_id)?.push({ id: edge.parent_id, delta: -1 });
  }

  for (const marriage of tree.marriages) {
    if (!personIds.has(marriage.person_1_id) || !personIds.has(marriage.person_2_id)) continue;
    adjacency.get(marriage.person_1_id)?.push({ id: marriage.person_2_id, delta: 0 });
    adjacency.get(marriage.person_2_id)?.push({ id: marriage.person_1_id, delta: 0 });
  }

  const rootId = tree.root_person_id && personIds.has(tree.root_person_id)
    ? tree.root_person_id
    : tree.persons[0].id;

  generationById.set(rootId, 0);
  const queue = [rootId];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentId = queue[cursor];
    const currentGeneration = generationById.get(currentId) ?? 0;

    for (const neighbor of adjacency.get(currentId) ?? []) {
      if (generationById.has(neighbor.id)) continue;
      generationById.set(neighbor.id, currentGeneration + neighbor.delta);
      queue.push(neighbor.id);
    }
  }

  for (const person of tree.persons) {
    if (!generationById.has(person.id)) generationById.set(person.id, 0);
  }

  const minGeneration = Math.min(...generationById.values());
  const normalizedGeneration = new Map(
    [...generationById.entries()].map(([id, generation]) => [id, generation - minGeneration]),
  );

  const groups = new Map<number, TreePerson[]>();
  for (const person of tree.persons) {
    const generation = normalizedGeneration.get(person.id) ?? 0;
    groups.set(generation, [...(groups.get(generation) ?? []), person]);
  }

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a - b);
  const widestRow = Math.max(...sortedGroups.map(([, people]) => people.length), 1);
  const width = Math.max(
    920,
    TREE_PAD_X * 2 + widestRow * TREE_NODE_WIDTH + Math.max(0, widestRow - 1) * TREE_X_GAP,
  );
  const height = Math.max(
    420,
    TREE_PAD_Y * 2 +
      sortedGroups.length * TREE_NODE_HEIGHT +
      Math.max(0, sortedGroups.length - 1) * TREE_Y_GAP,
  );

  const nodes: LayoutNode[] = [];
  for (const [rowIndex, [generation, people]] of sortedGroups.entries()) {
    const rowWidth =
      people.length * TREE_NODE_WIDTH + Math.max(0, people.length - 1) * TREE_X_GAP;
    const startX = Math.max(TREE_PAD_X, (width - rowWidth) / 2);

    const ordered = [...people].sort((a, b) =>
      personName(a).localeCompare(personName(b), 'mn'),
    );
    if (generation === 0 && ordered.some((person) => person.id === rootId)) {
      const root = ordered.find((person) => person.id === rootId);
      const peers = ordered.filter((person) => person.id !== rootId);
      peers.splice(Math.floor(peers.length / 2), 0, root!);
      ordered.splice(0, ordered.length, ...peers);
    }

    ordered.forEach((person, index) => {
      nodes.push({
        id: person.id,
        person,
        // Keep the semantic generation relative to the API-selected root.
        // The normalized generation is only for choosing the visual row.
        generation: generationById.get(person.id) ?? 0,
        x: startX + index * (TREE_NODE_WIDTH + TREE_X_GAP),
        y: TREE_PAD_Y + rowIndex * (TREE_NODE_HEIGHT + TREE_Y_GAP),
      });
    });
  }

  return {
    nodes,
    width,
    height,
    generations: sortedGroups.length,
  };
}

function relationshipStatusLabel(status: Marriage['status']) {
  if (status === 'married') return 'Идэвхтэй';
  if (status === 'divorced') return 'Салсан';
  return 'Бэлэвсэн';
}

function marriagePartnerId(marriage: Marriage, personId: string) {
  return marriage.person_1_id === personId ? marriage.person_2_id : marriage.person_1_id;
}

function TreePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPersonId = searchParams.get('person') ?? '';
  const { familyId, currentFamily: family, contextLoading, contextLoaded, contextError } = useAppShellContext();
  const [tree, setTree] = useState<TreeData | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [depth, setDepth] = useState(3);
  const [viewMode, setViewMode] = useState<'full' | 'close'>('full');
  const viewModeRef = useRef<'full' | 'close'>('full');
  const [treeView, setTreeView] = useState<'2d' | '3d'>('2d');
  const [zoom, setZoom] = useState(0.9);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noFamily, setNoFamily] = useState(false);
  const [notice, setNotice] = useState('');
  const [linkRequests, setLinkRequests] = useState<LinkRequest[]>([]);
  const [linkBusy, setLinkBusy] = useState(false);
  const [confirmRoot, setConfirmRoot] = useState(false);
  const [linkToApprove, setLinkToApprove] = useState<LinkRequest | null>(null);
  const [search, setSearch] = useState('');
  const [searchPage, setSearchPage] = useState<PersonSearchPage | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchPageNumber, setSearchPageNumber] = useState(1);
  const [relation, setRelation] = useState<RelationKind | null>(null);

  useEffect(() => {
    if (!relation) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setRelation(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [relation]);
  const [relationError, setRelationError] = useState('');
  const [relationMode, setRelationMode] = useState<'existing' | 'new'>('existing');
  const [relationPersonQuery, setRelationPersonQuery] = useState('');
  const [relationPersonResults, setRelationPersonResults] = useState<PersonSearchPage['items']>([]);
  const [relationPersonId, setRelationPersonId] = useState('');
  const [relationPersonBusy, setRelationPersonBusy] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editingPersonIsAlive, setEditingPersonIsAlive] = useState(true);
  const [editPersonError, setEditPersonError] = useState('');
  const [editPersonBusy, setEditPersonBusy] = useState(false);

  const loadSequence = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const persistSelected = useCallback(
    (personId: string) => {
      setSelectedId(personId);
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      if (personId) params.set('person', personId);
      else params.delete('person');
      window.history.replaceState(null, '', '/tree?' + params.toString());
    },
    [],
  );

  const loadTree = useCallback(
    async (id: string, preferredPersonId?: string, nextDepth = 3) => {
      const sequence = ++loadSequence.current;
      loadAbort.current?.abort();
      const controller = new AbortController();
      loadAbort.current = controller;

      setLoading(true);
      setError('');
      setNotice('');
      setTree(null);
      setSelectedId('');
      setSearchPage(null);
      setRelation(null);

      try {
        if (!family || family.id !== id) return;
        let treeData: TreeData;
        const treeBase = '/families/' + encodeURIComponent(id) + '/tree?depth=' + String(nextDepth)
          + '&scope=' + (viewModeRef.current === 'full' ? 'all' : 'context');
        try {
          const query = preferredPersonId
            ? treeBase + '&person_id=' + encodeURIComponent(preferredPersonId)
            : treeBase;
          treeData = await api<TreeData>(query, { signal: controller.signal });
        } catch (cause) {
          if (
            preferredPersonId &&
            cause instanceof ApiError &&
            (cause.status === 404 || cause.status === 422) &&
            sequence === loadSequence.current
          ) {
            treeData = await api<TreeData>(treeBase, { signal: controller.signal });
          } else {
            throw cause;
          }
        }

        if (sequence !== loadSequence.current || controller.signal.aborted) return;

        setTree(treeData);
        const preferredIsAvailable =
          Boolean(preferredPersonId) &&
          treeData.persons.some((person) => person.id === preferredPersonId);
        const backendRootIsAvailable =
          Boolean(treeData.root_person_id) &&
          treeData.persons.some((person) => person.id === treeData.root_person_id);

        // Never substitute an unrelated Person when a requested Person is unavailable.
        // Only the backend-provided root is eligible as the initial selection.
        const nextSelectedId = preferredPersonId
          ? preferredIsAvailable
            ? preferredPersonId
            : ''
          : backendRootIsAvailable
            ? treeData.root_person_id ?? ''
            : '';

        persistSelected(nextSelectedId);
      } catch (cause) {
        if (sequence !== loadSequence.current || controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(treeFriendlyError(cause, 'Удмын модыг ачаалж чадсангүй.'));
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [family, persistSelected, router],
  );

  useEffect(() => {
    loadAbort.current?.abort();
    searchAbort.current?.abort();
    loadSequence.current += 1;
    searchSequence.current += 1;
    setSearchPage(null);
    setSelectedId('');
    setTree(null);
    setError('');
    setNoFamily(false);

    if (contextLoading || !contextLoaded) {
      setLoading(true);
      return;
    }
    if (contextError) {
      setLoading(false);
      setError(contextError);
      return;
    }
    if (!familyId || !family) {
      setLoading(false);
      setNoFamily(true);
      setTree(EMPTY_TREE);
      return;
    }
    void loadTree(familyId, requestedPersonId || undefined);
  }, [contextError, contextLoaded, contextLoading, family, familyId, loadTree, requestedPersonId]);

  useEffect(() => {
    return () => {
      loadAbort.current?.abort();
      searchAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!familyId || family?.role !== 'owner') { setLinkRequests([]); return; }
    let active = true;
    api<LinkRequest[]>(`/families/${encodeURIComponent(familyId)}/link-requests`)
      .then((rows) => { if (active) setLinkRequests(rows); })
      .catch(() => { if (active) setLinkRequests([]); });
    return () => { active = false; };
  }, [familyId, family?.role]);

  useEffect(() => {
    const query = search.trim();
    searchAbort.current?.abort();

    if (!familyId || !query) {
      searchSequence.current += 1;
      setSearchPage(null);
      setSearchBusy(false);
      return;
    }

    const sequence = ++searchSequence.current;
    const controller = new AbortController();
    searchAbort.current = controller;

    const timer = window.setTimeout(() => {
      setSearchBusy(true);
      api<PersonSearchPage>(
        '/families/' +
          encodeURIComponent(familyId) +
          '/persons/search?q=' +
          encodeURIComponent(query) +
          '&page=1&page_size=25',
        { signal: controller.signal },
      )
        .then((result) => {
          if (sequence !== searchSequence.current || controller.signal.aborted) return;
          setSearchPage(result);
          setSearchPageNumber(1);
        })
        .catch((cause) => {
          if (sequence !== searchSequence.current || controller.signal.aborted) return;
          if (cause instanceof ApiError && cause.status === 401) {
            router.replace('/login');
            return;
          }
          setError(treeFriendlyError(cause, 'Хайлт хийхэд алдаа гарлаа.'));
        })
        .finally(() => {
          if (sequence === searchSequence.current) setSearchBusy(false);
        });
    }, 260);

    return () => window.clearTimeout(timer);
  }, [familyId, router, search]);

  useEffect(() => {
    const query = relationPersonQuery.trim();
    if (!relation || relationMode !== 'existing' || query.length < 2 || !familyId) {
      setRelationPersonResults([]);
      setRelationPersonBusy(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setRelationPersonBusy(true);
      api<PersonSearchPage>(
        '/families/' + encodeURIComponent(familyId) + '/persons/search?q=' +
          encodeURIComponent(query) + '&page=1&page_size=15',
      )
        .then((result) => {
          if (active) setRelationPersonResults(result.items.filter((item) => item.id !== selectedId));
        })
        .catch((cause) => {
          if (active) setRelationError(treeFriendlyError(cause, 'Хүмүүсийн хайлт амжилтгүй боллоо.'));
        })
        .finally(() => {
          if (active) setRelationPersonBusy(false);
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [familyId, relation, relationMode, relationPersonQuery, selectedId]);

  const layout = useMemo(
    () => buildTreeLayout(tree ?? EMPTY_TREE),
    [tree],
  );

  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout],
  );

  const selectedPerson = selectedId
    ? tree?.persons.find((person) => person.id === selectedId) ?? null
    : null;

  const hasBackendRoot =
    Boolean(tree?.root_person_id) &&
    Boolean(tree?.persons.some((person) => person.id === tree.root_person_id));
  const canManageTree = family?.role === 'owner' || family?.role === 'editor';

  useEffect(() => {
    if (!selectedId || !tree || loading) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById('tree-person-' + selectedId);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, selectedId, tree]);

  const relationCounts = useMemo(() => {
    const parents = new Map<string, number>();
    const children = new Map<string, number>();
    const spouses = new Map<string, number>();

    for (const edge of tree?.parent_child_relationships ?? []) {
      parents.set(edge.child_id, (parents.get(edge.child_id) ?? 0) + 1);
      children.set(edge.parent_id, (children.get(edge.parent_id) ?? 0) + 1);
    }

    for (const marriage of tree?.marriages ?? []) {
      spouses.set(
        marriage.person_1_id,
        (spouses.get(marriage.person_1_id) ?? 0) + 1,
      );
      spouses.set(
        marriage.person_2_id,
        (spouses.get(marriage.person_2_id) ?? 0) + 1,
      );
    }

    return { parents, children, spouses };
  }, [tree]);

  const selectedMarriages = useMemo(
    () =>
      tree?.marriages.filter(
        (marriage) =>
          marriage.person_1_id === selectedId || marriage.person_2_id === selectedId,
      ) ?? [],
    [selectedId, tree],
  );

  const selectedParents =
    tree?.parent_child_relationships.filter((edge) => edge.child_id === selectedId) ?? [];
  const selectedChildren =
    tree?.parent_child_relationships.filter((edge) => edge.parent_id === selectedId) ?? [];

  const spouseNames = useMemo(() => {
    if (!tree || !selectedId) return [];
    return selectedMarriages
      .map((marriage) => tree.persons.find((person) => person.id === marriagePartnerId(marriage, selectedId)))
      .filter((person): person is TreePerson => Boolean(person))
      .map((person) => personName(person));
  }, [selectedId, selectedMarriages, tree]);

  function selectPerson(personId: string) {
    if (!tree?.persons.some((person) => person.id === personId)) return;
    persistSelected(personId);
  }

  function profileHref(personId: string) {
    return (
      '/profile?family=' +
      encodeURIComponent(familyId) +
      '&person=' +
      encodeURIComponent(personId)
    );
  }

  function focusSelected() {
    if (!selectedId) return;
    const element = document.getElementById('tree-person-' + selectedId);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }

  function switchView(mode: 'full' | 'close') {
    if (!tree || !familyId) return;
    if (mode === 'close' && !tree.linked_person_id) {
      setNotice('Таны аккаунт удмын хүнтэй холбогдоогүй байна. Эхлээд өөрийгөө хүнээс хайж, гэр бүлийн эзэнтэй холбоосоо баталгаажуулна уу.');
      return;
    }
    setViewMode(mode);
    viewModeRef.current = mode;
    const focus = mode === 'close' ? tree.linked_person_id : tree.lineage_root_person_id;
    void loadTree(familyId, focus || undefined, mode === 'close' ? 2 : 5);
    setDepth(mode === 'close' ? 2 : 5);
  }

  async function designateRoot() {
    if (!familyId || !selectedId || family?.role !== 'owner' || tree?.lineage_root_person_id) return;
    try {
      await api(`/families/${encodeURIComponent(familyId)}/root`, {
        method: 'PUT', body: JSON.stringify({ person_id: selectedId }),
      });
      setNotice('Удмын эхийг хадгаллаа.');
      setConfirmRoot(false);
      await loadTree(familyId, selectedId, depth);
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Удмын эхийг хадгалж чадсангүй.'));
    }
  }

  async function requestLink() {
    if (!familyId || !selectedId || linkBusy) return;
    setLinkBusy(true); setError('');
    try {
      await api(`/families/${encodeURIComponent(familyId)}/persons/${encodeURIComponent(selectedId)}/link-request`, { method: 'POST' });
      setNotice('Холбох хүсэлтийг гэр бүлийн эзэнд илгээлээ. Таныг мөн болохыг баталгаажуулсны дараа холбоно.');
    } catch (cause) { setError(treeFriendlyError(cause, 'Холбох хүсэлт илгээж чадсангүй.')); }
    finally { setLinkBusy(false); }
  }

  async function approveLink(request: LinkRequest) {
    if (!familyId || family?.role !== 'owner' || linkBusy) return;
    setLinkBusy(true); setError('');
    try {
      await api(`/families/${encodeURIComponent(familyId)}/link-requests/${encodeURIComponent(request.id)}/approve`, { method: 'POST' });
      setLinkRequests((rows) => rows.filter((row) => row.id !== request.id));
      setLinkToApprove(null);
      setNotice(`${request.user_name} аккаунтыг ${request.person_name} хүнтэй холболоо.`);
    } catch (cause) { setError(treeFriendlyError(cause, 'Холбоосыг баталгаажуулж чадсангүй.')); }
    finally { setLinkBusy(false); }
  }

  async function loadMoreSearch() {
    if (!searchPage?.has_next || !familyId || searchBusy) return;

    const sequence = ++searchSequence.current;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const nextPage = searchPageNumber + 1;
    setSearchBusy(true);

    try {
      const next = await api<PersonSearchPage>(
        '/families/' +
          encodeURIComponent(familyId) +
          '/persons/search?q=' +
          encodeURIComponent(search.trim()) +
          '&page=' +
          String(nextPage) +
          '&page_size=25',
        { signal: controller.signal },
      );
      if (sequence !== searchSequence.current || controller.signal.aborted) return;
      setSearchPage((current) =>
        current ? { ...next, items: [...current.items, ...next.items] } : next,
      );
      setSearchPageNumber(nextPage);
    } catch (cause) {
      if (sequence !== searchSequence.current || controller.signal.aborted) return;
      setError(treeFriendlyError(cause, 'Хайлтын үр дүнг ачаалж чадсангүй.'));
    } finally {
      if (sequence === searchSequence.current) setSearchBusy(false);
    }
  }

  async function selectSearchResult(personId: string) {
    if (!familyId) return;
    setSearchPage(null);
    setSearch('');
    await loadTree(familyId, personId, depth);
  }

  async function addRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!relation || !selectedId || !familyId) return;

    setRelationError('');
    setError('');
    const form = new FormData(event.currentTarget);
    const existingId = relationMode === 'existing' ? relationPersonId : '';

    try {
      let relatedId = existingId;
      if (!relatedId) {
        if (relationMode === 'existing') {
          setRelationError('Холбох хүнийг хайж сонгоно уу. Шинэ хүн нэмэх бол горимоо солино уу.');
          return;
        }
        const fullName = String(form.get('name') ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (!fullName.length) {
          setRelationError('Шинэ хүний овог, нэрийг оруулна уу.');
          return;
        }
        const created = await api<Person>(
          '/families/' + encodeURIComponent(familyId) + '/persons',
          {
            method: 'POST',
            body: JSON.stringify({
              first_name: fullName.at(-1) ?? '',
              last_name: fullName.slice(0, -1).join(' '),
              gender: form.get('gender'),
              birth_date: form.get('birth_date') || null,
              visibility: 'family',
            }),
          },
        );
        relatedId = created.id;
      }

      if (relation === 'spouse') {
        await api(
          '/families/' + encodeURIComponent(familyId) + '/marriages',
          {
            method: 'POST',
            body: JSON.stringify({
              person_1_id: selectedId,
              person_2_id: relatedId,
              status: 'married',
              start_date: form.get('start_date') || null,
            }),
          },
        );
      } else {
        await api(
          '/families/' +
            encodeURIComponent(familyId) +
            '/relationships/parent-child',
          {
            method: 'POST',
            body: JSON.stringify({
              parent_id: relation === 'parent' ? relatedId : selectedId,
              child_id: relation === 'parent' ? selectedId : relatedId,
              relationship_type: form.get('relationship_type'),
            }),
          },
        );
      }

      setRelation(null);
      setRelationPersonId('');
      setRelationPersonQuery('');
      setNotice('Гэр бүлийн холбоо хадгалагдлаа.');
      await loadTree(familyId, selectedId, depth);
    } catch (cause) {
      setRelationError(
        cause instanceof Error
          ? cause.message
          : 'Холбоог хадгалж чадсангүй.',
      );
    }
  }

  function beginRelation(kind: RelationKind) {
    setRelationError('');
    setRelationMode('existing');
    setRelationPersonId('');
    setRelationPersonQuery('');
    setRelationPersonResults([]);
    setRelation(kind);
  }

  async function openPersonEditor(personId: string) {
    setEditPersonError('');
    setEditPersonBusy(true);
    try {
      const profile = await api<Person>(
        '/families/' + encodeURIComponent(familyId) + '/persons/' + encodeURIComponent(personId),
      );
      setEditingPerson(profile);
      setEditingPersonIsAlive(profile.is_alive);
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Хүний мэдээллийг нээж чадсангүй.'));
    } finally {
      setEditPersonBusy(false);
    }
  }

  async function savePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPerson || !familyId) return;
    const values = new FormData(event.currentTarget);
    const alive = values.get('is_alive') === 'true';
    const optional = (key: string) => String(values.get(key) ?? '').trim() || null;
    const body = {
      first_name: String(values.get('first_name') ?? '').trim(),
      last_name: String(values.get('last_name') ?? '').trim(),
      middle_name: optional('middle_name'),
      nickname: optional('nickname'),
      gender: String(values.get('gender') ?? 'unknown'),
      birth_date: optional('birth_date'),
      birth_place: optional('birth_place'),
      is_alive: alive,
      death_date: alive ? null : optional('death_date'),
      death_place: alive ? null : optional('death_place'),
      short_description: optional('short_description'),
      visibility: String(values.get('visibility') ?? 'family'),
    };
    setEditPersonError('');
    setEditPersonBusy(true);
    try {
      await api<Person>(
        '/families/' + encodeURIComponent(familyId) + '/persons/' + encodeURIComponent(editingPerson.id),
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      const personId = editingPerson.id;
      setEditingPerson(null);
      await loadTree(familyId, personId, depth);
      setNotice('Хүний мэдээллийг шинэчиллээ.');
    } catch (cause) {
      setEditPersonError(treeFriendlyError(cause, 'Хүний мэдээллийг хадгалж чадсангүй.'));
    } finally {
      setEditPersonBusy(false);
    }
  }

  async function detachPerson(personId: string) {
    const person = tree?.persons.find((candidate) => candidate.id === personId);
    const name = person ? personName(person) : 'энэ хүнийг';
    if (!familyId || !window.confirm(
      name + ' хүнийг энэ гэр бүлийн жагсаалтаас салгах уу? Хүний үндсэн бүртгэл болон түүх хадгалагдана.',
    )) return;
    try {
      await api<void>(
        '/families/' + encodeURIComponent(familyId) + '/persons/' + encodeURIComponent(personId),
        { method: 'DELETE' },
      );
      await loadTree(familyId, undefined, depth);
      setNotice(name + ' хүнийг энэ гэр бүлийн модноос салгалаа.');
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Хүнийг гэр бүлийн модноос салгаж чадсангүй.'));
    }
  }

  async function updateParentChild(edge: TreeData['parent_child_relationships'][number], relationshipType: string) {
    try {
      await api(
        '/families/' + encodeURIComponent(familyId) + '/relationships/parent-child/' + encodeURIComponent(edge.id),
        {
          method: 'PATCH',
          body: JSON.stringify({ relationship_type: relationshipType }),
        },
      );
      await loadTree(familyId, selectedId, depth);
      setNotice('Эцэг эх-хүүхдийн холбооны төрлийг шинэчиллээ.');
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Холбооны төрлийг өөрчилж чадсангүй.'));
    }
  }

  async function removeParentChild(edge: TreeData['parent_child_relationships'][number]) {
    if (!window.confirm('Энэ эцэг эх-хүүхдийн холбоосыг модноос арилгах уу? Хоёр хүний бүртгэл хэвээр үлдэнэ.')) return;
    try {
      await api<void>(
        '/families/' + encodeURIComponent(familyId) + '/relationships/parent-child/' + encodeURIComponent(edge.id),
        { method: 'DELETE' },
      );
      await loadTree(familyId, selectedId, depth);
      setNotice('Буруу холбоосыг арилгалаа. Хүний бүртгэлүүд хэвээр үлдсэн.');
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Холбоосыг арилгаж чадсангүй.'));
    }
  }

  async function removeMarriage(marriageId: string) {
    if (!window.confirm('Энэ гэрлэлтийн бүртгэлийг түүхээс нуух уу?')) return;
    try {
      await api<void>(
        '/families/' + encodeURIComponent(familyId) + '/marriages/' + encodeURIComponent(marriageId),
        { method: 'DELETE' },
      );
      await loadTree(familyId, selectedId, depth);
      setNotice('Гэрлэлтийн бүртгэлийг архивлалаа.');
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Гэрлэлтийн бүртгэлийг арилгаж чадсангүй.'));
    }
  }

  async function divorce(marriageId: string) {
    if (!familyId || !selectedId) return;
    const endDate = window.prompt(
      'Салсан огноо (YYYY-MM-DD). Мэдэхгүй бол хоосон үлдээнэ үү.',
    );
    if (endDate === null) return;

    try {
      await api(
        '/families/' +
          encodeURIComponent(familyId) +
          '/marriages/' +
          encodeURIComponent(marriageId),
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'divorced',
            end_date: endDate || null,
          }),
        },
      );
      setNotice('Гэрлэлтийн мэдээлэл шинэчлэгдлээ.');
      await loadTree(familyId, selectedId, depth);
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Гэрлэлтийн мэдээллийг шинэчилж чадсангүй.'));
    }
  }

  if (noFamily) {
    return (
      <main className="tree-page">
        <section className="tree-state tree-state--empty">
          <div className="tree-state-mark" aria-hidden="true">🌳</div>
          <p className="tree-eyebrow">ГУУЛИНГИЙНХАН · УДМЫН МОД</p>
          <h1>Гэр бүлийн орчин олдсонгүй.</h1>
          <p>Таны эрхтэй гэр бүл байхгүй тул удмын модыг нээх боломжгүй байна.</p>
          <Link className="tree-button tree-button--primary" href="/families">Гэр бүлүүд</Link>
        </section>
      </main>
    );
  }

  if (loading && !tree) {
    return (
      <main className="tree-page">
        <section className="tree-shell">
          <div className="tree-page-header tree-skeleton-header" aria-hidden="true">
            <div className="tree-skeleton tree-skeleton--title" />
            <div className="tree-skeleton tree-skeleton--control" />
          </div>
          <div className="tree-loading-scene" role="status" aria-live="polite">
            <div className="tree-loading-tree" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <strong>Удмын модыг ачаалж байна…</strong>
            <small>Гэр бүлийн зөвшөөрөгдсөн хүмүүс болон холбоосуудыг татаж байна.</small>
          </div>
        </section>
      </main>
    );
  }

  if (error && !tree) {
    return (
      <main className="tree-page">
        <section className="tree-state tree-state--empty">
          <div className="tree-state-mark" aria-hidden="true">!</div>
          <p className="tree-eyebrow">ГУУЛИНГИЙНХАН · УДМЫН МОД</p>
          <h1>Удмын модыг ачаалж чадсангүй.</h1>
          <p>{error}</p>
          <button
            type="button"
            className="tree-button tree-button--primary"
            onClick={() => {
              if (familyId) {
                void loadTree(familyId, selectedId || undefined, depth);
              } else {
                window.location.reload();
              }
            }}
          >
            Дахин оролдох
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="tree-page">
      <section className="tree-shell">
        <header className="tree-page-header">
          <div>
            <Link className="tree-back-link" href={'/dashboard?family=' + encodeURIComponent(familyId)}>
              ← Гэр бүлийн тойм
            </Link>
            <p className="tree-eyebrow">ГУУЛИНГИЙНХАН · УДМЫН МОД</p>
            <h1>{family?.name ?? 'Удмын мод'}</h1>
            <p className="tree-lede">
              Удам, гэрлэлт, үеийн холбоосыг зөвхөн таны хандах эрхтэй бодит гэр бүлийн мэдээллээр харуулна.
            </p>
          </div>

          <div className="tree-header-actions">
            <button type="button" className={'tree-button ' + (viewMode === 'full' ? 'tree-button--primary' : 'tree-button--secondary')} onClick={() => switchView('full')}>Бүх удам</button>
            <button type="button" className={'tree-button ' + (viewMode === 'close' ? 'tree-button--primary' : 'tree-button--secondary')} onClick={() => switchView('close')}>Ойрын хүрээ</button>
            {family?.role === 'owner' && !tree?.lineage_root_person_id && selectedId && <button type="button" className="tree-button tree-button--secondary" onClick={() => setConfirmRoot(true)}>Сонгосон хүнийг удмын эх болгох</button>}
            {tree && !tree.linked_person_id && selectedId && <button type="button" className="tree-button tree-button--secondary" disabled={linkBusy} onClick={() => void requestLink()}>Өөрийн бүртгэлтэй холбох хүсэлт</button>}
            <Link
              className="tree-button tree-button--secondary"
              href={'/people?family=' + encodeURIComponent(familyId)}
            >
              Хүмүүс
            </Link>
            <button type="button" className="tree-button tree-button--secondary" onClick={focusSelected} disabled={!selectedId}>
              Сонгосон хүнийг төвд
            </button>
          </div>
        </header>

        {error && (
          <div className="tree-alert tree-alert--error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadTree(familyId, selectedId || undefined, depth)}>
              Дахин оролдох
            </button>
          </div>
        )}

        {notice && (
          <div className="tree-alert tree-alert--success" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Мэдэгдлийг хаах">×</button>
          </div>
        )}

        {tree?.persons.length && !tree.lineage_root_person_id && <div className="tree-alert tree-alert--info" role="status">Энэ гэр бүлийн удмын эхийг эзэн нь хараахан баталгаажуулаагүй байна. Одоогийн мод бодит хүмүүс, холбоосыг харуулж байгаа ч үеийн дугаарыг удмын эхтэй холбож үзүүлэхгүй.</div>}
        {tree?.persons.length && !tree.linked_person_id && <div className="tree-alert tree-alert--info" role="status">Удмын мод бэлэн байна. Та өөрийн Person бүртгэлтэй холбогдоогүй бол “Хүмүүс” хэсэгт өөрийгөө олж, гэр бүлийн эзэнтэй холбоосоо баталгаажуулна уу.</div>}
        {family?.role === 'owner' && linkRequests.length > 0 && <section className="tree-link-requests" aria-label="Холбох хүсэлтүүд"><h2>Хүнтэй холбох хүсэлт</h2><p>Батлахаас өмнө хүсэлт гаргагчийн хэн болохыг шалгана уу.</p>{linkRequests.map((request) => <div key={request.id}><span><strong>{request.user_name}</strong> → {request.person_name}</span><button type="button" disabled={linkBusy} onClick={() => setLinkToApprove(request)}>Шалгаж батлах</button></div>)}</section>}

        <section className="tree-workspace" aria-label="Удмын модны ажлын хэсэг">
          <div className="tree-workspace-top">
            <div className="tree-stats" aria-live="polite">
              <strong>{tree?.persons.length ?? 0}</strong><span>хүн</span>
              <i aria-hidden="true">·</i>
              <strong>{tree?.marriages.length ?? 0}</strong><span>гэрлэлт</span>
              {tree?.meta?.truncated ? <em>Хэсэгчлэн ачаалсан</em> : null}
            </div>

            <div className="tree-controls">
              <div className="tree-segmented" role="group" aria-label="Модны харагдац">
                <button type="button" aria-pressed={treeView === '2d'} onClick={() => setTreeView('2d')}>2D мод</button>
                <button type="button" aria-pressed={treeView === '3d'} onClick={() => setTreeView('3d')}>3D орон зай</button>
              </div>
              <label>
                <span>Хүрээ</span>
                <select
                  value={depth}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setDepth(next);
                    void loadTree(familyId, selectedId || undefined, next);
                  }}
                >
                  <option value={1}>1 үе</option>
                  <option value={2}>2 үе</option>
                  <option value={3}>3 үе</option>
                  <option value={4}>4 үе</option>
                  <option value={5}>5 үе</option>
                </select>
              </label>

              <div className="tree-zoom" aria-label="Модны хэмжээ">
                <button
                  type="button"
                  onClick={() => setZoom((value) => Math.max(0.65, Number((value - 0.1).toFixed(2))))}
                  aria-label="Жижигрүүлэх"
                >
                  −
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((value) => Math.min(1.3, Number((value + 0.1).toFixed(2))))}
                  aria-label="Томруулах"
                >
                  +
                </button>
                <button type="button" onClick={() => {
                  const available = Math.max(280, (scrollRef.current?.clientWidth || window.innerWidth) - 28);
                  setZoom(Math.max(0.3, Math.min(1, Number((available / layout.width).toFixed(2)))));
                  scrollRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
                }}>Тааруулах</button>
              </div>
            </div>
          </div>

          <div className="tree-search-wrap">
            <label className="tree-search">
              <span>Гэр бүлийн хүн хайх</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Нэрээр хайх…"
                autoComplete="off"
                spellCheck={false}
                aria-label="Гэр бүлийн хүн хайх"
              />
            </label>

            {searchBusy && <span className="tree-search-status" role="status">Хайж байна…</span>}

            {search.trim() && searchPage && (
              <section className="tree-search-results" aria-label="Хайлтын үр дүн">
                <div className="tree-search-results-head">
                  <strong>{searchPage.total} үр дүн</strong>
                  <button type="button" onClick={() => { setSearch(''); setSearchPage(null); }}>Хаах</button>
                </div>
                {searchPage.items.length === 0 ? (
                  <p>Тохирох хүн олдсонгүй.</p>
                ) : (
                  <div className="tree-search-result-list">
                    {searchPage.items.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => void selectSearchResult(item.id)}
                      >
                        <span className="tree-mini-avatar" aria-hidden="true">
                          {item.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.birth_year ? item.birth_year + ' · Модонд харах' : 'Модонд харах'}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {searchPage.has_next && (
                  <button
                    type="button"
                    className="tree-search-more"
                    onClick={() => void loadMoreSearch()}
                    disabled={searchBusy}
                  >
                    {searchBusy ? 'Ачаалж байна…' : 'Дараагийн үр дүн'}
                  </button>
                )}
              </section>
            )}
          </div>

          {tree?.persons.length && !hasBackendRoot ? (
            <section className="tree-state tree-state--empty tree-state--in-shell" role="status">
              <div className="tree-state-mark" aria-hidden="true">!</div>
              <h2>Удмын мод бүрэн бэлэн болоогүй байна.</h2>
              <p>Энэ гэр бүлийн модонд backend-ээс баталгаатай төв хүн ирээгүй тул буруу холбоос таамаглан харуулахгүй.</p>
              <Link className="tree-button tree-button--primary" href={'/people?family=' + encodeURIComponent(familyId)}>
                Хүмүүс рүү очих
              </Link>
            </section>
          ) : !tree?.persons.length ? (
            <section className="tree-state tree-state--empty tree-state--in-shell">
              <div className="tree-state-mark" aria-hidden="true">🌳</div>
              <h2>Удмын мод одоогоор хоосон байна.</h2>
              <p>Энэ гэр бүлийн зөвшөөрөгдсөн орчинд одоогоор хүн эсвэл холбоос алга байна.</p>
              <Link className="tree-button tree-button--primary" href={'/people?family=' + encodeURIComponent(familyId)}>
                Хүмүүс рүү очих
              </Link>
            </section>
          ) : (
            <div className={'tree-map-layout ' + (treeView === '3d' ? 'tree-map-layout--3d' : '')}>
              {treeView === '3d' ? <Tree3DScene
                data={tree}
                selectedPersonId={selectedId}
                currentPersonId={tree.linked_person_id}
                canonicalRootId={tree.lineage_root_person_id || tree.root_person_id}
                onSelect={selectPerson}
                onFallback={() => setTreeView('2d')}
              /> : (
              <div
                ref={scrollRef}
                className="tree-map-scroll"
                style={{ height: Math.max(440, layout.height * zoom + 24), maxHeight: '72vh' }}
                tabIndex={0}
                aria-label="Удмын модны зөөврийн зураглал. Хэвтээ болон босоо гүйлгэж удам угсааг харна."
              >
                <div
                  className="tree-map-space"
                  style={{
                    width: layout.width * zoom,
                    height: layout.height * zoom,
                  }}
                >
                  <div
                    className="tree-map-stage"
                    style={{
                      width: layout.width,
                      height: layout.height,
                      transform: 'scale(' + zoom + ')',
                    }}
                  >
                    <div className="tree-map-scenery" aria-hidden="true" />
                    <div className="tree-map-veil" aria-hidden="true" />

                    <svg
                      className="tree-connectors"
                      width={layout.width}
                      height={layout.height}
                      viewBox={'0 0 ' + layout.width + ' ' + layout.height}
                      aria-hidden="true"
                    >
                      {tree.parent_child_relationships.map((edge) => {
                        const parent = nodeById.get(edge.parent_id);
                        const child = nodeById.get(edge.child_id);
                        if (!parent || !child) return null;

                        const x1 = parent.x + TREE_NODE_WIDTH / 2;
                        const y1 = parent.y + TREE_NODE_HEIGHT - 4;
                        const x2 = child.x + TREE_NODE_WIDTH / 2;
                        const y2 = child.y + 4;
                        const middleY = (y1 + y2) / 2;

                        return (
                          <g key={'parent-' + edge.id} className="tree-branch">
                            <path
                              d={'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + middleY + ', ' + x2 + ' ' + middleY + ', ' + x2 + ' ' + y2}
                              className={'tree-connector tree-connector--parent tree-connector--shadow ' + (edge.relationship_type === 'adoptive' ? 'is-adoptive' : '')}
                            />
                            <path
                              d={'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + middleY + ', ' + x2 + ' ' + middleY + ', ' + x2 + ' ' + y2}
                              className={'tree-connector tree-connector--parent tree-connector--bark ' + (edge.relationship_type === 'adoptive' ? 'is-adoptive' : '')}
                            />
                            <path
                              d={'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + middleY + ', ' + x2 + ' ' + middleY + ', ' + x2 + ' ' + y2}
                              className={'tree-connector tree-connector--parent tree-connector--glint ' + (edge.relationship_type === 'adoptive' ? 'is-adoptive' : '')}
                            />
                          </g>
                        );
                      })}

                      {tree.marriages.map((marriage) => {
                        const first = nodeById.get(marriage.person_1_id);
                        const second = nodeById.get(marriage.person_2_id);
                        if (!first || !second) return null;

                        const x1 = first.x + TREE_NODE_WIDTH;
                        const y1 = first.y + TREE_NODE_HEIGHT / 2;
                        const x2 = second.x;
                        const y2 = second.y + TREE_NODE_HEIGHT / 2;
                        const isHistorical = marriage.status !== 'married';

                        const startX = Math.min(x1, x2);
                        const endX = Math.max(x1, x2);
                        const lineY = (y1 + y2) / 2;

                        return (
                          <g key={'marriage-' + marriage.id}>
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              className={'tree-connector tree-connector--spouse ' + (isHistorical ? 'is-history' : '')}
                            />
                            <circle
                              cx={(startX + endX) / 2}
                              cy={lineY}
                              r="6"
                              className={'tree-marriage-dot ' + (isHistorical ? 'is-history' : '')}
                            />
                          </g>
                        );
                      })}
                    </svg>

                    {layout.nodes.map((node) => {
                      const person = node.person;
                      const selected = person.id === selectedId;
                      const parentCount = relationCounts.parents.get(person.id) ?? 0;
                      const childCount = relationCounts.children.get(person.id) ?? 0;
                      const spouseCount = relationCounts.spouses.get(person.id) ?? 0;

                      return (
                        <article
                          key={person.id}
                          id={'tree-person-' + person.id}
                          data-person-id={person.id}
                          className={'tree-person-card ' + (selected ? 'is-selected' : '')}
                          style={{
                            left: node.x,
                            top: node.y,
                          }}
                        >
                          <button
                            type="button"
                            className="tree-person-select"
                            aria-pressed={selected}
                            aria-label={personName(person) + ' хүнийг сонгох'}
                            onClick={() => selectPerson(person.id)}
                          >
                            <ProfilePhoto className="tree-person-avatar" url={person.profile_photo_url} name={personName(person)} fallback={initials(person)} />
                            <strong>{personName(person) || 'Нэргүй хүн'}</strong>
                            <span>{lifeSummary(person)}</span>
                            <em>{tree.lineage_root_person_id && viewMode === 'full' ? generationLabel(node.generation) : 'Үе тогтоогоогүй'}</em>
                          </button>

                          <div className="tree-person-meta">
                            <span>{parentCount} эцэг/эх</span>
                            <span>{childCount} хүүхэд</span>
                            <span>{spouseCount} хань</span>
                          </div>

                          {(person.lineage_name || person.branch_name) && (
                            <div className="tree-person-tags">
                              {person.lineage_name ? <span>{person.lineage_name}</span> : null}
                              {person.branch_name ? <span>{person.branch_name}</span> : null}
                            </div>
                          )}

                          <Link
                            className="tree-person-profile"
                            href={profileHref(person.id)}
                            aria-label={personName(person) + ' профайл нээх'}
                          >
                            Профайл →
                          </Link>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
              )}

              <aside className="tree-selected-panel" aria-label="Сонгосон хүний мэдээлэл">
                {selectedPerson ? (
                  <>
                    <div className="tree-selected-heading">
                      <ProfilePhoto className="tree-selected-avatar" url={selectedPerson.profile_photo_url} name={personName(selectedPerson)} fallback={initials(selectedPerson)} />
                      <div>
                        <p className="tree-eyebrow">СОНГОГДСОН ХҮН</p>
                        <h2>{personName(selectedPerson) || 'Нэргүй хүн'}</h2>
                        <span>{lifeSummary(selectedPerson)}</span>
                      </div>
                    </div>

                    <div className="tree-selected-context">
                      <div>
                        <span>Эцэг/эх</span>
                        <strong>{selectedParents.length}</strong>
                      </div>
                      <div>
                        <span>Хүүхэд</span>
                        <strong>{selectedChildren.length}</strong>
                      </div>
                      <div>
                        <span>Гэрлэлт</span>
                        <strong>{selectedMarriages.length}</strong>
                      </div>
                    </div>

                    <div className="tree-selected-actions">
                      <Link className="tree-button tree-button--primary" href={profileHref(selectedPerson.id)}>
                        Профайл үзэх
                      </Link>
                      {canManageTree && (
                        <>
                          <button type="button" className="tree-button tree-button--secondary" onClick={() => void openPersonEditor(selectedPerson.id)} disabled={editPersonBusy}>
                            {editPersonBusy ? 'Нээж байна…' : 'Мэдээлэл засах'}
                          </button>
                          <div className="tree-add-relation-grid">
                            <button type="button" className="tree-button tree-button--secondary" onClick={() => beginRelation('parent')}>+ Эцэг/эх</button>
                            <button type="button" className="tree-button tree-button--secondary" onClick={() => beginRelation('child')}>+ Хүүхэд</button>
                            <button type="button" className="tree-button tree-button--secondary" onClick={() => beginRelation('spouse')}>+ Гэрлэлт</button>
                          </div>
                          <button type="button" className="tree-button tree-button--danger" onClick={() => void detachPerson(selectedPerson.id)}>
                            Энэ модноос салгах
                          </button>
                        </>
                      )}
                    </div>

                    <div className="tree-selected-relations">
                      <section>
                        <h3>Эцэг, эх</h3>
                        {selectedParents.length ? selectedParents.map((edge) => {
                          const parent = tree?.persons.find((person) => person.id === edge.parent_id);
                          return (
                            <div className="tree-relation-row" key={edge.id}>
                              <strong>{parent ? personName(parent) : 'Хүний мэдээлэл харагдахгүй байна'}</strong>
                              <span>{parentLinkLabel(edge.relationship_type)}</span>
                              {canManageTree && <div className="tree-relation-actions">
                                <select aria-label="Эцэг эхийн холбооны төрөл" value={edge.relationship_type} onChange={(event) => void updateParentChild(edge, event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option><option value="step">Дагавар</option></select>
                                <button type="button" className="is-danger" onClick={() => void removeParentChild(edge)}>Холбоос хасах</button>
                              </div>}
                            </div>
                          );
                        }) : <span>Бүртгэлтэй эцэг, эхийн холбоо алга.</span>}
                      </section>

                      <section>
                        <h3>Хүүхдүүд</h3>
                        {selectedChildren.length ? selectedChildren.map((edge) => {
                          const child = tree?.persons.find((person) => person.id === edge.child_id);
                          return (
                            <div className="tree-relation-row" key={edge.id}>
                              <strong>{child ? personName(child) : 'Хүний мэдээлэл харагдахгүй байна'}</strong>
                              <span>{parentLinkLabel(edge.relationship_type)}</span>
                              {canManageTree && <div className="tree-relation-actions">
                                <select aria-label="Хүүхдийн холбооны төрөл" value={edge.relationship_type} onChange={(event) => void updateParentChild(edge, event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option><option value="step">Дагавар</option></select>
                                <button type="button" className="is-danger" onClick={() => void removeParentChild(edge)}>Холбоос хасах</button>
                              </div>}
                            </div>
                          );
                        }) : <span>Бүртгэлтэй хүүхдийн холбоо алга.</span>}
                      </section>

                      <section>
                        <h3>Хань</h3>
                        {spouseNames.length ? (
                          <p>{spouseNames.join(' · ')}</p>
                        ) : (
                          <span>Бүртгэлтэй хань алга.</span>
                        )}
                      </section>

                      <section>
                        <h3>Гэрлэлтийн түүх</h3>
                        {selectedMarriages.length ? (
                          selectedMarriages.map((marriage) => {
                            const partner = tree?.persons.find(
                              (person) => person.id === marriagePartnerId(marriage, selectedId),
                            );
                            return (
                              <div className="tree-marriage-row" key={marriage.id}>
                                <div>
                                  <strong>{partner ? personName(partner) : 'Нөгөө талын мэдээлэл хязгаарлагдсан'}</strong>
                                  <span>
                                    {relationshipStatusLabel(marriage.status)} · {marriage.start_date ?? 'Эхэлсэн огноо тодорхойгүй'}
                                    {marriage.end_date ? ' – ' + marriage.end_date : ''}
                                  </span>
                                </div>
                                {marriage.status === 'married' && (
                                  <button type="button" onClick={() => void divorce(marriage.id)}>
                                    Салалтыг бүртгэх
                                  </button>
                                )}
                                {canManageTree && <button type="button" className="is-danger" onClick={() => void removeMarriage(marriage.id)}>Арилгах</button>}
                              </div>
                            );
                          })
                        ) : (
                          <span>Гэрлэлтийн бүртгэл алга.</span>
                        )}
                      </section>
                    </div>
                  </>
                ) : (
                  <div className="tree-selected-empty">
                    <span className="tree-state-mark" aria-hidden="true">◎</span>
                    <h2>Хүнийг сонгоно уу.</h2>
                    <p>Удмын модны хүн дээр дарж тухайн хүний холбоос болон профайл руу орно.</p>
                  </div>
                )}
              </aside>
            </div>
          )}
        </section>

        {tree?.meta?.truncated && (
          <p className="tree-truncated-note">
            Энэ мод API-ийн аюулгүй дээд хязгаараас хэтэрсэн тул бүх хүнийг нэг дор харуулахгүй байж болно. Хайлт ашиглан өөр хүнийг төв болгон үргэлжлүүлэн хараарай.
          </p>
        )}

        <footer className="tree-footer-note">
          <span>Удмын холбоосыг зөвхөн backend-ээс зөвшөөрөгдсөн Person болон Relationship өгөгдлөөр зурна.</span>
          <span>Гэрлэлт болон эцэг-эх/хүүхдийн холбоо тусдаа хадгалагдана.</span>
        </footer>
      </section>

      {(confirmRoot || linkToApprove) && <div className="tree-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !linkBusy) { setConfirmRoot(false); setLinkToApprove(null); } }}><section className="tree-modal" role="dialog" aria-modal="true" aria-labelledby="tree-confirm-title"><div className="tree-modal-heading"><div><p className="tree-eyebrow">БАТАЛГААЖУУЛАХ</p><h2 id="tree-confirm-title">{confirmRoot ? 'Удмын эхийг сонгох' : 'Хүнтэй холбох'}</h2></div></div><p>{confirmRoot ? `${selectedPerson ? personName(selectedPerson) : 'Сонгосон хүн'}-ийг удмын эхээр хадгална. Энгийн дэлгэцээс дараа нь солих боломжгүй.` : `${linkToApprove?.user_name} аккаунтыг ${linkToApprove?.person_name} хүнтэй холбоно. Батлахаас өмнө хүсэлт гаргагчийн хэн болохыг шалгана уу.`}</p><div className="tree-modal-actions"><button type="button" className="tree-button tree-button--secondary" disabled={linkBusy} onClick={() => { setConfirmRoot(false); setLinkToApprove(null); }}>Болих</button><button type="button" className="tree-button tree-button--primary" disabled={linkBusy} onClick={() => { if (confirmRoot) void designateRoot(); else if (linkToApprove) void approveLink(linkToApprove); }}>{linkBusy ? 'Хүлээнэ үү…' : 'Батлах'}</button></div></section></div>}

      {relation && selectedPerson && (
        <div className="tree-modal-backdrop" role="presentation" onMouseDown={() => setRelation(null)}>
          <section
            className="tree-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tree-relation-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tree-modal-heading">
              <div>
                <p className="tree-eyebrow">ХОЛБОО</p>
                <h2 id="tree-relation-title">
                  {relation === 'parent' ? 'Эцэг/эх нэмэх' : relation === 'child' ? 'Хүүхэд нэмэх' : 'Гэрлэлт нэмэх'}
                </h2>
              </div>
              <button type="button" onClick={() => setRelation(null)} aria-label="Холбооны цонхыг хаах">×</button>
            </div>

            {relationError && <div className="tree-alert tree-alert--error" role="alert">{relationError}</div>}

            <form onSubmit={addRelation} className="tree-modal-form">
              <div className="tree-mode-switch" role="group" aria-label="Хүн сонгох эсвэл шинээр нэмэх">
                <button type="button" className={relationMode === 'existing' ? 'is-active' : ''} onClick={() => { setRelationMode('existing'); setRelationPersonId(''); }}>
                  Бүртгэлтэй хүн холбох
                </button>
                <button type="button" className={relationMode === 'new' ? 'is-active' : ''} onClick={() => { setRelationMode('new'); setRelationPersonId(''); }}>
                  Шинэ хүн бүртгээд холбох
                </button>
              </div>
              <p className="tree-modal-hint">Холбоосыг хасахад хүний бүртгэл үлдэнэ. Бүртгэлтэй хүн олдохгүй бол шинээр бүртгээд энэ холбоонд оруулна.</p>

              {relationMode === 'existing' ? (
                <>
                  <label>
                    <span>Гэр бүлийн бүртгэлээс хайх</span>
                    <input value={relationPersonQuery} onChange={(event) => { setRelationPersonQuery(event.target.value); setRelationPersonId(''); }} placeholder="Нэрийн эхний хэсгийг бичнэ үү…" autoComplete="off" />
                  </label>
                  {relationPersonBusy && <small className="tree-modal-hint" role="status">Хайж байна…</small>}
                  {relationPersonResults.length > 0 && (
                    <div className="tree-relation-search-results" role="listbox" aria-label="Хайсан гэр бүлийн хүмүүс">
                      {relationPersonResults.map((person) => (
                        <button type="button" key={person.id} role="option" aria-selected={relationPersonId === person.id} onClick={() => { setRelationPersonId(person.id); setRelationPersonQuery(person.name); }}>
                          <span className="tree-mini-avatar" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>
                          <span><strong>{person.name}</strong><small>{person.birth_year ?? 'Төрсөн он тодорхойгүй'}</small></span>
                        </button>
                      ))}
                    </div>
                  )}
                  {relationPersonQuery.trim().length >= 2 && !relationPersonBusy && relationPersonResults.length === 0 && (
                    <small className="tree-modal-hint">Ийм нэртэй бүртгэл олдсонгүй. Шинэ хүн нэмэх бол дээрх горимыг сонгоно уу.</small>
                  )}
                  <label>
                    <span>Модонд харагдаж буй хүнээс сонгох</span>
                    <select value={relationPersonId} onChange={(event) => { setRelationPersonId(event.target.value); setRelationPersonQuery(''); }}>
                      <option value="">Хүн сонгоно уу</option>
                      {tree?.persons.filter((person) => person.id !== selectedId).map((person) => (
                        <option value={person.id} key={person.id}>{personName(person)}</option>
                      ))}
                      {relationPersonResults.filter((item) => !tree?.persons.some((person) => person.id === item.id)).map((item) => (
                        <option value={item.id} key={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <small className="tree-modal-hint">Ижил нэртэй бүртгэл байвал эхлээд хайж сонгоорой. Нэг хүнийг давхар үүсгэхээс сэргийлнэ.</small>
                </>
              ) : (
                <>
                  <label>
                    <span>Шинэ хүний овог, нэр</span>
                    <input name="name" maxLength={360} placeholder="Овог Нэр" required />
                  </label>
                  <label>
                    <span>Хүйс</span>
                    <select name="gender" defaultValue="unknown">
                      <option value="unknown">Тодорхойгүй</option>
                      <option value="male">Эрэгтэй</option>
                      <option value="female">Эмэгтэй</option>
                      <option value="other">Бусад</option>
                    </select>
                  </label>
                  <label>
                    <span>Төрсөн огноо (мэдэж байвал)</span>
                    <input name="birth_date" type="date" />
                  </label>
                </>
              )}

              {relation === 'spouse' ? (
                <label>
                  <span>Гэрлэсэн огноо</span>
                  <input name="start_date" type="date" />
                </label>
              ) : (
                <label>
                  <span>Холбооны төрөл</span>
                  <select name="relationship_type" defaultValue="biological">
                    <option value="biological">Төрсөн</option>
                    <option value="adoptive">Үрчилсэн</option>
                    <option value="step">Дагавар (ханьтай гэрлэснээр өөрийн төрсөн хүүхэд болохгүй)</option>
                  </select>
                </label>
              )}

              <div className="tree-modal-actions">
                <button type="button" className="tree-button tree-button--secondary" onClick={() => setRelation(null)}>
                  Болих
                </button>
                <button type="submit" className="tree-button tree-button--primary" disabled={relationMode === 'existing' && !relationPersonId}>
                  Холбоог хадгалах
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editingPerson && (
        <div className="tree-modal-backdrop" role="presentation" onMouseDown={() => setEditingPerson(null)}>
          <section className="tree-modal tree-person-editor" role="dialog" aria-modal="true" aria-labelledby="tree-person-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="tree-modal-heading">
              <div>
                <p className="tree-eyebrow">ХҮНИЙ БҮРТГЭЛ</p>
                <h2 id="tree-person-editor-title">Мэдээлэл засах</h2>
              </div>
              <button type="button" onClick={() => setEditingPerson(null)} aria-label="Засварын цонх хаах">×</button>
            </div>
            {editPersonError && <div className="tree-alert tree-alert--error" role="alert">{editPersonError}</div>}
            <form onSubmit={savePerson} className="tree-modal-form tree-editor-grid">
              <label><span>Нэр</span><input name="first_name" defaultValue={editingPerson.first_name} maxLength={120} required /></label>
              <label><span>Овог</span><input name="last_name" defaultValue={editingPerson.last_name} maxLength={120} /></label>
              <label><span>Эцэг/эхийн нэр</span><input name="middle_name" defaultValue={editingPerson.middle_name ?? ''} maxLength={120} /></label>
              <label><span>Дууддаг нэр</span><input name="nickname" defaultValue={editingPerson.nickname ?? ''} maxLength={120} /></label>
              <label><span>Хүйс</span><select name="gender" defaultValue={editingPerson.gender}><option value="unknown">Тодорхойгүй</option><option value="male">Эрэгтэй</option><option value="female">Эмэгтэй</option><option value="other">Бусад</option></select></label>
              <label><span>Төрсөн огноо</span><input name="birth_date" type="date" defaultValue={editingPerson.birth_date ?? ''} /></label>
              <label><span>Төрсөн газар</span><input name="birth_place" defaultValue={editingPerson.birth_place ?? ''} maxLength={240} /></label>
              <label><span>Амьд эсэх</span><select name="is_alive" value={String(editingPersonIsAlive)} onChange={(event) => setEditingPersonIsAlive(event.target.value === 'true')}><option value="true">Амьд</option><option value="false">Нас барсан</option></select></label>
              {!editingPersonIsAlive && <><label><span>Нас барсан огноо</span><input name="death_date" type="date" defaultValue={editingPerson.death_date ?? ''} /></label>
              <label><span>Нас барсан газар</span><input name="death_place" defaultValue={editingPerson.death_place ?? ''} maxLength={240} /></label></>}
              <label><span>Харагдах хүрээ</span><select name="visibility" defaultValue={editingPerson.visibility}><option value="family">Гэр бүл</option><option value="private">Хувийн</option><option value="public">Нийтэд</option></select></label>
              <label className="tree-editor-wide"><span>Товч намтар</span><textarea name="short_description" defaultValue={editingPerson.short_description ?? ''} maxLength={1000} rows={3} /></label>
              <div className="tree-modal-actions tree-editor-wide">
                <button type="button" className="tree-button tree-button--secondary" onClick={() => setEditingPerson(null)}>Болих</button>
                <button type="submit" className="tree-button tree-button--primary" disabled={editPersonBusy}>{editPersonBusy ? 'Хадгалж байна…' : 'Өөрчлөлт хадгалах'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}


export default function TreePage() {
  return (
    <Suspense
      fallback={
        <main className="tree-page">
          <section className="tree-shell">
            <div className="tree-loading-scene" role="status" aria-live="polite">
              <strong>Удмын модыг ачаалж байна…</strong>
              <small>Гэр бүлийн мэдээллийг бэлтгэж байна.</small>
            </div>
          </section>
        </main>
      }
    >
      <TreePageContent />
    </Suspense>
  );
}
