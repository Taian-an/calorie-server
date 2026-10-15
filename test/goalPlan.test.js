const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GOAL_POLICY, STATUS, CODES, validateGoal, suggestFeasibleTimeline, calculateMacroTargets,
  calculateGoalNumbers, resolveDailyTarget, addDays, daysBetween,
} = require('../services/goalPlan');

const TODAY = '2026-10-16';
// 70 kg male, 21, TDEE 2100: male calorie minimum 1500.
const base = { goalType: 'cut', currentWeightKg: 70, targetWeightKg: 65, todayKey: TODAY, tdee: 2100, sex: 'male', age: 21 };
const inDays = n => addDays(TODAY, n);
const codes = r => r.errors.map(e => e.code);
const warnCodes = r => r.warnings.map(e => e.code);

test('valid cut: 5 kg in 13 weeks', () => {
  const r = validateGoal({ ...base, targetDate: inDays(91) });
  assert.equal(r.status, STATUS.VALID);
  assert.equal(r.allowed, true);
  assert.equal(r.estimate.days, 91);
  assert.equal(r.estimate.weightChangeKg, -5);
  assert.ok(Math.abs(r.estimate.weeklyChangeKg - (-5 * 7 / 91)) < 1e-9);
  assert.ok(Math.abs(r.estimate.dailyAdjustmentKcal - (-5 * 7700 / 91)) < 1e-9);
  assert.ok(Math.abs(r.estimate.estimatedDailyCalories - (2100 - 5 * 7700 / 91)) < 1e-9);
});

test('valid bulk at a reasonable pace', () => {
  // 2 kg in 84 days at 70 kg = 0.24 %/week, well under the 0.75 % review line.
  const r = validateGoal({ ...base, goalType: 'bulk', targetWeightKg: 72, targetDate: inDays(84) });
  assert.equal(r.allowed, true, JSON.stringify(r));
  assert.ok(r.estimate.dailyAdjustmentKcal > 0);
  assert.ok(r.estimate.estimatedDailyCalories > 2100);
});

test('maintenance: target equals TDEE, no date needed', () => {
  const r = validateGoal({ ...base, goalType: 'maintain', targetWeightKg: undefined, targetDate: undefined });
  assert.equal(r.status, STATUS.VALID);
  assert.equal(r.estimate.estimatedDailyCalories, 2100);
  assert.equal(r.estimate.dailyAdjustmentKcal, 0);
});

test('maintenance with a different goal weight is allowed with a warning', () => {
  const r = validateGoal({ ...base, goalType: 'maintain', targetWeightKg: 65 });
  assert.equal(r.status, STATUS.WARNING);
  assert.equal(r.allowed, true);
  assert.deepEqual(warnCodes(r), [CODES.MAINTAIN_TARGET_IGNORED]);
});

test('target weight equal to current weight cannot be a cut or a bulk', () => {
  for (const goalType of ['cut', 'bulk']) {
    const r = validateGoal({ ...base, goalType, targetWeightKg: 70, targetDate: inDays(91) });
    assert.equal(r.status, STATUS.INVALID_INPUT);
    assert.deepEqual(codes(r), [goalType === 'cut' ? CODES.CUT_TARGET_NOT_LOWER : CODES.BULK_TARGET_NOT_HIGHER]);
  }
});

test('wrong direction is invalid input', () => {
  assert.deepEqual(codes(validateGoal({ ...base, targetWeightKg: 75, targetDate: inDays(91) })), [CODES.CUT_TARGET_NOT_LOWER]);
  assert.deepEqual(codes(validateGoal({ ...base, goalType: 'bulk', targetDate: inDays(400) })), [CODES.BULK_TARGET_NOT_HIGHER]);
});

test('zero, negative, missing, NaN and infinite values are rejected', () => {
  const bad = [0, -70, undefined, null, NaN, Infinity, -Infinity, '70'];
  for (const v of bad) {
    const w = validateGoal({ ...base, currentWeightKg: v, targetDate: inDays(91) });
    assert.equal(w.status, STATUS.INVALID_INPUT, `weight ${v}`);
    assert.ok(codes(w).includes(CODES.WEIGHT_INVALID), `weight ${v}`);
    const tw = validateGoal({ ...base, targetWeightKg: v, targetDate: inDays(91) });
    assert.ok(codes(tw).includes(CODES.TARGET_WEIGHT_INVALID), `target ${v}`);
    const td = validateGoal({ ...base, tdee: v, targetDate: inDays(91) });
    assert.ok(codes(td).includes(CODES.TDEE_INVALID), `tdee ${v}`);
  }
  assert.ok(codes(validateGoal({ ...base, goalType: 'lose', targetDate: inDays(91) })).includes(CODES.GOAL_TYPE_INVALID));
});

test('values outside product limits are rejected', () => {
  assert.ok(codes(validateGoal({ ...base, currentWeightKg: 29.9, targetWeightKg: 29, targetDate: inDays(91) })).includes(CODES.WEIGHT_OUT_OF_RANGE));
  assert.ok(codes(validateGoal({ ...base, targetWeightKg: 251, goalType: 'bulk', targetDate: inDays(91) })).includes(CODES.TARGET_WEIGHT_OUT_OF_RANGE));
  assert.ok(codes(validateGoal({ ...base, tdee: 7000, targetDate: inDays(91) })).includes(CODES.TDEE_OUT_OF_RANGE));
});

test('past, today, malformed and impossible dates are rejected', () => {
  assert.deepEqual(codes(validateGoal({ ...base, targetDate: inDays(-1) })), [CODES.TARGET_DATE_NOT_FUTURE]);
  assert.deepEqual(codes(validateGoal({ ...base, targetDate: TODAY })), [CODES.TARGET_DATE_NOT_FUTURE]);
  for (const d of ['2027-02-30', '2027/01/01', 'soon', undefined, null, 20270101]) {
    assert.deepEqual(codes(validateGoal({ ...base, targetDate: d })), [CODES.TARGET_DATE_INVALID], String(d));
  }
});

test('timeline length limits, at and around the boundary', () => {
  const { min, max } = GOAL_POLICY.limits.timelineDays;
  assert.deepEqual(codes(validateGoal({ ...base, targetWeightKg: 69.5, targetDate: inDays(min - 1) })), [CODES.TIMELINE_TOO_SHORT]);
  assert.ok(!codes(validateGoal({ ...base, targetWeightKg: 69.5, targetDate: inDays(min) })).includes(CODES.TIMELINE_TOO_SHORT));
  assert.equal(validateGoal({ ...base, targetDate: inDays(max) }).allowed, true);
  assert.deepEqual(codes(validateGoal({ ...base, targetDate: inDays(max + 1) })), [CODES.TIMELINE_TOO_LONG]);
});

test('weekly rate limit for cutting: exactly 1 % passes, just above fails', () => {
  // 70 kg × 1 % = 0.7 kg/week. 7 kg in exactly 70 days = 0.7 kg/week. Use a high TDEE so calories are not the limit.
  const atLimit = validateGoal({ ...base, tdee: 4000, targetWeightKg: 63, targetDate: inDays(70) });
  assert.ok(Math.abs(atLimit.estimate.weeklyRatePercent - 1) < 1e-9);
  assert.equal(atLimit.allowed, true);
  assert.equal(atLimit.status, STATUS.WARNING); // above 75 % of the limit
  assert.deepEqual(warnCodes(atLimit), [CODES.RATE_AGGRESSIVE]);
  const over = validateGoal({ ...base, tdee: 4000, targetWeightKg: 63, targetDate: inDays(69) });
  assert.equal(over.status, STATUS.GOAL_TOO_AGGRESSIVE);
  assert.deepEqual(codes(over), [CODES.RATE_TOO_FAST]);
});

test('aggressive-but-allowed warning starts above 75 % of the limit', () => {
  // 0.75 % of 70 kg = 0.525 kg/week. 7 kg over 100 days = 0.49 kg/week (0.7 %): no warning.
  const calm = validateGoal({ ...base, tdee: 4000, targetWeightKg: 63, targetDate: inDays(100) });
  assert.equal(calm.status, STATUS.VALID);
  const brisk = validateGoal({ ...base, tdee: 4000, targetWeightKg: 63, targetDate: inDays(90) }); // 0.778 %
  assert.equal(brisk.status, STATUS.WARNING);
});

// Bulking tiers (weekly gain as % of body weight): ≤ 0.75 % reasonable, 0.75–1.0 % needs review,
// above 1.0 % extreme. The rate alone never blocks a bulk; the surplus limit (500 kcal) still does.
// A 40 kg person keeps the surplus under 500 kcal up to ~1.16 %/week, so every tier is reachable.
const light = { ...base, goalType: 'bulk', currentWeightKg: 40, tdee: 1800 };

test('bulking up to 0.75 %/week is reasonable', () => {
  // 40 kg × 0.75 % = 0.3 kg/week → 1.2 kg in exactly 28 days.
  const r = validateGoal({ ...light, targetWeightKg: 41.2, targetDate: inDays(28) });
  assert.ok(Math.abs(r.estimate.weeklyRatePercent - 0.75) < 1e-9);
  assert.equal(r.status, STATUS.VALID);
  assert.deepEqual(warnCodes(r), []);
});

test('bulking above 0.75 % up to 1.0 %/week needs review but is allowed', () => {
  const brisk = validateGoal({ ...light, targetWeightKg: 41.2, targetDate: inDays(26) }); // 0.81 %
  assert.equal(brisk.status, STATUS.WARNING);
  assert.equal(brisk.allowed, true);
  assert.deepEqual(warnCodes(brisk), [CODES.RATE_AGGRESSIVE]);
  assert.equal(brisk.warnings[0].params.reviewWeeklyPercent, 0.75);
  const atOne = validateGoal({ ...light, targetWeightKg: 41.6, targetDate: inDays(28) }); // exactly 1.0 %
  assert.equal(atOne.status, STATUS.WARNING);
  assert.deepEqual(warnCodes(atOne), [CODES.RATE_AGGRESSIVE]);
});

test('bulking above 1.0 %/week is extreme, not blocked by the rate alone', () => {
  const r = validateGoal({ ...light, targetWeightKg: 41.7, targetDate: inDays(28) }); // 1.06 %, ≈ 467 kcal/day
  assert.equal(r.status, STATUS.WARNING);
  assert.equal(r.allowed, true);
  assert.deepEqual(codes(r), []);
  assert.deepEqual(warnCodes(r), [CODES.RATE_EXTREME]);
  assert.equal(r.warnings[0].params.extremeWeeklyPercent, 1.0);
});

test('an extreme bulk is still blocked by the surplus limit, and stays flagged as extreme', () => {
  // 70 kg, 3 kg in 28 days = 0.75 kg/week (1.07 %) → 825 kcal/day surplus.
  const r = validateGoal({ ...base, goalType: 'bulk', targetWeightKg: 73, targetDate: inDays(28) });
  assert.equal(r.status, STATUS.CALORIE_LIMIT_EXCEEDED);
  assert.deepEqual(codes(r), [CODES.SURPLUS_TOO_LARGE]);
  assert.ok(warnCodes(r).includes(CODES.RATE_EXTREME));
  // suggested pace: 3 kg / 0.35 kg per week (0.5 %) → 60 days, and the result is reasonable.
  assert.equal(r.suggestion?.days, 60);
  const recheck = validateGoal({ ...base, goalType: 'bulk', targetWeightKg: 73, targetDate: r.suggestion.targetDate });
  assert.equal(recheck.status, STATUS.VALID);
  assert.ok(recheck.estimate.weeklyRatePercent <= GOAL_POLICY.rate.bulk.suggestWeeklyPercent);
});

test('cutting keeps its hard limit: no RATE_EXTREME, RATE_TOO_FAST above 1 %', () => {
  const over = validateGoal({ ...base, tdee: 4000, targetWeightKg: 63, targetDate: inDays(60) });
  assert.deepEqual(codes(over), [CODES.RATE_TOO_FAST]);
  assert.ok(!warnCodes(over).includes(CODES.RATE_EXTREME));
});

test('calorie minimum: below is rejected, at the minimum passes', () => {
  // Female minimum 1200. TDEE 1600 → a 400 kcal/day deficit lands exactly on 1200.
  const f = { ...base, sex: 'female', currentWeightKg: 80, tdee: 1600 };
  const kg = 400 * 140 / 7700; // 140 days at exactly −400/day
  const atMin = validateGoal({ ...f, targetWeightKg: 80 - kg, targetDate: inDays(140) });
  assert.ok(Math.abs(atMin.estimate.estimatedDailyCalories - 1200) < 1e-6);
  assert.equal(atMin.allowed, true, JSON.stringify(atMin.errors));
  const below = validateGoal({ ...f, targetWeightKg: 80 - kg, targetDate: inDays(139) });
  assert.equal(below.status, STATUS.CALORIE_LIMIT_EXCEEDED);
  assert.deepEqual(codes(below), [CODES.CALORIES_BELOW_MINIMUM]);
});

test('a plan whose calories would be zero or negative is rejected, never clamped', () => {
  const r = validateGoal({ ...base, targetWeightKg: 60, targetDate: inDays(30) });
  assert.ok(r.estimate.estimatedDailyCalories <= 0);
  assert.equal(r.allowed, false);
  assert.ok(codes(r).includes(CODES.CALORIES_BELOW_MINIMUM));
  assert.equal(r.estimate.estimatedDailyCalories, 2100 - 10 * 7700 / 30); // untouched
});

test('the surplus limit does not apply at or under the 1 %/week extreme line', () => {
  // Heavy person: 0.25 %/week of 200 kg = 0.5 kg/week ≈ 550 kcal/day, over 500 but a reasonable rate.
  const heavy = validateGoal({ ...base, goalType: 'bulk', currentWeightKg: 200, targetWeightKg: 205, tdee: 4000, targetDate: inDays(70) });
  assert.equal(heavy.status, STATUS.VALID);
  // 70 kg, +7 kg in 92 days = 0.53 kg/week (0.76 %) ≈ 586 kcal/day: needs review, not blocked.
  const review = validateGoal({ ...base, goalType: 'bulk', targetWeightKg: 77, targetDate: inDays(92) });
  assert.equal(review.status, STATUS.WARNING);
  assert.equal(review.allowed, true);
  assert.deepEqual(warnCodes(review), [CODES.RATE_AGGRESSIVE]);
});

test('missing sex or age gives insufficient_information, minors get policy_restricted', () => {
  const noSex = validateGoal({ ...base, sex: undefined, targetDate: inDays(91) });
  assert.equal(noSex.status, STATUS.INSUFFICIENT_INFORMATION);
  assert.equal(noSex.allowed, false);
  const noAge = validateGoal({ ...base, age: undefined, targetDate: inDays(91) });
  assert.equal(noAge.status, STATUS.INSUFFICIENT_INFORMATION);
  const minor = validateGoal({ ...base, age: 17, targetDate: inDays(91) });
  assert.equal(minor.status, STATUS.POLICY_RESTRICTED);
  assert.deepEqual(codes(minor), [CODES.AGE_BELOW_MINIMUM]);
  assert.equal(validateGoal({ ...base, age: 17, goalType: 'maintain' }).allowed, true);
});

test('suggested timeline: the stricter limit wins and the suggestion passes validation', () => {
  const r = validateGoal({ ...base, targetDate: inDays(30) });
  assert.equal(r.allowed, false);
  assert.ok(r.suggestion, 'expected a suggestion');
  // suggested pace: 5 kg / 0.35 kg per week (0.5 %) → 100 days; calories: 5 × 7700 / (2100 − 1500) → 65 days.
  assert.equal(r.suggestion.days, 100);
  assert.equal(r.suggestion.targetDate, inDays(100));
  const recheck = validateGoal({ ...base, targetDate: r.suggestion.targetDate });
  assert.equal(recheck.status, STATUS.VALID);
  assert.ok(recheck.estimate.weeklyRatePercent <= GOAL_POLICY.rate.cut.suggestWeeklyPercent);
  assert.ok(recheck.estimate.estimatedDailyCalories >= 1500);
});

test('suggestion when the calorie minimum is the stricter one', () => {
  // 5 kg with 200 kcal/day of room: 5 × 7700 / 200 → 193 days, longer than the 100 days the pace needs.
  const s = suggestFeasibleTimeline({ ...base, tdee: 1700 });
  assert.equal(s.ok, true);
  assert.equal(s.days, 193);
});

test('suggestion when the rate is the stricter one', () => {
  const s = suggestFeasibleTimeline({ ...base, tdee: 4000, targetWeightKg: 63 });
  assert.equal(s.ok, true);
  assert.equal(s.days, 140); // 7 kg / 0.35 kg per week
});

test('no suggestion when no timeline can work, with the reason', () => {
  // TDEE at the minimum: there is no room for any deficit.
  const r = validateGoal({ ...base, tdee: 1500, targetDate: inDays(91) });
  assert.equal(r.allowed, false);
  assert.equal(r.suggestion, undefined);
  assert.deepEqual(warnCodes(r), [CODES.NO_FEASIBLE_TIMELINE]);
  assert.equal(r.warnings[0].params.reason, 'tdee_below_minimum');
  // Too far for the maximum timeline: 40 kg with only 200 kcal/day of room above the minimum
  // needs 40 × 7700 / 200 = 1540 days, more than the 1095-day maximum.
  const far = suggestFeasibleTimeline({ ...base, currentWeightKg: 80, targetWeightKg: 40, tdee: 1700 });
  assert.deepEqual(far, { ok: false, reason: 'exceeds_max_timeline' });
  // Not offered for invalid input or minors.
  assert.equal(validateGoal({ ...base, targetDate: inDays(-5) }).suggestion, undefined);
});

test('validateGoal never mutates its input', () => {
  const input = Object.freeze({ ...base, targetDate: inDays(30) });
  validateGoal(input);
  assert.equal(input.targetDate, inDays(30));
});

test('macros add up to the calorie target within rounding', () => {
  for (const goalType of ['cut', 'bulk', 'maintain']) {
    for (const calories of [1200, 1500, 1834.6, 2100, 2750, 3600]) {
      for (const weightKg of [45, 70, 110, 160]) {
        const m = calculateMacroTargets({ calories, weightKg, goalType });
        const kcal = m.protein * 4 + m.carbs * 4 + m.fat * 9;
        assert.ok(Math.abs(kcal - calories) <= 4.5, `${goalType} ${calories} ${weightKg}: ${kcal}`);
        assert.ok(m.protein >= 0 && m.carbs >= 0 && m.fat >= 0);
        assert.ok(m.protein * 4 <= calories * GOAL_POLICY.macros.maxProteinShare + 2);
      }
    }
  }
});

test('macros: protein follows body weight and goal, fat keeps its floor', () => {
  const cut = calculateMacroTargets({ calories: 2000, weightKg: 70, goalType: 'cut' });
  assert.equal(cut.protein, 140); // 2.0 g/kg
  const maintain = calculateMacroTargets({ calories: 2400, weightKg: 70, goalType: 'maintain' });
  assert.equal(maintain.protein, 112); // 1.6 g/kg
  const heavyLowCal = calculateMacroTargets({ calories: 1500, weightKg: 120, goalType: 'cut' });
  assert.ok(heavyLowCal.fat >= Math.round(1500 * 0.25 / 9));
  assert.equal(calculateMacroTargets({ calories: 0, weightKg: 70, goalType: 'cut' }), null);
});

test('resolveDailyTarget: valid plan, drifted plan, reached goal, legacy profile', () => {
  const profile = { goal: 'cut', weight: 70, targetWeight: 65, goalDate: inDays(91), tdee: 2100, gender: 'male', age: 21 };
  const ok = resolveDailyTarget(profile, TODAY);
  assert.equal(ok.planStatus, 'ok');
  assert.ok(Math.abs(ok.target - (2100 - 5 * 7700 / 91)) < 1e-9);

  // Too little time left: falls back to the largest safe change, never below the minimum.
  const rushed = resolveDailyTarget({ ...profile, goalDate: inDays(20) }, TODAY);
  assert.equal(rushed.planStatus, 'needs_review');
  assert.ok(rushed.target >= 1500);
  assert.ok(rushed.goalChange >= -600 - 1e-9 && rushed.goalChange < 0);

  const reached = resolveDailyTarget({ ...profile, weight: 64.9 }, TODAY);
  assert.equal(reached.planStatus, 'needs_review');
  assert.equal(reached.goalChange, 0);

  const legacy = resolveDailyTarget({ ...profile, goalDate: undefined }, TODAY);
  assert.equal(legacy.planStatus, 'no_plan');
  assert.equal(legacy.goalChange, -400);

  const adapted = resolveDailyTarget({ ...profile, targetAdjustment: -2000 }, TODAY);
  assert.equal(adapted.target, 1500); // adaptive adjustment stops at the minimum
});

test('date helpers', () => {
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(calculateGoalNumbers({ goalType: 'maintain', currentWeightKg: 70, tdee: 2000 }).estimatedDailyCalories, 2000);
});

test('metric / imperial: a plan entered in lb validates the same as in kg', () => {
  const LB = 2.20462262;
  const fromLb = lb => lb / LB;
  const kgPlan = validateGoal({ ...base, targetDate: inDays(91) });
  const lbPlan = validateGoal({ ...base, currentWeightKg: fromLb(70 * LB), targetWeightKg: fromLb(65 * LB), targetDate: inDays(91) });
  assert.equal(lbPlan.status, kgPlan.status);
  assert.ok(Math.abs(lbPlan.estimate.estimatedDailyCalories - kgPlan.estimate.estimatedDailyCalories) < 1e-6);
});
