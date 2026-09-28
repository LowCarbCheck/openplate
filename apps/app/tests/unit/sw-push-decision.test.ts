/**
 * The file the phone actually runs, tested as the phone loads it.
 *
 * `sw-push-copy-parity.test.ts` holds `public/sw-push-decision.js` to the same
 * behaviour as its TypeScript source, and `push-decision.test.ts` tests that
 * source. Neither of them would catch a copy that fails to LOAD: a syntax the
 * worker rejects, a reference to a global a service worker does not have, or a
 * module that quietly attaches nothing. This file evaluates the shipped
 * artefact in a bare scope carrying only `self` and asserts on what came out.
 *
 * `public/sw.js` also asserts that this file is enough: it is loaded with
 * `importScripts('/sw-push-decision.js')` and its functions are reached through
 * `self.openplatePushDecision`, both of which are exercised here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadWorkerPushDecision, readWorkerCopySource } from './sw-push-decision-harness';

const NOW = Date.UTC(2026, 8, 12, 5, 0, 0);

const decision = loadWorkerPushDecision(readWorkerCopySource());

const FRESH = {
  forDay: '2026-09-11',
  title: 'Yesterday: 18 g net carbs',
  body: 'Protein was 96 g. Today you have 20 g to spend.',
  url: '/catch-up',
  locale: 'en',
  writtenAt: NOW - 60_000,
};

describe('the shipped worker module', () => {
  it('loads in a scope that has nothing but self', () => {
    assert.equal(Object.keys(decision).includes('decidePush'), true);
    assert.equal(Object.keys(decision).includes('notificationPath'), true);
  });

  it('shows the stored words for a fresh record', () => {
    const shown = decision.decidePush('catch-up', FRESH, NOW, 'en');

    assert.equal(shown.title, 'Yesterday: 18 g net carbs');
    assert.equal(shown.url, '/catch-up');
    assert.equal(shown.tag, 'openplate-catchup');
  });

  it('falls back to the generic line when the read found nothing', () => {
    const shown = decision.decidePush('catch-up', null, NOW, 'de-DE');

    assert.equal(shown.title, 'Dein Tagesrückblick ist da');
    assert.equal(shown.url, '/catch-up');
  });

  it('falls back for a record older than 36 hours', () => {
    const stale = { ...FRESH, writtenAt: NOW - 37 * 60 * 60 * 1000 };

    const shown = decision.decidePush('catch-up', stale, NOW, 'en');

    assert.equal(shown.title, 'Your catch-up is ready');
  });

  it('shows the fast target line and deep links the fasting screen', () => {
    const shown = decision.decidePush('fast-target', FRESH, NOW, 'en');

    assert.equal(shown.title, 'Your fast has reached its target');
    assert.equal(shown.url, '/fasting');
    assert.equal(shown.tag, 'openplate-fast');
  });

  it('treats a kind it does not know as a catch-up', () => {
    const shown = decision.decidePush('meal-reminder', null, NOW, 'en');

    assert.equal(shown.title, 'Your catch-up is ready');
    assert.equal(shown.url, '/catch-up');
  });

  it('routes a tap, defaulting to the catch-up', () => {
    assert.equal(decision.notificationPath({}), '/catch-up');
    assert.equal(decision.notificationPath(null), '/catch-up');
    assert.equal(decision.notificationPath({ url: '/fasting' }), '/fasting');
  });
});
