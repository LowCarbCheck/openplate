/**
 * Which source the SERVER takes its build stamp from.
 *
 * THE FAILURE THIS PINS: under `pnpm dev` the browser's stamp comes from Vite,
 * computed live when the dev server starts. An earlier `pnpm build` can leave a
 * `build/build-info.json` from a different commit lying around. When the server
 * read that file in dev, the two disagreed permanently: `bundle-freshness.ts`
 * saw two known, unequal shas on every poll, and the update ribbon said "A newer
 * version of this page is ready" for the whole session, on a page that was
 * already the newest one. Reload could not clear it, because there was nothing
 * newer to reload onto. It was invisible in production, where the file is
 * written by the build that produced the bundle, so only developers saw it, and
 * every developer would have.
 *
 * The rule is one branch, and both arms matter for different reasons: dev must
 * never read the file even as a fallback, and production must prefer it, because
 * production is where git is absent and the file is the only source.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { selectServerBuild, type BuildInfoSources } from '../../app/lib/build-info.server';
import type { BuildInfo } from '../../app/lib/build-info';

const FROM_FILE: BuildInfo = { version: '0.18.3', sha: 'stale11', builtAt: '2026-09-01T00:00:00.000Z' };
const FROM_GIT: BuildInfo = { version: '0.18.3', sha: 'live222', builtAt: '2026-09-08T00:00:00.000Z' };

/** Sources that record which of the two was actually consulted. */
function trackedSources({ stampFile }: { stampFile: BuildInfo | null }) {
  const consulted: string[] = [];
  const sources: BuildInfoSources = {
    stampFile: () => {
      consulted.push('stampFile');
      return stampFile;
    },
    live: () => {
      consulted.push('live');
      return FROM_GIT;
    },
  };
  return { consulted, sources };
}

describe('selectServerBuild in development', () => {
  it('derives the build live', () => {
    const { sources } = trackedSources({ stampFile: FROM_FILE });
    assert.deepEqual(selectServerBuild({ isProduction: false, sources }), FROM_GIT);
  });

  it('does not READ the stamp file at all, even when one exists', () => {
    // Not merely "prefers live": the file must not be consulted, so a stale one
    // cannot become a fallback the moment the live read returns something odd.
    const { consulted, sources } = trackedSources({ stampFile: FROM_FILE });
    selectServerBuild({ isProduction: false, sources });
    assert.deepEqual(consulted, ['live']);
  });
});

describe('selectServerBuild in production', () => {
  it('reads the stamp the build wrote beside the bundle', () => {
    const { sources } = trackedSources({ stampFile: FROM_FILE });
    assert.deepEqual(selectServerBuild({ isProduction: true, sources }), FROM_FILE);
  });

  it('falls back to the live derivation when there is no stamp file', () => {
    const { sources } = trackedSources({ stampFile: null });
    assert.deepEqual(selectServerBuild({ isProduction: true, sources }), FROM_GIT);
  });

  it('does not derive live when the stamp file answered', () => {
    // Spawning git in a container is pointless work and would answer `unknown`.
    const { consulted, sources } = trackedSources({ stampFile: FROM_FILE });
    selectServerBuild({ isProduction: true, sources });
    assert.deepEqual(consulted, ['stampFile']);
  });
});
