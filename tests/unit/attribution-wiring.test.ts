/**
 * WIRING guard for `LocalFoodLog.attribution` — the source's licence credit.
 *
 * The field shipped with a READER and no writer at all. `AttributionNote` on
 * the entry detail page was built to render it, `backup.ts` was extended to
 * carry it through an export, `local-quick-add.ts` put it on every curated
 * candidate, and both the add flow and the scan flow displayed it before
 * logging — but nothing ever copied it ONTO the entry. So the credit the
 * receipt was designed to show was, in practice, always absent.
 *
 * That is not a cosmetic gap. CC BY requires the credit to travel with the
 * data wherever the data is shown, and the entry detail page is one of those
 * places; a credit shown once at the moment of adding and then dropped is a
 * disappearing footnote, not compliance. So these tests assert the ROUND TRIP:
 * log an entry from a source carrying a credit, and read the credit back off
 * the persisted entry, verbatim.
 *
 * Sibling of `authoritative-net-carbs-wiring.test.ts` — the same defect class
 * (a value correct at its source, silently dropped by its consumer) one field
 * over. Kept separate because the two fields follow deliberately DIFFERENT
 * rules under a macro edit; see `resolveAppliedMatchSnapshot`.
 *
 * If you are reading this because a test here failed: an entry-creating path
 * stopped copying `attribution`. Re-thread it — this is a licence obligation,
 * not a nicety.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// The real, initialized shared instance — `PortionStep` renders through
// `useTranslation`, and the schema's messages come from the same catalog, so
// the markup asserted below is the actual English the app ships.
import i18next from '../../app/i18n/i18n';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';

import { PortionStep, buildLoggedEntry, createLogSchema, type AddSearchCandidate } from '../../app/routes/add';
import { ConfirmDraftForm, ConfirmDraftSchema, buildConfirmedEntry } from '../../app/routes/scan';
import {
  LogRecentSchema,
  QuickAddChipButton,
  RestoreLogSchema,
  buildCopiedEntry,
  buildRecentLogEntry,
  buildRestoredEntry,
} from '../../app/routes/diary';
import { AttributionNote, ProvenanceNote, buildRestorePayload } from '../../app/routes/diary.entry.$id';
import { matchMacrosToFormValues, toCuratedSource } from '../../app/services/food-resolution/apply-match';
import type { MacroFormValues } from '../../app/services/food-resolution/apply-match';
import {
  computeLocalRecentFoods,
  localCuratedMatchToCandidate,
  localRecentFoodToCandidate,
  selectLocalFrequentChips,
} from '../../app/lib/local-store/local-quick-add';
import { computeEditPatch } from '../../app/lib/log-edit';
import { migrateEnvelopeForward, parseBackupEnvelope, serializeBackup } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION, type LocalFoodLog } from '../../app/lib/local-store/schema';
import { toStoredAttribution } from '../../app/lib/attribution';
import type { FoodMatch } from '../../app/services/food-resolution/types';

/**
 * A real CC BY credit, kept verbatim end to end. The em dash and the "(adapted)"
 * suffix matter: a licence credit is a legal string, so any test that passes on
 * a reworded/truncated/re-cased version would be pinning the wrong thing.
 */
const CREDIT = 'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)';

const SERVING_GRAMS = 100;
const DAY_KEY = '2026-07-28';
const LOGGED_AT_MS = Date.parse(`${DAY_KEY}T12:00:00Z`);

function creditedMatch(overrides: Partial<FoodMatch> = {}): FoodMatch {
  return {
    slug: 'wheat-bran',
    locale: 'en',
    title: 'Wheat bran',
    canonicalName: 'Wheat bran',
    url: null,
    imageUrl: null,
    macrosPer100g: { kcal: 216, protein: 15.6, fat: 4.3, carbs: 21.7, fiber: 42.8, sugars: null, polyols: null },
    netCarbsPer100g: 21.7,
    attribution: CREDIT,
    score: 0.95,
    origin: 'bls',
    portionSize: SERVING_GRAMS,
    ...overrides,
  };
}

function creditedCandidate(overrides: Partial<FoodMatch> = {}): AddSearchCandidate {
  return { ...localCuratedMatchToCandidate(creditedMatch(overrides)), matchTier: 'strong' };
}

const noop = () => undefined;

////////////////////////////////////////////////////////////////////////////////
// The ADD flow (search -> portion step -> logged entry)
////////////////////////////////////////////////////////////////////////////////

/** `PortionStep` calls `useNavigation`, so it needs a data router, not a plain `<MemoryRouter>`. */
function renderPortionStep(candidate: AddSearchCandidate): string {
  const element = createElement(PortionStep, {
    candidate,
    defaultMealType: 'lunch',
    returnTo: '/diary',
    logContext: { date: null, label: null, switchToTodayHref: '/add' },
    lastResult: undefined,
    onBack: noop,
  });
  const router = createMemoryRouter([{ path: '/add', element }], { initialEntries: ['/add'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The hidden input the portion step emits to carry the credit into the log action. */
const ADD_ATTRIBUTION_FIELD = /<input[^>]*name="attribution"[^>]*value="([^"]*)"[^>]*>/;

function emittedAddAttribution(html: string): string {
  const match = ADD_ATTRIBUTION_FIELD.exec(html);
  assert.ok(match, `the portion step emitted no attribution input at all:\n${html.slice(0, 400)}`);
  return match[1] ?? '';
}

/**
 * The REAL add-flow write path: render the portion step, take the credit from
 * the hidden input IT actually emitted (never from the candidate object — that
 * would bypass the wiring under test), submit it through the real `LogSchema`,
 * and build the entry with the real `buildLoggedEntry`.
 */
function logEntryFromAddFlow(candidate: AddSearchCandidate): LocalFoodLog {
  const html = renderPortionStep(candidate);
  const formData = new FormData();
  formData.set('name', candidate.name);
  formData.set('quantityGrams', String(SERVING_GRAMS));
  formData.set('aiEstimated', candidate.aiEstimated ? 'true' : 'false');
  formData.set('curatedSource', candidate.curatedSource ?? '');
  for (const [key, value] of Object.entries(candidate.macrosPer100g)) {
    formData.set(key, value === null ? '' : String(value));
  }
  formData.set('attribution', emittedAddAttribution(html));

  const submission = parseWithZod(formData, { schema: createLogSchema(i18next.t) });
  assert.equal(submission.status, 'success', 'LogSchema rejected the portion-step submission');
  if (submission.status !== 'success') throw new Error('unreachable');

  return buildLoggedEntry({
    data: submission.value,
    id: 'log-1',
    loggedAtMs: LOGGED_AT_MS,
    dayKey: DAY_KEY,
    createdAtMs: LOGGED_AT_MS,
  });
}

describe('a credited food logged from the add flow keeps its credit', () => {
  it('ROUND TRIP: the persisted entry carries the source’s credit verbatim', () => {
    assert.equal(
      logEntryFromAddFlow(creditedCandidate()).attribution,
      CREDIT,
      'the licence credit died between the portion step and the stored entry — the entry detail page will show none',
    );
  });

  it('the entry detail page then actually renders it (the reader this field was built for)', () => {
    const entry = logEntryFromAddFlow(creditedCandidate());
    const html = renderToStaticMarkup(createElement(AttributionNote, { log: entry }));
    assert.ok(html.includes(CREDIT), `the credit is not in the receipt markup:\n${html}`);
  });

  it('stores null — never an empty string — for a source that carries no credit', () => {
    // `AttributionNote` renders nothing for either, but only `null` matches the
    // field's documented "null/absent for sources with no attribution".
    assert.equal(logEntryFromAddFlow(creditedCandidate({ attribution: null })).attribution, null);
  });

  it('stores no credit for a personal (custom) food — the user is the source, there is nobody to credit', () => {
    const custom: AddSearchCandidate = { ...creditedCandidate(), source: 'custom', attribution: null };
    assert.equal(logEntryFromAddFlow(custom).attribution, null);
  });

  it('carries the credit forward when the same food is re-logged from the "Recent" list', () => {
    // The recent row already passes the original entry's `curatedSource`
    // through, so dropping the credit here would leave the new entry claiming a
    // curated source it no longer credits.
    const original = logEntryFromAddFlow(creditedCandidate());
    const [recent] = computeLocalRecentFoods([original], { limit: 5 });
    assert.ok(recent, 'expected one recent food');
    assert.equal(recent.attribution, CREDIT, 'the recent-foods projection dropped the credit');

    const relogged = logEntryFromAddFlow({ ...localRecentFoodToCandidate(recent), matchTier: null });
    assert.equal(relogged.attribution, CREDIT, 'a re-log from Recent silently stripped the credit');
  });
});

////////////////////////////////////////////////////////////////////////////////
// The SCAN confirm flow (AI draft + an applied curated match)
////////////////////////////////////////////////////////////////////////////////

const AI_IDENTIFICATION = {
  foods: [
    {
      name: 'Wheat bran',
      estimatedGrams: SERVING_GRAMS,
      confidence: 'high' as const,
      macrosPer100g: { kcal: 200, protein: 10, fat: 4, carbs: 30, fiber: 5 },
    },
  ],
};

/** The confirm form's field values for one item — `curatedSource` + macros is the post-`applyMatch` state. */
function confirmFormData(overrides: { curatedSource?: string; macros?: MacroFormValues } = {}): FormData {
  const formData = new FormData();
  formData.set('items[0].include', 'on');
  formData.set('items[0].name', 'Wheat bran');
  formData.set('items[0].estimatedGrams', String(SERVING_GRAMS));
  formData.set('items[0].confidence', 'high');
  formData.set('items[0].curatedSource', overrides.curatedSource ?? '');
  const macros = overrides.macros ?? matchMacrosToFormValues(creditedMatch().macrosPer100g);
  for (const [key, value] of Object.entries(macros)) formData.set(`items[0].macros.${key}`, value);
  return formData;
}

/** Renders the real confirm step in the state `formData` describes, via the real re-validation path. */
function renderConfirmStep(formData: FormData): string {
  const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
  const element = createElement(ConfirmDraftForm, {
    identification: AI_IDENTIFICATION,
    modelId: 'test-model',
    matches: [[creditedMatch()]],
    lastResult: submission.reply({ formErrors: ['Select at least one food to log.'] }),
    logDate: null,
    logDateLabel: null,
    photoFile: null,
    userId: 0,
  });
  const router = createMemoryRouter([{ path: '/scan', element }], { initialEntries: ['/scan'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

const CONFIRM_ATTRIBUTION_FIELD = /<input[^>]*name="items\[0\]\.attribution"[^>]*value="([^"]*)"[^>]*>/;

/** Undoes React's SSR attribute escaping, so a rendered hidden input reads back as the string it was. */
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function emittedConfirmAttribution(html: string): string {
  const match = CONFIRM_ATTRIBUTION_FIELD.exec(html);
  assert.ok(match, `the confirm step emitted no items[0].attribution input at all:\n${html.slice(0, 400)}`);
  // Attribute values are HTML-escaped on the way out; compare against the real string.
  return unescapeAttribute(match[1] ?? '');
}

/** The REAL scan write path, taking the credit from the markup the confirm step emitted. */
function confirmedEntryFromScanFlow(formData: FormData): LocalFoodLog {
  const html = renderConfirmStep(formData);
  const submitted = new FormData();
  for (const [key, value] of formData.entries()) submitted.set(key, value);
  submitted.set('items[0].attribution', emittedConfirmAttribution(html));

  const submission = parseWithZod(submitted, { schema: ConfirmDraftSchema });
  assert.equal(submission.status, 'success', 'ConfirmDraftSchema rejected the confirm submission');
  if (submission.status !== 'success') throw new Error('unreachable');
  const item = submission.value.items[0];
  assert.ok(item, 'expected one confirmed item');

  return buildConfirmedEntry({
    item,
    per100g: {
      carbs: item.macros.carbs,
      fiber: item.macros.fiber ?? null,
      sugars: item.macros.sugars ?? null,
      polyols: item.macros.polyols ?? null,
      protein: item.macros.protein ?? null,
      fat: item.macros.fat ?? null,
      kcal: item.macros.kcal ?? null,
    },
    id: 'scan-log-1',
    foodId: 'scan-food-1',
    loggedAtMs: LOGGED_AT_MS,
    dayKey: DAY_KEY,
    createdAtMs: LOGGED_AT_MS,
    logBatchId: 'batch-1',
  });
}

describe('a curated match applied on the scan confirm step keeps its credit', () => {
  const APPLIED = { curatedSource: toCuratedSource('wheat-bran') };

  it('ROUND TRIP: the persisted entry carries the applied match’s credit verbatim', () => {
    assert.equal(
      confirmedEntryFromScanFlow(confirmFormData(APPLIED)).attribution,
      CREDIT,
      'applying a curated match on the confirm step logged the entry without its licence credit',
    );
  });

  it('stores no credit for a plain AI plate estimate — an LLM guess has no source to credit', () => {
    assert.equal(confirmedEntryFromScanFlow(confirmFormData()).attribution, null);
  });

  it('KEEPS the credit after a hand macro edit, unlike the net-carbs figure', () => {
    // Deliberately divergent rules, and the divergence is the point: this flow
    // preserves `curatedSource` through an edit ("still sourced from a curated
    // entry, not an LLM estimate"), and CC BY's obligation covers adaptations —
    // the credit itself literally ends "(adapted)". An entry that still claims
    // curated provenance while dropping the credit is the licence violation.
    const edited = confirmFormData({
      ...APPLIED,
      macros: { ...matchMacrosToFormValues(creditedMatch().macrosPer100g), carbs: '30' },
    });
    const entry = confirmedEntryFromScanFlow(edited);
    assert.equal(
      entry.curatedSource,
      toCuratedSource('wheat-bran'),
      'this flow keeps curated provenance through an edit',
    );
    assert.equal(entry.attribution, CREDIT, 'the credit must not be dropped while the provenance claim remains');
    assert.equal(
      entry.netCarbsPer100g,
      undefined,
      'the net-carbs snapshot, by contrast, DOES withdraw on a macro edit',
    );
  });
});

////////////////////////////////////////////////////////////////////////////////
// The remaining entry-creating paths
////////////////////////////////////////////////////////////////////////////////

function creditedEntry(overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id: 'log-1',
    name: 'Wheat bran',
    quantityGrams: SERVING_GRAMS,
    macros: { carbs: 21.7, fiber: 42.8, sugars: null, polyols: null, protein: 15.6, fat: 4.3, kcal: 216 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: toCuratedSource('wheat-bran'),
    foodId: null,
    dayKey: DAY_KEY,
    loggedAt: LOGGED_AT_MS,
    createdAt: LOGGED_AT_MS,
    logBatchId: null,
    netCarbsPer100g: 21.7,
    attribution: CREDIT,
    ...overrides,
  };
}

/**
 * The Undo toast's payload for a deleted entry, built by the REAL
 * `buildRestorePayload` the receipt's `handleUndo` submits — not a
 * hand-written lookalike. That distinction is the whole point of this file: a
 * mimic can happily carry a field production forgot, which is exactly how this
 * payload lost three of them one at a time.
 */
function restorePayload(log: LocalFoodLog): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(buildRestorePayload(log))) formData.set(name, value);
  return formData;
}

/** The REAL undo-restore write path: the posted payload → `RestoreLogSchema` → `buildRestoredEntry`. */
function restoredEntry(log: LocalFoodLog): LocalFoodLog {
  const submission = parseWithZod(restorePayload(log), { schema: RestoreLogSchema });
  assert.equal(submission.status, 'success', 'RestoreLogSchema rejected the Undo payload');
  if (submission.status !== 'success') throw new Error('unreachable');
  return buildRestoredEntry({
    value: submission.value,
    id: 'restored-1',
    loggedAtMs: log.loggedAt,
    dayKey: log.dayKey,
    createdAtMs: LOGGED_AT_MS,
  });
}

/**
 * The REAL chip re-log write path, all four links: a stored log ->
 * `computeLocalRecentFoods` -> `selectLocalFrequentChips` -> the chip's OWN
 * rendered hidden inputs -> `LogRecentSchema` -> `buildRecentLogEntry`.
 *
 * The fields are read off the markup rather than off the chip object on
 * purpose: a helper that builds its own payload from the chip would sail
 * straight past a deleted hidden input, which is one of the two places this
 * credit has actually gone missing.
 */
function chipRelogEntry(log: LocalFoodLog): LocalFoodLog {
  // Two identical logs so the food clears the diary's real `minTimesLogged: 2` floor.
  const recents = computeLocalRecentFoods([log, { ...log, id: `${log.id}-again` }], { limit: 5 });
  const [chip] = selectLocalFrequentChips(recents, { limit: 4, minTimesLogged: 2 });
  assert.ok(chip, 'expected the logged food to earn a chip');

  const element = createElement(QuickAddChipButton, { chip, date: DAY_KEY });
  const router = createMemoryRouter([{ path: '/diary', element }], { initialEntries: ['/diary'] });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

  const formData = new FormData();
  for (const [tag] of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined) continue;
    formData.set(name, unescapeAttribute(/value="([^"]*)"/.exec(tag)?.[1] ?? ''));
  }

  const submission = parseWithZod(formData, { schema: LogRecentSchema });
  assert.equal(submission.status, 'success', 'LogRecentSchema rejected the chip’s own submission');
  if (submission.status !== 'success') throw new Error('unreachable');
  return buildRecentLogEntry({
    value: submission.value,
    id: 'chip-log-1',
    loggedAtMs: LOGGED_AT_MS,
    mealType: 'lunch',
    createdAtMs: LOGGED_AT_MS,
  });
}

describe('the credit survives every other way an entry is created', () => {
  it('UNDO of a delete restores the credit, not a stripped copy of the entry', () => {
    const restored = restoredEntry(creditedEntry());
    assert.equal(
      restored.attribution,
      CREDIT,
      'Undo brought the entry back without its licence credit — silently, and permanently',
    );
    // The sibling fields ride the same payload; a break in one usually means all.
    assert.equal(restored.netCarbsPer100g, 21.7);
  });

  it('UNDO of a delete restores the chosen PORTION too — an undone "2 eggs" must not come back as "180 g"', () => {
    const portion = { unit: 'egg' as const, quantity: 2, gramsPerUnit: 50 };
    const restored = restoredEntry(creditedEntry({ portion, quantityGrams: 100 }));
    assert.deepEqual(
      restored.portion,
      portion,
      'Undo brought the entry back as bare grams — the person’s own portion choice was dropped in transit',
    );
    // The grams are restored unchanged, which is exactly what keeps the label valid.
    assert.equal(restored.quantityGrams, 100);
  });

  it('UNDO of a grams-only entry restores no portion rather than a fabricated one', () => {
    assert.equal(restoredEntry(creditedEntry({ portion: null })).portion, null);
  });

  it('UNDO of an uncredited entry restores no credit rather than an empty string', () => {
    assert.equal(restoredEntry(creditedEntry({ attribution: null })).attribution, null);
  });

  it('a FREQUENT/FAVOURITE CHIP re-log carries the credit — the most-tapped path owes it too', () => {
    assert.equal(
      chipRelogEntry(creditedEntry()).attribution,
      CREDIT,
      'tapping a favourite re-logged the same credited data with no credit at all',
    );
  });

  it('a chip re-log of an uncredited food stores null, never an empty string', () => {
    assert.equal(chipRelogEntry(creditedEntry({ attribution: null, curatedSource: null })).attribution, null);
  });

  it('COPY YESTERDAY carries the credit onto the copy — same food, same source, same obligation', () => {
    const copy = buildCopiedEntry({
      log: creditedEntry(),
      id: 'copy-1',
      dayKey: '2026-07-29',
      loggedAtMs: LOGGED_AT_MS + 86_400_000,
      createdAtMs: LOGGED_AT_MS + 86_400_000,
      logBatchId: 'copy-batch-1',
    });
    assert.equal(copy.attribution, CREDIT, 'the copied entry claims the original’s source but drops its credit');
    assert.equal(copy.netCarbsPer100g, 21.7);
    // Only identity/placement/grouping may differ — everything describing the
    // food must be identical, which is the invariant that keeps getting broken.
    assert.deepEqual(
      { ...copy, id: 'log-1', dayKey: DAY_KEY, loggedAt: LOGGED_AT_MS, createdAt: LOGGED_AT_MS, logBatchId: null },
      // M123/13 review finding 3 added `carbBasis` to `buildCopiedEntry`'s
      // field list; `creditedEntry()` carries none, so the copy carries none
      // either — asserted explicitly here so this deep-equal stays exhaustive.
      { ...creditedEntry(), portion: undefined, micronutrientsPer100g: undefined, carbBasis: undefined },
    );
  });

  it('survives a backup export/import round trip instead of being stripped by the schema', () => {
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-28T12:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [creditedEntry()],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
      },
    };
    const restored = migrateEnvelopeForward(parseBackupEnvelope(serializeBackup(envelope)));
    assert.equal(restored.data.foodLogs[0]?.attribution, CREDIT);
  });

  it('a pre-v4 entry (no such key at all) still loads and simply shows no credit', () => {
    const legacy = creditedEntry();
    // SAFETY: `attribution` is a declared property of the entry type, so widening the
    // fixture to the same field as optional only relaxes `delete`'s required-key check;
    // the very next line asserts the key is genuinely gone.
    delete (legacy as { attribution?: string | null }).attribution;
    assert.equal('attribution' in legacy, false, 'the fixture must genuinely lack the key');
    assert.equal(renderToStaticMarkup(createElement(AttributionNote, { log: legacy })), '');
  });
});

////////////////////////////////////////////////////////////////////////////////
// The receipt must not contradict itself
//
// The two rules this file pins are individually right and, together, printed a
// contradiction: a macro edit CLEARS `curatedSource` (the numbers are the
// person's now) but KEEPS `attribution` (CC BY covers adaptations), so the
// receipt rendered "Manual entry." directly above a credit for the food
// database the entry had just stopped claiming. A reader with no technical
// context cannot reconcile those two lines, and one of them looks like a bug.
//
// The resolution is the LABEL, not either rule: an entry with a credit and no
// provenance claim is an ADAPTED one — the person's own numbers, derived from
// someone else's data.
////////////////////////////////////////////////////////////////////////////////

/** The exact state `handleSave` leaves a curated entry in after a hand macro edit. */
function handEditedCuratedEntry(): LocalFoodLog {
  const originalBasis = { carbs: 21.7, fiber: 42.8, sugars: null, polyols: null, protein: 15.6, fat: 4.3, kcal: 216 };
  const patch = computeEditPatch({
    grams: SERVING_GRAMS,
    // The person corrects the carbs by hand.
    editedPer100g: { ...originalBasis, carbs: 30 },
    originalBasis,
    currentProvenance: { aiEstimated: false, curatedSource: toCuratedSource('wheat-bran') },
    currentNetCarbsPer100g: 21.7,
  });
  // Mirrors `handleSave`'s write: the patch decides provenance/macros/figure,
  // and everything else — `attribution` included — rides the `...existing` spread.
  return {
    ...creditedEntry(),
    macros: patch.snapshot,
    aiEstimated: patch.provenance.aiEstimated,
    curatedSource: patch.provenance.curatedSource,
    netCarbsPer100g: patch.netCarbsPer100g,
  };
}

function renderProvenance(log: LocalFoodLog): string {
  return renderToStaticMarkup(createElement(ProvenanceNote, { log }));
}

/** The curated pill's exact text — the claim "these numbers are unmodified curated data". */
const CURATED_CLAIM = 'From our food database';

describe('a hand-edited curated entry reads coherently — credit kept, provenance honest', () => {
  it('FIXTURE CHECK: the edit really does clear the provenance claim while keeping the credit', () => {
    const adapted = handEditedCuratedEntry();
    assert.equal(adapted.curatedSource, null, 'a hand-edited entry must not keep claiming curated provenance');
    assert.equal(adapted.aiEstimated, false);
    assert.equal(adapted.attribution, CREDIT, 'the credit is deliberately retained — CC BY covers adaptations');
    assert.equal(adapted.netCarbsPer100g, undefined, 'and the upstream figure is deliberately withdrawn');
  });

  it('never renders "Manual entry." next to a licence credit — the two statements contradict each other', () => {
    const html = renderProvenance(handEditedCuratedEntry());
    assert.ok(html.includes(CREDIT), 'the credit must survive: dropping it is the actual licence violation');
    assert.equal(
      html.includes('Manual entry.'),
      false,
      'the receipt claims the numbers came from nowhere while crediting the database they came from',
    );
  });

  it('does not claim unmodified curated provenance for hand-edited numbers either', () => {
    assert.equal(
      renderProvenance(handEditedCuratedEntry()).includes(CURATED_CLAIM),
      false,
      'the entry would be claiming its edited numbers are the database’s own',
    );
  });

  it('names the actual state instead: the numbers are the person’s, the data they started from is credited', () => {
    const html = renderProvenance(handEditedCuratedEntry());
    assert.match(html, /Edited by you/, 'the reader is told whose numbers these now are');
    assert.match(html, /started from our food database/, 'and where they came from, which is why a credit follows');
  });

  it('leaves the other three states exactly as they were', () => {
    // Curated (untouched): the claim and the credit belong together.
    const curated = renderProvenance(creditedEntry());
    assert.ok(curated.includes(CURATED_CLAIM) && curated.includes(CREDIT));
    // AI-estimated: unchanged.
    assert.ok(renderProvenance(creditedEntry({ curatedSource: null, aiEstimated: true })).includes('AI estimated'));
    // Genuinely manual (no credit to reconcile): still the plain manual line.
    const manual = renderProvenance(creditedEntry({ curatedSource: null, attribution: null }));
    assert.ok(manual.includes('Manual entry.'));
    assert.equal(manual.includes('CC BY'), false);
  });

  it('a re-log of an adapted entry stays adapted — never silently promoted back to curated', () => {
    // The recents/chip path passes `curatedSource` and `attribution` through
    // independently, so an adapted food re-logs as adapted rather than
    // regaining a provenance claim its numbers no longer support.
    const relogged = chipRelogEntry(handEditedCuratedEntry());
    assert.equal(relogged.curatedSource, null);
    assert.equal(relogged.attribution, CREDIT);
    assert.equal(renderProvenance(relogged).includes('Manual entry.'), false);
  });
});

describe('toStoredAttribution — the one rule every writer shares', () => {
  it('keeps a real credit verbatim, only trimming surrounding whitespace', () => {
    assert.equal(toStoredAttribution(CREDIT), CREDIT);
    assert.equal(toStoredAttribution(`  ${CREDIT}  `), CREDIT);
  });

  it('collapses every "no credit" shape to null, never to an empty string', () => {
    for (const raw of ['', '   ', null, undefined]) {
      assert.equal(toStoredAttribution(raw), null, `expected ${JSON.stringify(raw)} to normalize to null`);
    }
  });
});
