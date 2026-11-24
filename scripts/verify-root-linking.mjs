import assert from 'node:assert/strict';
import { sharedAncestryGenerations, sharedAncestryPaths } from '../lib/shared-ancestry.ts';
import { readWorkspacePeople } from '../lib/admin-workspace.ts';

// FamilyWorkspace serializes `people`, unlike SharedTreeOut's `persons`.
const workspacePeople = [{ id: 'father', first_name: 'Ancestor', last_name: '', birth_date: null, is_alive: false }];
assert.deepEqual(readWorkspacePeople({ people: workspacePeople }), workspacePeople);
assert.deepEqual(readWorkspacePeople({ people: [] }), []);
assert.throws(() => readWorkspacePeople({ persons: workspacePeople }), /people must be an array/);
assert.throws(() => readWorkspacePeople({ people: null }), /people must be an array/);

const tree = {
  root_person_id: 'father', root_partner_person_id: 'mother',
  persons: ['father', 'mother', 'daughter', 'spouse', 'grandchild', 'unlinked', 'pending-account'].map((id) => ({ id })),
  relationships: [
    { parent_id: 'father', child_id: 'daughter' },
    { parent_id: 'mother', child_id: 'daughter' },
    { parent_id: 'daughter', child_id: 'grandchild' },
    { parent_id: 'spouse', child_id: 'grandchild' },
  ],
  spouses: [
    { person_1_id: 'father', person_2_id: 'mother' },
    { person_1_id: 'daughter', person_2_id: 'spouse' },
  ],
};
const paths = sharedAncestryPaths(tree);
assert.deepEqual(paths.get('grandchild'), ['father', 'daughter', 'grandchild']);
assert.deepEqual(paths.get('spouse'), ['father', 'daughter', 'spouse']);
assert.ok(!paths.has('unlinked'));
assert.ok(!paths.has('pending-account'));
assert.equal(sharedAncestryPaths({ ...tree, root_person_id: null }).size, 0);
assert.equal(sharedAncestryPaths({ ...tree, persons: [] }).size, 0);
const generations = sharedAncestryGenerations(tree);
assert.equal(generations.get('father'), 1);
assert.equal(generations.get('mother'), 1);
assert.equal(generations.get('daughter'), 2);
assert.equal(generations.get('spouse'), 2);
assert.equal(generations.get('grandchild'), 3);
assert.equal(generations.has('unlinked'), false);
const cyclic = sharedAncestryPaths({ ...tree, relationships: [...tree.relationships, { parent_id: 'grandchild', child_id: 'father' }] });
assert.equal(cyclic.size, 5);
const cyclicGenerations = sharedAncestryGenerations({ ...tree, relationships: [...tree.relationships, { parent_id: 'grandchild', child_id: 'father' }] });
assert.equal(cyclicGenerations.get('father'), 1);
assert.equal(cyclicGenerations.get('grandchild'), 3);
console.log('PASS root paths and generations: explicit parents, spouses, grandchildren, pending account exclusion, hidden roots, cycle resilience');

