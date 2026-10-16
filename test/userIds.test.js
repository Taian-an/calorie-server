// services/userIds.js and the plan in ops/fix-duplicate-user-ids.js (no database).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUserId, formatUserId } = require('../services/userIds');
const { planRenumbering } = require('../ops/fix-duplicate-user-ids');

test('user ids round-trip and reject other formats', () => {
  assert.equal(parseUserId('u1021'), 1021);
  assert.equal(formatUserId(10000), 'u10000');
  assert.equal(parseUserId('1021'), null);
  assert.equal(parseUserId(undefined), null);
});

test('the oldest user in a duplicate group keeps the number; the rest and users without one are renumbered', () => {
  const docs = [
    { _id: 'a', email: 'old@x.test', userId: 'u1021', createdAt: '2026-01-01' },
    { _id: 'b', email: 'new@x.test', userId: 'u1021', createdAt: '2026-05-01' },
    { _id: 'c', email: 'solo@x.test', userId: 'u1022', createdAt: '2026-02-01' },
    { _id: 'd', email: 'none@x.test', createdAt: '2026-03-01' },
  ];
  const plan = planRenumbering(docs);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.duplicates[0].keep.email, 'old@x.test');
  assert.deepEqual(plan.toRenumber.map(u => u.email), ['new@x.test', 'none@x.test']);
});

test('nothing to do when every number is unique', () => {
  const plan = planRenumbering([{ _id: 'a', userId: 'u1001' }, { _id: 'b', userId: 'u1002' }]);
  assert.equal(plan.toRenumber.length, 0);
});
