const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isMlListingDeleted,
  isMlListingDeletionPayload,
} = require('../src/lib/ml/listing-deletion-state.ts');

test('reconhece exclusão somente pelo sub_status oficial', () => {
  assert.equal(isMlListingDeleted({ status: 'closed', sub_status: ['deleted'] }), true);
  assert.equal(isMlListingDeleted({ status: 'inactive', sub_status: ['waiting_for_patch', 'DELETED'] }), true);
  assert.equal(isMlListingDeleted({ status: 'closed', sub_status: [] }), false);
});

test('reconhece flag explícita de exclusão na fila', () => {
  assert.equal(isMlListingDeletionPayload({ delete_listing: true }), true);
  assert.equal(isMlListingDeletionPayload({ delete_listing: 'true' }), true);
  assert.equal(isMlListingDeletionPayload({ delete_listing: false }), false);
  assert.equal(isMlListingDeletionPayload(null), false);
});
