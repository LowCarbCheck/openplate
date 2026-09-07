/**
 * The first run teaches THREE ways to log, and each card starts the real one.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The label scanner shipped in M123/10 and the product's own owner did not
 * know it existed. Teaching it on the first run is half the point of M200/01,
 * and a lesson that quietly drops back to two ways, or points a card at a
 * screen that does not run the scanner it names, would look completely normal
 * in review. So the three ways and their destinations are executed here.
 *
 * ── What is EXECUTED and what is READ ────────────────────────────────────
 *
 * The catalog and the destination allowlist are real modules, so everything
 * about WHICH ways exist and WHERE they go runs. The wiring from the catalog
 * to the buttons is read out of `app/routes/onboarding.tsx`: there is no jsdom
 * in this repo, so a card cannot be clicked. Every source assertion names one
 * anchor, so a rename fails it instead of passing vacuously.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ONBOARDING_STEPS, resolveExitDestination } from '../../app/lib/onboarding';
import { WAYS_TO_LOG, WAY_TO_LOG_IDS, waysToLogCopyKeys } from '../../app/lib/ways-to-log';
import { SCAN_TASK_BY_MODE, VISION_MODES } from '../../app/services/vision/task';
import { requestedScanMode } from '../../app/lib/scan-mode-param';

const ONBOARDING_ROUTE = readFileSync(
  fileURLToPath(new URL('../../app/routes/onboarding.tsx', import.meta.url)),
  'utf8',
);
const SCAN_ROUTE = readFileSync(fileURLToPath(new URL('../../app/routes/scan.tsx', import.meta.url)), 'utf8');

describe('the lesson is three ways, inside the wizard that already existed', () => {
  it('teaches exactly three ways: the plate, the package panel, and the search', () => {
    assert.deepEqual([...WAY_TO_LOG_IDS], ['plate', 'label', 'search']);
    assert.equal(WAYS_TO_LOG.length, 3);
  });

  it('did not make the wizard longer', () => {
    assert.deepEqual([...ONBOARDING_STEPS], ['focus', 'weight', 'body', 'first-food']);
  });

  it('lands on the step where a person is about to do the thing', () => {
    assert.match(
      ONBOARDING_ROUTE,
      /\{step === 'first-food' && <FirstFoodStep \/>\}/,
      'the lesson is no longer rendered on the first-food step',
    );
  });
});

describe('each card starts the real action', () => {
  it('survives the exit allowlist, so no card is silently rewritten to the diary', () => {
    for (const way of WAYS_TO_LOG) {
      assert.equal(
        resolveExitDestination(way.destination),
        way.destination,
        `the ${way.id} card points somewhere the onboarding action refuses`,
      );
    }
  });

  it('sends the plate card to the plate scanner', () => {
    assert.equal(WAYS_TO_LOG[0]?.destination, '/scan');
  });

  it('sends the label card to the LABEL scanner, not to the plate default', () => {
    const label = WAYS_TO_LOG[1];
    assert.equal(label?.id, 'label');
    assert.equal(label?.destination, '/scan?mode=label');
    // The destination is only true if the scan screen honours it.
    assert.equal(requestedScanMode('?mode=label'), 'label');
    assert.match(
      SCAN_ROUTE,
      /const asked = requestedScanMode\(window\.location\.search\);/,
      'scan.tsx stopped reading the mode out of the URL',
    );
    assert.match(SCAN_ROUTE, /setMode\(asked\);/, 'scan.tsx reads the requested mode but no longer applies it');
  });

  it('names a scanner that actually exists, so the label card is not a dead URL', () => {
    assert.ok(VISION_MODES.includes('label'));
    assert.equal(SCAN_TASK_BY_MODE.label.mode, 'label');
  });

  it('sends the search card to /add', () => {
    assert.equal(WAYS_TO_LOG[2]?.destination, '/add');
  });

  it('gives every card its own destination, so no two teach the same thing', () => {
    const destinations = WAYS_TO_LOG.map((way) => way.destination);
    assert.equal(new Set(destinations).size, destinations.length);
  });

  it('ignores a mode nobody asked for, so a hand-typed /scan URL cannot invent a scanner', () => {
    assert.equal(requestedScanMode(''), null);
    assert.equal(requestedScanMode('?mode=barcode'), null);
    assert.equal(requestedScanMode('?shared=1'), null);
    assert.equal(requestedScanMode('?mode=plate'), 'plate');
  });
});

describe('the cards are wired to the catalog, not hand-copied beside it', () => {
  it('renders one card per catalog row', () => {
    assert.match(
      ONBOARDING_ROUTE,
      /\{WAYS_TO_LOG\.map\(\(way\) => \(/,
      'the step no longer maps the catalog, so a fourth way could be added to the list and never render',
    );
  });

  it("submits the row's own destination", () => {
    assert.match(ONBOARDING_ROUTE, /value=\{way\.destination\}/, 'the card no longer submits the catalog destination');
  });

  it('stamps onboarding completion first, so no card lands a person outside the gate', () => {
    assert.match(
      ONBOARDING_ROUTE,
      /name="_intent" value=\{INTENT\.FINISH\}/,
      'the ways-to-log form no longer carries the finish intent',
    );
  });

  it('keeps the skip: "later" still exits to the diary', () => {
    assert.match(ONBOARDING_ROUTE, /value="\/diary"/, 'the step can no longer be left without logging anything');
  });
});

describe('every string the lesson renders is named once', () => {
  it('covers the lead, the dictation note, and both lines of every card', () => {
    assert.deepEqual(waysToLogCopyKeys(), [
      'onboarding.step.firstFood.description',
      'onboarding.waysToLog.dictationNote',
      'onboarding.waysToLog.plate.title',
      'onboarding.waysToLog.plate.description',
      'onboarding.waysToLog.label.title',
      'onboarding.waysToLog.label.description',
      'onboarding.waysToLog.search.title',
      'onboarding.waysToLog.search.description',
    ]);
  });
});
