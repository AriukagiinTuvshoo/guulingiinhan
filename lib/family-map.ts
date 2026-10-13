import { personName, TreeData, TreePerson } from './api';

export type FamilyMapPerson = {
  person: TreePerson;
  generation: number | null;
  displayGeneration: number;
  component: number;
  parents: string[];
  children: string[];
  spouses: string[];
};

export type FamilyMapGeneration = {
  key: string;
  generation: number | null;
  displayGeneration: number;
  component: number;
  people: FamilyMapPerson[];
};

export type FamilyMapProjection = {
  components: number;
  generations: FamilyMapGeneration[];
  people: FamilyMapPerson[];
};

type Neighbor = { id: string; delta: number };

function comparePeople(left: TreePerson, right: TreePerson) {
  return personName(left).localeCompare(personName(right), 'mn') || left.id.localeCompare(right.id);
}

function graphFor(data: TreeData) {
  const ids = new Set(data.persons.map((person) => person.id));
  const graph = new Map<string, Neighbor[]>();
  const parents = new Map<string, number>();
  for (const person of data.persons) graph.set(person.id, []);
  for (const edge of data.parent_child_relationships) {
    if (!ids.has(edge.parent_id) || !ids.has(edge.child_id)) continue;
    graph.get(edge.parent_id)?.push({ id: edge.child_id, delta: 1 });
    graph.get(edge.child_id)?.push({ id: edge.parent_id, delta: -1 });
    parents.set(edge.child_id, (parents.get(edge.child_id) ?? 0) + 1);
  }
  for (const marriage of data.marriages) {
    if (!ids.has(marriage.person_1_id) || !ids.has(marriage.person_2_id)) continue;
    graph.get(marriage.person_1_id)?.push({ id: marriage.person_2_id, delta: 0 });
    graph.get(marriage.person_2_id)?.push({ id: marriage.person_1_id, delta: 0 });
  }
  return { graph, ids, parents };
}

/**
 * Creates a deterministic, linear-time presentation model from canonical tree data.
 * Disconnected people remain in separate components and never receive a fabricated
 * shared-lineage generation number.
 */
export function projectFamilyMap(data: TreeData): FamilyMapProjection {
  if (!data.persons.length) return { components: 0, generations: [], people: [] };
  const { graph, ids, parents } = graphFor(data);
  const peopleById = new Map(data.persons.map((person) => [person.id, person]));
  const confirmedRoot = data.lineage_root_person_id && ids.has(data.lineage_root_person_id)
    ? data.lineage_root_person_id
    : null;
  const familyRoot = data.root_person_id && ids.has(data.root_person_id) ? data.root_person_id : null;
  const ordered = [...data.persons].sort(comparePeople);
  const seeds: string[] = [];
  if (confirmedRoot) seeds.push(confirmedRoot);
  else if (familyRoot) seeds.push(familyRoot);
  for (const person of ordered) if (!parents.has(person.id)) seeds.push(person.id);
  for (const person of ordered) seeds.push(person.id);

  const componentById = new Map<string, number>();
  const displayGenerationById = new Map<string, number>();
  let component = 0;
  for (const seed of seeds) {
    if (componentById.has(seed)) continue;
    const queue = [seed];
    componentById.set(seed, component);
    displayGenerationById.set(seed, 0);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const currentGeneration = displayGenerationById.get(current) ?? 0;
      for (const neighbor of graph.get(current) ?? []) {
        if (componentById.has(neighbor.id)) continue;
        componentById.set(neighbor.id, component);
        displayGenerationById.set(neighbor.id, currentGeneration + neighbor.delta);
        queue.push(neighbor.id);
      }
    }
    component += 1;
  }

  const canonicalGenerationById = new Map<string, number>();
  if (confirmedRoot) {
    canonicalGenerationById.set(confirmedRoot, 0);
    const queue = [confirmedRoot];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const currentGeneration = canonicalGenerationById.get(current) ?? 0;
      for (const neighbor of graph.get(current) ?? []) {
        if (canonicalGenerationById.has(neighbor.id)) continue;
        canonicalGenerationById.set(neighbor.id, currentGeneration + neighbor.delta);
        queue.push(neighbor.id);
      }
    }
  }

  const parentsByPerson = new Map<string, string[]>();
  const childrenByPerson = new Map<string, string[]>();
  for (const edge of data.parent_child_relationships) {
    if (!ids.has(edge.parent_id) || !ids.has(edge.child_id)) continue;
    parentsByPerson.set(edge.child_id, [...(parentsByPerson.get(edge.child_id) ?? []), edge.parent_id]);
    childrenByPerson.set(edge.parent_id, [...(childrenByPerson.get(edge.parent_id) ?? []), edge.child_id]);
  }

  const sortedRelatedIds = (relatedIds: string[]) => relatedIds
    .map((id) => peopleById.get(id))
    .filter((candidate): candidate is TreePerson => Boolean(candidate))
    .sort(comparePeople)
    .map((candidate) => candidate.id);

  const spouses = new Map<string, string[]>();
  for (const marriage of data.marriages) {
    if (!ids.has(marriage.person_1_id) || !ids.has(marriage.person_2_id)) continue;
    spouses.set(marriage.person_1_id, [...(spouses.get(marriage.person_1_id) ?? []), marriage.person_2_id]);
    spouses.set(marriage.person_2_id, [...(spouses.get(marriage.person_2_id) ?? []), marriage.person_1_id]);
  }

  const people = data.persons.map((person) => ({
    person,
    generation: canonicalGenerationById.get(person.id) ?? null,
    displayGeneration: displayGenerationById.get(person.id) ?? 0,
    component: componentById.get(person.id) ?? 0,
    parents: sortedRelatedIds(parentsByPerson.get(person.id) ?? []),
    children: sortedRelatedIds(childrenByPerson.get(person.id) ?? []),
    spouses: sortedRelatedIds(spouses.get(person.id) ?? []),
  }));

  const rows = new Map<string, FamilyMapGeneration>();
  for (const item of people) {
    const key = `${item.component}:${item.displayGeneration}`;
    const row = rows.get(key) ?? {
      key,
      generation: item.generation,
      displayGeneration: item.displayGeneration,
      component: item.component,
      people: [],
    };
    row.people.push(item);
    if (row.generation === null && item.generation !== null) row.generation = item.generation;
    rows.set(key, row);
  }
  const generations = [...rows.values()]
    .sort((left, right) => left.component - right.component || left.displayGeneration - right.displayGeneration)
    .map((row) => ({ ...row, people: row.people.sort((left, right) => comparePeople(left.person, right.person)) }));
  return { components: component, generations, people };
}

/** Returns a bounded local graph without inventing or rewriting relationships. */
export function focusFamilyTree(data: TreeData, personId: string, radius: number): TreeData {
  const { graph, ids } = graphFor(data);
  if (!personId || !ids.has(personId)) return data;
  const distance = new Map([[personId, 0]]);
  const queue = [personId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const currentDistance = distance.get(current) ?? 0;
    if (currentDistance >= radius) continue;
    for (const neighbor of graph.get(current) ?? []) {
      if (distance.has(neighbor.id)) continue;
      distance.set(neighbor.id, currentDistance + 1);
      queue.push(neighbor.id);
    }
  }
  const visible = new Set(distance.keys());
  return {
    ...data,
    root_person_id: personId,
    persons: data.persons.filter((person) => visible.has(person.id)),
    parent_child_relationships: data.parent_child_relationships.filter((edge) => visible.has(edge.parent_id) && visible.has(edge.child_id)),
    marriages: data.marriages.filter((marriage) => visible.has(marriage.person_1_id) && visible.has(marriage.person_2_id)),
  };
}
