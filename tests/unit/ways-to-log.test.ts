/**
 * The first run teaches THREE ways to log, and each card starts the real one.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The label scanner shipped in M123/10 and the product's own owner did not
 * know it existed. Teaching every way in on the first run is half the point of
 * M200/01, and a lesson that quietly drops back to two ways, or points a card
 * at a screen that does not do the thing it names, would look completely
 * normal in review. So the three ways and their destinations are executed
 * here.
 *
 * WHICH THREE CHANGED ON 2026-09-08, and the reason is worth keeping. The
 * label photo stopped being a way of its own when the two photo tasks merged
 * (amends ADR-0005): one photo path reads a plate, a single item or a printed
 * panel, so "photograph a nutrition panel" is the same card as "photograph
 * your plate". Speaking took the vacated slot because it stopped being a way
 * to TYPE: a finished transcript now runs the same AI intake a typed sentence
 * does. The old lesson's footnote said speaking never logs a food, and by the
 * end of that day it was a false sentence in the one place a person has
 * nothing to check it against.
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
import { INTAKE_MODES } from '../../app/services/vision/task';

const ONBOARDING_ROUTE = readFileSync(
  fileURLToPath(new URL('../../app/routes/onboarding.tsx', import.meta.url)),
  'utf8',
);
const SCAN_ROUTE = readFileSync(fileURLToPath(new URL('../../app/routes/scan.tsx', import.meta.url)), 'utf8');

describe('the lesson is three ways, inside the wizard that already existed', () => {
  it('teaches exactly three ways: photograph it, write it, say it', () => {
    assert.deepEqual([...WAY_TO_LOG_IDS], ['photo', 'type', 'speak']);
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

  it('sends the photo card to the one photo path', () => {
    assert.equal(WAYS_TO_LOG[0]?.id, 'photo');
    assert.equal(WAYS_TO_LOG[0]?.destination, '/scan');
  });

  it('sends the type card to the composer, never to the database search', () => {
    assert.equal(WAYS_TO_LOG[1]?.id, 'type');
    assert.equal(WAYS_TO_LOG[1]?.destination, '/describe');
    // The defect M203 fixed: the card teaches "write a whole meal in one
    // line" and used to land on `/add`, a search field that wants one noun.
    assert.notEqual(WAYS_TO_LOG[1]?.destination, '/add');
  });

  it('sends the speak card to the ARMED microphone, never to a listening one', () => {
    const speak = WAYS_TO_LOG[2];
    assert.equal(speak?.id, 'speak');
    assert.equal(speak?.destination, '/describe?speak=1');
    assert.notEqual(speak?.destination, '/add?speak=1');
    // Arming is focus, not a session. An app that opened a microphone on
    // navigation is an app nobody can trust with one, so the button's own
    // guarantee is read here rather than assumed.
    const button = readFileSync(
      fileURLToPath(new URL('../../app/components/add/speech-input-button.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(button, /NO AUTO-START, EVER/, 'the microphone button dropped its no-auto-start guarantee');
  });

  it('teaches no scanner that no longer exists', () => {
    // There is one photo task. A card pointing at a second scanner would be a
    // dead URL that still rendered, which is exactly how the old label card
    // would have failed after the merge.
    assert.deepEqual([...INTAKE_MODES], ['photo', 'text']);
    for (const way of WAYS_TO_LOG) {
      assert.ok(!way.destination.includes('mode='), `the ${way.id} card still names a scan mode`);
    }
    assert.doesNotMatch(SCAN_ROUTE, /requestedScanMode/, 'scan.tsx still reads a scan mode out of the URL');
  });

  it('gives every card its own destination, so no two teach the same thing', () => {
    const destinations = WAYS_TO_LOG.map((way) => way.destination);
    assert.equal(new Set(destinations).size, destinations.length);
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
  it('covers the lead, the speech privacy note, and both lines of every card', () => {
    assert.deepEqual(waysToLogCopyKeys(), [
      'onboarding.step.firstFood.description',
      'onboarding.waysToLog.speechPrivacyNote',
      'onboarding.waysToLog.photo.title',
      'onboarding.waysToLog.photo.description',
      'onboarding.waysToLog.type.title',
      'onboarding.waysToLog.type.description',
      'onboarding.waysToLog.speak.title',
      'onboarding.waysToLog.speak.description',
    ]);
  });
});
