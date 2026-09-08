/**
 * The stale-bundle hysteresis (M203) in `app/lib/bundle-freshness.ts`.
 *
 * THE FAILURE THIS PREVENTS: a deploy replaces containers one at a time, so for
 * a minute or two both the old and the new build answer requests. A tab polling
 * through that window sees new, old, new. Acting on the first mismatch offers
 * "reload for the newest version" to somebody who would reload onto the build
 * they are already on, and offers it again half an hour later.
 *
 * THE SECOND FAILURE: `unknown` is a real sha value, stamped by any build that
 * had no git and no override. `pnpm dev` serves it from both ends. Counting it
 * as a mismatch would make a dev server nag about an update on its second poll,
 * forever.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FRESH_BUNDLE, observeServerBuild, UNKNOWN_SHA } from '../../app/lib/bundle-freshness';

const BUNDLE = 'aaaaaaa';
const NEWER = 'bbbbbbb';

describe('observeServerBuild', () => {
  it('is fresh while the server reports the same commit', () => {
    const state = observeServerBuild({ state: FRESH_BUNDLE, serverSha: BUNDLE, bundleSha: BUNDLE });
    assert.deepEqual(state, FRESH_BUNDLE);
  });

  it('does not call one mismatch stale', () => {
    const state = observeServerBuild({ state: FRESH_BUNDLE, serverSha: NEWER, bundleSha: BUNDLE });
    assert.equal(state.mismatches, 1);
    assert.equal(state.isStale, false);
  });

  it('calls two consecutive mismatches stale', () => {
    const once = observeServerBuild({ state: FRESH_BUNDLE, serverSha: NEWER, bundleSha: BUNDLE });
    const twice = observeServerBuild({ state: once, serverSha: NEWER, bundleSha: BUNDLE });
    assert.equal(twice.isStale, true);
  });

  it('resets on a match, so the two have to be consecutive', () => {
    // The rolling-deploy window, exactly: new, old, new.
    const first = observeServerBuild({ state: FRESH_BUNDLE, serverSha: NEWER, bundleSha: BUNDLE });
    const settled = observeServerBuild({ state: first, serverSha: BUNDLE, bundleSha: BUNDLE });
    const again = observeServerBuild({ state: settled, serverSha: NEWER, bundleSha: BUNDLE });
    assert.equal(settled.mismatches, 0);
    assert.equal(again.isStale, false, 'one mismatch either side of a match is not two in a row');
  });

  it('treats an unknown server sha as no evidence', () => {
    const once = observeServerBuild({ state: FRESH_BUNDLE, serverSha: NEWER, bundleSha: BUNDLE });
    const blind = observeServerBuild({ state: once, serverSha: UNKNOWN_SHA, bundleSha: BUNDLE });
    assert.deepEqual(blind, FRESH_BUNDLE);
  });

  it('treats an unstamped bundle as no evidence, so dev never nags', () => {
    const once = observeServerBuild({ state: FRESH_BUNDLE, serverSha: NEWER, bundleSha: UNKNOWN_SHA });
    const twice = observeServerBuild({ state: once, serverSha: NEWER, bundleSha: UNKNOWN_SHA });
    assert.equal(twice.isStale, false);
  });

  it('treats a missing header as no evidence', () => {
    const state = observeServerBuild({ state: FRESH_BUNDLE, serverSha: null, bundleSha: BUNDLE });
    assert.deepEqual(state, FRESH_BUNDLE);
  });
});
