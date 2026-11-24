import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'guulingiinhan-tidy-tree-'));

function assertNoRowOverlaps(layout, context) {
  const byGen = new Map();
  for (const node of layout.nodes) {
    if (!byGen.has(node.generation)) byGen.set(node.generation, []);
    byGen.get(node.generation).push(node);
  }
  for (const [gen, row] of byGen.entries()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 0; i < row.length - 1; i += 1) {
      assert.ok(
        row[i].x + row[i].width < row[i + 1].x,
        `${context}: overlap in gen ${gen} between ${row[i].id} (right=${row[i].x + row[i].width}) and ${row[i + 1].id} (left=${row[i + 1].x})`,
      );
    }
  }
}

try {
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--ignoreConfig',
      'lib/tree-layout.ts',
      'lib/api.ts',
      '--target',
      'ES2022',
      '--module',
      'commonjs',
      '--types',
      'node',
      '--skipLibCheck',
      '--outDir',
      temporary,
    ],
    { cwd: root, stdio: 'inherit' },
  );

  const req = createRequire(path.join(temporary, 'bench.cjs'));
  const { buildAdvancedTreeLayout } = req(path.join(temporary, 'tree-layout.js'));

  // -------------------------------------------------------------------------
  // 1. Rich synthetic lineage: founding couple, 4 structural branches (NO branch_id),
  //    remarriage, single parent, spouse with loaded in-law parents, inter-branch child
  // -------------------------------------------------------------------------
  const persons = [
    { id: 'f1', first_name: 'Дорж', last_name: 'Алтан', gender: 'male', birth_date: '1812-01-01', is_alive: false },
    { id: 'f2', first_name: 'Цэцэгмаа', last_name: 'Сүрэн', gender: 'female', birth_date: '1816-01-01', is_alive: false },
    // 4 Gen-2 branch founders (no branch_id assigned -> structural derivation test)
    { id: 'b1', first_name: 'Батболд', last_name: 'Алтан', gender: 'male', birth_date: '1837-01-01', is_alive: false },
    { id: 'b1s', first_name: 'Хань1', last_name: 'Төмөр', gender: 'female', birth_date: '1839-01-01', is_alive: false },
    { id: 'b2', first_name: 'Оюунцэцэг', last_name: 'Алтан', gender: 'female', birth_date: '1840-01-01', is_alive: false },
    { id: 'b2s', first_name: 'Хань2', last_name: 'Пүрэв', gender: 'male', birth_date: '1841-01-01', is_alive: false },
    { id: 'b3', first_name: 'Ганбаатар', last_name: 'Алтан', gender: 'male', birth_date: '1843-01-01', is_alive: false },
    { id: 'b3s1', first_name: 'Эхнэр1', last_name: 'Баяр', gender: 'female', birth_date: '1844-01-01', is_alive: false },
    { id: 'b3s2', first_name: 'Эхнэр2', last_name: 'Цэрэн', gender: 'female', birth_date: '1848-01-01', is_alive: false },
    { id: 'b4', first_name: 'Нарантуяа', last_name: 'Алтан', gender: 'female', birth_date: '1846-01-01', is_alive: false },
    // Gen-3 children (including remarriage children from s1 and s2, single-parent child, daughter's child)
    { id: 'c11', first_name: 'Хүү11', last_name: 'Алтан', gender: 'male', birth_date: '1862-01-01', is_alive: false },
    { id: 'c21', first_name: 'Охин21', last_name: 'Пүрэв', gender: 'female', birth_date: '1865-01-01', is_alive: false },
    { id: 'c31', first_name: 'ЭхнийГэрлэлтХүү', last_name: 'Алтан', gender: 'male', birth_date: '1866-01-01', is_alive: false },
    { id: 'c32', first_name: 'ХоёрДахьГэрлэлтОхин', last_name: 'Алтан', gender: 'female', birth_date: '1872-01-01', is_alive: false },
    { id: 'c41', first_name: 'ГанцБиеХүүхэд', last_name: 'Алтан', gender: 'male', birth_date: '1870-01-01', is_alive: false },
    // Non-tree case A: loaded in-law parents of b1s
    { id: 'inlaw1', first_name: 'ХудАав', last_name: 'Төмөр', gender: 'male', birth_date: '1814-01-01', is_alive: false },
    { id: 'inlaw2', first_name: 'ХудЭэж', last_name: 'Очир', gender: 'female', birth_date: '1817-01-01', is_alive: false },
    // Non-tree case B: inter-branch child whose two parents (c11 & c21) are BOTH lineage descendants
    { id: 'interchild', first_name: 'ХоёрУдмынХүү', last_name: 'Алтан', gender: 'male', birth_date: '1890-01-01', is_alive: false },
  ];

  const parent_child_relationships = [
    { id: 'e1', parent_id: 'f1', child_id: 'b1', relationship_type: 'biological' },
    { id: 'e2', parent_id: 'f2', child_id: 'b1', relationship_type: 'biological' },
    { id: 'e3', parent_id: 'f1', child_id: 'b2', relationship_type: 'biological' },
    { id: 'e4', parent_id: 'f2', child_id: 'b2', relationship_type: 'biological' },
    { id: 'e5', parent_id: 'f1', child_id: 'b3', relationship_type: 'biological' },
    { id: 'e6', parent_id: 'f2', child_id: 'b3', relationship_type: 'biological' },
    { id: 'e7', parent_id: 'f1', child_id: 'b4', relationship_type: 'biological' },
    { id: 'e8', parent_id: 'f2', child_id: 'b4', relationship_type: 'biological' },
    { id: 'e9', parent_id: 'b1', child_id: 'c11', relationship_type: 'biological' },
    { id: 'e10', parent_id: 'b1s', child_id: 'c11', relationship_type: 'biological' },
    { id: 'e11', parent_id: 'b2', child_id: 'c21', relationship_type: 'biological' },
    { id: 'e12', parent_id: 'b2s', child_id: 'c21', relationship_type: 'biological' },
    { id: 'e13', parent_id: 'b3', child_id: 'c31', relationship_type: 'biological' },
    { id: 'e14', parent_id: 'b3s1', child_id: 'c31', relationship_type: 'biological' },
    { id: 'e15', parent_id: 'b3', child_id: 'c32', relationship_type: 'biological' },
    { id: 'e16', parent_id: 'b3s2', child_id: 'c32', relationship_type: 'biological' },
    { id: 'e17', parent_id: 'b4', child_id: 'c41', relationship_type: 'biological' },
    // In-law parent edges for spouse b1s
    { id: 'e18', parent_id: 'inlaw1', child_id: 'b1s', relationship_type: 'biological' },
    { id: 'e19', parent_id: 'inlaw2', child_id: 'b1s', relationship_type: 'biological' },
    // Inter-branch child with two lineage parents
    { id: 'e20', parent_id: 'c11', child_id: 'interchild', relationship_type: 'biological' },
    { id: 'e21', parent_id: 'c21', child_id: 'interchild', relationship_type: 'biological' },
  ];

  const marriages = [
    { id: 'm1', person_1_id: 'f1', person_2_id: 'f2', status: 'widowed', start_date: '1834-01-01', end_date: null },
    { id: 'm2', person_1_id: 'b1', person_2_id: 'b1s', status: 'widowed', start_date: '1860-01-01', end_date: null },
    { id: 'm3', person_1_id: 'b2', person_2_id: 'b2s', status: 'widowed', start_date: '1863-01-01', end_date: null },
    { id: 'm4', person_1_id: 'b3', person_2_id: 'b3s1', status: 'divorced', start_date: '1864-01-01', end_date: '1869-01-01' },
    { id: 'm5', person_1_id: 'b3', person_2_id: 'b3s2', status: 'widowed', start_date: '1871-01-01', end_date: null },
    { id: 'm6', person_1_id: 'inlaw1', person_2_id: 'inlaw2', status: 'widowed', start_date: '1835-01-01', end_date: null },
    { id: 'm7', person_1_id: 'c11', person_2_id: 'c21', status: 'married', start_date: '1888-01-01', end_date: null },
  ];

  const treeData = {
    persons,
    parent_child_relationships,
    marriages,
    root_person_id: 'f1',
    lineage_root_person_id: 'f1',
  };

  const fullLayout = buildAdvancedTreeLayout(treeData);
  assertNoRowOverlaps(fullLayout, 'full-lineage');
  assert.equal(fullLayout.hasConfirmedRoot, true);
  assert.equal(fullLayout.generationHeaders[0].label, '1-р үе');
  assert.equal(fullLayout.generationHeaders[1].label, '2-р үе');

  // Structural branches derived automatically even with NO branch_id!
  assert.equal(fullLayout.branches.length, 4, '4 structural branches derived from root children');

  // Non-tree Case A: in-law ancestors are excluded; spouse b1s is placed ONLY inside b1 couple unit
  assert.ok(fullLayout.nodeById.has('b1s'), 'spouse b1s is rendered inside couple unit');
  assert.equal(fullLayout.nodeById.has('inlaw1'), false, 'in-law father is NOT drawn');
  assert.equal(fullLayout.nodeById.has('inlaw2'), false, 'in-law mother is NOT drawn');

  // Non-tree Case B: inter-branch child appears once + 1 dashed secondary edge from the 2nd lineage parent
  assert.ok(fullLayout.nodeById.has('interchild'), 'inter-branch child is placed');
  assert.equal(fullLayout.secondaryEdges.length, 1, 'secondary lineage parent link emitted as dashed edge');
  assert.equal(fullLayout.secondaryEdges[0].childId, 'interchild');

  // Remarriage ordering: [b3s1, b3, b3s2] left-to-right, and c31 sits left of c32 (zero crossing!)
  const nB3s1 = fullLayout.nodeById.get('b3s1');
  const nB3 = fullLayout.nodeById.get('b3');
  const nB3s2 = fullLayout.nodeById.get('b3s2');
  assert.ok(nB3s1.x < nB3.x && nB3.x < nB3s2.x, 'remarriage places [spouse1, focal, spouse2]');
  const nC31 = fullLayout.nodeById.get('c31');
  const nC32 = fullLayout.nodeById.get('c32');
  assert.ok(nC31.x < nC32.x, 'marriage-1 child sits left of marriage-2 child (zero crossing)');

  // Parent centered over children (founding couple centered over its 4 branch units)
  const f1Node = fullLayout.nodeById.get('f1');
  const f2Node = fullLayout.nodeById.get('f2');
  const founderCenter = (f1Node.x + f2Node.x + f2Node.width) / 2;
  const b1UnitCenter = (fullLayout.nodeById.get('b1').x + fullLayout.nodeById.get('b1s').x + fullLayout.nodeById.get('b1s').width) / 2;
  const b4UnitCenter = fullLayout.nodeById.get('b4').x + fullLayout.nodeById.get('b4').width / 2;
  const childrenMid = (b1UnitCenter + b4UnitCenter) / 2;
  assert.ok(Math.abs(founderCenter - childrenMid) <= 2, `parent unit centered over children (${founderCenter} vs ${childrenMid})`);

  // Determinism check with reversed input order
  const reversedLayout = buildAdvancedTreeLayout({
    ...treeData,
    persons: [...persons].reverse(),
    parent_child_relationships: [...parent_child_relationships].reverse(),
    marriages: [...marriages].reverse(),
  });
  for (const node of fullLayout.nodes) {
    const other = reversedLayout.nodeById.get(node.id);
    assert.ok(other, `deterministic node ${node.id} present`);
    assert.equal(node.x, other.x, `deterministic x for ${node.id}`);
    assert.equal(node.y, other.y, `deterministic y for ${node.id}`);
  }

  // Branch filter + daughters' descendants toggle + ignoreFilters (Export)
  const branch2Layout = buildAdvancedTreeLayout(treeData, { branchId: fullLayout.branches[1].id });
  assert.ok(branch2Layout.nodeById.has('f1') && branch2Layout.nodeById.has('b2'));
  assert.equal(branch2Layout.nodeById.has('b1'), false, 'branch filter hides other branches');

  const noDaughtersDesc = buildAdvancedTreeLayout(treeData, { showDaughtersDescendants: false });
  assert.ok(noDaughtersDesc.nodeById.has('b2'), 'daughter herself remains visible');
  assert.equal(noDaughtersDesc.nodeById.has('c21'), false, 'daughter descendants hidden when toggle OFF');

  const exportLayout = buildAdvancedTreeLayout(treeData, {
    branchId: fullLayout.branches[1].id,
    showDaughtersDescendants: false,
    collapsedUnitIds: new Set(['f1', 'b1', 'b2']),
    ignoreFilters: true,
  });
  assert.equal(exportLayout.nodes.length, fullLayout.nodes.length, 'export ignoreFilters renders FULL tree');

  // Rootless tree: MUST NOT fabricate "1-р үе"
  const rootless = buildAdvancedTreeLayout({
    ...treeData,
    lineage_root_person_id: null,
  });
  assert.equal(rootless.hasConfirmedRoot, false);
  assert.ok(
    rootless.generationHeaders.every((h) => h.label === '?'),
    'rootless tree labels every generation as "?"',
  );

  // -------------------------------------------------------------------------
  // 2. 1,000-node performance & zero-overlap benchmark
  // -------------------------------------------------------------------------
  const N = 1000;
  const bigPersons = Array.from({ length: N }, (_, i) => ({
    id: `p-${i}`,
    first_name: `Хүн${i}`,
    last_name: 'Туршилт',
    gender: i % 2 === 0 ? 'male' : 'female',
    birth_date: `${1820 + Math.floor(Math.log2(i + 1)) * 22}-01-01`,
    is_alive: i > 600,
  }));
  const bigEdges = Array.from({ length: N - 1 }, (_, i) => ({
    id: `be-${i}`,
    parent_id: `p-${Math.floor(i / 2)}`,
    child_id: `p-${i + 1}`,
    relationship_type: 'biological',
  }));
  const bigTree = {
    persons: bigPersons,
    parent_child_relationships: bigEdges,
    marriages: [],
    root_person_id: 'p-0',
    lineage_root_person_id: 'p-0',
  };

  const timings = [];
  let bigLayout;
  for (let iter = 0; iter < 5; iter += 1) {
    const t0 = performance.now();
    bigLayout = buildAdvancedTreeLayout(bigTree);
    timings.push(performance.now() - t0);
  }
  timings.sort((a, b) => a - b);
  assert.equal(bigLayout.nodes.length, N, 'all 1,000 nodes placed');
  assertNoRowOverlaps(bigLayout, '1000-node-tree');
  assert.ok(timings[2] < 2000, `1,000-node tidy layout median ${timings[2].toFixed(1)}ms must be < 2000ms`);

  console.log(
    JSON.stringify({
      ok: true,
      fullNodes: fullLayout.nodes.length,
      branches: fullLayout.branches.length,
      secondaryEdges: fullLayout.secondaryEdges.length,
      benchmarkNodes: N,
      medianMs: Number(timings[2].toFixed(2)),
    }),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
