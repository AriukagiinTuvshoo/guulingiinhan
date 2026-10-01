import { personName, TreeData, TreePerson } from './api';

export type Point3 = { x: number; y: number; z: number };
export type Tree3DLayout = { positions: Map<string, Point3>; generations: Map<string, number> };

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

  const rootId = data.root_person_id && personIds.has(data.root_person_id)
    ? data.root_person_id
    : data.persons[0]?.id;
  const generations = new Map<string, number>();
  if (!rootId) return { positions: new Map(), generations };
  generations.set(rootId, 0);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const generation = generations.get(id) ?? 0;
    for (const edge of adjacency.get(id) ?? []) {
      if (generations.has(edge.id)) continue;
      generations.set(edge.id, generation + edge.generationDelta);
      queue.push(edge.id);
    }
  }
  for (const person of data.persons) if (!generations.has(person.id)) generations.set(person.id, 0);

  const branches = [...new Set(data.persons.map((person) => person.branch_id ?? person.lineage_id ?? ''))]
    .filter(Boolean).sort();
  const branchSlot = new Map(branches.map((id, index) => [id, index]));
  const generationRows = new Map<number, TreePerson[]>();
  for (const person of data.persons) {
    const generation = generations.get(person.id) ?? 0;
    let row = generationRows.get(generation);
    if (!row) {
      row = [];
      generationRows.set(generation, row);
    }
    row.push(person);
  }

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
        x: (index - rowOffset) * 5.4,
        y: -generation * 12,
        z: (branch - Math.max(0, branches.length - 1) / 2) * 13,
      });
    });
  }
  return { positions, generations };
}
