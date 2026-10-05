import assert from 'node:assert/strict';
import { sharedAncestryPaths } from '../lib/shared-ancestry.ts';

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
const cyclic = sharedAncestryPaths({ ...tree, relationships: [...tree.relationships, { parent_id: 'grandchild', child_id: 'father' }] });
assert.equal(cyclic.size, 5);
console.log('PASS root paths: explicit parents, spouses, grandchildren, pending account exclusion, hidden roots, cycle resilience');
