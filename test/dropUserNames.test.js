// ops/drop-user-names.js against an in-memory stand-in for the users collection (no database).
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanUsers, describeUri } = require('../ops/drop-user-names');

// Just enough of a MongoDB collection for the script: $exists / $or filters, $unset, indexes.
function fakeUsers(docs, indexNames = ['_id_', 'email_1', 'username_1']) {
  const indexes = indexNames.map(name => ({ name }));
  const matches = (doc, filter) => {
    if (filter.$or) return filter.$or.some(f => matches(doc, f));
    return Object.entries(filter).every(([k, cond]) => (cond.$exists ? k in doc : doc[k] === cond));
  };
  return {
    docs, indexList: indexes,
    async countDocuments(filter) { return docs.filter(d => matches(d, filter)).length; },
    find(filter) {
      const found = docs.filter(d => matches(d, filter));
      return { limit: n => ({ toArray: async () => found.slice(0, n).map(d => ({ ...d })) }) };
    },
    async indexes() { return indexes.slice(); },
    async updateMany(filter, update) {
      let modifiedCount = 0;
      for (const d of docs.filter(x => matches(x, filter))) {
        for (const k of Object.keys(update.$unset)) delete d[k];
        modifiedCount++;
      }
      return { modifiedCount };
    },
    async dropIndex(name) { indexes.splice(indexes.findIndex(i => i.name === name), 1); },
  };
}

const seed = () => [
  { _id: 1, email: 'a@x.test', name: 'Amy', username: 'amy', avatarKey: 'default', weight: 60 },
  { _id: 2, email: 'b@x.test', avatarKey: 'default', goal: 'cut' },
  { _id: 3, email: 'c@x.test', weight: 70 },
];
const quiet = () => {};

test('dry run reports what it would change and changes nothing', async () => {
  const users = fakeUsers(seed());
  const before = JSON.stringify(users.docs);
  const r = await cleanUsers(users, { log: quiet });
  assert.equal(r.applied, false);
  assert.equal(r.total, 3);
  assert.equal(r.affected, 2);
  assert.deepEqual(r.counts, { name: 1, username: 1, avatarKey: 2 });
  assert.equal(r.hasIndex, true);
  assert.equal(JSON.stringify(users.docs), before);
  assert.ok(users.indexList.some(i => i.name === 'username_1'));
});

test('apply removes only the three fields and the username index', async () => {
  const users = fakeUsers(seed());
  const r = await cleanUsers(users, { apply: true, log: quiet });
  assert.equal(r.modified, 2);
  assert.deepEqual(users.docs, [
    { _id: 1, email: 'a@x.test', weight: 60 },
    { _id: 2, email: 'b@x.test', goal: 'cut' },
    { _id: 3, email: 'c@x.test', weight: 70 },
  ]);
  assert.deepEqual(users.indexList.map(i => i.name), ['_id_', 'email_1']);
});

test('running it again is harmless', async () => {
  const users = fakeUsers(seed());
  await cleanUsers(users, { apply: true, log: quiet });
  const again = await cleanUsers(users, { apply: true, log: quiet });
  assert.equal(again.affected, 0);
  assert.equal(again.modified, 0);
  assert.equal(again.hasIndex, false);
});

test('the printed database address hides the password', () => {
  assert.equal(describeUri('mongodb+srv://admin:s3cret@cluster0.example.net/calorieDB'), 'mongodb+srv://***@cluster0.example.net/calorieDB');
  assert.equal(describeUri('mongodb://127.0.0.1:27017/calorieDB'), 'mongodb://127.0.0.1:27017/calorieDB');
});
