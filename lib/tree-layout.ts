import type { Marriage, TreeData, TreePerson } from './api';

export const TREE_NODE_WIDTH = 196;
export const TREE_NODE_HEIGHT = 168;
export const TREE_SPOUSE_GAP = 36;
export const TREE_SIBLING_GAP = 32;
export const TREE_FAMILY_GAP = 60;
export const TREE_GENERATION_GAP = 96;
export const TREE_PAD_X = 64;
export const TREE_PAD_Y = 64;

export type LayoutNode = {
  id: string;
  person: TreePerson;
  generation: number;
  normalizedGeneration: number;
  x: number;
  y: number;
  width: number;
  height: number;
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

export type GenerationHeader = {
  generation: number;
  normalizedGeneration: number;
  label: string;
  y: number;
  count: number;
};

export type AdvancedTreeLayout = {
  nodes: LayoutNode[];
  nodeById: Map<string, LayoutNode>;
  unions: UnionPoint[];
  buses: OrthogonalBus[];
  singleParentEdges: { id: string; parentId: string; childId: string; path: string }[];
  generationHeaders: GenerationHeader[];
  width: number;
  height: number;
  generationsCount: number;
};

function getMongolianGenerationLabel(relativeGen: number): string {
  switch (relativeGen) {
    case -4:
      return 'Хуланц өвөг (4-р үе дээш)';
    case -3:
      return 'Элэнц өвөг (3-р үе дээш)';
    case -2:
      return 'Өвөг эцэг, эмэг эх (2-р үе дээш)';
    case -1:
      return 'Эцэг, эх (1-р үе дээш)';
    case 0:
      return 'Би / Үе тэнгийнхэн (Төв үе)';
    case 1:
      return 'Үр хүүхэд (1-р үе доош)';
    case 2:
      return 'Ач, зээ (2-р үе доош)';
    case 3:
      return 'Жич (3-р үе доош)';
    case 4:
      return 'Тач (4-р үе доош)';
    default:
      if (relativeGen < 0) return `${Math.abs(relativeGen)}-р үе (Дээд өвөг)`;
      return `${relativeGen}-р үе (Үр хойч)`;
  }
}

export function buildAdvancedTreeLayout(tree: TreeData): AdvancedTreeLayout {
  if (!tree.persons.length) {
    return {
      nodes: [],
      nodeById: new Map(),
      unions: [],
      buses: [],
      singleParentEdges: [],
      generationHeaders: [],
      width: 960,
      height: 480,
      generationsCount: 0,
    };
  }

  const personById = new Map<string, TreePerson>(tree.persons.map((p) => [p.id, p]));
  const personIds = new Set(tree.persons.map((p) => p.id));

  // Relationships maps
  const childToParents = new Map<string, string[]>();
  const parentToChildren = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  const marriageMap = new Map<string, Marriage>();

  for (const p of tree.persons) {
    childToParents.set(p.id, []);
    parentToChildren.set(p.id, []);
    spousesOf.set(p.id, []);
  }

  for (const edge of tree.parent_child_relationships) {
    if (!personIds.has(edge.parent_id) || !personIds.has(edge.child_id)) continue;
    childToParents.get(edge.child_id)?.push(edge.parent_id);
    parentToChildren.get(edge.parent_id)?.push(edge.child_id);
  }

  for (const m of tree.marriages) {
    if (!personIds.has(m.person_1_id) || !personIds.has(m.person_2_id)) continue;
    spousesOf.get(m.person_1_id)?.push(m.person_2_id);
    spousesOf.get(m.person_2_id)?.push(m.person_1_id);
    const key1 = `${m.person_1_id}:${m.person_2_id}`;
    const key2 = `${m.person_2_id}:${m.person_1_id}`;
    marriageMap.set(key1, m);
    marriageMap.set(key2, m);
  }

  // Determine generations
  const rootId =
    tree.root_person_id && personIds.has(tree.root_person_id)
      ? tree.root_person_id
      : tree.persons[0].id;

  const generationById = new Map<string, number>();
  generationById.set(rootId, 0);

  // BFS to propagate generations relative to root
  const queue = [rootId];
  const visited = new Set<string>([rootId]);

  while (queue.length) {
    const currentId = queue.shift()!;
    const currentGen = generationById.get(currentId) ?? 0;

    // Parents are currentGen - 1
    for (const parentId of childToParents.get(currentId) ?? []) {
      if (!visited.has(parentId)) {
        visited.add(parentId);
        generationById.set(parentId, currentGen - 1);
        queue.push(parentId);
      }
    }

    // Children are currentGen + 1
    for (const childId of parentToChildren.get(currentId) ?? []) {
      if (!visited.has(childId)) {
        visited.add(childId);
        generationById.set(childId, currentGen + 1);
        queue.push(childId);
      }
    }

    // Spouses are same generation
    for (const spouseId of spousesOf.get(currentId) ?? []) {
      if (!visited.has(spouseId)) {
        visited.add(spouseId);
        generationById.set(spouseId, currentGen);
        queue.push(spouseId);
      }
    }
  }

  // Handle any disconnected individuals
  for (const person of tree.persons) {
    if (!generationById.has(person.id)) {
      generationById.set(person.id, 0);
    }
  }

  const minGen = Math.min(...generationById.values());
  const maxGen = Math.max(...generationById.values());
  const totalGenerations = maxGen - minGen + 1;

  // Group persons by normalized generation (0..N)
  const personsByGen = new Map<number, TreePerson[]>();
  for (const person of tree.persons) {
    const normGen = (generationById.get(person.id) ?? 0) - minGen;
    const list = personsByGen.get(normGen) ?? [];
    list.push(person);
    personsByGen.set(normGen, list);
  }

  // Cluster people within each generation into Family Units (Couples or Singles)
  type FamilyUnit = {
    members: TreePerson[];
    isCouple: boolean;
    spouse1?: TreePerson;
    spouse2?: TreePerson;
    marriage?: Marriage;
    targetX?: number;
  };

  const unitsByGen = new Map<number, FamilyUnit[]>();

  for (let g = 0; g < totalGenerations; g++) {
    const peopleInGen = personsByGen.get(g) ?? [];
    const placed = new Set<string>();
    const units: FamilyUnit[] = [];

    for (const person of peopleInGen) {
      if (placed.has(person.id)) continue;

      // Check if person has a spouse in this same generation who isn't placed yet
      const spouses = (spousesOf.get(person.id) ?? []).filter(
        (spId) => (generationById.get(spId) ?? 0) - minGen === g && !placed.has(spId),
      );

      if (spouses.length > 0) {
        const spouseId = spouses[0];
        const spouse = personById.get(spouseId)!;
        const marriage = marriageMap.get(`${person.id}:${spouseId}`);

        // Mongolian convention: husband/father often on left, wife on right (or male left, female right)
        let s1 = person;
        let s2 = spouse;
        if (s1.gender === 'female' && s2.gender === 'male') {
          s1 = spouse;
          s2 = person;
        }

        placed.add(s1.id);
        placed.add(s2.id);
        units.push({
          members: [s1, s2],
          isCouple: true,
          spouse1: s1,
          spouse2: s2,
          marriage,
        });
      } else {
        placed.add(person.id);
        units.push({
          members: [person],
          isCouple: false,
        });
      }
    }

    unitsByGen.set(g, units);
  }

  // Compute node coordinates:
  // First calculate width of each unit
  function getUnitWidth(unit: FamilyUnit): number {
    return unit.isCouple ? TREE_NODE_WIDTH * 2 + TREE_SPOUSE_GAP : TREE_NODE_WIDTH;
  }

  // Calculate row width and lay units out horizontally
  let maxCanvasWidth = 960;
  const unitPositionsByGen = new Map<number, { unit: FamilyUnit; x: number; width: number }[]>();

  for (let g = 0; g < totalGenerations; g++) {
    const units = unitsByGen.get(g) ?? [];
    let currentX = TREE_PAD_X;
    const positioned: { unit: FamilyUnit; x: number; width: number }[] = [];

    for (const unit of units) {
      const uWidth = getUnitWidth(unit);
      positioned.push({ unit, x: currentX, width: uWidth });
      currentX += uWidth + TREE_FAMILY_GAP;
    }

    const rowTotalWidth = currentX - TREE_FAMILY_GAP + TREE_PAD_X;
    if (rowTotalWidth > maxCanvasWidth) {
      maxCanvasWidth = rowTotalWidth;
    }
    unitPositionsByGen.set(g, positioned);
  }

  // Now create the layout nodes with centered rows
  const layoutNodes: LayoutNode[] = [];
  const nodeById = new Map<string, LayoutNode>();
  const unionPoints: UnionPoint[] = [];

  for (let g = 0; g < totalGenerations; g++) {
    const positioned = unitPositionsByGen.get(g) ?? [];
    if (!positioned.length) continue;

    const rowWidth =
      positioned[positioned.length - 1].x +
      positioned[positioned.length - 1].width -
      positioned[0].x;
    const offsetX = Math.max(0, (maxCanvasWidth - rowWidth) / 2 - TREE_PAD_X);

    const y = TREE_PAD_Y + g * (TREE_NODE_HEIGHT + TREE_GENERATION_GAP);
    const relGen = g + minGen;

    for (const { unit, x } of positioned) {
      const adjustedX = x + offsetX;

      if (unit.isCouple && unit.spouse1 && unit.spouse2) {
        const node1: LayoutNode = {
          id: unit.spouse1.id,
          person: unit.spouse1,
          generation: relGen,
          normalizedGeneration: g,
          x: adjustedX,
          y,
          width: TREE_NODE_WIDTH,
          height: TREE_NODE_HEIGHT,
        };
        const node2: LayoutNode = {
          id: unit.spouse2.id,
          person: unit.spouse2,
          generation: relGen,
          normalizedGeneration: g,
          x: adjustedX + TREE_NODE_WIDTH + TREE_SPOUSE_GAP,
          y,
          width: TREE_NODE_WIDTH,
          height: TREE_NODE_HEIGHT,
        };

        layoutNodes.push(node1, node2);
        nodeById.set(node1.id, node1);
        nodeById.set(node2.id, node2);

        // Union point between them
        const unionX = adjustedX + TREE_NODE_WIDTH + TREE_SPOUSE_GAP / 2;
        const unionY = y + TREE_NODE_HEIGHT / 2;
        unionPoints.push({
          id: `union-${unit.spouse1.id}-${unit.spouse2.id}`,
          person1Id: unit.spouse1.id,
          person2Id: unit.spouse2.id,
          marriageId: unit.marriage?.id,
          x: unionX,
          y: unionY,
          status: unit.marriage?.status ?? 'married',
        });
      } else {
        const person = unit.members[0];
        const node: LayoutNode = {
          id: person.id,
          person,
          generation: relGen,
          normalizedGeneration: g,
          x: adjustedX,
          y,
          width: TREE_NODE_WIDTH,
          height: TREE_NODE_HEIGHT,
        };
        layoutNodes.push(node);
        nodeById.set(node.id, node);
      }
    }
  }

  // Connectors: Orthogonal Buses for sibling groups
  // Group children by their parent set
  const childrenByParentSet = new Map<string, { parents: string[]; children: string[] }>();

  for (const person of tree.persons) {
    const parents = (childToParents.get(person.id) ?? []).filter((pid) => nodeById.has(pid));
    if (!parents.length) continue;

    const parentKey = parents.sort().join(':');
    const existing = childrenByParentSet.get(parentKey);
    if (existing) {
      existing.children.push(person.id);
    } else {
      childrenByParentSet.set(parentKey, { parents, children: [person.id] });
    }
  }

  const buses: OrthogonalBus[] = [];
  const singleParentEdges: { id: string; parentId: string; childId: string; path: string }[] = [];

  for (const { parents, children } of childrenByParentSet.values()) {
    const childNodes = children
      .map((cid) => nodeById.get(cid))
      .filter((n): n is LayoutNode => n !== undefined);
    if (!childNodes.length) continue;

    let sourceX = 0;
    let sourceY = 0;

    if (parents.length >= 2) {
      // Find union point for parents
      const p1 = parents[0];
      const p2 = parents[1];
      const union = unionPoints.find(
        (u) =>
          (u.person1Id === p1 && u.person2Id === p2) || (u.person1Id === p2 && u.person2Id === p1),
      );

      if (union) {
        sourceX = union.x;
        sourceY = union.y;
      } else {
        const nodeP1 = nodeById.get(p1)!;
        const nodeP2 = nodeById.get(p2)!;
        sourceX = (nodeP1.x + nodeP2.x + TREE_NODE_WIDTH) / 2;
        sourceY = Math.max(nodeP1.y, nodeP2.y) + TREE_NODE_HEIGHT;
      }
    } else {
      const pNode = nodeById.get(parents[0])!;
      sourceX = pNode.x + TREE_NODE_WIDTH / 2;
      sourceY = pNode.y + TREE_NODE_HEIGHT;
    }

    const minChildX = Math.min(...childNodes.map((c) => c.x + TREE_NODE_WIDTH / 2));
    const maxChildX = Math.max(...childNodes.map((c) => c.x + TREE_NODE_WIDTH / 2));
    const avgChildY = childNodes[0].y;
    const busY = sourceY + (avgChildY - sourceY) / 2;

    if (childNodes.length === 1 && parents.length === 1) {
      // Simple clean direct curve for single child of single parent
      const cNode = childNodes[0];
      const cX = cNode.x + TREE_NODE_WIDTH / 2;
      const cY = cNode.y;
      const path = `M ${sourceX} ${sourceY} C ${sourceX} ${busY}, ${cX} ${busY}, ${cX} ${cY}`;
      singleParentEdges.push({
        id: `edge-${parents[0]}-${cNode.id}`,
        parentId: parents[0],
        childId: cNode.id,
        path,
      });
    } else {
      buses.push({
        id: `bus-${parents.join('-')}`,
        parents,
        sourceX,
        sourceY,
        busY,
        minChildX,
        maxChildX,
        children: childNodes.map((c) => ({
          id: c.id,
          x: c.x + TREE_NODE_WIDTH / 2,
          y: c.y,
        })),
      });
    }
  }

  // Generation Headers
  const generationHeaders: GenerationHeader[] = [];
  for (let g = 0; g < totalGenerations; g++) {
    const relGen = g + minGen;
    const peopleInGen = personsByGen.get(g) ?? [];
    if (peopleInGen.length > 0) {
      generationHeaders.push({
        generation: relGen,
        normalizedGeneration: g,
        label: getMongolianGenerationLabel(relGen),
        y: TREE_PAD_Y + g * (TREE_NODE_HEIGHT + TREE_GENERATION_GAP) - 26,
        count: peopleInGen.length,
      });
    }
  }

  const canvasHeight = Math.max(
    520,
    TREE_PAD_Y * 2 +
      totalGenerations * TREE_NODE_HEIGHT +
      Math.max(0, totalGenerations - 1) * TREE_GENERATION_GAP,
  );

  return {
    nodes: layoutNodes,
    nodeById,
    unions: unionPoints,
    buses,
    singleParentEdges,
    generationHeaders,
    width: maxCanvasWidth,
    height: canvasHeight,
    generationsCount: totalGenerations,
  };
}
