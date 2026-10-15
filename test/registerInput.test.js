const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail, isValidEmail, validateRegisterInput, isDuplicateEmailError,
} = require('../services/registerInput');

test('emails are compared trimmed and lower-cased', () => {
  assert.equal(normalizeEmail('  Name@Example.COM '), 'name@example.com');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(42), '');
});

test('name@example.com style addresses are accepted', () => {
  for (const e of ['name@example.com', ' A.B+tag@mail.example.co.uk ', 'x@y.io']) {
    assert.equal(isValidEmail(e), true, e);
  }
});

test('malformed addresses are rejected', () => {
  for (const e of ['', '   ', 'name', 'name@', '@example.com', 'name@example', 'name@example.',
    'name@.com', 'na me@example.com', 'a@b@example.com', 'name@exa mple.com', null, {},
    'a'.repeat(250) + '@x.com']) {
    assert.equal(isValidEmail(e), false, String(e));
  }
});

test('validateRegisterInput returns the normalized email', () => {
  assert.deepEqual(validateRegisterInput({ email: ' Me@Example.com ', password: 'abcd' }),
    { ok: true, email: 'me@example.com' });
});

test('a bad email format is a 400 with its own message', () => {
  const r = validateRegisterInput({ email: 'me@example', password: 'abcd' });
  assert.equal(r.ok, false);
  assert.equal(r.httpStatus, 400);
  assert.equal(r.body.error, 'Invalid email format');
});

test('a short or missing password is a 400', () => {
  for (const password of [undefined, '', 'abc', 1234]) {
    const r = validateRegisterInput({ email: 'me@example.com', password });
    assert.equal(r.ok, false);
    assert.equal(r.httpStatus, 400);
    assert.equal(r.body.error, 'Invalid email or password (min 4 chars)');
  }
  assert.equal(validateRegisterInput(undefined).ok, false);
});

test('only a duplicate-key error on email counts as "already registered"', () => {
  assert.equal(isDuplicateEmailError({ code: 11000, keyPattern: { email: 1 } }), true);
  assert.equal(isDuplicateEmailError({ code: 11000, message: 'E11000 duplicate key error index: email_1' }), true);
  assert.equal(isDuplicateEmailError({ code: 11000, keyPattern: { googleId: 1 }, message: 'googleId_1' }), false);
  assert.equal(isDuplicateEmailError(new Error('boom')), false);
  assert.equal(isDuplicateEmailError(undefined), false);
});
