/**
 * THE ONE THING THE STUDY CONSOLE MUST NEVER DO (M163/03,
 * `openplate-sync` ADR-0003).
 *
 * The owner-private compartment rides INSIDE the synced snapshot, and
 * openplate's local store is DEVICE-scoped — one flat store per browser
 * profile, with no per-user namespacing. So a study session that reused the
 * diary's outgoing-snapshot path would push the RESEARCHER'S OWN DIARY as the
 * study account's shareable region, the first time she signed into the study
 * account in the browser profile that holds her diary. Silently.
 *
 * This is asserted TWO ways, and neither alone would be enough.
 *
 * ── 1. The blob that IS built is empty ───────────────────────────────────
 *
 * Driven from `SNAPSHOT_KEY_REGIONS` rather than a hand-copied list, so a key
 * added to the shareable region in future is covered here on the day it is
 * added rather than the day somebody remembers this file.
 *
 * ── 2. Nothing in the surface can READ a diary ───────────────────────────
 *
 * The emptiness assertion alone does not discriminate: a unit test in node has
 * no local store, so a `readLocalSnapshot()` injected into the study path
 * would return nothing here and the blob would still look empty. The
 * structural half is what fires — no module of this surface may name any of
 * the verbs through which a device's diary enters a snapshot. It is the same
 * shape of assertion `join-study.test.ts` uses, and for the same reason: the
 * defect is invisible to the only kind of rendering/execution these tests do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SNAPSHOT_KEY_REGIONS } from '../../app/lib/sync/snapshot-partition';
import { buildStudySnapshot, EMPTY_STUDY_SHAREABLE_REGION } from '../../app/lib/sync/research/study-snapshot';

/** Every module a `/study` session runs through on its way to a push. */
const STUDY_CONSOLE_MODULES = [
  '../../app/routes/study._index.tsx',
  '../../app/components/study-key-card.tsx',
  '../../app/components/study-cohort-panel.tsx',
  '../../app/lib/sync/research/study-snapshot.ts',
  '../../app/lib/sync/research/study-session.ts',
  '../../app/lib/sync/research/study-blob.ts',
  '../../app/lib/sync/research/study-compartment.ts',
  '../../app/lib/sync/research/study-keyring.ts',
  '../../app/lib/sync/research/study-console-view.ts',
] as const;

/**
 * The verbs through which a device's diary enters a snapshot.
 *
 * Named rather than banning the `local-store` module path, because
 * `SCHEMA_VERSION` legitimately comes from there and is a number, not a diary.
 * These are the functions: the bridge's readers, the partition of a device
 * snapshot, the store's list/get readers, and the importer that writes one
 * back.
 */
const DIARY_READING_VERBS =
  /readLocalSnapshot|readLocalOwnerPrivateRegion|local-store-bridge|partitionSnapshot|applyMergedSnapshot|getPrimaryStore|listLocal[A-Z]|getLocal[A-Z]/;

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

test('a study blob carries no diary', () => {
  const shareableKeys = Object.entries(SNAPSHOT_KEY_REGIONS)
    .filter(([, region]) => region === 'shared')
    .map(([key]) => key);

  // Not vacuous: the map really does classify a shareable half, and the
  // constant really does cover all of it.
  assert.ok(shareableKeys.length > 0, 'no snapshot key is classified as shareable');
  assert.deepEqual(Object.keys(EMPTY_STUDY_SHAREABLE_REGION).toSorted(), shareableKeys.toSorted());

  const snapshot = buildStudySnapshot({ privateStore: null });
  assert.deepEqual(Object.keys(snapshot).toSorted(), [...shareableKeys, 'privateStore'].toSorted());
  for (const key of shareableKeys) {
    const value = Object.entries(snapshot).find(([name]) => name === key)?.[1];
    const isEmpty = value === null || (Array.isArray(value) && value.length === 0);
    assert.ok(isEmpty, `the study blob's "${key}" carried something — a study account has no diary`);
  }

  // The structural half. See this file's header for why the assertion above
  // cannot see the defect this one catches.
  for (const modulePath of STUDY_CONSOLE_MODULES) {
    assert.doesNotMatch(
      sourceOf(modulePath),
      DIARY_READING_VERBS,
      `${modulePath} can read this device's diary; a study session must not be able to push one`,
    );
  }
});

test('the compartment is the only thing a study blob carries', () => {
  // The one parameter, and the whole difference between two study pushes.
  const sealed = { ciphertext: 'AA', cdkWrapPassphrase: 'BB', cdkWrapRecovery: 'CC' };
  assert.deepEqual(buildStudySnapshot({ privateStore: sealed }), {
    ...EMPTY_STUDY_SHAREABLE_REGION,
    privateStore: sealed,
  });
});
