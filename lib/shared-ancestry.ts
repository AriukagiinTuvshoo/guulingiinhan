export type SharedAncestryGraph = {
  root_person_id: string | null;
  root_partner_person_id: string | null;
  persons: { id: string }[];
  relationships: { parent_id: string; child_id: string }[];
  spouses: { person_1_id: string; person_2_id: string }[];
};

/** Only explicit visible relationships establish a path from the root couple. */
export function sharedAncestryPaths(tree: SharedAncestryGraph | null): Map<string, string[]> {
  const paths = new Map<string, string[]>();
  if (!tree?.root_person_id) return paths;
  const visible = new Set(tree.persons.map((person) => person.id));
  const adjacent = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!visible.has(from) || !visible.has(to)) return;
    const neighbours = adjacent.get(from) || new Set<string>();
    neighbours.add(to); adjacent.set(from, neighbours);
  };
  for (const edge of tree.relationships) add(edge.parent_id, edge.child_id);
  for (const pair of tree.spouses) { add(pair.person_1_id, pair.person_2_id); add(pair.person_2_id, pair.person_1_id); }
  const queue = [tree.root_person_id, tree.root_partner_person_id].filter((id): id is string => Boolean(id && visible.has(id)));
  for (const id of queue) paths.set(id, [id]);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const next of adjacent.get(id) || []) {
      if (paths.has(next)) continue;
      paths.set(next, [...paths.get(id)!, next]); queue.push(next);
    }
  }
  return paths;
}
