/**
 * THE DELETE JOURNAL HAS ONE MEANING, and these are the two source facts that
 * keep it.
 *
 * The journal records deletes THIS DEVICE performed, and it is the only thing
 * that authorises a tombstone. Two ways to break that, and each has a line
 * here:
 *
 *  - a user-facing delete that skips the journal. Then the delete is real, no
 *    tombstone is ever minted for it, and it comes back on the next sync,
 *    forever, on every device;
 *  - a removal that WRITES the journal without a person having deleted
 *    anything. `applyMergedSnapshot` is the one, it removes rows a PEER
 *    deleted, and the cost is in
 *    `tests/integration/sync-peer-delete-is-not-mine.test.ts`.
 *
 * `removeEntitiesWithoutJournal` is the second case's escape hatch, and an
 * escape hatch is only safe while it is hard to reach. Its `reason` parameter
 * and its name do that for a reader; this file does it for a build, because a
 * future caller that finds it convenient will not read the doc comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
}

/** Every `name(` in a file, minus its own declaration. Comments naming the function without a call are not calls. */
function callSitesOf(source: string, name: string): string[] {
  return source
    .split('\n')
    .filter((line) => line.includes(`${name}(`))
    .filter((line) => !line.includes(`function ${name}(`));
}

const APP_FILES = [
  'app/lib/sync/local-store-bridge.ts',
  'app/lib/sync/sync-actions.ts',
  'app/lib/sync/orchestrator.ts',
  'app/lib/local-store/primary-store.ts',
  'app/lib/local-store/index.ts',
];

test('the unjournalled removal has exactly one caller, and it is the merge apply', () => {
  const callers = APP_FILES.flatMap((file) =>
    callSitesOf(readSource(file), 'removeEntitiesWithoutJournal').map((line) => ({ file, line })),
  );
  assert.deepEqual(
    callers.map((caller) => caller.file),
    ['app/lib/sync/local-store-bridge.ts'],
    'only `applyMergedSnapshot` may remove rows without recording a delete',
  );
  // CONTROL: the matcher really does find a call. Without this the assertion
  // above passes just as happily against a typo in the function name.
  assert.equal(callers.length, 1);
  assert.match(callers[0]?.line ?? '', /removeEntitiesWithoutJournal\(\{/);
});

test('it is not on the local store’s public surface', () => {
  // The barrel is what every user-facing verb imports. Reaching the
  // unjournalled path therefore takes a deep import, which is a line a reviewer
  // sees.
  assert.ok(
    !readSource('app/lib/local-store/index.ts').includes('removeEntitiesWithoutJournal'),
    '`#app/lib/local-store` must not re-export the unjournalled removal',
  );
  // CONTROL: the barrel really is the file that exports the journal's own
  // readers, so "absent from it" is a claim about the right file.
  assert.ok(readSource('app/lib/local-store/index.ts').includes('listDeletedEntityKeys'));
});

test('applying a merge does not call a journalling delete verb', () => {
  const bridge = readSource('app/lib/sync/local-store-bridge.ts');
  const apply = bridge.slice(bridge.indexOf('export async function applyMergedSnapshot'));
  for (const verb of ['deleteLocalFood(', 'deleteLocalFoodLog(', 'deleteLocalWeightEntry(']) {
    assert.ok(!apply.includes(verb), `applying a peer's delete must not go through ${verb}`);
  }
  // CONTROL: the slice is not empty and really is the apply, so the three
  // assertions above are about code rather than about an empty string.
  assert.match(apply, /removeEntitiesWithoutJournal\(\{/);
});
