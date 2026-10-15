const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// services/goalPlan.js is a copy of calorie-app/constants/goalPlan.js. They must stay identical so
// the app and the API judge a Goal plan the same way. Runs when the app repo sits next to this one
// (the usual SP/ checkout); skipped elsewhere, e.g. on the production VM.
const appCopy = path.join(__dirname, '..', '..', 'calorie-app', 'constants', 'goalPlan.js');

test('server goalPlan.js matches the app copy', { skip: !fs.existsSync(appCopy) && 'calorie-app not checked out next to the server' }, () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'services', 'goalPlan.js'), 'utf8');
  const app = fs.readFileSync(appCopy, 'utf8');
  assert.equal(server, app, 'Copy calorie-app/constants/goalPlan.js to services/goalPlan.js');
});
