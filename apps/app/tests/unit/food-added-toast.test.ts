/**
 * Unit tests for `#app/lib/food-added-toast` — the add toast's copy and its
 * batching rule (M129/03).
 *
 * Two contracts: the sentence always reports the day's RUNNING net-carb total
 * (that's the whole reason the toast changed), and consecutive adds inside the
 * window collapse into one growing burst rather than stacking — the counsel
 * amendment that a four-item plate is one toast, not four.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import i18next from '../../app/i18n/i18n';
import {
  ADD_BATCH_WINDOW_MS,
  formatFoodAddedToast,
  nextFoodAddedBatch,
  resetFoodAddedBatch,
  showFoodAddedToast,
  type Translate,
} from '../../app/lib/food-added-toast';
import { formatDayLabel } from '../../app/lib/format-day-label';
import { readStatus, resetStatusChannel } from '../../app/lib/status';

/**
 * The REAL catalog. The sentence is the contract, so it is asserted in the
 * language it ships in — a renamed `diary.toast.*` key fails here rather than
 * leaking a raw key into the app's most-seen toast.
 */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

const BASE = { mealLabel: 'Breakfast', netCarbsTotal: 12.4, hasEstimates: false, dayLabel: null, t };

describe('formatFoodAddedToast', () => {
  it('names the food, the meal, and the running total', () => {
    const copy = formatFoodAddedToast({ ...BASE, batch: { count: 1, lastName: 'Greek yogurt', startedAtMs: 0 } });
    assert.equal(copy.title, 'Added Greek yogurt');
    assert.equal(copy.description, 'To Breakfast, 12.4\u00a0g net carbs so far today.');
  });

  it('ends a long name in "…" so the title fits beside an Undo, and keeps a short one whole (M265)', () => {
    const copied = formatFoodAddedToast({
      ...BASE,
      verb: 'copied',
      batch: { count: 1, lastName: 'Dinkelporridge mit Heidelbeeren und Zimt', startedAtMs: 0 },
    });
    assert.equal(copied.title, 'Copied Dinkelporridge mit Heide…');
    // THE CONTROL: the short name of the first case comes through untouched.
    const added = formatFoodAddedToast({ ...BASE, batch: { count: 1, lastName: 'Greek yogurt', startedAtMs: 0 } });
    assert.equal(added.title, 'Added Greek yogurt');
  });

  it('leaves the meal out when the status offers Undo, and keeps the figure and the day (M265)', () => {
    const withUndo = formatFoodAddedToast({
      ...BASE,
      offersUndo: true,
      dayLabel: 'Mon 28 Sept',
      batch: { count: 1, lastName: 'Rice', startedAtMs: 0 },
    });
    assert.equal(withUndo.description, '12.4\u00a0g net carbs on Mon 28 Sept.');
    // THE CONTROL: the same add with no Undo still names the meal.
    const withoutUndo = formatFoodAddedToast({
      ...BASE,
      dayLabel: 'Mon 28 Sept',
      batch: { count: 1, lastName: 'Rice', startedAtMs: 0 },
    });
    assert.equal(withoutUndo.description, 'To Breakfast, 12.4\u00a0g net carbs on Mon 28 Sept.');
  });

  it('ends a past-day line on one period when the date already ends in one (M265)', () => {
    // German abbreviates the weekday and the month with a period, so the date
    // ends in one: "Mo., 28. Sept.". The sentence's own period made it "..".
    const german = i18next.getFixedT('de');
    const deCopy = formatFoodAddedToast({
      ...BASE,
      t: (key, params) => german(key, params ?? {}),
      language: 'de',
      offersUndo: true,
      dayLabel: formatDayLabel('2026-09-28', 'de'),
      batch: { count: 1, lastName: 'Reis', startedAtMs: 0 },
    });
    assert.equal(deCopy.description, '12,4\u00a0g Netto-KH am Mo., 28. Sept.');
    // THE CONTROL: an English date ends in no period, and its line keeps the
    // sentence's one.
    const enCopy = formatFoodAddedToast({
      ...BASE,
      offersUndo: true,
      dayLabel: formatDayLabel('2026-09-28', 'en'),
      batch: { count: 1, lastName: 'Rice', startedAtMs: 0 },
    });
    assert.equal(enCopy.description, '12.4\u00a0g net carbs on Mon 28 Sept.');
  });

  it('collapses a burst into a count', () => {
    const copy = formatFoodAddedToast({ ...BASE, batch: { count: 4, lastName: 'Rice', startedAtMs: 0 } });
    assert.equal(copy.title, 'Added 4 foods');
  });

  it('drops the meal clause when the entry has no meal', () => {
    const copy = formatFoodAddedToast({
      ...BASE,
      mealLabel: null,
      batch: { count: 1, lastName: 'Rice', startedAtMs: 0 },
    });
    assert.equal(copy.description, '12.4\u00a0g net carbs so far today.');
  });

  it('says WHICH day instead of "today" when the entry was back-dated', () => {
    const copy = formatFoodAddedToast({
      ...BASE,
      dayLabel: 'Sun 3 Aug',
      batch: { count: 1, lastName: 'Rice', startedAtMs: 0 },
    });
    assert.equal(copy.description, 'To Breakfast, 12.4\u00a0g net carbs on Sun 3 Aug.');
  });

  it('hedges the total when the day includes AI estimates', () => {
    const copy = formatFoodAddedToast({
      ...BASE,
      hasEstimates: true,
      batch: { count: 1, lastName: 'Rice', startedAtMs: 0 },
    });
    assert.match(copy.description, /~12\.4\u00a0g net carbs so far today\./);
  });

  it('takes a different verb for a copied day without changing the shape', () => {
    const copy = formatFoodAddedToast({ ...BASE, verb: 'copied', batch: { count: 3, lastName: 'Rice', startedAtMs: 0 } });
    assert.equal(copy.title, 'Copied 3 foods');
    assert.match(copy.description, /net carbs so far today\./);
  });

  it('never praises or scolds — the figure speaks for itself', () => {
    const heavy = formatFoodAddedToast({
      ...BASE,
      netCarbsTotal: 220,
      batch: { count: 1, lastName: 'Cake', startedAtMs: 0 },
    });
    assert.ok(!`${heavy.title} ${heavy.description}`.includes('!'));
  });
});

describe('nextFoodAddedBatch', () => {
  it('starts a burst when there is nothing in flight', () => {
    const batch = nextFoodAddedBatch({ previous: null, name: 'Rice', nowMs: 1000 });
    assert.deepEqual(batch, { count: 1, lastName: 'Rice', startedAtMs: 1000 });
  });

  it('folds a fast follow-up into the same burst', () => {
    const first = nextFoodAddedBatch({ previous: null, name: 'Rice', nowMs: 1000 });
    const second = nextFoodAddedBatch({ previous: first, name: 'Chicken', nowMs: 1500 });
    assert.equal(second.count, 2);
    assert.equal(second.lastName, 'Chicken');
    assert.equal(second.startedAtMs, 1000, 'the window is measured from the FIRST add, not the latest');
  });

  it('counts a multi-entry action (a scanned plate) as its real size', () => {
    const batch = nextFoodAddedBatch({ previous: null, name: 'Plate', count: 4, nowMs: 1000 });
    assert.equal(batch.count, 4);
  });

  it('starts fresh once the window has lapsed', () => {
    const first = nextFoodAddedBatch({ previous: null, name: 'Rice', nowMs: 1000 });
    const later = nextFoodAddedBatch({ previous: first, name: 'Chicken', nowMs: 1000 + ADD_BATCH_WINDOW_MS + 1 });
    assert.equal(later.count, 1);
    assert.equal(later.startedAtMs, 1000 + ADD_BATCH_WINDOW_MS + 1);
  });
});

describe('showFoodAddedToast', () => {
  beforeEach(() => {
    resetStatusChannel();
    resetFoodAddedBatch();
  });
  afterEach(() => {
    resetStatusChannel();
    resetFoodAddedBatch();
  });

  const undo = { label: 'Undo', onClick: () => {} };
  const add = { mealLabel: 'Breakfast', netCarbsTotal: 12.4, hasEstimates: false, dayLabel: null, t, action: undo };

  it('publishes an Undo status whose second line leaves the meal out (M265)', () => {
    showFoodAddedToast({ ...add, name: 'Rice', nowMs: 1000 });
    assert.equal(readStatus()?.action, undo);
    assert.equal(readStatus()?.description, '12.4\u00a0g net carbs so far today.');
  });

  it('CONTROL: a collapsed burst offers no Undo and names the meal again', () => {
    showFoodAddedToast({ ...add, name: 'Rice', nowMs: 1000 });
    showFoodAddedToast({ ...add, name: 'Egg', nowMs: 1500 });
    assert.equal(readStatus()?.action, null);
    assert.equal(readStatus()?.description, 'To Breakfast, 12.4\u00a0g net carbs so far today.');
  });
});
