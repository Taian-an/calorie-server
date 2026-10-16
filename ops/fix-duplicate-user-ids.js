// One-off cleanup: give every user a userId nobody else has, then create the unique index on userId.
// Old builds numbered users 'u' + (1001 + user count), so after a user was deleted the next sign-up got
// a number that already existed. In each group of duplicates the oldest account keeps its number and the
// others get new ones from the counter (services/userIds.js). Users with no userId get one too.
// userId is only a display number in /admin; nothing links to it, so renumbering is safe.
//
// Dry run by default: it only lists what it would change.
//   node ops/fix-duplicate-user-ids.js            # dry run against MONGODB_URI from .env
//   node ops/fix-duplicate-user-ids.js --apply    # renumber, sync the counter, create the index
//   MONGODB_URI=mongodb://... node ops/fix-duplicate-user-ids.js [--apply]
// Back up the users collection first (mongodump --collection users). Old numbers are printed but not kept.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { nextUserId, syncUserIdCounter, maxExistingUserIdNumber, formatUserId } = require('../services/userIds');

const INDEX = 'userId_1';

const createdAt = u => (u.createdAt ? new Date(u.createdAt).getTime() : u._id?.getTimestamp?.()?.getTime() ?? 0);

// Which users need a new number: all but the oldest of each duplicate group, plus users without one.
// Pure, so it can be tested without a database.
function planRenumbering(docs) {
  const groups = new Map();
  const missing = [];
  for (const u of docs) {
    if (u.userId == null || u.userId === '') { missing.push(u); continue; }
    if (!groups.has(u.userId)) groups.set(u.userId, []);
    groups.get(u.userId).push(u);
  }
  const byAge = (a, b) => createdAt(a) - createdAt(b) || String(a._id).localeCompare(String(b._id));
  const duplicates = [];
  for (const [userId, us] of groups) {
    if (us.length < 2) continue;
    const [keep, ...rest] = us.slice().sort(byAge);
    duplicates.push({ userId, keep, renumber: rest });
  }
  const toRenumber = [...duplicates.flatMap(d => d.renumber), ...missing.slice().sort(byAge)];
  return { duplicates, missing, toRenumber };
}

async function fixUserIds(users, counters, { apply = false, log = console.log } = {}) {
  const docs = await users.find({}, { projection: { userId: 1, email: 1, createdAt: 1 } }).toArray();
  const { duplicates, missing, toRenumber } = planRenumbering(docs);
  const indexes = await users.indexes();
  const existing = indexes.find(i => i.name === INDEX);
  const hasUniqueIndex = !!existing?.unique;

  log(`Users: ${docs.length}. Duplicate numbers: ${duplicates.length} (${duplicates.reduce((n, d) => n + d.renumber.length, 0)} users to renumber). Without a number: ${missing.length}.`);
  log(`Index ${INDEX}: ${existing ? (existing.unique ? 'present, unique' : 'present, NOT unique') : 'not present'}`);
  for (const d of duplicates) {
    log(`  ${d.userId}: keeps ${d.keep.email ?? d.keep._id}; renumbers ${d.renumber.map(u => u.email ?? u._id).join(', ')}`);
  }
  for (const u of missing) log(`  (no number): ${u.email ?? u._id}`);

  if (!apply) {
    let next = await maxExistingUserIdNumber(users);
    for (const u of toRenumber) log(`  would set ${u.email ?? u._id}: ${u.userId ?? '(none)'} → ${formatUserId(++next)} (or higher)`);
    log(`Dry run: nothing changed. Run again with --apply to renumber${hasUniqueIndex ? '' : ' and create the unique index'}.`);
    return { applied: false, total: docs.length, duplicates: duplicates.length, renumbered: 0, hasUniqueIndex };
  }

  await syncUserIdCounter(counters, users);
  const changes = [];
  for (const u of toRenumber) {
    const userId = await nextUserId(counters, users);
    await users.updateOne({ _id: u._id }, { $set: { userId } });
    changes.push({ _id: u._id, email: u.email, from: u.userId ?? null, to: userId });
    log(`  ${u.email ?? u._id}: ${u.userId ?? '(none)'} → ${userId}`);
  }
  if (existing && !existing.unique) await users.dropIndex(INDEX);
  if (!hasUniqueIndex) await users.createIndex({ userId: 1 }, { name: INDEX, unique: true, sparse: true });
  log(`Renumbered ${changes.length} users${hasUniqueIndex ? '' : ` and created the unique index ${INDEX}`}.`);
  return { applied: true, total: docs.length, duplicates: duplicates.length, renumbered: changes.length, changes, hasUniqueIndex: true };
}

// Show where it connects without printing a password.
const describeUri = uri => uri.replace(/\/\/[^@/]*@/, '//***@');

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/calorieDB';
  const mongoose = require('mongoose');
  await mongoose.connect(uri, { autoIndex: false });
  try {
    console.log(`Database: ${describeUri(uri)} (${mongoose.connection.name})${apply ? ' — APPLYING' : ' — dry run'}`);
    const db = mongoose.connection.db;
    await fixUserIds(db.collection('users'), db.collection('counters'), { apply });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { planRenumbering, fixUserIds, describeUri, INDEX };
