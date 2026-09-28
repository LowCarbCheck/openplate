/**
 * The build stamp (M203) in `app/lib/build-info.ts` and the ribbon's own rule.
 *
 * `APP_VERSION` used to be a hand-copied literal in `brand.ts` pinned to
 * `package.json` by `brand.test.ts`. The pin is gone because the copy is gone:
 * Vite reads the manifest at build time and injects the result. What is left to
 * test is the formatting, which is what a person reads out of a bug report, and
 * the ribbon's decision, which is the one piece of update logic with a real
 * judgement call in it.
 *
 * The module is imported here under plain node, where `__OPENPLATE_BUILD__` was
 * never substituted, so `BUILD` is the unstamped fallback. That is itself worth
 * asserting: it must be obviously fake, so a broken `define` cannot reach
 * production wearing a plausible version number.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BUILD, formatBuildLabel } from '../../app/lib/build-info';
import { ribbonState, type UpdateSnapshot } from '../../app/lib/update-store';
import type { UpdateStatus } from '../../app/lib/update-status';

describe('formatBuildLabel', () => {
  it('is the version and the commit, separated by a middle dot', () => {
    assert.equal(formatBuildLabel({ version: '0.18.3', sha: '586caeb', builtAt: '' }), 'v0.18.3 · 586caeb');
  });

  it('carries no dash of any width', () => {
    const label = formatBuildLabel({ version: '1.0.0', sha: 'abcdef1', builtAt: '' });
    assert.ok(!label.includes('—'), 'no em dash');
    assert.ok(!label.includes('–'), 'no en dash');
  });

  it('drops the commit rather than printing the word unknown at a person', () => {
    assert.equal(formatBuildLabel({ version: '0.18.3', sha: 'unknown', builtAt: '' }), 'v0.18.3');
    assert.equal(formatBuildLabel({ version: '0.18.3', sha: '', builtAt: '' }), 'v0.18.3');
  });
});

describe('BUILD outside a Vite build', () => {
  it('falls back to an obviously fake version rather than a plausible one', () => {
    assert.equal(BUILD.version, '0.0.0-unstamped');
    assert.equal(BUILD.sha, 'unknown');
  });
});

function status(overrides: Partial<UpdateStatus>): UpdateStatus {
  return {
    enabled: true,
    currentVersion: '0.18.3',
    sha: 'aaaaaaa',
    builtAt: '2026-09-08T00:00:00.000Z',
    latest: null,
    releaseUrl: null,
    checkedAt: null,
    updateAvailable: false,
    throttled: false,
    nextCheckAllowedAt: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<UpdateSnapshot>): UpdateSnapshot {
  return { status: null, isChecking: false, bundleStale: false, dismissedVersion: null, ...overrides };
}

describe('ribbonState', () => {
  it('says nothing when there is nothing to say', () => {
    assert.equal(ribbonState(snapshot({})), 'none');
    assert.equal(ribbonState(snapshot({ status: status({}) })), 'none');
  });

  it('announces a newer release', () => {
    const current = snapshot({ status: status({ latest: '0.19.0', updateAvailable: true }) });
    assert.equal(ribbonState(current), 'newer-release');
  });

  it('stops announcing a release that was dismissed', () => {
    const current = snapshot({
      status: status({ latest: '0.19.0', updateAvailable: true }),
      dismissedVersion: '0.19.0',
    });
    assert.equal(ribbonState(current), 'none');
  });

  it('announces the NEXT release even after the last one was dismissed', () => {
    const current = snapshot({
      status: status({ latest: '0.20.0', updateAvailable: true }),
      dismissedVersion: '0.19.0',
    });
    assert.equal(ribbonState(current), 'newer-release');
  });

  it('prefers the stale bundle, the only one of the two with a working button', () => {
    const current = snapshot({
      status: status({ latest: '0.19.0', updateAvailable: true }),
      bundleStale: true,
    });
    assert.equal(ribbonState(current), 'newer-bundle');
  });

  it('shows the stale bundle even when the release was dismissed', () => {
    const current = snapshot({
      status: status({ latest: '0.19.0', updateAvailable: true }),
      dismissedVersion: '0.19.0',
      bundleStale: true,
    });
    assert.equal(ribbonState(current), 'newer-bundle');
  });
});
