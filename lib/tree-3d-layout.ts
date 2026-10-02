import { personName, TreeData, TreePerson } from './api';

export type Point3 = { x: number; y: number; z: number };
export type Tree3DLayout = { positions: Map<string, Point3>; generations: Map<string, number | null> };

/** Deterministic 3D coordinates derived only from canonical relationship and branch IDs. */
export function layoutTree3D(data: TreeData): Tree3DLayout {
  const personIds = new Set(data.persons.map((person) => person.id));
  const adjacency = new Map<string, { id: string; generationDelta: number }[]>();
  for (const person of data.persons) adjacency.set(person.id, []);
  for (const edge of data.parent_child_relationships) {
    if (!personIds.has(edge.parent_id) || !personIds.has(edge.child_id)) continue;
    adjacency.get(edge.parent_id)?.push({ id: edge.child_id, generationDelta: 1 });
    adjacency.get(edge.child_id)?.push({ id: edge.parent_id, generationDelta: -1 });
  }
  for (const marriage of data.marriages) {
    if (!personIds.has(marriage.person_1_id) || !personIds.has(marriage.person_2_id)) continue;
    adjacency.get(marriage.person_1_id)?.push({ id: marriage.person_2_id, generationDelta: 0 });
    adjacency.get(marriage.person_2_id)?.push({ id: marriage.person_1_id, generationDelta: 0 });
  }

  // A family-level root is useful for its private household tree, but only an
  // explicitly assigned shared-lineage root defines public generation numbers.
  const confirmedRootId = data.lineage_root_person_id && personIds.has(data.lineage_root_person_id)
    ? data.lineage_root_person_id
    : undefined;
  // A deterministic fallback is needed to place an unrooted graph in space,
  // but it must never be presented as a confirmed generation.
  const layoutRootId = confirmedRootId ?? data.persons[0]?.id;
  const generations = new Map<string, number | null>();
  if (!layoutRootId) return { positions: new Map(), generations };
  const layoutGenerations = new Map<string, number>();
  layoutGenerations.set(layoutRootId, 0);
  const queue = [layoutRootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const generation = layoutGenerations.get(id) ?? 0;
    for (const edge of adjacency.get(id) ?? []) {
      if (layoutGenerations.has(edge.id)) continue;
      layoutGenerations.set(edge.id, generation + edge.generationDelta);
      queue.push(edge.id);
    }
  }
  for (const person of data.persons) {
    generations.set(person.id, confirmedRootId ? layoutGenerations.get(person.id) ?? null : null);
  }
  const branches = [...new Set(data.persons.map((person) => person.branch_id ?? person.lineage_id ?? ''))]
    .filter(Boolean).sort();
  const branchSlot = new Map(branches.map((id, index) => [id, index]));
  const generationRows = new Map<number | null, TreePerson[]>();
  for (const person of data.persons) {
    const generation = layoutGenerations.get(person.id) ?? null;
    let row = generationRows.get(generation);
    if (!row) {
      row = [];
      generationRows.set(generation, row);
    }
    row.push(person);
  }

  const generationValues = [...generationRows.keys()].filter((generation): generation is number => generation !== null);
  const generationSpan = generationValues.length
    ? Math.max(...generationValues) - Math.min(...generationValues)
    : 0;
  const widestGeneration = Math.max(...[...generationRows.values()].map((people) => people.length));
  const xSpacing = Math.min(5.4, 520 / Math.max(1, widestGeneration - 1));
  const zSpacing = Math.min(13, 340 / Math.max(1, branches.length - 1));
  const ySpacing = Math.min(12, 360 / Math.max(1, generationSpan));

  const positions = new Map<string, Point3>();
  for (const [generation, people] of generationRows) {
    const sorted = [...people].sort((a, b) => {
      const aBranch = a.branch_id ?? a.lineage_id ?? '';
      const bBranch = b.branch_id ?? b.lineage_id ?? '';
      return aBranch.localeCompare(bBranch) || personName(a).localeCompare(personName(b), 'mn') || a.id.localeCompare(b.id);
    });
    const rowOffset = (sorted.length - 1) / 2;
    sorted.forEach((person, index) => {
      const branchId = person.branch_id ?? person.lineage_id ?? '';
      const branch = branchSlot.get(branchId) ?? 0;
      positions.set(person.id, {
        x: (index - rowOffset) * xSpacing,
        y: generation === null ? ySpacing * 1.75 : -generation * ySpacing,
        z: (branch - Math.max(0, branches.length - 1) / 2) * zSpacing,
      });
    });
  }
  return { positions, generations };
}
