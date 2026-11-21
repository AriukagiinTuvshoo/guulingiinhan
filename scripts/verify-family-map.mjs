import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'guulingiinhan-family-map-'));

function fixture(count) {
  const persons = Array.from({ length: count }, (_, index) => ({
    id: `person-${index}`,
    first_name: `Хүн ${index}`,
    last_name: 'Туршилт',
    birth_date: null,
    is_alive: true,
    death_date: null,
  }));
  const parentChild = Array.from({ length: count - 1 }, (_, index) => ({
    id: `edge-${index}`,
    parent_id: `person-${Math.floor(index / 3)}`,
    child_id: `person-${index + 1}`,
    relationship_type: 'biological',
  }));
  const marriages = Array.from({ length: Math.floor(count / 12) }, (_, index) => ({
    id: `marriage-${index}`,
    person_1_id: `person-${index * 12 + 4}`,
    person_2_id: `person-${index * 12 + 5}`,
    status: index % 4 ? 'married' : 'divorced',
    start_date: null,
    end_date: null,
  }));
  return {
    persons,
    parent_child_relationships: parentChild,
    marriages,
    root_person_id: 'person-0',
    lineage_root_person_id: 'person-0',
  };
}

try {
  execFileSync(process.execPath, [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--ignoreConfig', 'lib/family-map.ts', 'lib/family-map-layout.ts', 'lib/api.ts',
    '--target', 'ES2022', '--module', 'commonjs', '--types', 'node', '--skipLibCheck', '--outDir', temporary,
  ], { cwd: root, stdio: 'inherit' });
  const benchRequire = createRequire(path.join(temporary, 'bench.cjs'));
  const { focusFamilyTree, projectFamilyMap } = benchRequire(path.join(temporary, 'family-map.js'));
  const { layoutFamilyMap, visibleMapNodes } = benchRequire(path.join(temporary, 'family-map-layout.js'));

  const results = [];
  for (const count of [20, 30, 100, 800, 2000, 5000]) {
    const data = fixture(count);
    const started = performance.now();
    const projection = projectFamilyMap(data);
    const layout = layoutFamilyMap(data, count > 100);
    const layoutMs = performance.now() - started;
    assert.equal(projection.people.length, count, `${count}: every authorized person is projected`);
    assert.equal(layout.nodes.length, count, `${count}: no person is duplicated or lost in branching layout`);
    assert.equal(new Set(layout.nodes.map((node) => node.id)).size, count);
    assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), `${count}: finite positions`);
    const rowNodes = new Map();
    for (const node of layout.nodes) {
      const row = rowNodes.get(node.rowKey) ?? [];
      row.push(node); rowNodes.set(node.rowKey, row);
    }
    for (const row of rowNodes.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) assert.ok(row[i].x >= row[i - 1].x + layout.nodeWidth, `${count}: same-generation nodes do not overlap`);
    }
    assert.ok(visibleMapNodes(layout, { x: 0, y: 0, scale: .7 }, 390, 600).length <= 240, `${count}: viewport window is bounded`);
    assert.equal(projection.components, 1, `${count}: connected fixture remains one component`);
    assert.ok(projection.generations.length > 1, `${count}: meaningful generations are retained`);
    assert.deepEqual(projection.people.find((item) => item.person.id === 'person-1')?.parents, ['person-0'], `${count}: canonical parent identity remains visible`);
    assert.ok(projection.people.find((item) => item.person.id === 'person-0')?.children.includes('person-1'), `${count}: canonical child identity remains visible`);
    if (count >= 20) assert.deepEqual(projection.people.find((item) => item.person.id === 'person-4')?.spouses, ['person-5'], `${count}: spouse identity remains distinct from parent-child structure`);
    const focused = focusFamilyTree(data, `person-${Math.min(count - 1, 250)}`, 2);
    assert.ok(focused.persons.length < count || count === 20, `${count}: focus is bounded below the whole graph`);
    assert.ok(focused.persons.some((person) => person.id === `person-${Math.min(count - 1, 250)}`), `${count}: focus retains selected person`);
    assert.ok(layoutMs < 5000, `${count}: projection stays within generous local safety ceiling`);
    results.push({ count, generations: projection.generations.length, focusPeople: focused.persons.length, layoutMs: Number(layoutMs.toFixed(2)) });
  }

  const disconnected = fixture(30);
  disconnected.persons.push({ id: 'detached-a', first_name: 'Тусдаа', last_name: 'А', birth_date: null, is_alive: true, death_date: null });
  disconnected.persons.push({ id: 'detached-b', first_name: 'Тусдаа', last_name: 'Б', birth_date: null, is_alive: true, death_date: null });
  disconnected.parent_child_relationships.push({ id: 'detached-edge', parent_id: 'detached-a', child_id: 'detached-b', relationship_type: 'biological' });
  const projectedDisconnected = projectFamilyMap(disconnected);
  assert.equal(projectedDisconnected.components, 2, 'disconnected branch remains a separate component');
  assert.ok(projectedDisconnected.people.filter((item) => item.component === 1).every((item) => item.generation === null), 'disconnected branch never receives fabricated canonical generations');
  assert.equal(projectedDisconnected.people.find((item) => item.person.id === 'detached-b')?.displayGeneration, 1, 'detached branch still has understandable local structure');
  const detachedLayout = layoutFamilyMap(disconnected);
  assert.equal(detachedLayout.frames.filter((frame) => frame.detached).length, 1);
  assert.ok(detachedLayout.edges.every((edge) => [...edge.from, ...edge.to].every((id) => disconnected.persons.some((person) => person.id === id))), 'only authorized connector endpoints');
  const unknown = structuredClone(disconnected);
  unknown.parent_child_relationships.push({ id: 'foreign', parent_id: 'unauthorized-person', child_id: 'person-1', relationship_type: 'biological' });
  unknown.marriages.push({ id: 'foreign-spouse', person_1_id: 'unauthorized-person', person_2_id: 'person-2', status: 'married' });
  assert.ok(layoutFamilyMap(unknown).edges.every((edge) => ![...edge.from, ...edge.to].includes('unauthorized-person')), 'layout never leaks unauthorized endpoints');
  const occurrences = fixture(20);
  occurrences.marriages.push({ id: 'widow', person_1_id: 'person-4', person_2_id: 'person-6', status: 'widowed', start_date: null, end_date: null });
  const occurrenceLayout = layoutFamilyMap(occurrences);
  assert.equal(occurrenceLayout.edges.filter((edge) => edge.kind === 'divorced').length, 1);
  assert.equal(occurrenceLayout.edges.filter((edge) => edge.kind === 'widowed').length, 1);
  assert.equal(occurrenceLayout.nodes.length, occurrences.persons.length, 'remarriage preserves one canonical person');

  console.log(JSON.stringify({
    verified: 'canonical projection, branching layout, no overlaps, marriage occurrences, unauthorized endpoint filtering, disconnected safety, bounded DOM window and focus; local scale algorithm only',
    results,
    caveat: 'local synthetic timing excludes API, browser layout, image loading, and network',
  }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
