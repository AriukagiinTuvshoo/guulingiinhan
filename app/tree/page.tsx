'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Menu, Users, X } from 'lucide-react';
import { useDialogFocus } from '../../components/use-dialog-focus';
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
import TreePrint from '../../components/tree-print';
import FamilyMap, { FamilyMapMode, FamilyMapCamera } from '../../components/family-map';

const Tree3DScene = dynamic(() => import('../../components/tree-3d-scene'), {
  ssr: false,
  loading: () => <div className="tree-3d-loading" role="status">3D удмын зураглалыг ачаалж байна…</div>,
});

type RelationKind = 'parent' | 'child' | 'spouse';
type LinkRequest = { id: string; person_id: string; user_id: string; user_name: string; person_name: string; status: string; created_at: string };

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
  const requestedMapMode = searchParams.get('map');
  const initialMapMode: FamilyMapMode = requestedMapMode === 'focus' || requestedMapMode === 'list' ? requestedMapMode : 'overview';
  const requestedZoom = Number(searchParams.get('zoom'));
  const { familyId, currentFamily: family, contextLoading, contextLoaded, contextError } = useAppShellContext();
  const [tree, setTree] = useState<TreeData | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [depth, setDepth] = useState(3);
  const [viewMode, setViewMode] = useState<'full' | 'close'>('full');
  const viewModeRef = useRef<'full' | 'close'>('full');
  const [treeView, setTreeView] = useState<'2d' | '3d'>('2d');
  const [mapMode, setMapMode] = useState<FamilyMapMode>(initialMapMode);
  const [zoom, setZoom] = useState(Number.isFinite(requestedZoom) && requestedZoom >= 0.18 && requestedZoom <= 2.2 ? requestedZoom : 0.85);
  const [personPanelOpen, setPersonPanelOpen] = useState(false);
  const initialCamera = useMemo<FamilyMapCamera | null>(() => {
    const x = Number(searchParams.get('map_x')), y = Number(searchParams.get('map_y'));
    return searchParams.has('map_x') && searchParams.has('map_y') && Number.isFinite(x) && Number.isFinite(y) && requestedZoom >= 0.18 && requestedZoom <= 2.2
      ? { x, y, scale: requestedZoom, width: Number(searchParams.get('map_width')), height: Number(searchParams.get('map_height')) } : null;
  }, [searchParams, requestedZoom]);
  const [focusDepth, setFocusDepth] = useState(() => {
    const value = Number(searchParams.get('focus_depth'));
    return value >= 1 && value <= 3 ? value : 2;
  });
  const [activeGeneration, setActiveGeneration] = useState(searchParams.get('generation') ?? '');
  const [branchRoot, setBranchRoot] = useState('');
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
  useDialogFocus(Boolean(relation || editingPerson || confirmRoot || linkToApprove), '.tree-modal[role="dialog"]', () => {
    if (linkBusy || editPersonBusy) return;
    setRelation(null); setEditingPerson(null); setConfirmRoot(false); setLinkToApprove(null);
  });
  useDialogFocus(personPanelOpen && !relation && !editingPerson && !confirmRoot && !linkToApprove, '.tree-selected-panel[role="dialog"]', () => setPersonPanelOpen(false));

  const loadSequence = useRef(0);
  const persistedSelection = useRef('');
  const loadedFamilyId = useRef('');
  const loadAbort = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);

  const persistSelected = useCallback(
    (personId: string) => {
      persistedSelection.current = personId;
      setSelectedId(personId);
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      if (personId) params.set('person', personId);
      else params.delete('person');
      window.history.replaceState(null, '', '/tree?' + params.toString());
    },
    [],
  );

  const persistMapState = useCallback((next: {
    mode?: FamilyMapMode;
    zoom?: number;
    focusDepth?: number;
    generation?: string;
  }) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const mode = next.mode ?? mapMode;
    const nextZoom = next.zoom ?? zoom;
    const nextDepth = next.focusDepth ?? focusDepth;
    const generation = next.generation ?? activeGeneration;
    params.set('map', mode);
    params.set('zoom', nextZoom.toFixed(2));
    params.set('focus_depth', String(nextDepth));
    if (generation) params.set('generation', generation);
    else params.delete('generation');
    window.history.replaceState(null, '', '/tree?' + params.toString());
  }, [activeGeneration, focusDepth, mapMode, zoom]);

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
          + '&scope=' + (viewModeRef.current === 'full' ? 'all&node_limit=1000' : 'context');
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
        loadedFamilyId.current = id;
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
    if (!contextLoading && !contextError && familyId === loadedFamilyId.current && requestedPersonId === persistedSelection.current && tree?.persons.some(person => person.id === requestedPersonId)) {
      persistedSelection.current = '';
      return;
    }
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

  const displayedTree = useMemo(() => {
    if (!tree || !branchRoot || !tree.persons.some(p => p.id === branchRoot)) return tree ?? EMPTY_TREE;
    const children = new Map<string, string[]>();
    for (const edge of tree.parent_child_relationships) children.set(edge.parent_id, [...(children.get(edge.parent_id) || []), edge.child_id]);
    const ids = new Set([branchRoot]); const pending = [branchRoot];
    for (let index = 0; index < pending.length; index++) for (const child of children.get(pending[index]) || []) if (!ids.has(child)) { ids.add(child); pending.push(child); }
    const descendants = new Set(ids);
    for (const marriage of tree.marriages) if (descendants.has(marriage.person_1_id) || descendants.has(marriage.person_2_id)) { ids.add(marriage.person_1_id); ids.add(marriage.person_2_id); }
    return { ...tree, root_person_id: branchRoot, persons: tree.persons.filter(p => ids.has(p.id)), parent_child_relationships: tree.parent_child_relationships.filter(e => ids.has(e.parent_id) && ids.has(e.child_id)), marriages: tree.marriages.filter(m => ids.has(m.person_1_id) && ids.has(m.person_2_id)) };
  }, [tree, branchRoot]);
  useEffect(() => { setBranchRoot(''); setPersonPanelOpen(false); }, [familyId]);

  const selectedPerson = selectedId
    ? tree?.persons.find((person) => person.id === selectedId) ?? null
    : null;

  const hasBackendRoot =
    Boolean(tree?.root_person_id) &&
    Boolean(tree?.persons.some((person) => person.id === tree.root_person_id));
  const canManageTree = family?.role === 'owner' || family?.role === 'editor';

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
    setPersonPanelOpen(true);
  }

  function profileHref(personId: string) {
    return (
      '/profile?family=' +
      encodeURIComponent(familyId) +
      '&person=' +
      encodeURIComponent(personId) +
      '&from=tree'
    );
  }

  function focusSelected() {
    if (!selectedId) return;
    setTreeView('2d');
    setMapMode('focus');
    setActiveGeneration('');
    persistMapState({ mode: 'focus', generation: '' });
    setPersonPanelOpen(false);
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
    setBranchRoot('');
    if (!familyId) return;
    setSearchPage(null);
    setSearch('');
    await loadTree(familyId, personId, depth);
    setTreeView('2d');
    setMapMode('focus');
    setActiveGeneration('');
    persistMapState({ mode: 'focus', generation: '' });
    setPersonPanelOpen(true);
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
          <h1 className="sr-only">Удмын мод</h1>
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
    <main className="tree-page tree-page--studio">
      <section className="tree-shell">
        <header className="tree-page-header">
          <div>
            <Link className="tree-back-link" href={'/dashboard?family=' + encodeURIComponent(familyId)}>
              ← Гэр бүлийн тойм
            </Link>
            <p className="tree-eyebrow">УДМЫН МОД</p>
            <h1>{family?.name ?? 'Удмын мод'}</h1>
            <p className="tree-lede">
              Өвөг дээдэс, хань, үр хүүхэд — гэр бүлийн холбоо нэг дор.
            </p>
          </div>

          <div className="tree-header-actions">
            <Link className="tree-studio-action" aria-label="Гэр бүлийн хүмүүс" href={'/people?family=' + encodeURIComponent(familyId)}><Users size={19} /></Link>
            <details className="tree-studio-menu"><summary aria-label="Удмын модны цэс"><Menu size={19} /></summary><div>
            <Link className="tree-button tree-button--secondary" href={`/relationships?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(selectedId)}`}>Хамаарлыг харах</Link>
            <button type="button" className="tree-button tree-button--secondary" disabled={!selectedId} onClick={() => setBranchRoot(branchRoot ? '' : selectedId)}>{branchRoot ? 'Бүх салааг харах' : 'Сонгосон хүний үр удам'}</button>
            <button type="button" className="tree-button tree-button--secondary" onClick={() => window.print()}>Модыг хэвлэх</button>
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
            <Link className="tree-button tree-button--secondary" href={'/ancestry/connect?family=' + encodeURIComponent(familyId)}>
              Үндэс модтой холбох
            </Link>
            <button type="button" className="tree-button tree-button--secondary" onClick={focusSelected} disabled={!selectedId}>
              Сонгосон хүнийг төвд
            </button>
            </div></details>
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

        {Boolean(tree?.persons.length && (!tree.lineage_root_person_id || !tree.linked_person_id)) && <details className="tree-studio-context"><summary>Удмын эх, миний бүртгэл</summary>{!tree?.lineage_root_person_id && <p>Удмын эх хараахан сонгогдоогүй. Гэр бүлийн эзэн хүн сонгоод цэснээс удмын эхийг батална.</p>}{!tree?.linked_person_id && <p>“Хүмүүс” хэсгээс өөрийн бүртгэлийг олж, гэр бүлийн эзнээр холбоосоо баталгаажуулаарай.</p>}</details>}
        {family?.role === 'owner' && linkRequests.length > 0 && <section className="tree-link-requests" aria-label="Холбох хүсэлтүүд"><h2>Хүнтэй холбох хүсэлт</h2><p>Батлахаас өмнө хүсэлт гаргагчийн хэн болохыг шалгана уу.</p>{linkRequests.map((request) => <div key={request.id}><span><strong>{request.user_name}</strong> → {request.person_name}</span><button type="button" disabled={linkBusy} onClick={() => setLinkToApprove(request)}>Шалгаж батлах</button></div>)}</section>}

        <section className="tree-workspace" aria-label="Удмын модны ажлын хэсэг">
          <div className="tree-workspace-top">
            <div className="tree-stats" aria-live="polite">
              <strong>{displayedTree.persons.length}</strong><span>{branchRoot ? 'салааны хүн' : 'хүн'}</span>
              <i aria-hidden="true">·</i>
              <strong>{displayedTree.marriages.length}</strong><span>гэрлэлт</span>
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
                data={displayedTree}
                selectedPersonId={selectedId}
                currentPersonId={tree.linked_person_id}
                canonicalRootId={tree.lineage_root_person_id || tree.root_person_id}
                onSelect={selectPerson}
                onFallback={() => setTreeView('2d')}
              /> : (
              <FamilyMap
                key={familyId}
                data={displayedTree}
                familyId={familyId}
                selectedId={selectedId}
                mode={mapMode}
                zoom={zoom}
                focusDepth={focusDepth}
                activeGeneration={activeGeneration}
                initialCamera={initialCamera}
                onCameraChange={(camera) => {
                  const params = new URLSearchParams(window.location.search);
                  params.set('map_x', camera.x.toFixed(1));
                  params.set('map_y', camera.y.toFixed(1));
                  params.set('zoom', camera.scale.toFixed(3));
                  if (camera.width) params.set('map_width', String(Math.round(camera.width)));
                  if (camera.height) params.set('map_height', String(Math.round(camera.height)));
                  window.history.replaceState(null, '', '/tree?' + params.toString());
                }}
                onModeChange={(mode) => {
                  setMapMode(mode);
                  setActiveGeneration('');
                  persistMapState({ mode, generation: '' });
                }}
                onZoomChange={(nextZoom) => {
                  setZoom(nextZoom);
                  persistMapState({ zoom: nextZoom });
                }}
                onFocusDepthChange={(nextDepth) => {
                  setFocusDepth(nextDepth);
                  persistMapState({ focusDepth: nextDepth });
                }}
                onGenerationChange={(generation) => {
                  setActiveGeneration(generation);
                  persistMapState({ generation });
                }}
                onSelect={selectPerson}
              />
              )}

              {personPanelOpen && selectedPerson ? <div className="tree-studio-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPersonPanelOpen(false); }}><aside className="tree-selected-panel" role="dialog" aria-modal="true" aria-label="Сонгосон хүний мэдээлэл">
                <button type="button" className="tree-studio-close" aria-label="Хүний мэдээллийг хаах" onClick={() => setPersonPanelOpen(false)}><X size={18} /></button>
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
                              {parent ? <button type="button" className="tree-studio-relative" onClick={() => selectPerson(parent.id)}>{personName(parent)}</button> : <strong>Хүний мэдээлэл харагдахгүй байна</strong>}
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
                              {child ? <button type="button" className="tree-studio-relative" onClick={() => selectPerson(child.id)}>{personName(child)}</button> : <strong>Хүний мэдээлэл харагдахгүй байна</strong>}
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
                          <div>{selectedMarriages.map((marriage) => { const partner = tree?.persons.find((person) => person.id === marriagePartnerId(marriage, selectedId)); return partner ? <button className="tree-studio-relative" type="button" key={marriage.id} onClick={() => selectPerson(partner.id)}>{personName(partner)} · {marriage.status === 'married' ? 'Хань' : marriage.status === 'divorced' ? 'Өмнөх хань' : 'Бэлэвсэн'}</button> : null; })}</div>
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
              </aside></div> : null}
            </div>
          )}
        </section>

        {tree?.meta?.truncated && (
          <p className="tree-truncated-note">
            Энэ мод API-ийн аюулгүй дээд хязгаараас хэтэрсэн тул бүх хүнийг нэг дор харуулахгүй байж болно. Хайлт ашиглан өөр хүнийг төв болгон үргэлжлүүлэн хараарай.
          </p>
        )}

        <footer className="tree-footer-note">
          <span>Холбоос нэмэх, мэдээлэл засах бол хүн дээр дарна уу.</span>
        </footer>
      </section>
      {tree && <TreePrint tree={displayedTree} familyName={family?.name || 'Гэр бүл'} />}

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
