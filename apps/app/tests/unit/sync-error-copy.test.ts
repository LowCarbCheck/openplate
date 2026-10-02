/**
 * Every sync error reason has a sentence, and the sentence is the right one.
 *
 * `ALL_REASONS` below is checked against `SyncErrorReason`, so adding a
 * reason to the type without listing it here is a type error: this file cannot
 * quietly stop covering the newest reason. Each key `syncErrorCopyKey` returns
 * is looked up in the English catalog, so a reason whose key was never
 * written fails here rather than rendering the raw key on screen.
 */
import { test } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { syncErrorCopyKey } from '../../app/lib/sync/sync-error-copy';
import type { SyncErrorReason } from '../../app/lib/sync/sync-session';

/**
 * Every reason, keyed by itself. `satisfies { [R in SyncErrorReason]: R }` makes
 * the object complete in both directions: a reason added to the type and not
 * listed here, or a typo here, is a type error.
 */
const ALL_REASONS = {
  'reauth-required': 'reauth-required',
  suspended: 'suspended',
  offline: 'offline',
  incompatible: 'incompatible',
  failed: 'failed',
} as const satisfies { [R in SyncErrorReason]: R };

interface Catalog {
  [key: string]: string | Catalog;
}

/** The on-disk catalog, parsed rather than asserted. */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
);

/** The string at a dotted path, or `undefined` for a miss or a non-leaf. */
function lookup(key: string): string | undefined {
  let node: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) {
    const group = catalogSchema.safeParse(node);
    if (!group.success) return undefined;
    node = group.data[part];
  }
  const leaf = z.string().safeParse(node);
  return leaf.success ? leaf.data : undefined;
}

const REASONS = Object.values(ALL_REASONS);

test('every reason, in both modes, resolves to a sentence in the English catalog', () => {
  for (const reason of REASONS) {
    for (const hasHiddenTheDiary of [false, true]) {
      const key = syncErrorCopyKey({ reason, hasHiddenTheDiary });
      assert.ok((lookup(key) ?? '').length > 0, `${reason} (hidden: ${hasHiddenTheDiary}) has no copy at ${key}`);
    }
  }
  // CONTROL: the lookup can fail.
  assert.equal(lookup('sync.status.error.noSuchReason'), undefined);
});

test('a suspension reuses the existing suspended sentence, in either mode', () => {
  for (const hasHiddenTheDiary of [false, true]) {
    assert.equal(syncErrorCopyKey({ reason: 'suspended', hasHiddenTheDiary }), 'sync.suspended');
  }
});

test('only a reauth that hid the diary says the diary was hidden', () => {
  assert.equal(
    syncErrorCopyKey({ reason: 'reauth-required', hasHiddenTheDiary: true }),
    'sync.status.error.reauthRequiredManaged',
  );
  // CONTROL: the open-instance line is unchanged, and the other reasons ignore the flag.
  assert.equal(
    syncErrorCopyKey({ reason: 'reauth-required', hasHiddenTheDiary: false }),
    'sync.status.error.reauth-required',
  );
  assert.equal(syncErrorCopyKey({ reason: 'offline', hasHiddenTheDiary: true }), 'sync.status.error.offline');
});
