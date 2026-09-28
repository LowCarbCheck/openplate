/**
 * Unit tests for the pure helpers exported from
 * `app/routes/diary.entry.$id.tsx` (M12x diary readability round): combining
 * an edited date + time into an instant (item 4), formatting an instant back
 * into the edit form's `HH:mm` value, and invalidating a stored household
 * portion when the edit changes the entry's grams (item 7). Also covers the
 * durability round's `AttributionNote`/`ProvenanceNote` — the licence-credit
 * round-trip fix (a food logged from a curated, licensed source used to lose
 * its credit the moment it was logged; see `schema.ts`'s `attribution` field
 * doc for the full incident).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  AttributionNote,
  MACRO_FIELD_KEYS,
  MEAL_TYPE_LABEL_KEYS,
  ProvenanceNote,
  combineDateAndTime,
  formatTimeInputValue,
  resolveEditedPortion,
} from '../../app/routes/diary.entry.$id';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

/**
 * Since M129/05 the route holds catalog KEYS, not label copy, so the wording
 * assertions below resolve each key against the English catalog — the same
 * file `i18n-key-parity.test.ts` reads, and read the same way (from disk, not
 * through the i18next instance) so a failure names the missing key rather than
 * silently comparing a key string against a sentence.
 */
/** A translation catalog: nested groups of keys bottoming out in translated strings. */
type Catalog = { [key: string]: string | Catalog };

/** The on-disk catalog, parsed rather than asserted — a stray non-string leaf fails loudly here. */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), catalogSchema])),
);

const leafSchema = z.string();

const EN_CATALOG = catalogSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
);

function englishFor(key: string): string {
  let node: string | Catalog | undefined = EN_CATALOG;
  for (const part of key.split('.')) {
    const group = catalogSchema.safeParse(node);
    if (!group.success) {
      node = undefined;
      break;
    }
    node = group.data[part];
  }
  const leaf = leafSchema.safeParse(node);
  assert.ok(leaf.success, `missing English catalog entry for "${key}"`);
  return leaf.data;
}

describe('combineDateAndTime', () => {
  it('combines a date and time into the matching UTC instant in a zero-offset zone', () => {
    const ms = combineDateAndTime({ date: '2026-07-20', time: '14:32', timezone: 'UTC' });
    assert.equal(new Date(ms).toISOString(), '2026-07-20T14:32:00.000Z');
  });

  it('accounts for a non-UTC time zone offset', () => {
    // New York is UTC-4 in July (EDT), so 09:00 local is 13:00 UTC.
    const ms = combineDateAndTime({ date: '2026-07-20', time: '09:00', timezone: 'America/New_York' });
    assert.equal(new Date(ms).toISOString(), '2026-07-20T13:00:00.000Z');
  });

  it('throws on a malformed time', () => {
    assert.throws(() => combineDateAndTime({ date: '2026-07-20', time: '25:99', timezone: 'UTC' }));
    assert.throws(() => combineDateAndTime({ date: '2026-07-20', time: 'garbage', timezone: 'UTC' }));
  });

  it('round-trips with formatTimeInputValue', () => {
    const ms = combineDateAndTime({ date: '2026-07-20', time: '08:05', timezone: 'UTC' });
    assert.equal(formatTimeInputValue(new Date(ms), 'UTC'), '08:05');
  });
});

describe('formatTimeInputValue', () => {
  it('formats midnight as 00:00, not 24:00', () => {
    assert.equal(formatTimeInputValue(new Date('2026-07-20T00:00:00Z'), 'UTC'), '00:00');
  });

  it('zero-pads single-digit hours and minutes', () => {
    assert.equal(formatTimeInputValue(new Date('2026-07-20T05:07:00Z'), 'UTC'), '05:07');
  });
});

describe('resolveEditedPortion', () => {
  const eggPortion = { unit: 'egg' as const, quantity: 2, gramsPerUnit: 50 };

  it('returns null when there was no existing portion', () => {
    assert.equal(resolveEditedPortion({ existingPortion: null, previousGrams: 100, newGrams: 100 }), null);
  });

  it('keeps the portion unchanged when grams are unchanged (a macro/name/time-only edit)', () => {
    const result = resolveEditedPortion({ existingPortion: eggPortion, previousGrams: 100, newGrams: 100 });
    assert.deepEqual(result, eggPortion);
  });

  it('clears the portion when grams changed (the edit form has no unit-aware chips)', () => {
    const result = resolveEditedPortion({ existingPortion: eggPortion, previousGrams: 100, newGrams: 150 });
    assert.equal(result, null);
  });

  it('tolerates sub-tenth floating point noise as "unchanged"', () => {
    const result = resolveEditedPortion({ existingPortion: eggPortion, previousGrams: 100, newGrams: 100.00001 });
    assert.deepEqual(result, eggPortion);
  });
});

describe('MEAL_TYPE_LABEL_KEYS — trigger and dropdown must agree (jargon round)', () => {
  it('is proper-case for every meal type (never the raw lowercase enum value)', () => {
    for (const [meal, key] of Object.entries(MEAL_TYPE_LABEL_KEYS)) {
      const label = englishFor(key);
      assert.equal(label, label[0]?.toUpperCase() + label.slice(1));
      assert.notEqual(label, meal);
    }
  });
});

describe('MACRO_FIELD_KEYS — plain words, never a bare unit abbreviation (jargon round)', () => {
  it('never labels a field with the raw macro key alone', () => {
    const labels = Object.fromEntries(MACRO_FIELD_KEYS.map(([field, key]) => [field, englishFor(key)]));
    assert.notEqual(labels.kcal, 'Kcal');
    assert.notEqual(labels.polyols, 'Polyols');
  });

  it('spells out calories and sugar alcohols in words a first-time visitor recognizes', () => {
    const labels = Object.fromEntries(MACRO_FIELD_KEYS.map(([field, key]) => [field, englishFor(key)]));
    assert.match(labels.kcal ?? '', /calorie/i);
    assert.match(labels.polyols ?? '', /sugar alcohol/i);
  });
});

/** A minimal, valid `LocalFoodLog` — every required field filled, every optional one defaulted "unset". */
function makeLog(overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id: 'log-1',
    name: 'Boiled eggs',
    quantityGrams: 100,
    macros: { carbs: 1, fiber: 0, sugars: 1, polyols: null, protein: 13, fat: 11, kcal: 155 },
    mealType: null,
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-07-20',
    loggedAt: Date.now(),
    createdAt: Date.now(),
    logBatchId: null,
    ...overrides,
  };
}

function renderComponent(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element);
}

describe('AttributionNote / ProvenanceNote — licence-credit round-trip (durability round)', () => {
  it('renders nothing when the entry has no attribution (manual entry, never had one)', () => {
    const html = renderComponent(createElement(AttributionNote, { log: makeLog() }));
    assert.equal(html, '');
  });

  it('renders the licence credit verbatim when the entry carries one', () => {
    const attribution = 'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)';
    const html = renderComponent(createElement(AttributionNote, { log: makeLog({ attribution }) }));
    assert.ok(html.includes(attribution), 'the exact licence string must appear verbatim');
  });

  it('renders nothing for an existing on-device record that predates the `attribution` field entirely', () => {
    // Simulates a pre-durability-round record: the key is OMITTED from the
    // object, not merely set to null/undefined — exactly what a JSON blob
    // written before this field existed looks like once cast back to
    // `LocalFoodLog` (the same "optional, not just nullable" contract
    // `portion` already established — see schema.ts's SCHEMA_VERSION note).
    const preExistingLog = makeLog();
    delete preExistingLog.attribution;
    assert.ok(!('attribution' in preExistingLog));

    const html = renderComponent(createElement(AttributionNote, { log: preExistingLog }));
    assert.equal(html, '');
  });

  it('ProvenanceNote surfaces the licence credit alongside the curated "From our food database" note', () => {
    const attribution = 'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)';
    const html = renderComponent(
      createElement(ProvenanceNote, { log: makeLog({ curatedSource: 'bls', attribution }) }),
    );
    assert.ok(html.includes('From our food database'));
    assert.ok(html.includes(attribution), 'the licence credit must survive on the entry detail page, not just at add time');
  });

  it('ProvenanceNote surfaces the licence credit alongside an AI-estimated note too', () => {
    const attribution = 'Example Source 1.0, CC BY 4.0';
    const html = renderComponent(
      createElement(ProvenanceNote, { log: makeLog({ aiEstimated: true, attribution }) }),
    );
    assert.ok(html.includes('AI estimated'));
    assert.ok(html.includes(attribution));
  });

  it('ProvenanceNote renders no attribution line for a curated entry that genuinely has none', () => {
    const html = renderComponent(createElement(ProvenanceNote, { log: makeLog({ curatedSource: 'bls' }) }));
    assert.ok(html.includes('From our food database'));
    assert.ok(!html.includes('CC BY'));
  });

  it('ProvenanceNote falls back to "Manual entry." with no attribution line for a plain manual log', () => {
    const html = renderComponent(createElement(ProvenanceNote, { log: makeLog() }));
    assert.ok(html.includes('Manual entry.'));
  });
});

describe('ProvenanceNote — the ADAPTED state (a hand-edited curated entry)', () => {
  const attribution = 'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)';

  /**
   * What `handleSave` leaves behind after a macro edit on a curated entry:
   * `curatedSource` cleared (the numbers are the person's now) but the credit
   * deliberately kept (CC BY covers adaptations). The two rules are each right;
   * together they used to print "Manual entry." above a credit for the database
   * the entry had just stopped claiming.
   */
  const adapted = () => makeLog({ curatedSource: null, aiEstimated: false, attribution });

  it('does not label hand-edited numbers a "Manual entry." while crediting where they came from', () => {
    const html = renderComponent(createElement(ProvenanceNote, { log: adapted() }));
    assert.equal(html.includes('Manual entry.'), false, 'the receipt contradicted itself in two adjacent lines');
    assert.ok(html.includes(attribution), 'and the credit must survive regardless — dropping it is the licence breach');
  });

  it('does not claim unmodified curated provenance for them either', () => {
    const html = renderComponent(createElement(ProvenanceNote, { log: adapted() }));
    assert.equal(html.includes('From our food database'), false);
  });

  it('says whose numbers these are and where they started, in plain words', () => {
    const html = renderComponent(createElement(ProvenanceNote, { log: adapted() }));
    assert.match(html, /Edited by you/);
    assert.match(html, /started from our food database/);
  });

  it('still reads "Manual entry." for a genuinely hand-typed entry with nobody to credit', () => {
    const html = renderComponent(createElement(ProvenanceNote, { log: makeLog() }));
    assert.ok(html.includes('Manual entry.'));
    assert.equal(html.includes('Edited by you'), false);
  });
});
