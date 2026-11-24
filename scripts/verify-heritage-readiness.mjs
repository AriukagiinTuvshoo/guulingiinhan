import assert from 'node:assert/strict';
import { memoryDraftError } from '../lib/memory-draft.ts';
import { needsExplicitFamily, resolveFamilyScope } from '../lib/family-scope.ts';

const families = [{ id: 'family-a' }, { id: 'family-b' }];
for (const pathname of ['/tree', '/search', '/relationships', '/people', '/stories/new', '/memories/new', '/archives', '/settings', '/ancestry/connect']) {
  assert.ok(needsExplicitFamily(pathname, false));
  assert.equal(resolveFamilyScope([families[0]], '', true).id, 'family-a');
  assert.equal(resolveFamilyScope(families, 'invalid', true).id, '');
  assert.equal(resolveFamilyScope(families, 'foreign-family', true).id, '');
  assert.equal(resolveFamilyScope(families, 'family-b', true).id, 'family-b');
}
assert.ok(needsExplicitFamily('/profile', true));
assert.ok(!needsExplicitFamily('/community', false));
assert.equal(resolveFamilyScope([], 'family-a', false).id, '');
assert.equal(resolveFamilyScope(families, '', false).id, 'family-a');
assert.equal(resolveFamilyScope([{ id: 'family-a' }, { id: 'family-b' }], '', true).id, '');
assert.ok(memoryDraftError('   ', 'family', []));
assert.ok(memoryDraftError('Title', 'unknown', []));
assert.ok(memoryDraftError('Title', 'family', [{ type: 'text/plain', size: 10 }]));
assert.ok(memoryDraftError('Title', 'family', [{ type: '', size: 10 }]));
assert.ok(memoryDraftError('Title', 'family', [{ type: 'image/png', size: 10 * 1024 * 1024 + 1 }]));
for (const visibility of ['private', 'family', 'public']) {
  assert.equal(memoryDraftError('Title', visibility, []), null);
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(memoryDraftError('Title', visibility, [{ type, size: 100 }]), null);
}
assert.ok(memoryDraftError('Title', 'family', Array.from({ length: 21 }, () => ({ type: 'image/png', size: 10 }))));
console.log('PASS explicit family scope and memory creation validation');
