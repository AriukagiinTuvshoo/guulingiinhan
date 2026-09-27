'use client';

import Link from 'next/link';
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
  Family,
  Marriage,
  Person,
  PersonSearchPage,
  personName,
  TreeData,
  TreePerson,
} from '../../lib/api';

type RelationKind = 'parent' | 'child' | 'spouse';

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

const TREE_NODE_WIDTH = 172;
const TREE_NODE_HEIGHT = 148;
const TREE_X_GAP = 28;
const TREE_Y_GAP = 52;
const TREE_PAD_X = 48;
const TREE_PAD_Y = 52;

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
  const adjacency = new Map<string, string[]>();

  for (const person of tree.persons) adjacency.set(person.id, []);

  for (const edge of tree.parent_child_relationships) {
    if (!personIds.has(edge.parent_id) || !personIds.has(edge.child_id)) continue;
    adjacency.get(edge.parent_id)?.push(edge.child_id);
    adjacency.get(edge.child_id)?.push(edge.parent_id);
  }

  for (const marriage of tree.marriages) {
    if (!personIds.has(marriage.person_1_id) || !personIds.has(marriage.person_2_id)) continue;
    adjacency.get(marriage.person_1_id)?.push(marriage.person_2_id);
    adjacency.get(marriage.person_2_id)?.push(marriage.person_1_id);
  }

  const rootId = tree.root_person_id && personIds.has(tree.root_person_id)
    ? tree.root_person_id
    : tree.persons[0].id;

  generationById.set(rootId, 0);
  const queue = [rootId];

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) break;
    const currentGeneration = generationById.get(currentId) ?? 0;

    for (const neighborId of adjacency.get(currentId) ?? []) {
      if (generationById.has(neighborId)) continue;

      const parentEdge = tree.parent_child_relationships.find(
        (edge) =>
          (edge.parent_id === neighborId && edge.child_id === currentId) ||
          (edge.parent_id === currentId && edge.child_id === neighborId),
      );
      const nextGeneration = parentEdge
        ? parentEdge.parent_id === currentId
          ? currentGeneration + 1
          : currentGeneration - 1
        : currentGeneration;

      generationById.set(neighborId, nextGeneration);
      queue.push(neighborId);
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
  const requestedFamilyId = searchParams.get('family') ?? '';
  const requestedPersonId = searchParams.get('person') ?? '';

  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [tree, setTree] = useState<TreeData | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [depth, setDepth] = useState(3);
  const [zoom, setZoom] = useState(0.9);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noFamily, setNoFamily] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [searchPage, setSearchPage] = useState<PersonSearchPage | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchPageNumber, setSearchPageNumber] = useState(1);
  const [relation, setRelation] = useState<RelationKind | null>(null);
  const [relationError, setRelationError] = useState('');

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
      setFamilyId(id);
      setFamily(null);
      setTree(null);
      setSelectedId('');
      setSearchPage(null);
      setRelation(null);

      try {
        const familyData = await api<Family>('/families/' + encodeURIComponent(id), {
          signal: controller.signal,
        });
        if (sequence !== loadSequence.current) return;

        let treeData: TreeData;
        const treeBase = '/families/' + encodeURIComponent(id) + '/tree?depth=' + String(nextDepth);
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

        setFamily(familyData);
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
    [persistSelected, router],
  );

  useEffect(() => {
    let active = true;

    if (requestedFamilyId) {
      void loadTree(requestedFamilyId, requestedPersonId || undefined);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError('');
    setNoFamily(false);

    api<Family[]>('/families')
      .then((families) => {
        if (!active) return;
        if (!families.length) {
          setFamilyId('');
          setFamily(null);
          setTree(EMPTY_TREE);
          setSelectedId('');
          setNoFamily(true);
          setLoading(false);
          return;
        }
        const nextFamilyId = families[0].id;
        router.replace('/tree?family=' + encodeURIComponent(nextFamilyId));
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(treeFriendlyError(cause, 'Гэр бүлийн орчныг ачаалж чадсангүй.'));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadTree, requestedFamilyId, requestedPersonId, router]);

  useEffect(() => {
    return () => {
      loadAbort.current?.abort();
      searchAbort.current?.abort();
    };
  }, []);

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
    const existingId = String(form.get('existing') ?? '');

    try {
      let relatedId = existingId;
      if (!relatedId) {
        const fullName = String(form.get('name') ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const created = await api<Person>(
          '/families/' + encodeURIComponent(familyId) + '/persons',
          {
            method: 'POST',
            body: JSON.stringify({
              first_name: fullName.at(-1) ?? '',
              last_name: fullName.slice(0, -1).join(' '),
              gender: form.get('gender'),
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
              const retryFamilyId = requestedFamilyId || familyId;
              if (retryFamilyId) {
                void loadTree(retryFamilyId, requestedPersonId || selectedId || undefined, depth);
                return;
              }
              api<Family[]>('/families')
                .then((families) => {
                  const nextFamilyId = families[0]?.id;
                  if (!nextFamilyId) {
                    setNoFamily(true);
                    setLoading(false);
                    return;
                  }
                  router.replace('/tree?family=' + encodeURIComponent(nextFamilyId));
                })
                .catch((cause) => {
                  setError(treeFriendlyError(cause, 'Гэр бүлийн орчныг ачаалж чадсангүй.'));
                });
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

        <section className="tree-workspace" aria-label="Удмын модны ажлын хэсэг">
          <div className="tree-workspace-top">
            <div className="tree-stats" aria-live="polite">
              <strong>{tree?.persons.length ?? 0}</strong><span>хүн</span>
              <i aria-hidden="true">·</i>
              <strong>{tree?.marriages.length ?? 0}</strong><span>гэрлэлт</span>
              {tree?.meta?.truncated ? <em>Хэсэгчлэн ачаалсан</em> : null}
            </div>

            <div className="tree-controls">
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
                <button type="button" onClick={() => setZoom(0.9)}>Тааруулах</button>
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
            <div className="tree-map-layout">
              <div
                ref={scrollRef}
                className="tree-map-scroll"
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
                          <path
                            key={'parent-' + edge.id}
                            d={
                              'M ' +
                              x1 +
                              ' ' +
                              y1 +
                              ' C ' +
                              x1 +
                              ' ' +
                              middleY +
                              ', ' +
                              x2 +
                              ' ' +
                              middleY +
                              ', ' +
                              x2 +
                              ' ' +
                              y2
                            }
                            className="tree-connector tree-connector--parent"
                          />
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
                            <span className="tree-person-avatar" aria-hidden="true">
                              {initials(person)}
                            </span>
                            <strong>{personName(person) || 'Нэргүй хүн'}</strong>
                            <span>{lifeSummary(person)}</span>
                            <em>{generationLabel(node.generation)}</em>
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

              <aside className="tree-selected-panel" aria-label="Сонгосон хүний мэдээлэл">
                {selectedPerson ? (
                  <>
                    <div className="tree-selected-heading">
                      <div className="tree-selected-avatar" aria-hidden="true">
                        {initials(selectedPerson)}
                      </div>
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
                      <button type="button" className="tree-button tree-button--secondary" onClick={() => setRelation('parent')}>
                        + Эцэг/эх
                      </button>
                      <button type="button" className="tree-button tree-button--secondary" onClick={() => setRelation('child')}>
                        + Хүүхэд
                      </button>
                      <button type="button" className="tree-button tree-button--secondary" onClick={() => setRelation('spouse')}>
                        + Гэрлэлт
                      </button>
                    </div>

                    <div className="tree-selected-relations">
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
              <label>
                <span>Одоо байгаа хүнээс сонгох</span>
                <select name="existing" defaultValue="">
                  <option value="">Шинэ хүн үүсгэх</option>
                  {tree?.persons
                    ?.filter((person) => person.id !== selectedId)
                    .map((person) => (
                      <option value={person.id} key={person.id}>
                        {personName(person)}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                <span>Шинэ хүний нэр</span>
                <input name="name" maxLength={360} placeholder="Нэр Овог" />
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
                  </select>
                </label>
              )}

              <div className="tree-modal-actions">
                <button type="button" className="tree-button tree-button--secondary" onClick={() => setRelation(null)}>
                  Болих
                </button>
                <button type="submit" className="tree-button tree-button--primary">
                  Холбоог хадгалах
                </button>
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
