const {
  validateGoal, goalInputFromProfile, resolveDailyTarget, calcBmr, activityFactor, calculateMacroTargets,
  isValidDateKey, GOAL_TYPES, ACTIVITY_FACTORS, GOAL_POLICY,
} = require('./goalPlan');

// Profile writes from the app (PUT /me, POST /auth/register). The server never trusts numbers the
// client worked out: bmr, tdee and target are always recalculated here with the shared goalPlan.js,
// and a new or changed Goal plan must pass validateGoal before anything is saved.

// Fields the client may send. bmr / tdee / target are not among them: they are computed.
const CLIENT_FIELDS = [
  'gender', 'age', 'ageSetAt', 'birthday', 'height', 'weight', 'targetWeight', 'goalDate',
  'activity', 'goal', 'targetAdjustment', 'targetAdjustedAt', 'lastAdjustment',
];
const GOAL_FIELDS = ['goal', 'targetWeight', 'goalDate'];

const num = (min, max) => v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const oneOf = list => v => list.includes(v);
const dateKey = v => isValidDateKey(v);
const text = max => v => typeof v === 'string' && v.length <= max;
const { weightKg } = GOAL_POLICY.limits;

// null clears a field where that makes sense (no Goal weight / no target date).
const RULES = {
  gender: oneOf(['male', 'female', 'other']),
  age: num(13, 100),
  ageSetAt: dateKey,
  birthday: dateKey,
  height: num(100, 230),
  weight: num(weightKg.min, weightKg.max),
  targetWeight: v => v === null || num(weightKg.min, weightKg.max)(v),
  goalDate: v => v === null || dateKey(v),
  activity: oneOf(Object.keys(ACTIVITY_FACTORS)),
  goal: oneOf(GOAL_TYPES),
  targetAdjustment: num(-400, 400),
  targetAdjustedAt: dateKey,
  lastAdjustment: num(-400, 400),
};

const hasBody = p => ['gender', 'age', 'height', 'weight'].every(f => p[f] != null);

/*
 * buildProfileUpdate(current, body, todayKey)
 *   → { ok: true, patch }                       ready to save
 *   → { ok: false, httpStatus: 400, body }      a field is missing its type or range
 *   → { ok: false, httpStatus: 422, body }      the Goal plan is rejected (validateGoal result)
 * `current` is the stored profile (plain object), `todayKey` the user's local Day.
 */
function buildProfileUpdate(current, body, todayKey) {
  const patch = {};
  const invalid = [];
  for (const f of CLIENT_FIELDS) {
    if (body?.[f] === undefined) continue;
    if (!RULES[f](body[f])) invalid.push({ field: f, code: 'INVALID_VALUE' });
    else patch[f] = body[f];
  }
  if (invalid.length) return { ok: false, httpStatus: 400, body: { error: 'invalid_profile', fields: invalid } };

  const merged = { ...current, ...patch };
  if (!hasBody(merged)) return { ok: true, patch }; // not onboarded yet (e.g. a bare sign-up)

  const bmr = calcBmr(merged.gender, merged.weight, merged.height, merged.age);
  const tdee = bmr * activityFactor(merged.activity);
  const withEnergy = { ...merged, bmr, tdee, goal: GOAL_TYPES.includes(merged.goal) ? merged.goal : 'maintain' };

  // A plan the user creates or changes must pass. Weigh-ins and other edits are never rejected:
  // if they make an existing plan fail, resolveDailyTarget falls back to a safe Goal change and the
  // app asks the user to review the plan.
  // The app sends its whole profile on every save, so only a value that differs from the stored one
  // counts as a change to the plan.
  const planChanged = GOAL_FIELDS.some(f => f in patch && patch[f] !== (current[f] ?? null));
  if (planChanged) {
    const result = validateGoal(goalInputFromProfile(withEnergy, todayKey));
    if (!result.allowed) {
      return {
        ok: false,
        httpStatus: 422,
        body: {
          error: 'goal_rejected',
          status: result.status,
          errors: result.errors,
          warnings: result.warnings,
          ...(result.suggestion ? { suggestion: { days: result.suggestion.days, targetDate: result.suggestion.targetDate } } : {}),
        },
      };
    }
  }

  const { target } = resolveDailyTarget(withEnergy, todayKey);
  return { ok: true, patch: { ...patch, goal: withEnergy.goal, bmr, tdee, target } };
}

/*
 * previewGoalPlan(current, body, todayKey): what saving this Goal plan would do, without saving.
 * body may change the plan (goal, targetWeight, goalDate) and the inputs it depends on (weight, activity).
 *   → { httpStatus: 400, body }   a field has the wrong type or range
 *   → { httpStatus: 200, body }   { allowed, status, errors, warnings, suggestion?, estimate?,
 *                                   plan: { goal, weight, targetWeight, goalDate, activity, tdee, target, macros } }
 * The plan is always checked here, changed or not, because the user is asking for a review.
 */
const PREVIEW_FIELDS = ['goal', 'targetWeight', 'goalDate', 'weight', 'activity'];
function previewGoalPlan(current, body, todayKey) {
  const picked = {};
  for (const f of PREVIEW_FIELDS) if (body?.[f] !== undefined) picked[f] = body[f];
  const built = buildProfileUpdate({}, picked, todayKey); // field checks only: {} has no body data
  if (!built.ok) return { httpStatus: built.httpStatus, body: built.body };

  const merged = { ...current, ...built.patch };
  if (!hasBody(merged)) {
    return { httpStatus: 200, body: { allowed: false, status: 'insufficient_information', errors: [{ code: 'PROFILE_INCOMPLETE' }], warnings: [] } };
  }
  const bmr = calcBmr(merged.gender, merged.weight, merged.height, merged.age);
  const tdee = bmr * activityFactor(merged.activity);
  const withEnergy = { ...merged, bmr, tdee, goal: GOAL_TYPES.includes(merged.goal) ? merged.goal : 'maintain' };
  if (withEnergy.goal === 'maintain') withEnergy.goalDate = null;

  const result = validateGoal(goalInputFromProfile(withEnergy, todayKey));
  const plan = {
    goal: withEnergy.goal, weight: withEnergy.weight, targetWeight: withEnergy.targetWeight ?? null,
    goalDate: withEnergy.goalDate ?? null, activity: withEnergy.activity, tdee,
  };
  if (result.allowed) {
    plan.target = resolveDailyTarget(withEnergy, todayKey).target;
    plan.macros = calculateMacroTargets({ calories: plan.target, weightKg: withEnergy.weight, goalType: withEnergy.goal });
  }
  return {
    httpStatus: 200,
    body: {
      allowed: result.allowed, status: result.status, errors: result.errors, warnings: result.warnings,
      ...(result.estimate ? { estimate: result.estimate } : {}),
      ...(result.suggestion ? { suggestion: { days: result.suggestion.days, targetDate: result.suggestion.targetDate } } : {}),
      plan,
      checkedFor: todayKey, // the review is only good for this Day; a later save is checked again anyway
    },
  };
}

// POST /goals/validate handler (dry run, nothing is saved).
function createGoalPreviewHandler({ User, todayFor }) {
  return async (req, res) => {
    const user = await User.findById(req.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const current = typeof user.toObject === 'function' ? user.toObject() : user;
    const result = previewGoalPlan(current, req.body ?? {}, await todayFor(user, req));
    res.status(result.httpStatus).json(result.body);
  };
}

// PUT /me handler. Dependencies are passed in so tests can run it against an in-memory store.
function createPutMeHandler({ User, todayFor, publicProfile }) {
  return async (req, res) => {
    const user = await User.findById(req.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const current = typeof user.toObject === 'function' ? user.toObject() : user;
    const result = buildProfileUpdate(current, req.body ?? {}, await todayFor(user, req));
    if (!result.ok) return res.status(result.httpStatus).json(result.body);
    const updated = await User.findByIdAndUpdate(req.uid, result.patch, { new: true });
    res.json(publicProfile(updated));
  };
}

module.exports = { CLIENT_FIELDS, buildProfileUpdate, createPutMeHandler, previewGoalPlan, createGoalPreviewHandler };
