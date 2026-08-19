/**
 * Unit tests for the pure helpers and Zod schemas exported from
 * `app/routes/add.tsx`. Covers both the earlier add-flow usability round
 * (throttled-search messaging, human grams-field error messages, the
 * household-portion hidden-field round-trip, per-100g/per-serving manual
 * entry, recent/custom/curated grouping) and the search-readability round
 * (readable/reordered curated names, discriminating match-tier badge,
 * one net-carb number per row, relative-size fallback portion chips, a
 * meal-select trigger that matches its own dropdown, and non-contradictory
 * manual-add copy).
 *
 * Post-M129/05 these helpers no longer own their English — they take a `t` and
 * return whatever the active catalog holds. The assertions below therefore pin
 * the STRUCTURE that survives translation (which key is chosen for which
 * input, which interpolation values reach it, which fields are skipped); the
 * wording itself is now the English catalog's contract, not the code's.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWithZod } from '@conform-to/zod/v4';

import {
  MACRO_FIELD_LABEL_KEYS,
  MEAL_LABEL_KEYS,
  createLogSchema,
  createManualSchema,
  deriveFallbackPortionChoices,
  describeSearchPause,
  groupCandidatesBySource,
  orderCuratedMatchesForReadability,
  searchEmptyMessage,
  type AddSearchCandidate,
  type Translate,
} from '../../app/routes/add';
import type { Macros } from '../../app/lib/macros';
import type { FoodMatch } from '../../app/services/food-resolution';

/**
 * Stub translator: echoes the key plus every interpolation value it was
 * handed. Catalog-independent (so these tests never depend on wording), while
 * still surfacing a value that leaked into a message — a raw millisecond
 * figure reaching `describeSearchPause`'s copy would show up as digits here.
 */
const stubT: Translate = (key, params) => {
  if (!params) return key;
  const rendered = Object.entries(params)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',');
  return `${key}(${rendered})`;
};

/** The portion-step schema under the stub translator. */
const LogSchema = createLogSchema(stubT);
/** The manual-entry schema under the stub translator. */
const ManualSchema = createManualSchema(stubT);

function macros(overrides: Partial<Macros> = {}): Macros {
  return { carbs: 5, fiber: 1, sugars: null, polyols: null, protein: 10, fat: 2, kcal: 80, ...overrides };
}

function candidate(overrides: Partial<AddSearchCandidate> = {}): AddSearchCandidate {
  return {
    source: 'curated',
    name: 'Chicken breast',
    macrosPer100g: macros(),
    authoritativeNetCarbsPer100g: 4,
    defaultGrams: 100,
    defaultPortion: null,
    curatedSource: 'lowcarbcheck:chicken-breast',
    foodId: null,
    aiEstimated: false,
    imageUrl: null,
    timesLogged: 0,
    url: null,
    attribution: null,
    matchTier: 'strong',
    ...overrides,
  };
}

/** Minimal valid LogSchema FormData — override individual fields per test. */
function logFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('name', 'Egg');
  fd.set('quantityGrams', '100');
  fd.set('aiEstimated', 'false');
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

/** Minimal valid ManualSchema FormData — override individual fields per test. */
function manualFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('name', 'Protein bar');
  fd.set('quantityGrams', '50');
  fd.set('macroBasis', 'per100g');
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe('describeSearchPause', () => {
  it('never surfaces a raw millisecond figure — it picks a phrase, it does not interpolate the wait', () => {
    for (const ms of [null, 0, 5_000, 20_000, 90_000, 600_000]) {
      const message = describeSearchPause(ms, stubT);
      assert.equal(/\d/.test(message), false, `expected no digits in "${message}"`);
    }
  });

  it('treats an unknown wait the same as a short one', () => {
    assert.equal(describeSearchPause(null, stubT), describeSearchPause(5_000, stubT));
  });

  it('scales the phrasing with the reported wait — a distinct key per band', () => {
    assert.equal(describeSearchPause(10_000, stubT), 'add.search.pause.seconds');
    assert.equal(describeSearchPause(60_000, stubT), 'add.search.pause.minute');
    assert.equal(describeSearchPause(300_000, stubT), 'add.search.pause.minutes');
  });
});

describe('searchEmptyMessage', () => {
  it('never implies a food does not exist when a query was actually typed — the query itself reaches the copy', () => {
    const message = searchEmptyMessage({ query: 'brocoli', hasAnyRecent: false, t: stubT });
    assert.match(message, /brocoli/);
  });

  it('gives a brand-new visitor a different message than a returning one', () => {
    const firstTime = searchEmptyMessage({ query: '', hasAnyRecent: false, t: stubT });
    const returning = searchEmptyMessage({ query: '', hasAnyRecent: true, t: stubT });
    assert.equal(firstTime.length > 0, true);
    assert.notEqual(firstTime, returning);
  });
});

describe('groupCandidatesBySource', () => {
  it('splits recent/custom/curated into their own buckets, preserving order within each', () => {
    const list: AddSearchCandidate[] = [
      candidate({ source: 'recent', name: 'A' }),
      candidate({ source: 'curated', name: 'B' }),
      candidate({ source: 'custom', name: 'C' }),
      candidate({ source: 'recent', name: 'D' }),
    ];
    const grouped = groupCandidatesBySource(list);
    assert.deepEqual(
      grouped.recent.map((c) => c.name),
      ['A', 'D'],
    );
    assert.deepEqual(
      grouped.custom.map((c) => c.name),
      ['C'],
    );
    assert.deepEqual(
      grouped.curated.map((c) => c.name),
      ['B'],
    );
  });

  it('returns empty buckets for a source with no candidates', () => {
    const grouped = groupCandidatesBySource([candidate({ source: 'recent' })]);
    assert.equal(grouped.custom.length, 0);
    assert.equal(grouped.curated.length, 0);
  });
});

describe('LogSchema quantityGrams — human messages, never a raw Zod error', () => {
  it('rejects a blank field with a plain sentence', () => {
    const result = parseWithZod(logFormData({ quantityGrams: '' }), { schema: LogSchema });
    assert.equal(result.status, 'error');
    assert.deepEqual(result.status === 'error' ? result.error?.quantityGrams : undefined, [
      'add.errors.gramsRequired',
    ]);
  });

  it('rejects a non-numeric field with a plain sentence (not "received NaN")', () => {
    const result = parseWithZod(logFormData({ quantityGrams: 'abc' }), { schema: LogSchema });
    assert.equal(result.status, 'error');
    const messages = result.status === 'error' ? (result.error?.quantityGrams ?? []) : [];
    assert.equal(messages.length, 1);
    assert.equal(messages[0], 'add.errors.gramsNotANumber');
    assert.equal(/NaN|undefined|Invalid input/.test(messages.join(' ')), false);
  });

  it('rejects zero/negative grams with the same message as before', () => {
    const result = parseWithZod(logFormData({ quantityGrams: '0' }), { schema: LogSchema });
    assert.equal(result.status, 'error');
    assert.deepEqual(
      result.status === 'error' ? result.error?.quantityGrams : undefined,
      ['add.errors.gramsNotPositive'],
    );
  });

  it('accepts a normal positive value', () => {
    const result = parseWithZod(logFormData({ quantityGrams: '150.5' }), { schema: LogSchema });
    assert.equal(result.status, 'success');
    assert.equal(result.status === 'success' ? result.value.quantityGrams : null, 150.5);
  });
});

describe('LogSchema portion — hidden-field round-trip', () => {
  it('carries a chosen display portion through as a structured value', () => {
    const portion = { unit: 'egg', quantity: 2, gramsPerUnit: 50 };
    const result = parseWithZod(logFormData({ quantityGrams: '100', portion: JSON.stringify(portion) }), {
      schema: LogSchema,
    });
    assert.equal(result.status, 'success');
    assert.deepEqual(result.status === 'success' ? result.value.portion : undefined, portion);
  });

  it('fails open to no portion (grams-only) on a blank field', () => {
    const result = parseWithZod(logFormData({ quantityGrams: '100', portion: '' }), { schema: LogSchema });
    assert.equal(result.status, 'success');
    assert.equal(result.status === 'success' ? result.value.portion : 'missing', undefined);
  });

  it('fails open to no portion on malformed JSON rather than rejecting the whole log', () => {
    const result = parseWithZod(logFormData({ quantityGrams: '100', portion: 'not json' }), { schema: LogSchema });
    assert.equal(result.status, 'success');
    assert.equal(result.status === 'success' ? result.value.portion : 'missing', undefined);
  });
});

describe('ManualSchema macroBasis/servingGrams — package-label entry', () => {
  it('defaults to per100g when the basis field is missing entirely', () => {
    const fd = manualFormData();
    fd.delete('macroBasis');
    const result = parseWithZod(fd, { schema: ManualSchema });
    assert.equal(result.status, 'success');
    assert.equal(result.status === 'success' ? result.value.macroBasis : null, 'per100g');
  });

  it('carries perServing + servingGrams through untouched — conversion happens in the action, not the schema', () => {
    const result = parseWithZod(
      manualFormData({ macroBasis: 'perServing', servingGrams: '30', carbs: '12' }),
      { schema: ManualSchema },
    );
    assert.equal(result.status, 'success');
    if (result.status !== 'success') return;
    assert.equal(result.value.macroBasis, 'perServing');
    assert.equal(result.value.servingGrams, 30);
    assert.equal(result.value.carbs, 12);
  });

  it('rejects a blank grams field with the same human message as LogSchema', () => {
    const result = parseWithZod(manualFormData({ quantityGrams: '' }), { schema: ManualSchema });
    assert.equal(result.status, 'error');
    assert.deepEqual(
      result.status === 'error' ? result.error?.quantityGrams : undefined,
      ['add.errors.gramsRequired'],
    );
  });
});

/** Minimal valid FoodMatch — override individual fields per test. */
function foodMatch(overrides: Partial<FoodMatch> = {}): FoodMatch {
  return {
    slug: 'eggs-boiled',
    locale: 'en',
    title: 'Eggs boiled',
    canonicalName: 'Eggs boiled',
    url: null,
    imageUrl: null,
    macrosPer100g: { kcal: 155, protein: 13, fat: 11, carbs: 1.1, fiber: 0, sugars: 1.1, polyols: null },
    netCarbsPer100g: 1.1,
    attribution: null,
    score: 0.9,
    origin: 'bls',
    portionSize: 50,
    ...overrides,
  };
}

describe('orderCuratedMatchesForReadability', () => {
  it('ranks a plain preparation above a heavily annotated one at the same relevance tier', () => {
    const plain = foodMatch({ title: 'Eggs boiled', score: 0.85 });
    const verbose = foodMatch({
      title: 'Eggs boiled, with remoulade sauce, diluted with cream and mustard',
      score: 0.85,
    });
    const ordered = orderCuratedMatchesForReadability([verbose, plain]);
    assert.deepEqual(
      ordered.map((match) => match.title),
      ['Eggs boiled', 'Eggs boiled, with remoulade sauce, diluted with cream and mustard'],
    );
  });

  it('never re-sorts genuinely-different scores — even a plainer, lower-scored match stays behind a stronger one, in whatever order the server gave them', () => {
    // The server's relevance order is authoritative (see the function's doc
    // comment) — this is NOT a defensive resort. Passed already in the
    // server's own score-descending order, a distinct-score pair must come
    // back untouched, however "nicer" the lower-scored title reads.
    const strongButVerbose = foodMatch({ title: 'Eggs boiled, with sauce, diluted', score: 0.9 });
    const weakButPlain = foodMatch({ title: 'Eggs', score: 0.5 });
    const ordered = orderCuratedMatchesForReadability([strongButVerbose, weakButPlain]);
    assert.deepEqual(
      ordered.map((match) => match.title),
      ['Eggs boiled, with sauce, diluted', 'Eggs'],
    );
  });

  it('never invents, edits, or drops a match — only reorders the input', () => {
    const matches = [foodMatch({ title: 'A', score: 0.9 }), foodMatch({ title: 'B', score: 0.7 })];
    const ordered = orderCuratedMatchesForReadability(matches);
    assert.equal(ordered.length, matches.length);
    assert.deepEqual(new Set(ordered.map((m) => m.title)), new Set(['A', 'B']));
  });

  it('preserves original order when tier and complexity both tie', () => {
    const matches = [foodMatch({ title: 'A', score: 0.9 }), foodMatch({ title: 'B', score: 0.9 })];
    const ordered = orderCuratedMatchesForReadability(matches);
    assert.deepEqual(
      ordered.map((m) => m.title),
      ['A', 'B'],
    );
  });

  it('surfaces the plainest preparation first even with no commas to key off (live "eggs" search shape — every row scored identically)', () => {
    const matches = [
      foodMatch({ title: 'Eggs in frying batter fried', score: 0.9 }),
      foodMatch({ title: 'Eggs with cheese gratinated', score: 0.9 }),
      foodMatch({ title: 'Eggs boiled', score: 0.9 }),
      foodMatch({ title: 'Eggs boiled, salted', score: 0.9 }),
    ];
    const ordered = orderCuratedMatchesForReadability(matches);
    assert.equal(ordered[0]?.title, 'Eggs boiled');
  });
});

describe('deriveFallbackPortionChoices', () => {
  it('offers small/medium/large chips, each stating its own gram weight', () => {
    const choices = deriveFallbackPortionChoices(100, stubT);
    // The gram weight is interpolated INTO the label, never left implicit —
    // that is the whole point of these chips (see the function's doc).
    assert.deepEqual(
      choices.map((c) => c.label),
      [
        'add.portion.fallback.small(grams=75)',
        'add.portion.fallback.medium(grams=100)',
        'add.portion.fallback.large(grams=150)',
      ],
    );
    assert.deepEqual(
      choices.map((c) => c.grams),
      [75, 100, 150],
    );
  });

  it('never offers two chips for the same gram weight (rounding collision)', () => {
    const choices = deriveFallbackPortionChoices(2, stubT);
    const grams = choices.map((c) => c.grams);
    assert.deepEqual(grams, Array.from(new Set(grams)), 'expected no duplicate gram values');
  });

  it('never offers a zero or negative gram weight', () => {
    const choices = deriveFallbackPortionChoices(1, stubT);
    for (const choice of choices) assert.equal(choice.grams > 0, true);
  });
});

describe('MEAL_LABEL_KEYS — trigger, dropdown and add-toast must agree', () => {
  it('covers every meal type plus the "no meal" state, so no surface has to invent its own label', () => {
    assert.deepEqual(Object.keys(MEAL_LABEL_KEYS).toSorted(), [
      'breakfast',
      'dinner',
      'lunch',
      'none',
      'snack',
    ]);
  });

  it('gives each state its own key — never renders the raw lowercase enum value', () => {
    const keys = Object.values(MEAL_LABEL_KEYS);
    assert.equal(new Set(keys).size, keys.length, 'expected a distinct key per meal state');
    for (const [meal, key] of Object.entries(MEAL_LABEL_KEYS)) {
      assert.equal(key, `add.meal.${meal}`);
    }
  });
});

describe('MACRO_FIELD_LABEL_KEYS — every field is a translated label, never a bare macro key', () => {
  it('maps all seven macro fields to their own key', () => {
    const keys = Object.fromEntries(MACRO_FIELD_LABEL_KEYS);
    assert.deepEqual(Object.keys(keys).toSorted(), ['carbs', 'fat', 'fiber', 'kcal', 'polyols', 'protein', 'sugars']);
    assert.equal(new Set(Object.values(keys)).size, 7, 'expected a distinct key per macro field');
  });

  it('never renders the raw macro key itself — the jargon-prone two get a label key like every other field', () => {
    const keys = Object.fromEntries(MACRO_FIELD_LABEL_KEYS);
    assert.equal(keys.kcal, 'add.macros.kcal');
    assert.equal(keys.polyols, 'add.macros.polyols');
  });
});
