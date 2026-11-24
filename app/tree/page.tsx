'use client';

import Link from 'next/link';
import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  API_BASE,
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
import {
  AdvancedTreeLayout,
  buildAdvancedTreeLayout,
  TREE_NODE_WIDTH,
  TREE_NODE_HEIGHT,
  LayoutNode,
} from '../../lib/tree-layout';
import { TreeDrawer } from './tree-drawer';
import { TreeExportModal } from '../../components/tree-export-modal';
import { PedigreeCertificateModal } from '../../components/pedigree-certificate-modal';
import { FamilyBookModal } from '../../components/family-book-modal';
import { PedigreeWizardModal, RelativeRole } from '../../components/pedigree-wizard-modal';
import { KinshipCalculatorModal } from '../../components/kinship-calculator-modal';
import GoldenHeritageTree from '../../components/golden-heritage-tree';
import HushTreeView from '../../components/hush-tree-view';
import ToonoTreeView from '../../components/toono-tree-view';
import { useFocusTrap } from '../../lib/use-focus-trap';
import { BookOpen, ChevronDown, Clock, Compass, FileBadge, GitCompare, Link2, Plus, Printer, Users, Wrench } from 'lucide-react';

export type BloodlineMode = 'none' | 'all' | 'paternal' | 'maternal' | 'descendants';

interface BloodlineHighlight {
  ancestorIds: Set<string>;
  descendantIds: Set<string>;
  paternalIds: Set<string>;
  maternalIds: Set<string>;
  spouseIds: Set<string>;
  activeIds: Set<string>;
}

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
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noFamily, setNoFamily] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [searchPage, setSearchPage] = useState<PersonSearchPage | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchPageNumber, setSearchPageNumber] = useState(1);

  // Kinship Modal State (Unified Mongolian Kinship Calculator)
  const [kinshipInitialPersonId, setKinshipInitialPersonId] = useState<string>('');
  const [divorceMarriageId, setDivorceMarriageId] = useState<string | null>(null);
  const [divorceEndDate, setDivorceEndDate] = useState('');
  const [divorceBusy, setDivorceBusy] = useState(false);
  const divorceModalRef = useRef<HTMLElement>(null);

  useFocusTrap(Boolean(divorceMarriageId), divorceModalRef, {
    onEscape: () => setDivorceMarriageId(null),
    disabled: divorceBusy,
  });

  // Bloodline Highlight & Interaction States
  const [viewMode, setViewMode] = useState<'gold' | 'hush' | 'toono'>('gold');
  const [bloodlineMode, setBloodlineMode] = useState<BloodlineMode>('none');
  const [isDraggingActive, setIsDraggingActive] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  // Tidy-Tree Collapse, Branch Filter & Lazy Subtree State
  const [collapsedUnitIds, setCollapsedUnitIds] = useState<Set<string>>(() => new Set());
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [loadingUnitId, setLoadingUnitId] = useState<string | null>(null);
  const lazyLoadedUnitsRef = useRef<Set<string>>(new Set());
  const classicAnchorRef = useRef<{ personId: string; prevX: number; prevY: number } | null>(null);

  // Vector Print & Export Modal State
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [certificateModalOpen, setCertificateModalOpen] = useState(false);
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [kinshipModalOpen, setKinshipModalOpen] = useState(false);
  const [openHeaderMenu, setOpenHeaderMenu] = useState<'print' | 'tools' | null>(null);
  const headerMenusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openHeaderMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!headerMenusRef.current?.contains(event.target as Node)) {
        setOpenHeaderMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenHeaderMenu(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openHeaderMenu]);

  // Interactive Time-Travel Slider State
  const currentYear = new Date().getFullYear();
  const [timeTravelOpen, setTimeTravelOpen] = useState(false);
  const [timeYear, setTimeYear] = useState(currentYear);
  const [timePlaying, setTimePlaying] = useState(false);

  // Pedigree Wizard Modal State
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAnchorId, setWizardAnchorId] = useState<string | null>(null);
  const [wizardRole, setWizardRole] = useState<RelativeRole>('son');
  const [wizardMode, setWizardMode] = useState<'create' | 'existing'>('create');

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

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
    async (
      id: string,
      preferredPersonId?: string,
      nextDepth = 3,
      options?: { expandAll?: boolean },
    ) => {
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

      try {
        const familyData = await api<Family>('/families/' + encodeURIComponent(id), {
          signal: controller.signal,
        });
        if (sequence !== loadSequence.current) return;

        let treeData: TreeData;
        const treeBase =
          '/families/' +
          encodeURIComponent(id) +
          '/tree?depth=' +
          String(nextDepth) +
          '&node_limit=300';
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
        lazyLoadedUnitsRef.current = new Set();
        setLoadingUnitId(null);
        if (options?.expandAll) {
          setCollapsedUnitIds(new Set());
        } else {
          const initialLayout = buildAdvancedTreeLayout(treeData);
          setCollapsedUnitIds(new Set(initialLayout.defaultCollapsedIds));
        }
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

  const layout: AdvancedTreeLayout = useMemo(
    () =>
      buildAdvancedTreeLayout(tree ?? EMPTY_TREE, {
        collapsedUnitIds,
        branchId: activeBranchId,
      }),
    [tree, collapsedUnitIds, activeBranchId],
  );

  // Export ALWAYS renders the FULL tree ignoring collapse and branch filters.
  const fullExportLayout: AdvancedTreeLayout = useMemo(
    () => buildAdvancedTreeLayout(tree ?? EMPTY_TREE, { ignoreFilters: true }),
    [tree],
  );

  const canEditFamily = family?.role === 'owner' || family?.role === 'editor';
  const canPrintFamily = family?.role === 'owner';

  // Keep clicked node at the same screen position after Classic 2D collapse/expand relayout.
  useLayoutEffect(() => {
    const anchor = classicAnchorRef.current;
    if (!anchor) return;
    const nextNode = layout.nodeById.get(anchor.personId);
    classicAnchorRef.current = null;
    if (!nextNode) return;
    const dx = (nextNode.x - anchor.prevX) * zoom;
    const dy = (nextNode.y - anchor.prevY) * zoom;
    const scroller = scrollRef.current;
    if (scroller && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
      scroller.scrollLeft = Math.max(0, scroller.scrollLeft + dx);
      scroller.scrollTop = Math.max(0, scroller.scrollTop + dy);
    }
  }, [layout, zoom]);

  const handleToggleCollapse = useCallback(
    async (unitId: string, focalPersonId: string, isFrontier: boolean) => {
      const isCurrentlyCollapsed = collapsedUnitIds.has(unitId) || isFrontier;
      if (!isCurrentlyCollapsed) {
        setCollapsedUnitIds((prev) => {
          const next = new Set(prev);
          next.add(unitId);
          return next;
        });
        return;
      }

      const nodeGen = layout.nodeById.get(focalPersonId)?.generation ?? 1;
      const needsLazyFetch =
        Boolean(familyId) &&
        (isFrontier || (!lazyLoadedUnitsRef.current.has(unitId) && depth < 9 && nodeGen >= depth));

      if (needsLazyFetch) {
        setLoadingUnitId(unitId);
        setError('');
        try {
          const incoming = await api<TreeData>(
            '/families/' +
              encodeURIComponent(familyId) +
              '/tree?person_id=' +
              encodeURIComponent(focalPersonId) +
              '&depth=3&direction=descendants&node_limit=300',
          );
          lazyLoadedUnitsRef.current.add(unitId);
          setTree((prev) => {
            if (!prev) return incoming;
            const personMap = new Map(prev.persons.map((p) => [p.id, p]));
            for (const p of incoming.persons) {
              if (!personMap.has(p.id)) personMap.set(p.id, p);
            }
            const edgeMap = new Map(prev.parent_child_relationships.map((e) => [e.id, e]));
            for (const e of incoming.parent_child_relationships) {
              if (!edgeMap.has(e.id)) edgeMap.set(e.id, e);
            }
            const marriageMap = new Map(prev.marriages.map((m) => [m.id, m]));
            for (const m of incoming.marriages) {
              if (!marriageMap.has(m.id)) marriageMap.set(m.id, m);
            }
            return {
              ...prev,
              persons: [...personMap.values()],
              parent_child_relationships: [...edgeMap.values()],
              marriages: [...marriageMap.values()],
              meta: prev.meta
                ? {
                    ...prev.meta,
                    node_count: personMap.size,
                    truncated: Boolean(prev.meta.truncated || incoming.meta?.truncated),
                  }
                : incoming.meta,
            };
          });
        } catch (cause) {
          setError(
            treeFriendlyError(cause, 'Салбарын үр хойчийг ачаалж чадсангүй. Дахин оролдоно уу.'),
          );
          setLoadingUnitId(null);
          return;
        } finally {
          setLoadingUnitId(null);
        }
      }

      setCollapsedUnitIds((prev) => {
        const next = new Set(prev);
        next.delete(unitId);
        return next;
      });
    },
    [collapsedUnitIds, depth, familyId, layout.nodeById],
  );

  const handleExpandAllNine = useCallback(() => {
    if (!familyId) return;
    if (depth < 9) {
      setDepth(9);
      void loadTree(familyId, tree?.lineage_root_person_id || undefined, 9, { expandAll: true });
    } else {
      setCollapsedUnitIds(new Set());
    }
  }, [depth, familyId, loadTree, tree?.lineage_root_person_id]);

  const handleCollapseAll = useCallback(() => {
    setCollapsedUnitIds(new Set(layout.allCollapsibleIds));
  }, [layout.allCollapsibleIds]);

  const handleFitClassicToScreen = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || layout.width <= 0 || layout.height <= 0) return;
    const vw = Math.max(320, scroller.clientWidth - 48);
    const vh = Math.max(320, scroller.clientHeight - 48);
    const fitZoom = Math.max(0.22, Math.min(1.1, Math.min(vw / layout.width, vh / layout.height)));
    setZoom(Number(fitZoom.toFixed(2)));
    setPan({ x: 0, y: 0 });
    scroller.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  }, [layout.height, layout.width]);

  const nodeById = layout.nodeById;

  const timeBounds = useMemo(() => {
    const years = (tree?.persons ?? [])
      .map((p) => (p.birth_date ? Number.parseInt(p.birth_date.slice(0, 4), 10) : Number.NaN))
      .filter((y) => Number.isFinite(y) && y >= 1800 && y <= currentYear);
    const min = years.length ? Math.max(1850, Math.min(...years) - 5) : 1920;
    return { min: Math.min(min, currentYear - 10), max: currentYear };
  }, [tree, currentYear]);

  useEffect(() => {
    if (!timePlaying || !timeTravelOpen) return;
    const timer = window.setInterval(() => {
      setTimeYear((prev) => {
        if (prev >= timeBounds.max) {
          setTimePlaying(false);
          return timeBounds.max;
        }
        return prev + 1;
      });
    }, 140);
    return () => window.clearInterval(timer);
  }, [timePlaying, timeTravelOpen, timeBounds.max]);

  const timeAliveCount = useMemo(() => {
    if (!timeTravelOpen || !tree) return 0;
    return tree.persons.filter((p) => {
      const b = p.birth_date ? Number.parseInt(p.birth_date.slice(0, 4), 10) : Number.NaN;
      const d = p.death_date ? Number.parseInt(p.death_date.slice(0, 4), 10) : Number.NaN;
      if (Number.isNaN(b)) return p.is_alive && timeYear >= currentYear - 35;
      if (timeYear < b) return false;
      if (!p.is_alive && !Number.isNaN(d) && timeYear > d) return false;
      return true;
    }).length;
  }, [timeTravelOpen, tree, timeYear, currentYear]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.tree-person-card, button, a, select, input, label')) {
      return;
    }
    isDragging.current = true;
    setIsDraggingActive(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({
      x: Math.round(panStart.current.x + dx),
      y: Math.round(panStart.current.y + dy),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) {
      isDragging.current = false;
      setIsDraggingActive(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      setZoom((prev) => Math.max(0.4, Math.min(2.0, Number((prev + delta).toFixed(2)))));
    }
  };

  const resetView = () => {
    setZoom(0.9);
    setPan({ x: 0, y: 0 });
  };

  const centerOnPerson = (personId: string) => {
    if (viewMode === 'gold') {
      const el = document.getElementById('tree-person-' + personId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      return;
    }
    const node = layout.nodeById.get(personId);
    if (node && scrollRef.current) {
      const container = scrollRef.current;
      const targetX = -(node.x + node.width / 2) * zoom + container.clientWidth / 2;
      const targetY = -(node.y + node.height / 2) * zoom + container.clientHeight / 2;
      setPan({ x: Math.round(targetX), y: Math.round(targetY) });
    }
  };

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

  const bloodline = useMemo<BloodlineHighlight>(() => {
    const result: BloodlineHighlight = {
      ancestorIds: new Set(),
      descendantIds: new Set(),
      paternalIds: new Set(),
      maternalIds: new Set(),
      spouseIds: new Set(),
      activeIds: new Set(),
    };

    if (!tree || !selectedId || bloodlineMode === 'none') {
      return result;
    }

    const childToParents = new Map<string, string[]>();
    const parentToChildren = new Map<string, string[]>();
    const personMap = new Map<string, TreePerson>();

    for (const p of tree.persons) {
      personMap.set(p.id, p);
    }

    for (const rel of tree.parent_child_relationships) {
      const pList = childToParents.get(rel.child_id) ?? [];
      pList.push(rel.parent_id);
      childToParents.set(rel.child_id, pList);

      const cList = parentToChildren.get(rel.parent_id) ?? [];
      cList.push(rel.child_id);
      parentToChildren.set(rel.parent_id, cList);
    }

    for (const m of tree.marriages) {
      if (m.person_1_id === selectedId) result.spouseIds.add(m.person_2_id);
      if (m.person_2_id === selectedId) result.spouseIds.add(m.person_1_id);
    }

    // BFS Ancestors
    const queueAncestors = [...(childToParents.get(selectedId) ?? [])];
    while (queueAncestors.length > 0) {
      const cur = queueAncestors.shift()!;
      if (!result.ancestorIds.has(cur)) {
        result.ancestorIds.add(cur);
        const nextParents = childToParents.get(cur) ?? [];
        for (const np of nextParents) queueAncestors.push(np);
      }
    }

    // BFS Descendants
    const queueDescendants = [...(parentToChildren.get(selectedId) ?? [])];
    while (queueDescendants.length > 0) {
      const cur = queueDescendants.shift()!;
      if (!result.descendantIds.has(cur)) {
        result.descendantIds.add(cur);
        const nextChildren = parentToChildren.get(cur) ?? [];
        for (const nc of nextChildren) queueDescendants.push(nc);
      }
    }

    // Paternal Line (Эцгийн ураг)
    let currFather: string | undefined = childToParents
      .get(selectedId)
      ?.find((pid) => personMap.get(pid)?.gender === 'male');
    while (currFather) {
      result.paternalIds.add(currFather);
      currFather = childToParents
        .get(currFather)
        ?.find((pid) => personMap.get(pid)?.gender === 'male');
    }
    for (const d of result.descendantIds) {
      result.paternalIds.add(d);
    }

    // Maternal Line (Эхийн тал)
    const directMother = childToParents
      .get(selectedId)
      ?.find((pid) => personMap.get(pid)?.gender === 'female');
    if (directMother) {
      result.maternalIds.add(directMother);
      const qM = [directMother];
      while (qM.length > 0) {
        const cur = qM.shift()!;
        for (const pid of childToParents.get(cur) ?? []) {
          if (!result.maternalIds.has(pid)) {
            result.maternalIds.add(pid);
            qM.push(pid);
          }
        }
      }
    }

    // Combine into activeIds based on chosen mode
    if (bloodlineMode === 'all') {
      result.activeIds.add(selectedId);
      result.ancestorIds.forEach((id) => result.activeIds.add(id));
      result.descendantIds.forEach((id) => result.activeIds.add(id));
      result.spouseIds.forEach((id) => result.activeIds.add(id));
    } else if (bloodlineMode === 'paternal') {
      result.activeIds.add(selectedId);
      result.paternalIds.forEach((id) => result.activeIds.add(id));
    } else if (bloodlineMode === 'maternal') {
      result.activeIds.add(selectedId);
      result.maternalIds.forEach((id) => result.activeIds.add(id));
    } else if (bloodlineMode === 'descendants') {
      result.activeIds.add(selectedId);
      result.descendantIds.forEach((id) => result.activeIds.add(id));
    }

    return result;
  }, [tree, selectedId, bloodlineMode]);

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

  async function divorce(marriageId: string) {
    if (!familyId || !selectedId) return;
    setDivorceEndDate('');
    setDivorceMarriageId(marriageId);
  }

  async function submitDivorce(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!familyId || !selectedId || !divorceMarriageId || divorceBusy) return;
    setDivorceBusy(true);
    try {
      await api(
        '/families/' +
          encodeURIComponent(familyId) +
          '/marriages/' +
          encodeURIComponent(divorceMarriageId),
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'divorced',
            end_date: divorceEndDate || null,
          }),
        },
      );
      setDivorceMarriageId(null);
      setDivorceEndDate('');
      setNotice('Гэрлэлтийн мэдээлэл шинэчлэгдлээ.');
      await loadTree(familyId, selectedId, depth);
    } catch (cause) {
      setError(treeFriendlyError(cause, 'Гэрлэлтийн мэдээллийг шинэчилж чадсангүй.'));
    } finally {
      setDivorceBusy(false);
    }
  }

  if (noFamily) {
    return (
      <main className="tree-page">
        <section className="tree-state tree-state--empty">
          <div className="tree-state-mark" aria-hidden="true">🌳</div>
          <p className="tree-eyebrow">ГУУЛИНГИЙНХАН · УДМЫН МОД</p>
          <h1>Гэр бүлийн орчин олдсонгүй.</h1>
          <p>Шинэ гэр бүл үүсгээд Гуулингийнхны Эх модонд (Ядамсүрэн ⚭ Гүнд) холбогдох, эсвэл нийтлэг эх модыг шууд үзнэ үү.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            <Link className="tree-button tree-button--primary" href="/ancestry">🌳 Гуулингийнхны Эх Мод үзэх</Link>
            <Link className="tree-button" href="/families">➕ Шинэ гэр бүл үүсгэх / Нэгдэх</Link>
          </div>
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
            <p className="tree-eyebrow">
              <span className="tree-mongolian-script" style={{ fontFamily: 'Georgia, serif', color: 'var(--gold-500)', marginRight: '8px', fontSize: '13px', letterSpacing: '1px' }}>
                ᠮᠣᠩᠭᠣᠯ ᠤᠷᠤᠭ ᠤᠨ ᠪᠢᠴᠢᠭ
              </span>
              ГУУЛИНГИЙНХАН · УДМЫН МОД
            </p>
            <h1>{family?.name ?? 'Удмын мод'}</h1>
            <p className="tree-lede">
              Удам, гэрлэлт, үеийн холбоосыг зөвхөн таны хандах эрхтэй бодит гэр бүлийн мэдээллээр харуулна.
            </p>
          </div>

          <div className="tree-header-actions" ref={headerMenusRef}>
            {canEditFamily && (
              <button
                type="button"
                className="ui-btn ui-btn--primary"
                onClick={() => {
                  setOpenHeaderMenu(null);
                  setWizardAnchorId(selectedPerson?.id || null);
                  setWizardRole(selectedPerson ? 'son' : 'standalone');
                  setWizardMode('create');
                  setWizardOpen(true);
                }}
              >
                <Plus size={15} aria-hidden="true" /> Хүн нэмэх
              </button>
            )}

            {canPrintFamily && (
              <div className="tree-header-menu">
                <button
                  type="button"
                  className={`ui-btn${openHeaderMenu === 'print' ? ' ui-btn--selected' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={openHeaderMenu === 'print'}
                  onClick={() => setOpenHeaderMenu((prev) => (prev === 'print' ? null : 'print'))}
                >
                  <Printer size={15} aria-hidden="true" /> Хэвлэх <ChevronDown size={14} aria-hidden="true" />
                </button>
                {openHeaderMenu === 'print' && (
                  <div className="tree-header-menu-panel" role="menu" aria-label="Хэвлэх цэс">
                    <button
                      type="button"
                      role="menuitem"
                      className="tree-header-menu-item"
                      onClick={() => {
                        setOpenHeaderMenu(null);
                        setExportModalOpen(true);
                      }}
                    >
                      <Printer size={15} aria-hidden="true" /> Хананд хэвлэх (PDF / SVG)
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="tree-header-menu-item"
                      onClick={() => {
                        setOpenHeaderMenu(null);
                        setCertificateModalOpen(true);
                      }}
                    >
                      <FileBadge size={15} aria-hidden="true" /> Ургийн бичиг (PDF)
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="tree-header-menu-item"
                      onClick={() => {
                        setOpenHeaderMenu(null);
                        setBookModalOpen(true);
                      }}
                    >
                      <BookOpen size={15} aria-hidden="true" /> Ургийн ном (PDF)
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="tree-header-menu">
              <button
                type="button"
                className={`ui-btn${openHeaderMenu === 'tools' || timeTravelOpen ? ' ui-btn--selected' : ''}`}
                aria-haspopup="menu"
                aria-expanded={openHeaderMenu === 'tools'}
                onClick={() => setOpenHeaderMenu((prev) => (prev === 'tools' ? null : 'tools'))}
              >
                <Wrench size={15} aria-hidden="true" /> Хэрэгсэл <ChevronDown size={14} aria-hidden="true" />
              </button>
              {openHeaderMenu === 'tools' && (
                <div className="tree-header-menu-panel" role="menu" aria-label="Хэрэгсэл цэс">
                  {canEditFamily && (tree?.persons.length ?? 0) >= 2 && (
                    <button
                      type="button"
                      role="menuitem"
                      className="tree-header-menu-item"
                      onClick={() => {
                        setOpenHeaderMenu(null);
                        setWizardAnchorId(selectedPerson?.id || tree?.persons[0]?.id || null);
                        setWizardRole('son');
                        setWizardMode('existing');
                        setWizardOpen(true);
                      }}
                    >
                      <Link2 size={15} aria-hidden="true" /> 2 хүн холбох
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-header-menu-item"
                    onClick={() => {
                      setOpenHeaderMenu(null);
                      setKinshipInitialPersonId(selectedId || '');
                      setKinshipModalOpen(true);
                    }}
                  >
                    <GitCompare size={15} aria-hidden="true" /> Хамаарал тооцоолох
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-header-menu-item"
                    aria-pressed={timeTravelOpen}
                    onClick={() => {
                      setOpenHeaderMenu(null);
                      setTimeTravelOpen((prev) => {
                        const next = !prev;
                        if (next) {
                          setTimeYear(timeBounds.min);
                          setTimePlaying(false);
                        } else {
                          setTimePlaying(false);
                        }
                        return next;
                      });
                    }}
                  >
                    <Clock size={15} aria-hidden="true" /> Цаг хугацааны аялал
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-header-menu-item"
                    disabled={!selectedId}
                    onClick={() => {
                      setOpenHeaderMenu(null);
                      focusSelected();
                    }}
                  >
                    <Compass size={15} aria-hidden="true" /> Сонгосон хүнийг төвд
                  </button>
                  <Link
                    role="menuitem"
                    className="tree-header-menu-item"
                    href={'/people?family=' + encodeURIComponent(familyId)}
                    onClick={() => setOpenHeaderMenu(null)}
                  >
                    <Users size={15} aria-hidden="true" /> Хүмүүсийн жагсаалт
                  </Link>
                </div>
              )}
            </div>
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
              <div className="tree-segmented" role="group" aria-label="Мод харах горим">
                <button
                  type="button"
                  aria-pressed={viewMode === 'gold'}
                  onClick={() => setViewMode('gold')}
                >
                  Алтан Мод
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === 'hush'}
                  onClick={() => setViewMode('hush')}
                >
                  Хуш мод
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === 'toono'}
                  onClick={() => setViewMode('toono')}
                >
                  Тооно Нархан
                </button>
              </div>

              <div className="tree-mobile-quick-row">
                <button
                  type="button"
                  className="tree-mobile-filter-toggle"
                  aria-expanded={mobileToolsOpen}
                  onClick={() => setMobileToolsOpen((prev) => !prev)}
                >
                  {mobileToolsOpen ? 'Шүүлтүүр хаах ▲' : 'Хайлт & Шүүлтүүр ▼'}
                </button>
                <button
                  type="button"
                  className={`tree-mobile-fullscreen-btn${isFullscreen ? ' is-active' : ''}`}
                  onClick={() => setIsFullscreen((prev) => !prev)}
                >
                  {isFullscreen ? '✕ Гарах' : '⛶ Томруулах'}
                </button>
              </div>

              <div className={`tree-controls-secondary tree-mobile-collapsible${mobileToolsOpen ? ' is-open' : ''}`}>
              <label className="tree-bloodline-select" title="Сонгосон хүний удам угсаа, үр садыг онцлон тодруулах">
                <span>Удам</span>
                <select
                  value={bloodlineMode}
                  onChange={(event) => setBloodlineMode(event.target.value as BloodlineMode)}
                  disabled={!selectedId}
                  aria-label="Удам угсаа гэрэлтүүлэх горим"
                >
                  <option value="none">Энгийн горим</option>
                  <option value="all">Бүх шугам (Удам + Үр сад)</option>
                  <option value="paternal">Эцгийн ураг (Ясан төрөл)</option>
                  <option value="maternal">Эхийн тал (Цусан төрөл)</option>
                  <option value="descendants">Үр удам (Хүүхдүүд, ач нар)</option>
                </select>
              </label>

              {bloodlineMode !== 'none' && selectedPerson && (
                <span className="tree-bloodline-status" title="Гэрэлтэж буй хүний тоо">
                  <strong>{bloodline.activeIds.size}</strong> хүн
                </span>
              )}

              <label>
                <span>Хүрээ</span>
                <select
                  value={depth}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setDepth(next);
                    void loadTree(familyId, tree?.lineage_root_person_id || selectedId || undefined, next);
                  }}
                >
                  <option value={3}>3 үе</option>
                  <option value={5}>5 үе</option>
                  <option value={7}>7 үе</option>
                  <option value={9}>9 үе</option>
                  <option value={10}>10 үе</option>
                </select>
              </label>

              <div className="tree-zoom" aria-label="Модны удирдлага">
                <button type="button" onClick={handleExpandAllNine}>
                  Бүх 9 үеийг нээх
                </button>
                <button type="button" onClick={handleCollapseAll}>
                  Хураах
                </button>
                <button
                  type="button"
                  className={isFullscreen ? 'ui-btn--selected' : undefined}
                  onClick={() => setIsFullscreen((prev) => !prev)}
                  title={isFullscreen ? 'Цонхыг хэвийн болгох' : 'Дэлгэц дүүргэх'}
                >
                  {isFullscreen ? 'Буцах' : 'Бүтэн дэлгэц'}
                </button>
              </div>
              </div>
            </div>
          </div>

          <div className={`tree-search-wrap tree-mobile-collapsible${mobileToolsOpen ? ' is-open' : ''}`}>
            {timeTravelOpen && (
              <div className="tree-time-travel-bar" role="region" aria-label="Он цагийн аялал">
                <div className="tree-time-travel-head">
                  <button
                    type="button"
                    className="tree-time-play-btn"
                    onClick={() => {
                      if (timeYear >= timeBounds.max) setTimeYear(timeBounds.min);
                      setTimePlaying((prev) => !prev);
                    }}
                  >
                    {timePlaying ? '⏸ Зогсоох' : '▶ Тоглуулах'}
                  </button>
                  <strong className="tree-time-year-badge">{timeYear} он</strong>
                  <span className="tree-time-alive-stat">
                    Тухайн онд амьд сэрүүн: <b>{timeAliveCount}</b> хүн
                  </span>
                  <button
                    type="button"
                    className="tree-time-close-btn"
                    onClick={() => {
                      setTimePlaying(false);
                      setTimeTravelOpen(false);
                    }}
                  >
                    ✕ Хаах
                  </button>
                </div>
                <div className="tree-time-slider-row">
                  <span>{timeBounds.min}</span>
                  <input
                    type="range"
                    min={timeBounds.min}
                    max={timeBounds.max}
                    value={timeYear}
                    onChange={(event) => {
                      setTimePlaying(false);
                      setTimeYear(Number(event.target.value));
                    }}
                    aria-label="Он сонгох гулсуур"
                  />
                  <span>{timeBounds.max}</span>
                </div>
              </div>
            )}
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
            <>
              {tree && tree.persons.length > 0 && !layout.hasConfirmedRoot && (
                <p className="tree-truncated-note" role="status">
                  Удмын эх хүн тохируулаагүй тул үеийн дугаарлалт &ldquo;?&rdquo; гэж харагдаж байна.{' '}
                  <Link href={'/admin?family=' + encodeURIComponent(familyId)}>
                    Админ хэсгээс удмын эх хүнийг тохируулна уу →
                  </Link>
                </p>
              )}

              {layout.branches.length > 0 && (
                <div className={`tree-filter-bar tree-mobile-collapsible${mobileToolsOpen ? ' is-open' : ''}`} role="region" aria-label="Салбарын шүүлтүүр" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <button
                    type="button"
                    className={`tree-action-pill${activeBranchId === null ? ' is-link' : ''}`}
                    aria-pressed={activeBranchId === null}
                    onClick={() => setActiveBranchId(null)}
                  >
                    Бүх салбар ({tree?.persons.length ?? 0})
                  </button>
                  {layout.branches.map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      className={`tree-action-pill${activeBranchId === branch.id ? ' is-link' : ''}`}
                      aria-pressed={activeBranchId === branch.id}
                      onClick={() =>
                        setActiveBranchId((prev) => (prev === branch.id ? null : branch.id))
                      }
                    >
                      {branch.label} ({branch.count})
                    </button>
                  ))}
                </div>
              )}

              <div className={`tree-map-layout ${viewMode === 'gold' ? 'tree-map-layout--3d' : ''}${!selectedPerson ? ' tree-map-layout--full' : ''}${isFullscreen ? ' tree-map-layout--fullscreen' : ''}`}>
              {isFullscreen && (
                <button
                  type="button"
                  className="tree-fullscreen-exit-btn"
                  onClick={() => setIsFullscreen(false)}
                >
                  ✕ Гарах
                </button>
              )}
              {viewMode === 'hush' && tree ? (
                <HushTreeView
                  tree={tree}
                  selectedId={selectedId}
                  onSelect={(pid) => selectPerson(pid)}
                  canEdit={canEditFamily}
                  onQuickAdd={(anchorId, role) => {
                    setWizardAnchorId(anchorId);
                    setWizardRole(role);
                    setWizardMode('create');
                    setWizardOpen(true);
                  }}
                  timeTravelOpen={timeTravelOpen}
                  timeYear={timeYear}
                />
              ) : viewMode === 'toono' && tree ? (
                <ToonoTreeView
                  tree={tree}
                  familyName={family?.name ?? 'Гуулингийнхан'}
                  selectedId={selectedId}
                  onSelect={(pid) => selectPerson(pid)}
                  timeTravelOpen={timeTravelOpen}
                  timeYear={timeYear}
                />
              ) : viewMode === 'gold' && tree ? (
                <GoldenHeritageTree
                  layout={layout}
                  selectedId={selectedId}
                  onSelect={(pid) => selectPerson(pid)}
                  onToggleCollapse={(unitId, focalPersonId, isFrontier) =>
                    void handleToggleCollapse(unitId, focalPersonId, isFrontier)
                  }
                  loadingUnitId={loadingUnitId}
                  canPrint={canPrintFamily}
                  bloodlineMode={bloodlineMode}
                  activeBloodlineIds={bloodline.activeIds}
                  timeTravelOpen={timeTravelOpen}
                  timeYear={timeYear}
                  currentYear={currentYear}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
                  onOpenKinship={() => {
                    setKinshipInitialPersonId(selectedId || '');
                    setKinshipModalOpen(true);
                  }}
                  onOpenCertificate={() => setCertificateModalOpen(true)}
                  onOpenBook={() => setBookModalOpen(true)}
                  onOpenExport={() => setExportModalOpen(true)}
                />
              ) : (
              <div
                ref={scrollRef}
                className={'tree-map-scroll ' + (isFullscreen ? 'is-fullscreen' : '')}
                tabIndex={0}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
                style={{ cursor: isDraggingActive ? 'grabbing' : 'grab', userSelect: 'none' }}
                aria-label="Удмын модны зөөврийн зураглал. Хулганаар чирч шилжүүлэх болон томруулж жижигрүүлж харна."
              >
                {isFullscreen && (
                  <button
                    type="button"
                    className="tree-floating-fullscreen-close"
                    onClick={() => setIsFullscreen(false)}
                    aria-label="Бүтэн дэлгэцийн горимоос гарах"
                  >
                    ✕ Буцах
                  </button>
                )}
                <div
                  className="tree-map-space"
                  style={{
                    width: layout.width * zoom,
                    height: layout.height * zoom,
                  }}
                >
                  <div
                    className={'tree-map-stage ' + (bloodlineMode !== 'none' ? 'has-bloodline-active' : '')}
                    style={{
                      width: layout.width,
                      height: layout.height,
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: '0 0',
                      transition: isDraggingActive ? 'none' : 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
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
                      {/* Theme-aware Generation Labels & Division Lines */}
                      {layout.generationHeaders.map((hdr) => (
                        <g key={'gen-' + hdr.generation} className="tree-gen-divider">
                          <line
                            x1={20}
                            y1={hdr.y + 14}
                            x2={layout.width - 20}
                            y2={hdr.y + 14}
                            stroke="var(--gold-border)"
                            strokeDasharray="4 6"
                            strokeWidth="1.5"
                          />
                          <rect
                            x={24}
                            y={hdr.y}
                            width={110}
                            height={26}
                            rx={13}
                            fill="var(--tree-gen-bg)"
                            stroke="var(--tree-dock-border)"
                            strokeWidth="1.5"
                          />
                          <text
                            x={38}
                            y={hdr.y + 17}
                            fill="var(--tree-gen-text)"
                            fontSize="11"
                            fontWeight="700"
                          >
                            {hdr.label}
                          </text>
                        </g>
                      ))}

                      {/* Sibling Orthogonal Bus Connectors (No criss-cross spaghetti!) */}
                      {layout.buses.map((bus) => {
                        const isBusParentsActive = bloodlineMode !== 'none' && bus.parents.some((pid) => bloodline.activeIds.has(pid));
                        const isBusAnyChildActive = bloodlineMode !== 'none' && bus.children.some((c) => bloodline.activeIds.has(c.id));
                        const isBusStemActive = isBusParentsActive && isBusAnyChildActive;
                        const isBusDimmed = bloodlineMode !== 'none' && !isBusStemActive;

                        return (
                          <g key={bus.id} className={'tree-connector-bus ' + (isBusStemActive ? 'is-bloodline-active ' : isBusDimmed ? 'is-dimmed ' : '')}>
                            {/* Vertical drop from parents midpoint / union to horizontal bus bar */}
                            <line
                              x1={bus.sourceX}
                              y1={bus.sourceY}
                              x2={bus.sourceX}
                              y2={bus.busY}
                              className={'tree-connector tree-connector--parent ' + (isBusStemActive ? 'is-bloodline-active' : isBusDimmed ? 'is-dimmed' : '')}
                            />
                            {/* Horizontal bus line connecting all children */}
                            <line
                              x1={bus.minChildX}
                              y1={bus.busY}
                              x2={bus.maxChildX}
                              y2={bus.busY}
                              className={'tree-connector tree-connector--parent ' + (isBusStemActive ? 'is-bloodline-active' : isBusDimmed ? 'is-dimmed' : '')}
                            />
                            {/* Drops into top center of each child */}
                            {bus.children.map((child) => {
                              const isChildActive = isBusParentsActive && bloodline.activeIds.has(child.id);
                              const isChildDimmed = bloodlineMode !== 'none' && !isChildActive;
                              return (
                                <line
                                  key={'child-drop-' + child.id}
                                  x1={child.x}
                                  y1={bus.busY}
                                  x2={child.x}
                                  y2={child.y}
                                  className={'tree-connector tree-connector--parent ' + (isChildActive ? 'is-bloodline-active' : isChildDimmed ? 'is-dimmed' : '')}
                                />
                              );
                            })}
                          </g>
                        );
                      })}

                      {/* Single Parent direct curves */}
                      {layout.singleParentEdges.map((edge) => {
                        const isEdgeActive = bloodlineMode !== 'none' && bloodline.activeIds.has(edge.parentId) && bloodline.activeIds.has(edge.childId);
                        const isEdgeDimmed = bloodlineMode !== 'none' && !isEdgeActive;
                        return (
                          <path
                            key={edge.id}
                            d={edge.path}
                            className={'tree-connector tree-connector--parent ' + (isEdgeActive ? 'is-bloodline-active' : isEdgeDimmed ? 'is-dimmed' : '')}
                          />
                        );
                      })}

                      {/* Marriage lines and central dots between spouses */}
                      {layout.unions.map((union) => {
                        const p1 = nodeById.get(union.person1Id);
                        const p2 = nodeById.get(union.person2Id);
                        if (!p1 || !p2) return null;
                        const x1 = p1.x + nodeP1Width(p1);
                        const x2 = p2.x;
                        const y = union.y;
                        const isHistorical = union.status !== 'married';

                        function nodeP1Width(node: LayoutNode) {
                          return node.width;
                        }

                        const isUnionActive = bloodlineMode !== 'none' && bloodline.activeIds.has(union.person1Id) && bloodline.activeIds.has(union.person2Id);
                        const isUnionDimmed = bloodlineMode !== 'none' && !isUnionActive;

                        return (
                          <g key={union.id} className={isUnionActive ? 'is-bloodline-active' : isUnionDimmed ? 'is-dimmed' : ''}>
                            <line
                              x1={x1}
                              y1={y}
                              x2={x2}
                              y2={y}
                              className={'tree-connector tree-connector--spouse ' + (isHistorical ? 'is-history ' : '') + (isUnionActive ? 'is-bloodline-active' : isUnionDimmed ? 'is-dimmed' : '')}
                            />
                            <circle
                              cx={union.x}
                              cy={union.y}
                              r="7"
                              className={'tree-marriage-dot ' + (isHistorical ? 'is-history ' : '') + (isUnionActive ? 'is-bloodline-active' : isUnionDimmed ? 'is-dimmed' : '')}
                            />
                          </g>
                        );
                      })}

                      {/* Non-tree secondary lineage parent dashed edges */}
                      {layout.secondaryEdges.map((edge) => {
                        const midY = Math.round((edge.y1 + edge.y2) / 2);
                        const d = `M ${edge.x1} ${edge.y1} C ${edge.x1} ${midY}, ${edge.x2} ${midY}, ${edge.x2} ${edge.y2}`;
                        return (
                          <path
                            key={edge.id}
                            d={d}
                            strokeDasharray="6 5"
                            className="tree-connector tree-connector--parent"
                          />
                        );
                      })}
                    </svg>

                    {layout.nodes.map((node) => {
                      const person = node.person;
                      const selected = person.id === selectedId;
                      const parentCount = relationCounts.parents.get(person.id) ?? 0;
                      const childCount = relationCounts.children.get(person.id) ?? 0;
                      const spouseCount = relationCounts.spouses.get(person.id) ?? 0;
                      const isMale = person.gender === 'male';
                      const isFemale = person.gender === 'female';

                      const isHighlighted = bloodlineMode !== 'none' && bloodline.activeIds.has(person.id);
                      const isDimmed = bloodlineMode !== 'none' && !isHighlighted;
                      const isAncestor = bloodline.ancestorIds.has(person.id);
                      const isDescendant = bloodline.descendantIds.has(person.id);
                      const isSpouse = bloodline.spouseIds.has(person.id);

                      let timeClass = '';
                      let ageAtTimeYear: number | null = null;
                      if (timeTravelOpen) {
                        const bYear = person.birth_date ? Number.parseInt(person.birth_date.slice(0, 4), 10) : Number.NaN;
                        const dYear = person.death_date ? Number.parseInt(person.death_date.slice(0, 4), 10) : Number.NaN;
                        if (!Number.isNaN(bYear)) {
                          if (timeYear < bYear) {
                            timeClass = 'is-time-unborn ';
                          } else if (!person.is_alive && !Number.isNaN(dYear) && timeYear > dYear) {
                            timeClass = 'is-time-passed ';
                          } else {
                            timeClass = 'is-time-alive ';
                            ageAtTimeYear = timeYear - bYear;
                          }
                        } else if (person.is_alive && timeYear >= currentYear - 35) {
                          timeClass = 'is-time-alive ';
                        } else {
                          timeClass = 'is-time-unborn ';
                        }
                      }

                      return (
                        <article
                          key={person.id}
                          id={'tree-person-' + person.id}
                          data-person-id={person.id}
                          className={
                            'tree-person-card ' +
                            (selected ? 'is-selected ' : '') +
                            (isMale ? 'is-male ' : isFemale ? 'is-female ' : '') +
                            (person.is_alive ? 'is-alive ' : 'is-deceased ') +
                            (isHighlighted ? 'is-in-bloodline ' : '') +
                            (isDimmed ? 'is-dimmed ' : '') +
                            (isAncestor ? 'is-bloodline-ancestor ' : '') +
                            (isDescendant ? 'is-bloodline-descendant ' : '') +
                            (isSpouse ? 'is-bloodline-spouse ' : '') +
                            timeClass
                          }
                          style={{
                            left: node.x,
                            top: node.y,
                            width: node.width,
                            height: node.height,
                          }}
                        >
                          {timeTravelOpen && ageAtTimeYear !== null && (
                            <span className="tree-time-age-pill" aria-label={`${timeYear} онд ${ageAtTimeYear} настай`}>
                              ✨ {ageAtTimeYear} нас
                            </span>
                          )}
                          {isHighlighted && (
                            <span className="tree-bloodline-tag" aria-label="Удам угсааны үүрэг">
                              {selected ? '👑 Төв хүн' : isAncestor ? '⭐ Дээдэс' : isDescendant ? '🌱 Үр сад' : isSpouse ? '💍 Хань' : '✨ Ураг'}
                            </span>
                          )}
                          <button
                            type="button"
                            className="tree-person-select"
                            aria-pressed={selected}
                            aria-label={personName(person) + ' хүнийг сонгох'}
                            onClick={() => selectPerson(person.id)}
                          >
                            <div className="tree-person-avatar-wrap">
                              <span className="tree-person-avatar" aria-hidden="true">
                                {person.profile_photo_url ? (
                                  <img
                                    src={
                                      person.profile_photo_url.startsWith('/')
                                        ? `${API_BASE}${person.profile_photo_url}`
                                        : person.profile_photo_url
                                    }
                                    alt=""
                                    loading="lazy"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
                                  />
                                ) : (
                                  initials(person)
                                )}
                              </span>
                              {person.is_alive ? (
                                <span className="tree-alive-beacon" title="Амьд сэрүүн" />
                              ) : (
                                <span className="tree-deceased-beacon" title="Мөнхөрсөн">🕊️</span>
                              )}
                            </div>
                            <strong className="tree-person-name">{personName(person) || 'Нэргүй хүн'}</strong>
                            <span className="tree-person-dates">{lifeSummary(person)}</span>
                          </button>
                        </article>
                      );
                    })}

                    {/* Per-unit Collapse / Expand Pills in Classic 2D */}
                    {layout.unitControls.map((ctrl) => {
                      const isUnitLoading = loadingUnitId === ctrl.unitId;
                      return (
                        <button
                          key={`classic-ctrl-${ctrl.unitId}`}
                          type="button"
                          className="tree-action-pill"
                          disabled={isUnitLoading}
                          style={{
                            position: 'absolute',
                            left: ctrl.x,
                            top: ctrl.y,
                            transform: 'translate(-50%, 0)',
                            zIndex: 6,
                            padding: '2px 8px',
                            fontSize: 11,
                          }}
                          aria-expanded={!ctrl.isCollapsed}
                          aria-label={
                            ctrl.isCollapsed
                              ? `Салбар нээх (${ctrl.hiddenDescendantCount} үр хойч)`
                              : 'Салбар хураах'
                          }
                          onClick={() => {
                            const focalNode = layout.nodeById.get(ctrl.focalPersonId);
                            if (focalNode) {
                              classicAnchorRef.current = {
                                personId: ctrl.focalPersonId,
                                prevX: focalNode.x,
                                prevY: focalNode.y,
                              };
                            }
                            void handleToggleCollapse(ctrl.unitId, ctrl.focalPersonId, ctrl.isFrontier);
                          }}
                        >
                          {isUnitLoading
                            ? '…'
                            : ctrl.isCollapsed
                              ? ctrl.hiddenDescendantCount > 0
                                ? `+${ctrl.hiddenDescendantCount}`
                                : '+…'
                              : '−'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              )}

              <TreeDrawer
                familyId={familyId}
                personId={selectedId}
                person={selectedPerson ?? null}
                allPersons={tree?.persons ?? []}
                marriages={selectedMarriages}
                canEdit={canEditFamily}
                onSelectRelative={(relId) => {
                  selectPerson(relId);
                  centerOnPerson(relId);
                }}
                onCenterPerson={(pid) => centerOnPerson(pid)}
                onOpenKinship={(pid) => {
                  setKinshipInitialPersonId(pid);
                  setKinshipModalOpen(true);
                }}
                onAddRelation={(type) => {
                  setWizardAnchorId(selectedId);
                  setWizardMode('create');
                  if (type === 'child') setWizardRole('son');
                  else if (type === 'spouse') setWizardRole('spouse');
                  else if (type === 'sibling') setWizardRole('sibling');
                  else setWizardRole('father');
                  setWizardOpen(true);
                }}
                onRefreshTree={async (msg) => {
                  if (msg) setNotice(msg);
                  await loadTree(familyId, selectedId || undefined, depth);
                }}
                onClose={() => setSelectedId('')}
                onDivorce={(mid) => divorce(mid)}
                profileHref={profileHref}
              />
            </div>
            </>
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

      {/* Vector Print & Wall Art Export Modal (always renders FULL tree ignoring filters/collapse) */}
      <TreeExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        family={family}
        tree={tree}
        layout={fullExportLayout}
      />

      {/* Mongolian Pedigree Certificate PDF Modal */}
      <PedigreeCertificateModal
        isOpen={certificateModalOpen}
        onClose={() => setCertificateModalOpen(false)}
        family={family}
        people={(tree?.persons ?? []) as unknown as Person[]}
        relationships={tree?.parent_child_relationships ?? []}
      />

      {/* Multi-Page Family Heritage Book PDF Studio */}
      <FamilyBookModal
        isOpen={bookModalOpen}
        onClose={() => setBookModalOpen(false)}
        family={family}
        tree={tree}
      />

      {/* Pedigree Context Relative Wizard Modal */}
      <PedigreeWizardModal
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        familyId={familyId}
        people={tree?.persons ?? []}
        marriages={tree?.marriages ?? []}
        parentChildEdges={tree?.parent_child_relationships ?? []}
        initialAnchorPersonId={wizardAnchorId}
        initialRole={wizardRole}
        initialMode={wizardMode}
        onSuccess={async (newPerson, msg) => {
          setWizardOpen(false);
          setNotice(msg);
          setSelectedId(newPerson.id);
          await loadTree(familyId, newPerson.id, depth);
        }}
      />

      {/* Traditional Mongolian Kinship Calculator Modal */}
      <KinshipCalculatorModal
        isOpen={kinshipModalOpen}
        onClose={() => setKinshipModalOpen(false)}
        people={tree?.persons ?? []}
        relationships={tree?.parent_child_relationships ?? []}
        marriages={tree?.marriages ?? []}
        initialPersonAId={kinshipInitialPersonId || selectedId || undefined}
      />

      {/* Divorce Date Picker Modal */}
      {divorceMarriageId && (
        <div
          className="tree-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="divorce-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !divorceBusy) setDivorceMarriageId(null);
          }}
        >
          <section
            ref={divorceModalRef}
            tabIndex={-1}
            className="tree-modal"
            style={{ maxWidth: '420px', width: '100%' }}
          >
            <div className="tree-modal-head">
              <h2 id="divorce-modal-title">Гэрлэлт цуцалсан төлөв оруулах</h2>
              <button
                type="button"
                className="tree-modal-close"
                onClick={() => setDivorceMarriageId(null)}
                disabled={divorceBusy}
                aria-label="Хаах"
              >
                ✕
              </button>
            </div>
            <form className="tree-modal-form" onSubmit={submitDivorce}>
              <label>
                <span>Салсан огноо (заавал биш)</span>
                <input
                  type="date"
                  value={divorceEndDate}
                  onChange={(e) => setDivorceEndDate(e.target.value)}
                  disabled={divorceBusy}
                />
              </label>
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--ui-text-muted)' }}>
                Огноог мэдэхгүй бол хоосон үлдээгээд хадгалж болно.
              </p>
              <div className="tree-modal-actions" style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  className="tree-button tree-button--secondary"
                  onClick={() => setDivorceMarriageId(null)}
                  disabled={divorceBusy}
                >
                  Болих
                </button>
                <button
                  type="submit"
                  className="tree-button tree-button--primary"
                  disabled={divorceBusy}
                >
                  {divorceBusy ? 'Хадгалж байна…' : 'Хадгалах'}
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
