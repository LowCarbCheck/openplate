/**
 * The seed diary generator (`scripts/lib/seed-diary.ts`).
 *
 * TWO CLAIMS ARE UNDER TEST, and they are different claims. The first is that
 * the generator is DETERMINISTIC, because that is what makes a screenshot diff
 * between two runs mean a real UI change. The second is that what it produces
 * is actually restorable, and that one is asserted through the APP'S OWN
 * validator (`parseBackupEnvelope` then `migrateEnvelopeForward`) rather than
 * by reading the object: a fixture that only ever passes a hand-written check
 * is a fixture that fails on the day somebody uploads it.
 *
 * The states are asserted too. A generator that produced twenty-one identical
 * days would satisfy every determinism check in this file and be worthless for
 * the thing it exists for, so the day totals are checked against the bands
 * their carb levels name, and the empty day is checked for by ABSENCE of entries,
 * never by a zero total. Those are different facts, and every chart in the app
 * has to tell them apart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeedDiary,
  MAX_SEED_WEEKS,
  SEED_DAY_CARB_LEVEL_CYCLE,
  SEED_GOALS,
  seedDayCarbLevel,
  solveAnchorGrams,
  summarizeSeedDiary,
} from '../../scripts/lib/seed-diary';
import { migrateEnvelopeForward, parseBackupEnvelope, serializeBackup } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import { computeNetCarbsFromParts } from '../../app/lib/net-carbs';

/** A fixed end day, so every assertion below is about the generator and never about the calendar. */
const END_DAY = '2026-05-14';
const TIMEZONE = 'Europe/Berlin';

function build(overrides: { weeks?: number; seed?: string; endDay?: string } = {}) {
  return buildSeedDiary({
    weeks: overrides.weeks ?? 3,
    seed: overrides.seed ?? 'openplate-seed',
    endDay: overrides.endDay ?? END_DAY,
    timezone: TIMEZONE,
  });
}

test('the same seed and end day produce a byte-identical envelope', () => {
  assert.equal(serializeBackup(build()), serializeBackup(build()));
});

test('a different seed produces a different diary', () => {
  assert.notEqual(serializeBackup(build()), serializeBackup(build({ seed: 'another-seed' })));
});

test('the envelope parses through the app own backup validator', () => {
  const restored = migrateEnvelopeForward(parseBackupEnvelope(serializeBackup(build())));
  assert.equal(restored.schemaVersion, SCHEMA_VERSION);
  assert.ok(restored.data.foodLogs.length > 0, 'the validated payload carries entries');
});

test('the envelope is stamped with the app own schema version, never a literal', () => {
  assert.equal(build().schemaVersion, SCHEMA_VERSION);
});

test('the requested number of weeks lands as whole calendar days', () => {
  for (const weeks of [1, 2, 6]) {
    const summary = summarizeSeedDiary(build({ weeks }));
    assert.equal(summary.dayCount, weeks * 7, `${weeks} weeks is ${weeks * 7} days`);
    assert.equal(summary.lastDay, END_DAY);
  }
});

test('weeks outside the supported range are refused rather than clamped', () => {
  assert.throws(() => build({ weeks: 0 }), /between 1 and/);
  assert.throws(() => build({ weeks: MAX_SEED_WEEKS + 1 }), /between 1 and/);
});

test('every week carries an unlogged day, and it is unlogged rather than zero', () => {
  const envelope = build({ weeks: 3 });
  const summary = summarizeSeedDiary(envelope);
  assert.equal(summary.emptyDayCount, 3, 'one empty day per week');

  // The claim that matters: no entry exists on that day at all. A day total of
  // zero would also read as `0` in `netCarbsByDay`, and the two are different
  // facts about a person's diary.
  const loggedDays = new Set(envelope.data.foodLogs.map((log) => log.dayKey));
  const emptyDays = summary.netCarbsByDay
    .map((_total, index) => index)
    .filter((index) => summary.netCarbsByDay[index] === 0);
  assert.equal(emptyDays.length, 3);
  for (const index of emptyDays) {
    const dayKey = shiftDayKey(summary.firstDay, index);
    assert.ok(!loggedDays.has(dayKey), `${dayKey} has no entries`);
  }
});

test('the most recent day is always logged, so the dashboard is never empty', () => {
  for (const weeks of [1, 2, 3, 6]) {
    const envelope = build({ weeks });
    const loggedDays = new Set(envelope.data.foodLogs.map((log) => log.dayKey));
    assert.ok(loggedDays.has(END_DAY), `${weeks} weeks still logs the last day`);
  }
});

test('day totals land in the band their carb level names', () => {
  const ceiling = SEED_GOALS.goalNetCarbsCeilingG;
  const summary = summarizeSeedDiary(build({ weeks: 4 }));
  const lastIndex = summary.netCarbsByDay.length - 1;

  summary.netCarbsByDay.forEach((total, index) => {
    const carbLevel = seedDayCarbLevel(lastIndex - index);
    if (carbLevel === 'empty') {
      assert.equal(total, 0, `an empty day contributes nothing (index ${index})`);
      return;
    }
    if (carbLevel === 'under') {
      assert.ok(total > 0 && total < ceiling * 0.7, `under: ${total} well below ${ceiling}`);
      return;
    }
    if (carbLevel === 'at') {
      assert.ok(total > ceiling * 0.85 && total <= ceiling, `at: ${total} just under ${ceiling}`);
      return;
    }
    assert.ok(total > ceiling, `over: ${total} above ${ceiling}`);
  });
});

test('the carb-level cycle carries all four states, so any whole week has one of each', () => {
  assert.equal(SEED_DAY_CARB_LEVEL_CYCLE.length, 7);
  assert.deepEqual([...new Set(SEED_DAY_CARB_LEVEL_CYCLE)].toSorted(), ['at', 'empty', 'over', 'under']);
  assert.notEqual(seedDayCarbLevel(0), 'empty', 'the last day is never the empty one');
});

test('entries fill all four meal slots and some carry none', () => {
  const logs = build().data.foodLogs;
  const meals = new Set<string | null>(logs.map((log) => log.mealType));
  for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
    assert.ok(meals.has(meal), `something is logged as ${meal}`);
  }
  assert.ok(
    logs.some((log) => log.mealType === null),
    'some entries belong to no meal',
  );
});

test('typed and photographed entries both appear, and only the typed ones claim a source', () => {
  const logs = build().data.foodLogs;
  const photographed = logs.filter((log) => log.source === 'plate_ai');
  const typed = logs.filter((log) => log.source === 'manual');
  assert.ok(photographed.length > 0, 'some entries came from a photograph');
  assert.ok(typed.length > 0, 'some entries were typed');

  for (const log of photographed) {
    assert.equal(log.aiEstimated, true, 'a photographed entry is an AI estimate');
    assert.equal(log.curatedSource, null, 'an estimate has no food database behind it');
    assert.equal(log.attribution, undefined, 'and no licence credit to carry');
  }
});

test('a hand-typed entry leaves the three-state fields ABSENT, never null', () => {
  // Absent means "no upstream source was ever consulted"; `null` means "one was
  // and it had no answer". Seeding the wrong one would misrepresent the very
  // distinction the readers branch on.
  const plain = build().data.foodLogs.find((log) => log.curatedSource === null);
  assert.ok(plain !== undefined);
  assert.equal('attribution' in plain, false);
  assert.equal('netCarbsPer100g' in plain, false);
});

test('goals are set, and the tracking focus follows from them', () => {
  const profile = build().data.profile;
  assert.ok(profile !== null);
  assert.equal(profile.goalNetCarbsCeilingG, SEED_GOALS.goalNetCarbsCeilingG);
  assert.equal(profile.goalProteinFloorG, SEED_GOALS.goalProteinFloorG);
  assert.equal(profile.goalKcalTarget, SEED_GOALS.goalKcalTarget);
  assert.equal(profile.trackingFocus, 'net-carbs');
  assert.ok(profile.onboardingCompletedAt !== null, 'a restored device must not be sent back to onboarding');
});

test('no body metrics are seeded', () => {
  // The fixture makes screens reviewable; it does not invent a person's height,
  // age, sex or reproductive status.
  const profile = build().data.profile;
  assert.ok(profile !== null);
  for (const field of ['heightCm', 'birthYear', 'biologicalSex', 'reproductiveStatus']) {
    assert.equal(field in profile, false, `${field} is not seeded`);
  }
});

test('the weight series is gappy and every entry lands on a diary day', () => {
  const envelope = build({ weeks: 3 });
  const summary = summarizeSeedDiary(envelope);
  const weights = envelope.data.weightEntries;
  assert.ok(weights.length > 1, 'a series, not a single reading');
  assert.ok(weights.length < summary.dayCount, 'not every day is weighed');
  assert.ok(
    weights.some((entry) => entry.dayKey === END_DAY),
    'the last day carries one',
  );
  for (const entry of weights) {
    assert.ok(entry.weightKg > 40 && entry.weightKg < 200, `${entry.weightKg} kg is a plausible reading`);
  }
});

test('personal foods predate every entry that points at one', () => {
  const envelope = build();
  const createdAtById = new Map(envelope.data.foods.map((food) => [food.id, food.createdAt]));
  for (const log of envelope.data.foodLogs) {
    assert.ok(log.foodId !== null);
    const foodCreatedAt = createdAtById.get(log.foodId);
    assert.ok(foodCreatedAt !== undefined, `${log.foodId} exists as a saved food`);
    assert.ok(foodCreatedAt <= log.loggedAt, 'a food is never created after the entry it was logged from');
  }
});

test('every entry is stamped inside the local day it is filed under', () => {
  // The gap this closes: a UTC instant computed with the wrong offset lands an
  // evening meal on the following day, and the diary then shows a day the
  // dashboard does not.
  const envelope = build();
  for (const log of envelope.data.foodLogs) {
    const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date(log.loggedAt));
    assert.equal(localDay, log.dayKey, `${log.name} is filed under the day it was logged on`);
  }
});

test('the summary counts rows rather than trusting the options it was built from', () => {
  const envelope = build({ weeks: 2 });
  const summary = summarizeSeedDiary(envelope);
  assert.equal(summary.foodLogCount, envelope.data.foodLogs.length);
  assert.equal(summary.weightEntryCount, envelope.data.weightEntries.length);
  assert.equal(summary.personalFoodCount, envelope.data.foods.length);

  const recomputed = envelope.data.foodLogs
    .filter((log) => log.dayKey === END_DAY)
    .reduce((total, log) => total + (computeNetCarbsFromParts(log.macros) ?? 0), 0);
  const lastTotal = summary.netCarbsByDay[summary.netCarbsByDay.length - 1];
  assert.ok(lastTotal !== undefined);
  assert.ok(Math.abs(lastTotal - recomputed) < 0.11, 'the summary total is the sum of the day it names');
});

test('the anchor portion is solved to close the gap, and never goes negative', () => {
  assert.equal(solveAnchorGrams({ baseNetCarbs: 10, targetNetCarbs: 25, anchorNetCarbsPer100g: 30 }), 50);
  // The floor: an overshooting day degrades into "slightly over", not into a
  // negative portion of rice.
  assert.equal(solveAnchorGrams({ baseNetCarbs: 40, targetNetCarbs: 25, anchorNetCarbsPer100g: 30 }), 10);
  assert.throws(
    () => solveAnchorGrams({ baseNetCarbs: 0, targetNetCarbs: 25, anchorNetCarbsPer100g: 0 }),
    /net carbohydrate/,
  );
});

/** `YYYY-MM-DD` plus `days`, as UTC calendar arithmetic. Local to this file so the test does not lean on the code it checks. */
function shiftDayKey(dayKey: string, days: number): string {
  const parts = dayKey.split('-').map(Number);
  const [year, month, day] = parts;
  assert.ok(year !== undefined && month !== undefined && day !== undefined);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
