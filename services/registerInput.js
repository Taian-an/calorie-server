// Email + password checks for POST /auth/register. The app runs the same format check while the
// user types (calorie-app/constants/email.js), but the server is the one that has to enforce it.

const MAX_EMAIL_LENGTH = 254;
// name@example.com: something before the @, and a domain with at least one dot. No spaces, one @.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// Accounts are identified by email, so it is always compared trimmed and lower-cased.
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(e);
}

// { ok: true, email } with the normalized email, or { ok: false, httpStatus, body } to send back
function validateRegisterInput({ email, password } = {}) {
  if (!isValidEmail(email)) {
    return { ok: false, httpStatus: 400, body: { error: 'Invalid email format' } };
  }
  if (typeof password !== 'string' || password.length < 4) {
    return { ok: false, httpStatus: 400, body: { error: 'Invalid email or password (min 4 chars)' } };
  }
  return { ok: true, email: normalizeEmail(email) };
}

// Two sign-ups with the same email at once both pass the findOne check; the unique index on
// User.email stops the second one, and it should get the same 409 as a normal duplicate.
function isDuplicateEmailError(err) {
  return err?.code === 11000 && (err.keyPattern?.email != null || /email/.test(err.message ?? ''));
}

const EMAIL_TAKEN = { error: 'Email already registered' };

module.exports = { normalizeEmail, isValidEmail, validateRegisterInput, isDuplicateEmailError, EMAIL_TAKEN };
