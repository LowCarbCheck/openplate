/**
 * Unit tests for the HOST COUNT half of `#app/lib/status`.
 *
 * The count is what makes the owner's rule ("no published status may ever be
 * lost") enforceable without a list of routes: every `HeaderStatus` registers
 * while it is mounted, and `StatusFallbackHost` draws its own bar when the
 * count is zero. So the count has to be exact, it has to come back down, and
 * `resetStatusChannel` has to clear it, or one test's mounted host would make
 * the next test's fallback invisible.
 *
 * These are plain function calls: `readStatusHostCount` is the non-subscribing
 * read, the same value `useStatusHostCount` serves.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { readStatusHostCount, registerStatusHost, resetStatusChannel } from '../../app/lib/status';

describe('the status host registry', () => {
  beforeEach(() => resetStatusChannel());
  afterEach(() => resetStatusChannel());

  it('starts at zero, which is what makes the fallback the default', () => {
    assert.equal(readStatusHostCount(), 0, 'a fresh channel already believed a host was on screen');
  });

  it('counts every host that registers, and drops one per unregister', () => {
    const releaseFirst = registerStatusHost();
    assert.equal(readStatusHostCount(), 1, 'the first host did not register');

    registerStatusHost();
    assert.equal(readStatusHostCount(), 2, 'a second host did not add to the count');

    releaseFirst();
    // The CONTROL for the assertion above: 2 and 1 are different numbers
    // through the same read, so neither line passes on a stuck counter.
    assert.equal(readStatusHostCount(), 1, 'unregistering one host cleared them all, or cleared none');
  });

  it('ignores a second unregister from the same host', () => {
    registerStatusHost();
    const release = registerStatusHost();
    release();
    release();
    assert.equal(readStatusHostCount(), 1, 'a repeated cleanup pushed the count below the mounted hosts');
  });

  it('lets the count reach zero again, so a shell that unmounts hands the message back', () => {
    const release = registerStatusHost();
    release();
    assert.equal(readStatusHostCount(), 0, 'the last host unmounted and the channel still thought it was there');
  });

  it('is cleared by resetStatusChannel, so one test cannot silence the next', () => {
    registerStatusHost();
    registerStatusHost();
    assert.equal(readStatusHostCount(), 2, 'the hosts under test never registered');
    resetStatusChannel();
    assert.equal(readStatusHostCount(), 0, 'the reset seam left a host behind');
  });
});
