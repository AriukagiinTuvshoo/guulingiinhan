import type { Marriage, TreeData, TreePerson } from './api';

export const TREE_NODE_WIDTH = 156;
export const TREE_NODE_HEIGHT = 128;
export const TREE_SPOUSE_GAP = 22;
export const TREE_SIBLING_GAP = 24;
export const TREE_FAMILY_GAP = 48;
export const TREE_GENERATION_GAP = 78;
export const TREE_PAD_X = 64;
export const TREE_PAD_Y = 56;

export type LayoutNode = {
  id: string;
  person: TreePerson;
  generation: number;
  normalizedGeneration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  unitId: string;
  branchKey: string | null;
};

export type UnionPoint = {
  id: string;
  person1Id: string;
  person2Id: string;
  marriageId?: string;
  x: number;
  y: number;
  status: Marriage['status'];
};

export type OrthogonalBus = {
  id: string;
  parents: string[];
  sourceX: number;
  sourceY: number;
  busY: number;
  minChildX: number;
  maxChildX: number;
  children: { id: string; x: number; y: number }[];
};

export type SecondaryEdge = {
  id: string;
  parentId: string;
  childId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type GenerationHeader = {
  generation: number;
  normalizedGeneration: number;
  label: string;
  y: number;
  count: number;
};

export type StructuralBranch = {
  id: string;
  label: string;
  rootChildId: string;
  count: number;
};

export type UnitControl = {
  unitId: string;
  focalPersonId: string;
  generation: number;
  x: number;
  y: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  hiddenDescendantCount: number;
  directChildCount: number;
  isFrontier: boolean;
};

export type TreeLayoutOptions = {
  collapsedUnitIds?: ReadonlySet<string>;
  branchId?: string | null;
  showDaughtersDescendants?: boolean;
  ignoreFilters?: boolean;
};

export type AdvancedTreeLayout = {
  nodes: LayoutNode[];
  nodeById: Map<string, LayoutNode>;
  unions: UnionPoint[];
  buses: OrthogonalBus[];
  singleParentEdges: { id: string; parentId: string; childId: string; path: string }[];
  secondaryEdges: SecondaryEdge[];
  generationHeaders: GenerationHeader[];
  unitControls: UnitControl[];
  branches: StructuralBranch[];
  hasConfirmedRoot: boolean;
  lineageRootId: string | null;
  defaultCollapsedIds: string[];
  allCollapsibleIds: string[];
  width: number;
  height: number;
  generationsCount: number;
};

type InternalUnit = {
  id: string;
  focalId: string;
  spouseIds: string[];
  /** Ordered left-to-right member IDs rendered inside this indivisible couple unit. */
  memberIds: string[];
  generation: number;
  branchKey: string | null;
  width: number;
  children: InternalUnit[];
  /** Relative x of this unit's left edge with respect to its parent's left edge. */
  relX: number;
  /** Final absolute x of this unit's left edge. */
  absX: number;
  /** Left/right bounding contours relative to this unit's left edge (index = depth below unit). */
  leftContour: number[];
  rightContour: number[];
};

function comparePeople(a: TreePerson, b: TreePerson): number {
  const byA = a.birth_date || '9999-99-99';
  const byB = b.birth_date || '9999-99-99';
  if (byA !== byB) return byA.localeCompare(byB);
  const nameA = `${a.last_name || ''} ${a.first_name || ''}`.trim();
  const nameB = `${b.last_name || ''} ${b.first_name || ''}`.trim();
  if (nameA !== nameB) return nameA.localeCompare(nameB);
  return a.id.localeCompare(b.id);
}

function shortLabel(person: TreePerson): string {
  return person.first_name || person.last_name || 'Салбар';
}

function marriageOrderKey(m: Marriage): string {
  const statusRank = m.status === 'divorced' ? '0' : m.status === 'widowed' ? '1' : '2';
  return `${m.start_date || '9999-99-99'}-${statusRank}-${m.id}`;
}

export function buildAdvancedTreeLayout(
  tree: TreeData,
  options: TreeLayoutOptions = {},
): AdvancedTreeLayout {
  const empty: AdvancedTreeLayout = {
    nodes: [],
    nodeById: new Map(),
    unions: [],
    buses: [],
    singleParentEdges: [],
    secondaryEdges: [],
    generationHeaders: [],
    unitControls: [],
    branches: [],
    hasConfirmedRoot: false,
    lineageRootId: null,
    defaultCollapsedIds: [],
    allCollapsibleIds: [],
    width: 960,
    height: 480,
    generationsCount: 0,
  };

  if (!tree.persons.length) {
    return empty;
  }

  const personById = new Map<string, TreePerson>(tree.persons.map((p) => [p.id, p]));
  const personIds = new Set(personById.keys());

  const childToParents = new Map<string, string[]>();
  const parentToChildren = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  const marriageByPair = new Map<string, Marriage>();

  for (const id of personIds) {
    childToParents.set(id, []);
    parentToChildren.set(id, []);
    spousesOf.set(id, []);
  }

  const sortedParentEdges = [...tree.parent_child_relationships].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (const edge of sortedParentEdges) {
    if (!personIds.has(edge.parent_id) || !personIds.has(edge.child_id)) continue;
    if (edge.parent_id === edge.child_id) continue;
    const pList = childToParents.get(edge.child_id)!;
    if (!pList.includes(edge.parent_id)) pList.push(edge.parent_id);
    const cList = parentToChildren.get(edge.parent_id)!;
    if (!cList.includes(edge.child_id)) cList.push(edge.child_id);
  }

  const sortedMarriages = [...tree.marriages].sort((a, b) =>
    marriageOrderKey(a).localeCompare(marriageOrderKey(b)),
  );
  for (const m of sortedMarriages) {
    if (!personIds.has(m.person_1_id) || !personIds.has(m.person_2_id)) continue;
    if (m.person_1_id === m.person_2_id) continue;
    const pairKey = [m.person_1_id, m.person_2_id].sort().join(':');
    if (!marriageByPair.has(pairKey) || m.status === 'married') {
      marriageByPair.set(pairKey, m);
    }
    const s1 = spousesOf.get(m.person_1_id)!;
    if (!s1.includes(m.person_2_id)) s1.push(m.person_2_id);
    const s2 = spousesOf.get(m.person_2_id)!;
    if (!s2.includes(m.person_1_id)) s2.push(m.person_1_id);
  }

  // Deterministic ordering of children and spouses
  for (const [, list] of parentToChildren) {
    list.sort((a, b) => comparePeople(personById.get(a)!, personById.get(b)!));
  }
  for (const [pid, list] of spousesOf) {
    list.sort((a, b) => {
      const mA = marriageByPair.get([pid, a].sort().join(':'));
      const mB = marriageByPair.get([pid, b].sort().join(':'));
      const kA = mA ? marriageOrderKey(mA) : '9999';
      const kB = mB ? marriageOrderKey(mB) : '9999';
      if (kA !== kB) return kA.localeCompare(kB);
      return comparePeople(personById.get(a)!, personById.get(b)!);
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Confirmed lineage root detection + upward walk to true top-most ancestor
  //    If a user later adds parents above lineage_root_person_id (e.g. adding
  //    Ядамсүрэн & Гүнд above Баавай), walk upward so the founding couple sits
  //    at Generation 1 and all children/descendants flow cleanly downward!
  // ---------------------------------------------------------------------------
  const hasConfirmedRoot = Boolean(
    tree.lineage_root_person_id && personIds.has(tree.lineage_root_person_id),
  );
  const lineageRootId = hasConfirmedRoot ? tree.lineage_root_person_id! : null;

  function walkUpToTopAncestor(startId: string): string {
    let current = startId;
    const seen = new Set<string>([current]);
    while (true) {
      const parents = (childToParents.get(current) ?? []).filter((pid) => !seen.has(pid));
      if (!parents.length) break;
      // Prefer male (paternal) ancestor as focal node of the couple unit, else oldest
      parents.sort((a, b) => {
        const pa = personById.get(a);
        const pb = personById.get(b);
        const maleA = pa?.gender === 'male' ? 0 : 1;
        const maleB = pb?.gender === 'male' ? 0 : 1;
        if (maleA !== maleB) return maleA - maleB;
        return comparePeople(pa!, pb!);
      });
      current = parents[0];
      seen.add(current);
    }
    return current;
  }

  let layoutRootId: string;
  if (lineageRootId) {
    layoutRootId = walkUpToTopAncestor(lineageRootId);
  } else {
    // Pick top-most ancestor with 0 parents who has the most children/descendants
    const candidatesWithNoParents = [...personIds]
      .filter((id) => (childToParents.get(id)?.length ?? 0) === 0)
      .sort((a, b) => {
        const descA = parentToChildren.get(a)?.length ?? 0;
        const descB = parentToChildren.get(b)?.length ?? 0;
        if (descA !== descB) return descB - descA;
        return comparePeople(personById.get(a)!, personById.get(b)!);
      });
    const seed =
      candidatesWithNoParents[0] ||
      (tree.root_person_id && personIds.has(tree.root_person_id) ? tree.root_person_id : '') ||
      [...personIds].sort((a, b) => comparePeople(personById.get(a)!, personById.get(b)!))[0];
    layoutRootId = walkUpToTopAncestor(seed);
  }

  // ---------------------------------------------------------------------------
  // 2. Downward lineage reachability & generation assignment from layoutRootId
  //    Handles non-tree cases:
  //    - Married-in spouses whose own in-law parents are loaded: excluded from
  //      in-law ancestor trees; drawn ONLY inside their couple unit.
  //    - Inter-branch marriages where BOTH parents are lineage descendants:
  //      child attaches to ONE primary parent; second parent becomes a dashed edge.
  // ---------------------------------------------------------------------------
  const genByPerson = new Map<string, number>();
  const lineageSet = new Set<string>();
  const rootSpouses = spousesOf.get(layoutRootId) ?? [];

  genByPerson.set(layoutRootId, 1);
  lineageSet.add(layoutRootId);
  for (const rs of rootSpouses) {
    genByPerson.set(rs, 1);
  }

  // BFS strictly downward from layoutRootId (+ rootSpouses' shared children).
  const queue: string[] = [layoutRootId, ...rootSpouses];
  const visitedDown = new Set<string>(queue);
  const primaryParentOf = new Map<string, string>();
  const secondaryParentPairs: { parentId: string; childId: string }[] = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curGen = genByPerson.get(cur) ?? 1;
    const isRootSpouse = cur !== layoutRootId && rootSpouses.includes(cur);
    const children = parentToChildren.get(cur) ?? [];

    for (const childId of children) {
      if (childId === layoutRootId || rootSpouses.includes(childId)) continue;
      if (!lineageSet.has(childId)) {
        lineageSet.add(childId);
        genByPerson.set(childId, curGen + 1);
        primaryParentOf.set(childId, isRootSpouse ? layoutRootId : cur);
        if (!visitedDown.has(childId)) {
          visitedDown.add(childId);
          queue.push(childId);
        }
      } else {
        // Child already reached via another parent in the lineage!
        const existingPrimary = primaryParentOf.get(childId);
        if (
          existingPrimary &&
          existingPrimary !== cur &&
          !isRootSpouse &&
          !(existingPrimary === layoutRootId && rootSpouses.includes(cur))
        ) {
          // Check if `cur` is simply the non-lineage spouse of `existingPrimary` (normal couple)
          const isNormalCoParent = (spousesOf.get(existingPrimary) ?? []).includes(cur) && !lineageSet.has(cur);
          if (!isNormalCoParent) {
            // Both `existingPrimary` and `cur` are lineage descendants -> non-tree inter-branch child!
            if (
              !secondaryParentPairs.some(
                (pair) => pair.parentId === cur && pair.childId === childId,
              )
            ) {
              secondaryParentPairs.push({ parentId: cur, childId });
            }
          }
        }
      }
    }
  }

  // Assign generation to married-in spouses of lineage members (do NOT walk into in-law parents!)
  const marriedInSpouses = new Set<string>();
  for (const lid of lineageSet) {
    const lGen = genByPerson.get(lid)!;
    for (const sp of spousesOf.get(lid) ?? []) {
      if (!lineageSet.has(sp)) {
        marriedInSpouses.add(sp);
        if (!genByPerson.has(sp)) {
          genByPerson.set(sp, lGen);
        }
      }
    }
  }

  // Identify in-law ancestors (ancestors of married-in spouses who are NOT in lineageSet
  // and NOT married-in spouses themselves) -> explicitly excluded from rendering!
  const inLawAncestors = new Set<string>();
  const inLawQueue: string[] = [...marriedInSpouses];
  const inLawVisited = new Set<string>(inLawQueue);
  while (inLawQueue.length > 0) {
    const cur = inLawQueue.shift()!;
    for (const parentId of childToParents.get(cur) ?? []) {
      if (!lineageSet.has(parentId) && !marriedInSpouses.has(parentId) && !inLawVisited.has(parentId)) {
        inLawVisited.add(parentId);
        inLawAncestors.add(parentId);
        inLawQueue.push(parentId);
        // Also exclude the in-law parent's spouse if not part of the lineage
        for (const sp of spousesOf.get(parentId) ?? []) {
          if (!lineageSet.has(sp) && !marriedInSpouses.has(sp) && !inLawVisited.has(sp)) {
            inLawVisited.add(sp);
            inLawAncestors.add(sp);
            inLawQueue.push(sp);
          }
        }
      }
    }
  }

  // Build primary parent -> direct children map for the lineage spanning tree
  const treeChildrenOf = new Map<string, string[]>();
  for (const lid of lineageSet) {
    treeChildrenOf.set(lid, []);
  }
  for (const [childId, parentId] of primaryParentOf.entries()) {
    const list = treeChildrenOf.get(parentId);
    if (list) list.push(childId);
  }
  for (const [, list] of treeChildrenOf) {
    list.sort((a, b) => comparePeople(personById.get(a)!, personById.get(b)!));
  }

  // ---------------------------------------------------------------------------
  // 3. Structural Branch Derivation (root couple's children -> branches,
  //    with explicit person.branch_id / branch_name as override)
  // ---------------------------------------------------------------------------
  const rootChildren = treeChildrenOf.get(layoutRootId) ?? [];
  const branchKeyByPerson = new Map<string, string | null>();
  const branchMeta = new Map<string, { id: string; label: string; rootChildId: string; count: number }>();

  branchKeyByPerson.set(layoutRootId, null);
  for (const rs of rootSpouses) {
    branchKeyByPerson.set(rs, null);
  }

  for (const rcId of rootChildren) {
    const rc = personById.get(rcId)!;
    const structuralKey = rc.branch_id || `structural:${rcId}`;
    const label = rc.branch_name || shortLabel(rc);
    if (!branchMeta.has(structuralKey)) {
      branchMeta.set(structuralKey, {
        id: structuralKey,
        label,
        rootChildId: rcId,
        count: 0,
      });
    }

    // BFS downward from this root child to tag its entire structural subtree
    const bQueue: string[] = [rcId];
    const bSeen = new Set<string>([rcId]);
    while (bQueue.length > 0) {
      const cur = bQueue.shift()!;
      const curPerson = personById.get(cur)!;
      const effectiveKey =
        curPerson.branch_id && branchMeta.has(curPerson.branch_id)
          ? curPerson.branch_id
          : structuralKey;
      branchKeyByPerson.set(cur, effectiveKey);
      const meta = branchMeta.get(effectiveKey);
      if (meta) meta.count += 1;

      for (const sp of spousesOf.get(cur) ?? []) {
        if (marriedInSpouses.has(sp) && !branchKeyByPerson.has(sp)) {
          branchKeyByPerson.set(sp, effectiveKey);
          if (meta) meta.count += 1;
        }
      }
      for (const ch of treeChildrenOf.get(cur) ?? []) {
        if (!bSeen.has(ch)) {
          bSeen.add(ch);
          bQueue.push(ch);
        }
      }
    }
  }

  const branches: StructuralBranch[] = [...branchMeta.values()];

  // ---------------------------------------------------------------------------
  // 4. Precompute total descendant counts & default collapse sets
  // ---------------------------------------------------------------------------
  const descendantCountMemo = new Map<string, number>();
  function countDescendants(focalId: string): number {
    const cached = descendantCountMemo.get(focalId);
    if (cached !== undefined) return cached;
    let total = 0;
    for (const ch of treeChildrenOf.get(focalId) ?? []) {
      total += 1 + countDescendants(ch);
    }
    descendantCountMemo.set(focalId, total);
    return total;
  }
  countDescendants(layoutRootId);

  const defaultCollapsedIds: string[] = [];
  const allCollapsibleIds: string[] = [];
  for (const lid of lineageSet) {
    const directChildren = treeChildrenOf.get(lid) ?? [];
    if (directChildren.length > 0) {
      allCollapsibleIds.push(lid);
      const g = genByPerson.get(lid) ?? 1;
      // Default open 3 generations (Gen 1, 2, 3 visible; Gen 3 parents start collapsed)
      if (g >= 3) {
        defaultCollapsedIds.push(lid);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Build Visible Couple-Unit Tree (respecting filters & collapse state)
  // ---------------------------------------------------------------------------
  const ignoreFilters = Boolean(options.ignoreFilters);
  const activeBranchId = ignoreFilters ? null : (options.branchId ?? null);
  const showDaughtersDescendants = ignoreFilters
    ? true
    : (options.showDaughtersDescendants ?? true);
  const collapsedSet: ReadonlySet<string> = ignoreFilters
    ? new Set<string>()
    : (options.collapsedUnitIds ?? new Set<string>());

  const claimedInUnit = new Set<string>();
  const unitByFocal = new Map<string, InternalUnit>();

  function buildUnit(focalId: string): InternalUnit | null {
    if (claimedInUnit.has(focalId)) return null;
    const focal = personById.get(focalId);
    if (!focal) return null;

    const gen = genByPerson.get(focalId) ?? 1;
    const bKey = branchKeyByPerson.get(focalId) ?? null;

    // Branch filter: Gen 1 founders always stay anchored; Gen 2+ must match activeBranchId.
    if (activeBranchId && gen >= 2 && bKey !== activeBranchId) {
      return null;
    }

    claimedInUnit.add(focalId);

    // Gather married-in spouses (never duplicate another lineage member who has their own natal unit!)
    const ownSpouses = (spousesOf.get(focalId) ?? []).filter((spId) => {
      if (claimedInUnit.has(spId)) return false;
      if (lineageSet.has(spId) && focalId !== layoutRootId) return false;
      return true;
    });

    for (const spId of ownSpouses) {
      claimedInUnit.add(spId);
    }

    // Order members left-to-right:
    // - 0 spouses: [focal]
    // - 1 spouse:  [focal, spouse1]
    // - 2+ spouses (remarriage!): [spouse1, focal, spouse2, ...] so marriage-1 children sit left
    //   and marriage-2 children sit right with zero crossing edges!
    let memberIds: string[];
    if (ownSpouses.length === 0) {
      memberIds = [focalId];
    } else if (ownSpouses.length === 1) {
      memberIds = [focalId, ownSpouses[0]];
    } else {
      memberIds = [ownSpouses[0], focalId, ...ownSpouses.slice(1)];
    }

    const width =
      memberIds.length * TREE_NODE_WIDTH + Math.max(0, memberIds.length - 1) * TREE_SPOUSE_GAP;

    const unit: InternalUnit = {
      id: focalId,
      focalId,
      spouseIds: ownSpouses,
      memberIds,
      generation: gen,
      branchKey: bKey,
      width,
      children: [],
      relX: 0,
      absX: 0,
      leftContour: [0],
      rightContour: [width],
    };
    unitByFocal.set(focalId, unit);

    // Check if children should be hidden (daughters' descendants toggle or collapsed state)
    const isDaughterBlocked =
      !showDaughtersDescendants && gen >= 2 && focal.gender === 'female';
    const isCollapsed = collapsedSet.has(focalId);

    if (!isDaughterBlocked && !isCollapsed) {
      const directChildren = [...(treeChildrenOf.get(focalId) ?? [])];
      // For remarriages, sort children by their co-parent's left-to-right spouse index so edges never cross!
      if (ownSpouses.length >= 2) {
        const spouseRank = (childId: string): number => {
          const parents = childToParents.get(childId) ?? [];
          for (let i = 0; i < ownSpouses.length; i += 1) {
            if (parents.includes(ownSpouses[i])) return i;
          }
          return ownSpouses.length;
        };
        directChildren.sort((a, b) => {
          const rA = spouseRank(a);
          const rB = spouseRank(b);
          if (rA !== rB) return rA - rB;
          return comparePeople(personById.get(a)!, personById.get(b)!);
        });
      }

      for (const chId of directChildren) {
        const childUnit = buildUnit(chId);
        if (childUnit) {
          unit.children.push(childUnit);
        }
      }
    }

    return unit;
  }

  const rootUnit = buildUnit(layoutRootId);
  const forest: InternalUnit[] = [];
  if (rootUnit) forest.push(rootUnit);

  // Pack any genuinely disconnected non-lineage components to the right (never re-add collapsed/filtered lineage nodes!)
  if (!activeBranchId) {
    const unplaced = [...personIds]
      .filter(
        (id) =>
          !claimedInUnit.has(id) &&
          !lineageSet.has(id) &&
          !inLawAncestors.has(id) &&
          !marriedInSpouses.has(id),
      )
      .sort((a, b) => comparePeople(personById.get(a)!, personById.get(b)!));
    for (const id of unplaced) {
      if (claimedInUnit.has(id)) continue;
      if (!genByPerson.has(id)) genByPerson.set(id, 1);
      const u = buildUnit(id);
      if (u) forest.push(u);
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Reingold-Tilford Contour Tidy-Tree Placement (Zero Overlap, Centered Parents)
  // ---------------------------------------------------------------------------
  function layoutUnit(unit: InternalUnit): void {
    if (unit.children.length === 0) {
      unit.leftContour = [0];
      unit.rightContour = [unit.width];
      return;
    }

    for (const child of unit.children) {
      layoutUnit(child);
    }

    // Place children left-to-right using exact contour separation
    let combinedLeft: number[] = [];
    let combinedRight: number[] = [];

    for (let i = 0; i < unit.children.length; i += 1) {
      const child = unit.children[i];
      if (i === 0) {
        child.relX = 0;
        combinedLeft = [...child.leftContour];
        combinedRight = [...child.rightContour];
        continue;
      }

      // Compute minimum shift so child's left contour clears combinedRight at every shared depth
      const sharedDepth = Math.min(combinedRight.length, child.leftContour.length);
      let shift = combinedRight[0] + TREE_SIBLING_GAP - child.leftContour[0];
      for (let d = 0; d < sharedDepth; d += 1) {
        const needed = combinedRight[d] + TREE_SIBLING_GAP - child.leftContour[d];
        if (needed > shift) shift = needed;
      }
      child.relX = shift;

      // Merge contours
      const maxDepth = Math.max(combinedLeft.length, child.leftContour.length);
      const nextLeft: number[] = [];
      const nextRight: number[] = [];
      for (let d = 0; d < maxDepth; d += 1) {
        const lA = d < combinedLeft.length ? combinedLeft[d] : Number.POSITIVE_INFINITY;
        const lB = d < child.leftContour.length ? child.leftContour[d] + shift : Number.POSITIVE_INFINITY;
        nextLeft.push(Math.min(lA, lB));

        const rA = d < combinedRight.length ? combinedRight[d] : Number.NEGATIVE_INFINITY;
        const rB = d < child.rightContour.length ? child.rightContour[d] + shift : Number.NEGATIVE_INFINITY;
        nextRight.push(Math.max(rA, rB));
      }
      combinedLeft = nextLeft;
      combinedRight = nextRight;
    }

    // Center parent unit directly over the midpoint of its first and last child centers
    const firstChild = unit.children[0];
    const lastChild = unit.children[unit.children.length - 1];
    const childrenMid =
      (firstChild.relX + firstChild.width / 2 + (lastChild.relX + lastChild.width / 2)) / 2;
    const childOffset = unit.width / 2 - childrenMid;

    for (const child of unit.children) {
      child.relX += childOffset;
    }

    unit.leftContour = [0, ...combinedLeft.map((x) => x + childOffset)];
    unit.rightContour = [unit.width, ...combinedRight.map((x) => x + childOffset)];
  }

  for (const treeRoot of forest) {
    layoutUnit(treeRoot);
  }

  // Assign absolute X coordinates across the forest
  let forestCursorX = TREE_PAD_X;
  const allUnits: InternalUnit[] = [];

  function assignAbsX(unit: InternalUnit, parentAbsX: number): void {
    unit.absX = Math.round(parentAbsX + unit.relX);
    allUnits.push(unit);
    for (const child of unit.children) {
      assignAbsX(child, unit.absX);
    }
  }

  for (const treeRoot of forest) {
    const minLeft = Math.min(...treeRoot.leftContour);
    const maxRight = Math.max(...treeRoot.rightContour);
    const rootAbsX = forestCursorX - minLeft;
    assignAbsX(treeRoot, rootAbsX);
    forestCursorX = rootAbsX + maxRight + TREE_FAMILY_GAP;
  }

  // ---------------------------------------------------------------------------
  // 7. Emit LayoutNodes, Unions, Buses, Secondary Dashed Edges & Unit Controls
  // ---------------------------------------------------------------------------
  const nodes: LayoutNode[] = [];
  const nodeById = new Map<string, LayoutNode>();
  const rowCounts = new Map<number, number>();
  let maxX = 0;
  let maxY = 0;

  for (const unit of allUnits) {
    const y = TREE_PAD_Y + (unit.generation - 1) * (TREE_NODE_HEIGHT + TREE_GENERATION_GAP);
    for (let i = 0; i < unit.memberIds.length; i += 1) {
      const pid = unit.memberIds[i];
      const person = personById.get(pid)!;
      const x = Math.round(unit.absX + i * (TREE_NODE_WIDTH + TREE_SPOUSE_GAP));
      const node: LayoutNode = {
        id: pid,
        person,
        generation: unit.generation,
        normalizedGeneration: unit.generation - 1,
        x,
        y,
        width: TREE_NODE_WIDTH,
        height: TREE_NODE_HEIGHT,
        unitId: unit.id,
        branchKey: unit.branchKey,
      };
      nodes.push(node);
      nodeById.set(pid, node);
      rowCounts.set(unit.generation, (rowCounts.get(unit.generation) ?? 0) + 1);
      maxX = Math.max(maxX, x + TREE_NODE_WIDTH);
      maxY = Math.max(maxY, y + TREE_NODE_HEIGHT);
    }
  }

  const unions: UnionPoint[] = [];
  const unionByPair = new Map<string, UnionPoint>();
  const buses: OrthogonalBus[] = [];
  const singleParentEdges: { id: string; parentId: string; childId: string; path: string }[] = [];

  for (const unit of allUnits) {
    const focalNode = nodeById.get(unit.focalId);
    if (!focalNode) continue;

    // Emit marriage unions for each spouse in this unit
    for (const spId of unit.spouseIds) {
      const spNode = nodeById.get(spId);
      if (!spNode) continue;
      const left = focalNode.x <= spNode.x ? focalNode : spNode;
      const right = focalNode.x <= spNode.x ? spNode : focalNode;
      const pairKey = [unit.focalId, spId].sort().join(':');
      const m = marriageByPair.get(pairKey);
      const union: UnionPoint = {
        id: `union:${pairKey}`,
        person1Id: left.id,
        person2Id: right.id,
        marriageId: m?.id,
        x: Math.round((left.x + left.width + right.x) / 2),
        y: Math.round(left.y + left.height / 2),
        status: m?.status ?? 'married',
      };
      unions.push(union);
      unionByPair.set(pairKey, union);
    }

    // Group visible children of this unit by their parent union (or single focal parent)
    if (unit.children.length > 0) {
      const childrenByGroup = new Map<string, { parents: string[]; sourceX: number; sourceY: number; childIds: string[] }>();

      for (const childUnit of unit.children) {
        const cParents = childToParents.get(childUnit.focalId) ?? [];
        const coSpouse = unit.spouseIds.find((spId) => cParents.includes(spId));
        if (coSpouse) {
          const pairKey = [unit.focalId, coSpouse].sort().join(':');
          const union = unionByPair.get(pairKey);
          const key = `u:${pairKey}`;
          if (!childrenByGroup.has(key)) {
            childrenByGroup.set(key, {
              parents: [unit.focalId, coSpouse],
              sourceX: union ? union.x : Math.round(focalNode.x + focalNode.width / 2),
              sourceY: union ? union.y : focalNode.y + focalNode.height,
              childIds: [],
            });
          }
          childrenByGroup.get(key)!.childIds.push(childUnit.focalId);
        } else {
          const key = `s:${unit.focalId}`;
          if (!childrenByGroup.has(key)) {
            childrenByGroup.set(key, {
              parents: [unit.focalId],
              sourceX: Math.round(focalNode.x + focalNode.width / 2),
              sourceY: focalNode.y + focalNode.height,
              childIds: [],
            });
          }
          childrenByGroup.get(key)!.childIds.push(childUnit.focalId);
        }
      }

      for (const [groupKey, group] of childrenByGroup.entries()) {
        const childCoords = group.childIds
          .map((cid) => nodeById.get(cid))
          .filter((n): n is LayoutNode => Boolean(n))
          .map((n) => ({
            id: n.id,
            x: Math.round(n.x + n.width / 2),
            y: n.y,
          }))
          .sort((a, b) => a.x - b.x);
        if (!childCoords.length) continue;

        const minChildX = Math.min(...childCoords.map((c) => c.x));
        const maxChildX = Math.max(...childCoords.map((c) => c.x));
        const busY = Math.round(
          (focalNode.y + focalNode.height + childCoords[0].y) / 2,
        );
        buses.push({
          id: `bus:${groupKey}`,
          parents: group.parents,
          sourceX: group.sourceX,
          sourceY: group.sourceY,
          busY,
          minChildX,
          maxChildX,
          children: childCoords,
        });
      }
    }
  }

  // Secondary dashed edges for non-tree inter-branch children (both parents in lineage)
  const secondaryEdges: SecondaryEdge[] = [];
  for (const pair of secondaryParentPairs) {
    const pNode = nodeById.get(pair.parentId);
    const cNode = nodeById.get(pair.childId);
    if (!pNode || !cNode) continue;
    secondaryEdges.push({
      id: `secondary:${pair.parentId}:${pair.childId}`,
      parentId: pair.parentId,
      childId: pair.childId,
      x1: Math.round(pNode.x + pNode.width / 2),
      y1: pNode.y + pNode.height,
      x2: Math.round(cNode.x + cNode.width / 2),
      y2: cNode.y,
    });
  }

  // Per-unit collapse / expand controls (with descendant count & frontier indicator)
  const maxLoadedGen = Math.max(...[...genByPerson.values()], 1);
  const unitControls: UnitControl[] = [];
  for (const unit of allUnits) {
    const directChildren = treeChildrenOf.get(unit.focalId) ?? [];
    const hiddenDesc = countDescendants(unit.focalId);
    const focal = personById.get(unit.focalId);
    const isDaughterBlocked =
      !showDaughtersDescendants && unit.generation >= 2 && focal?.gender === 'female';
    if (isDaughterBlocked) continue;

    // Show pill if this unit has loaded children OR is at the loaded frontier of a truncated/partial tree
    const isFrontier =
      directChildren.length === 0 &&
      Boolean(tree.meta?.depth && unit.generation >= tree.meta.depth + 1) &&
      unit.generation < 9 &&
      unit.generation === maxLoadedGen;

    if (directChildren.length > 0 || isFrontier) {
      const isCollapsed = collapsedSet.has(unit.focalId) || isFrontier;
      unitControls.push({
        unitId: unit.id,
        focalPersonId: unit.focalId,
        generation: unit.generation,
        x: Math.round(unit.absX + unit.width / 2),
        y: TREE_PAD_Y + (unit.generation - 1) * (TREE_NODE_HEIGHT + TREE_GENERATION_GAP) + TREE_NODE_HEIGHT + 4,
        hasChildren: directChildren.length > 0,
        isCollapsed,
        hiddenDescendantCount: hiddenDesc,
        directChildCount: directChildren.length,
        isFrontier,
      });
    }
  }

  // Generation headers (STRICT: only "1-р үе … N-р үе" when lineage_root_person_id is loaded, else "?")
  const sortedGens = [...rowCounts.keys()].sort((a, b) => a - b);
  const generationHeaders: GenerationHeader[] = sortedGens.map((gen) => ({
    generation: gen,
    normalizedGeneration: gen - 1,
    label: hasConfirmedRoot ? `${gen}-р үе` : '?',
    y: TREE_PAD_Y + (gen - 1) * (TREE_NODE_HEIGHT + TREE_GENERATION_GAP),
    count: rowCounts.get(gen) ?? 0,
  }));

  return {
    nodes,
    nodeById,
    unions,
    buses,
    singleParentEdges,
    secondaryEdges,
    generationHeaders,
    unitControls,
    branches,
    hasConfirmedRoot,
    lineageRootId,
    defaultCollapsedIds,
    allCollapsibleIds,
    width: Math.max(960, Math.round(maxX + TREE_PAD_X)),
    height: Math.max(480, Math.round(maxY + TREE_PAD_Y + 48)),
    generationsCount: sortedGens.length,
  };
}
