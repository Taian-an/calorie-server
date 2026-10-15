// One-off cleanup: remove name, username and avatarKey from every user document, now that email is
// the only identifier (commit 0375891) and the display name and avatar live on the device only.
// Also drops the old unique index on username, which would otherwise stay in MongoDB.
//
// Dry run by default: it only counts and lists what it would change.
//   node ops/drop-user-names.js                 # dry run against MONGODB_URI from .env
//   node ops/drop-user-names.js --apply         # actually remove the fields and the index
//   MONGODB_URI=mongodb://... node ops/drop-user-names.js [--apply]
// Back up the users collection first (mongodump --collection users). $unset cannot be undone.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const FIELDS = ['name', 'username', 'avatarKey'];
const OLD_INDEX = 'username_1';
const SAMPLE = 10;

const hasAnyField = { $or: FIELDS.map(f => ({ [f]: { $exists: true } })) };

// The work itself, on a users collection; kept apart from the connection so it can be tested.
async function cleanUsers(users, { apply = false, log = console.log } = {}) {
  const counts = {};
  for (const f of FIELDS) counts[f] = await users.countDocuments({ [f]: { $exists: true } });
  const affected = await users.countDocuments(hasAnyField);
  const total = await users.countDocuments({});
  const sample = await users.find(hasAnyField, { projection: { email: 1, ...Object.fromEntries(FIELDS.map(f => [f, 1])) } })
    .limit(SAMPLE).toArray();
  const indexes = await users.indexes();
  const hasIndex = indexes.some(i => i.name === OLD_INDEX);

  log(`Users: ${total} in total, ${affected} with at least one of ${FIELDS.join(', ')}`);
  for (const f of FIELDS) log(`  ${f}: ${counts[f]}`);
  log(`Index ${OLD_INDEX}: ${hasIndex ? 'present' : 'not present'}`);
  if (sample.length) {
    log(`First ${sample.length} affected (email → fields that would be removed):`);
    for (const u of sample) log(`  ${u.email ?? `(no email, _id ${u._id})`} → ${FIELDS.filter(f => f in u).join(', ')}`);
  }

  if (!apply) {
    log('Dry run: nothing changed. Run again with --apply to remove them.');
    return { applied: false, total, affected, counts, hasIndex };
  }

  const result = await users.updateMany(hasAnyField, { $unset: Object.fromEntries(FIELDS.map(f => [f, ''])) });
  if (hasIndex) await users.dropIndex(OLD_INDEX);
  log(`Removed the fields from ${result.modifiedCount} users${hasIndex ? ` and dropped ${OLD_INDEX}` : ''}.`);
  return { applied: true, total, affected, counts, hasIndex, modified: result.modifiedCount };
}

// Show where it connects without printing a password.
const describeUri = uri => uri.replace(/\/\/[^@/]*@/, '//***@');

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/calorieDB';
  const mongoose = require('mongoose');
  await mongoose.connect(uri);
  try {
    console.log(`Database: ${describeUri(uri)} (${mongoose.connection.name})${apply ? ' — APPLYING' : ' — dry run'}`);
    await cleanUsers(mongoose.connection.db.collection('users'), { apply });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { cleanUsers, describeUri, FIELDS, OLD_INDEX };
