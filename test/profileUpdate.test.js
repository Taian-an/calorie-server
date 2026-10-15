const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { buildProfileUpdate, createPutMeHandler } = require('../services/profileUpdate');
const { addDays, calcBmr, activityFactor, CODES } = require('../services/goalPlan');

const TODAY = '2026-10-16';
const onboarded = {
  name: 'Test', gender: 'male', age: 21, height: 175, weight: 70, activity: 'sedentary', goal: 'maintain',
};
const tdeeOf = p => calcBmr(p.gender, p.weight, p.height, p.age) * activityFactor(p.activity);

/* ── buildProfileUpdate ─────────────────────────────────────────── */

test('client-sent bmr / tdee / target are ignored and recalculated', () => {
  const r = buildProfileUpdate(onboarded, { weight: 72, bmr: 1, tdee: 99999, target: 500 }, TODAY);
  assert.equal(r.ok, true);
  const tdee = tdeeOf({ ...onboarded, weight: 72 });
  assert.ok(Math.abs(r.patch.tdee - tdee) < 1e-9);
  assert.ok(Math.abs(r.patch.target - tdee) < 1e-9); // maintain → TDEE
  assert.notEqual(r.patch.bmr, 1);
});

test('fields with the wrong type or range are rejected with 400', () => {
  for (const body of [{ weight: 'heavy' }, { weight: -1 }, { weight: NaN }, { age: 5 }, { goal: 'lose' }, { goalDate: '2027-02-30' }, { targetAdjustment: 5000 }]) {
    const r = buildProfileUpdate(onboarded, body, TODAY);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.httpStatus, 400);
    assert.equal(r.body.error, 'invalid_profile');
  }
});

test('an unsafe new plan is rejected with 422 and a revalidated suggestion', () => {
  const r = buildProfileUpdate(onboarded, { goal: 'cut', targetWeight: 60, goalDate: addDays(TODAY, 30) }, TODAY);
  assert.equal(r.ok, false);
  assert.equal(r.httpStatus, 422);
  assert.equal(r.body.error, 'goal_rejected');
  assert.equal(r.body.status, 'goal_too_aggressive');
  assert.ok(r.body.errors.some(e => e.code === CODES.RATE_TOO_FAST));
  assert.ok(r.body.suggestion?.targetDate > addDays(TODAY, 30));
  // The suggested date itself is accepted.
  const retry = buildProfileUpdate(onboarded, { goal: 'cut', targetWeight: 60, goalDate: r.body.suggestion.targetDate }, TODAY);
  assert.equal(retry.ok, true);
});

test('wrong goal direction and past dates are rejected', () => {
  const up = buildProfileUpdate(onboarded, { goal: 'cut', targetWeight: 75, goalDate: addDays(TODAY, 200) }, TODAY);
  assert.equal(up.httpStatus, 422);
  assert.equal(up.body.status, 'invalid_input');
  const past = buildProfileUpdate(onboarded, { goal: 'cut', targetWeight: 65, goalDate: addDays(TODAY, -1) }, TODAY);
  assert.equal(past.httpStatus, 422);
  assert.deepEqual(past.body.errors.map(e => e.code), [CODES.TARGET_DATE_NOT_FUTURE]);
});

test('a valid plan is accepted and the server works out the target', () => {
  const r = buildProfileUpdate(onboarded, { goal: 'cut', targetWeight: 65, goalDate: addDays(TODAY, 91) }, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.patch.goal, 'cut');
  assert.ok(Math.abs(r.patch.target - (tdeeOf(onboarded) - 5 * 7700 / 91)) < 1e-9);
});

test('a weigh-in is never rejected, even when it makes the stored plan fail', () => {
  const stored = { ...onboarded, goal: 'cut', targetWeight: 65, goalDate: addDays(TODAY, 30) }; // already too fast
  // The app sends its whole profile, including the unchanged plan.
  const r = buildProfileUpdate(stored, { ...stored, weight: 71 }, TODAY);
  assert.equal(r.ok, true);
  assert.ok(r.patch.target >= 1500); // safe fallback, never below the minimum
});

test('sign-up with only a name stores the name and computes nothing', () => {
  const r = buildProfileUpdate({}, { name: 'New', target: 100 }, TODAY);
  assert.deepEqual(r, { ok: true, patch: { name: 'New' } });
});

/* ── PUT /me over HTTP (in-memory user store, auth stubbed) ─────────── */

function makeServer(initial) {
  const users = new Map([['u1', { _id: 'u1', ...initial }]]);
  const User = {
    async findById(id) { return users.get(id) ?? null; },
    async findByIdAndUpdate(id, patch) {
      const next = { ...users.get(id), ...patch };
      users.set(id, next);
      return next;
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.uid = req.headers['x-test-user'] ?? 'u1'; next(); });
  app.put('/me', createPutMeHandler({ User, todayFor: async () => TODAY, publicProfile: u => ({ ...u }) }));
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, users, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const put = (url, body, headers = {}) => fetch(`${url}/me`, {
  method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('HTTP: a direct request with an unsafe plan is refused and nothing is saved', async () => {
  const { server, users, url } = await makeServer(onboarded);
  try {
    const res = await put(url, { goal: 'cut', targetWeight: 55, goalDate: addDays(TODAY, 14), target: 900 });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error, 'goal_rejected');
    assert.ok(body.errors.length > 0);
    assert.equal(users.get('u1').goal, 'maintain');
    assert.equal(users.get('u1').target, undefined);
  } finally { server.close(); }
});

test('HTTP: a hand-made target is ignored', async () => {
  const { server, users, url } = await makeServer(onboarded);
  try {
    const res = await put(url, { target: 800, tdee: 800 });
    assert.equal(res.status, 200);
    assert.ok(Math.abs(users.get('u1').target - tdeeOf(onboarded)) < 1e-9);
  } finally { server.close(); }
});

test('HTTP: a valid plan is saved with the server-side target', async () => {
  const { server, users, url } = await makeServer(onboarded);
  try {
    const res = await put(url, { goal: 'bulk', targetWeight: 72, goalDate: addDays(TODAY, 120) });
    assert.equal(res.status, 200);
    const saved = users.get('u1');
    assert.equal(saved.goal, 'bulk');
    assert.equal(saved.goalDate, addDays(TODAY, 120));
    assert.ok(Math.abs(saved.target - (tdeeOf(onboarded) + 2 * 7700 / 120)) < 1e-9);
  } finally { server.close(); }
});

test('HTTP: invalid field types give 400 and are not saved', async () => {
  const { server, users, url } = await makeServer(onboarded);
  try {
    const res = await put(url, { weight: 'Infinity', name: 'x' });
    assert.equal(res.status, 400);
    assert.equal(users.get('u1').name, 'Test');
  } finally { server.close(); }
});

test('HTTP: unknown user gives 404', async () => {
  const { server, url } = await makeServer(onboarded);
  try {
    const res = await put(url, { name: 'x' }, { 'x-test-user': 'nobody' });
    assert.equal(res.status, 404);
  } finally { server.close(); }
});
