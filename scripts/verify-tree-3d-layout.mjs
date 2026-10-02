import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'guulingiinhan-tree3d-'));

try {
  execFileSync(process.execPath, [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--ignoreConfig', 'lib/tree-3d-layout.ts', 'lib/api.ts',
    '--target', 'ES2022', '--module', 'commonjs', '--types', 'node', '--skipLibCheck', '--outDir', temporary,
  ], { cwd: root, stdio: 'inherit' });
  const benchRequire = createRequire(path.join(temporary, 'bench.cjs'));
  const { layoutTree3D } = benchRequire(path.join(temporary, 'tree-3d-layout.js'));

  // Isolated synthetic fixture: never inserted into an application database or route.
  const count = 800;
  const persons = Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${index}`,
    first_name: `Person ${index}`,
    last_name: 'Synthetic',
    lineage_id: 'synthetic-lineage',
    branch_id: `synthetic-branch-${Math.floor(index / 70)}`,
  }));
  const parentChild = Array.from({ length: count - 1 }, (_, offset) => ({
    id: `edge-${offset}`,
    parent_id: `synthetic-${Math.floor(offset / 2)}`,
    child_id: `synthetic-${offset + 1}`,
    relationship_type: 'biological',
  }));
  const marriages = Array.from({ length: 90 }, (_, index) => ({
    id: `marriage-${index}`,
    person_1_id: `synthetic-${600 + index * 2}`,
    person_2_id: `synthetic-${601 + index * 2}`,
    status: index % 5 === 0 ? 'divorced' : 'married',
    start_date: null,
    end_date: null,
  }));
  const data = {
    persons,
    parent_child_relationships: parentChild,
    marriages,
    root_person_id: 'synthetic-0',
    lineage_root_person_id: 'synthetic-0',
  };
  const timings = [];
  let result;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const start = performance.now();
    result = layoutTree3D(data);
    timings.push(performance.now() - start);
  }
  timings.sort((left, right) => left - right);
  assert.equal(result.positions.size, count, 'every authorized synthetic Person receives a stable position');
  assert.equal(result.generations.get('synthetic-0'), 0, 'root is the generation reference');
  assert.ok([...result.positions.values()].every((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)), 'all coordinates are finite');
  assert.ok(timings[3] < 5000, '800-person layout completes within the generous local safety ceiling');
  const disconnected = layoutTree3D({
    persons: [
      { id: 'root', first_name: 'Root', last_name: 'Fixture' },
      { id: 'unknown', first_name: 'Unknown', last_name: 'Fixture' },
    ],
    parent_child_relationships: [],
    marriages: [],
    root_person_id: 'root',
  });
  assert.equal(disconnected.generations.get('unknown'), null, 'disconnected people do not receive a fabricated generation');
  assert.equal(disconnected.generations.get('root'), null, 'a family-only root is not a confirmed shared-lineage root');
  assert.ok(disconnected.positions.get('unknown').y > disconnected.positions.get('root').y, 'unlinked people get a separate visual lane');
  const unrooted = layoutTree3D({
    persons: [
      { id: 'first', first_name: 'First', last_name: 'Fixture' },
      { id: 'child', first_name: 'Child', last_name: 'Fixture' },
    ],
    parent_child_relationships: [{ id: 'edge', parent_id: 'first', child_id: 'child' }],
    marriages: [],
  });
  assert.equal(unrooted.positions.size, 2, 'unrooted people can still be spatially arranged');
  assert.ok([...unrooted.generations.values()].every((generation) => generation === null),
    'an unconfirmed layout seed never creates public generation labels');
  console.log(JSON.stringify({
    syntheticPeople: count,
    parentChildEdges: parentChild.length,
    marriageEdges: marriages.length,
    positionedPeople: result.positions.size,
    medianLayoutMs: Number(timings[3].toFixed(2)),
    measured: 'layout algorithm only; excludes API/network/WebGL/GPU rendering',
  }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
