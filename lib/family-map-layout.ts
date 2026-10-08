import { TreeData } from './api';
import { projectFamilyMap } from './family-map';

export type MapNode = { id: string; x: number; y: number; component: number; generation: number; rowKey: string };
export type MapEdge = { id: string; kind: 'parent' | 'married' | 'divorced' | 'widowed'; from: string[]; to: string[]; path: string; x: number; y: number; routes?: Array<{ childId: string; path: string }> };
export type MapFrame = { key: string; x: number; y: number; width: number; height: number; count: number; detached: boolean; startId: string };
export type MapLayout = { nodes: MapNode[]; edges: MapEdge[]; frames: MapFrame[]; width: number; height: number; nodeWidth: number; nodeHeight: number; generations: ReturnType<typeof projectFamilyMap>['generations'] };
type Unit = { ids: string[]; generation: number; children: Unit[]; parent?: Unit; width: number; ownWidth: number; x: number };

/** Presentation only: every connector originates in an authorized canonical edge. */
export function layoutFamilyMap(data: TreeData, compact = false): MapLayout {
  const projection = projectFamilyMap(data);
  const nodeWidth = compact ? 88 : 112;
  const nodeHeight = compact ? 96 : 132;
  const horizontalGap = compact ? 22 : 34;
  const spouseGap = compact ? 18 : 28;
  const verticalGap = compact ? 66 : 88;
  const pitch = nodeHeight + verticalGap;
  const byId = new Map(projection.people.map((item) => [item.person.id, item]));
  const nodeMap = new Map<string, MapNode>();
  const components = new Map<number, typeof projection.people>();
  for (const item of projection.people) {
    const items = components.get(item.component) ?? [];
    items.push(item);
    components.set(item.component, items);
  }
  const frames: MapFrame[] = [];
  let top = 46;
  let maxWidth = 0;
  for (const [component, items] of components) {
    const ordered = [...items].sort((a, b) => a.displayGeneration - b.displayGeneration || a.person.id.localeCompare(b.person.id));
    const unitForId = new Map<string, Unit>();
    const units: Unit[] = [];
    for (const item of ordered) {
      if (unitForId.has(item.person.id)) continue;
      const ids = [item.person.id];
      const unit: Unit = { ids, generation: item.displayGeneration, children: [], width: 0, ownWidth: 0, x: 0 };
      unitForId.set(item.person.id, unit);
      // Keep marriage occurrences together without duplicating a person after remarriage.
      for (let cursor = 0; cursor < ids.length; cursor += 1) {
        for (const spouseId of byId.get(ids[cursor])?.spouses ?? []) {
          const spouse = byId.get(spouseId);
          if (!spouse || spouse.component !== component || spouse.displayGeneration !== unit.generation || unitForId.has(spouseId)) continue;
          ids.push(spouseId);
          unitForId.set(spouseId, unit);
        }
      }
      unit.ownWidth = ids.length * nodeWidth + (ids.length - 1) * spouseGap;
      units.push(unit);
    }
    // Assign one layout owner to a child unit. All actual parents are drawn separately below.
    for (const unit of units) {
      const candidates = new Set<Unit>();
      for (const id of unit.ids) for (const parentId of byId.get(id)?.parents ?? []) {
        const parent = unitForId.get(parentId);
        if (parent && parent !== unit && parent.generation < unit.generation) candidates.add(parent);
      }
      const parent = [...candidates].sort((a, b) => b.generation - a.generation || a.ids[0].localeCompare(b.ids[0]))[0];
      if (parent) { unit.parent = parent; parent.children.push(unit); }
    }
    const birthOrder = (unit: Unit) => byId.get(unit.ids[0])?.person.birth_date ?? '9999';
    for (const unit of [...units].sort((a, b) => b.generation - a.generation)) {
      unit.children.sort((a, b) => birthOrder(a).localeCompare(birthOrder(b)) || a.ids[0].localeCompare(b.ids[0]));
      unit.width = Math.max(unit.ownWidth, unit.children.reduce((sum, child) => sum + child.width, 0) + Math.max(0, unit.children.length - 1) * horizontalGap);
    }
    const minGeneration = Math.min(...units.map((unit) => unit.generation), 0);
    const maxGeneration = Math.max(...units.map((unit) => unit.generation), 0);
    const roots = units.filter((unit) => !unit.parent);
    let left = 64;
    const stack: Array<{ unit: Unit; left: number }> = [];
    for (const unit of roots) { stack.push({ unit, left }); left += unit.width + horizontalGap * 2; }
    while (stack.length) {
      const entry = stack.pop()!;
      const unit = entry.unit;
      const middle = entry.left + unit.width / 2;
      const rowLeft = middle - unit.ownWidth / 2;
      unit.ids.forEach((id, index) => nodeMap.set(id, {
        id, x: rowLeft + index * (nodeWidth + spouseGap), y: top + (unit.generation - minGeneration) * pitch,
        component, generation: unit.generation, rowKey: `${component}:${unit.generation}`,
      }));
      const childWidth = unit.children.reduce((sum, child) => sum + child.width, 0) + Math.max(0, unit.children.length - 1) * horizontalGap;
      let childLeft = middle - childWidth / 2;
      for (const child of unit.children) { stack.push({ unit: child, left: childLeft }); childLeft += child.width + horizontalGap; }
    }
    const width = Math.max(nodeWidth + 128, left + 20);
    const height = (maxGeneration - minGeneration) * pitch + nodeHeight + 40;
    frames.push({ key: `component-${component}`, x: 28, y: top - 34, width: width - 40, height: height + 34, count: items.length, detached: component > 0, startId: ordered[0]?.person.id ?? '' });
    maxWidth = Math.max(maxWidth, width);
    top += height + 88;
  }
  // Flow detached households together rather than leaving a long vertical stack
  // of one-person frames. Their boundaries and canonical edges remain separate.
  const mainFrame = frames.find((frame) => !frame.detached);
  const flowWidth = Math.max(mainFrame?.width ?? 0, 780);
  const changes = new Map<number, { x: number; y: number }>();
  let flowX = 28, flowY = mainFrame ? mainFrame.y + mainFrame.height + 60 : 28, lineHeight = 0;
  for (const frame of frames.filter((entry) => entry.detached).sort((a, b) => Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]))) {
    if (flowX > 28 && flowX + frame.width > flowWidth + 28) { flowX = 28; flowY += lineHeight + 28; lineHeight = 0; }
    changes.set(Number(frame.key.split('-')[1]), { x: flowX - frame.x, y: flowY - frame.y });
    frame.x = flowX; frame.y = flowY;
    flowX += frame.width + 24;
    lineHeight = Math.max(lineHeight, frame.height);
  }
  for (const node of nodeMap.values()) {
    const delta = changes.get(node.component);
    if (delta) { node.x += delta.x; node.y += delta.y; }
  }
  maxWidth = Math.max(...frames.map((frame) => frame.x + frame.width + 28), 240);
  top = Math.max(...frames.map((frame) => frame.y + frame.height), 200) + 76;
  const edges: MapEdge[] = [];
  const round = (value: number) => Math.round(value * 10) / 10;
  const point = (id: string) => nodeMap.get(id);
  const spousePairs = new Set<string>();
  for (const marriage of data.marriages) {
    const a = point(marriage.person_1_id), b = point(marriage.person_2_id);
    if (!a || !b) continue;
    spousePairs.add([a.id, b.id].sort().join('|'));
    const left = a.x < b.x ? a : b, right = left === a ? b : a;
    const avatar = compact ? 54 : 72;
    const y = left.y + avatar / 2;
    const x1 = left.x + nodeWidth / 2 + avatar / 2, x2 = right.x + nodeWidth / 2 - avatar / 2;
    const path = a.y === b.y ? `M${round(x1)} ${round(y)}H${round(x2)}`
      : `M${round(a.x + nodeWidth / 2)} ${round(a.y + nodeHeight)}V${round(Math.max(a.y, b.y) + nodeHeight + 22)}H${round(b.x + nodeWidth / 2)}V${round(b.y + nodeHeight)}`;
    edges.push({ id: marriage.id, kind: marriage.status, from: [a.id], to: [b.id], path, x: (x1 + x2) / 2, y });
  }
  const sibships = new Map<string, { parents: string[]; children: string[] }>();
  for (const item of projection.people) {
    const parents = [...new Set(item.parents)].filter((id) => nodeMap.has(id)).sort();
    if (!parents.length || !nodeMap.has(item.person.id)) continue;
    const key = parents.join('|');
    const group = sibships.get(key) ?? { parents, children: [] };
    group.children.push(item.person.id);
    sibships.set(key, group);
  }
  for (const [key, group] of sibships) {
    const parents = group.parents.map((id) => point(id)!);
    const children = group.children.map((id) => point(id)!);
    const coupled = parents.length === 2 && parents[0].y === parents[1].y && spousePairs.has(key) && Math.abs(parents[0].x - parents[1].x) <= nodeWidth + spouseGap + 1;
    const x = parents.reduce((sum, node) => sum + node.x + nodeWidth / 2, 0) / parents.length;
    const y = coupled ? parents[0].y + (compact ? 27 : 36) : Math.max(...parents.map((node) => node.y + nodeHeight)) + 10;
    const busY = Math.min(...children.map((node) => node.y)) - verticalGap / 2;
    let path = coupled ? '' : parents.map((node) => `M${round(node.x + nodeWidth / 2)} ${round(node.y + nodeHeight)}V${round(y)}H${round(x)}`).join('');
    const xs = [x, ...children.map((node) => node.x + nodeWidth / 2)];
    path += `M${round(x)} ${round(y)}V${round(busY)}M${round(Math.min(...xs))} ${round(busY)}H${round(Math.max(...xs))}`;
    path += children.map((node) => `M${round(node.x + nodeWidth / 2)} ${round(busY)}V${round(node.y)}`).join('');
    const routes = children.map((node) => ({ childId: node.id, path: (coupled ? '' : parents.map((parent) => `M${round(parent.x + nodeWidth / 2)} ${round(parent.y + nodeHeight)}V${round(y)}H${round(x)}`).join('')) + `M${round(x)} ${round(y)}V${round(busY)}H${round(node.x + nodeWidth / 2)}V${round(node.y)}` }));
    edges.push({ id: `parents-${key}`, kind: 'parent', from: group.parents, to: group.children, path, x, y: busY, routes });
  }
  return { nodes: [...nodeMap.values()], edges, frames, width: maxWidth || 240, height: Math.max(240, top - 48), nodeWidth, nodeHeight, generations: projection.generations };
}

/** A bounded DOM window, while the full layout remains navigable by pan and search. */
export function visibleMapNodes(layout: MapLayout, view: { x: number; y: number; scale: number }, width: number, height: number, selectedId = '') {
  const margin = 110 / view.scale;
  const left = -view.x / view.scale - margin, top = -view.y / view.scale - margin;
  const right = left + width / view.scale + margin * 2, bottom = top + height / view.scale + margin * 2;
  const inView = layout.nodes.filter((node) => node.id === selectedId || (node.x + layout.nodeWidth >= left && node.x <= right && node.y + layout.nodeHeight >= top && node.y <= bottom));
  if (inView.length <= 240) return inView;
  const cx = (-view.x + width / 2) / view.scale, cy = (-view.y + height / 2) / view.scale;
  return inView.sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))).slice(0, 240);
}
