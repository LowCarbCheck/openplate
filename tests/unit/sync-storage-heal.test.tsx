/**
 * THE HEAL IS SILENT IN MECHANISM AND LOUD IN REPORTING (M223).
 *
 * The withholding itself is invisible by design: the push simply carries no
 * deletes, the pull hands the account's copy back, and the device repopulates
 * through the ordinary path. That is right, because a person whose data came
 * back should not have to do anything.
 *
 * It is also exactly how this defect survived. A device that silently empties
 * itself and silently fills itself again looks perfectly healthy while doing
 * both. So the notice is a separate, testable statement, and this file is the
 * two halves of it: the pure decision, and the sentence a person reads.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { resolveStorageHealNotice } from '../../app/lib/sync/storage-heal';
import type { Tombstone } from '../../app/lib/sync/engine/merge/types';
import { SyncRestoredNotice } from '../../app/components/sync-status';
import type { StorageHealNotice } from '../../app/lib/sync/storage-heal';
import { withI18n } from './trends-i18n-harness';

function tombstone(entityId: string): Tombstone {
  return { entityId, entityType: 'foodLog', lamport: 2, deviceId: 'device-1' };
}

function render(notice: StorageHealNotice): string {
  return renderToStaticMarkup(withI18n(createElement(SyncRestoredNotice, { notice })));
}

describe('resolveStorageHealNotice', () => {
  it('says nothing at all when nothing was withheld', () => {
    assert.deepEqual(resolveStorageHealNotice([]), { kind: 'none' });
  });

  it('counts what could not be proven deleted', () => {
    assert.deepEqual(resolveStorageHealNotice([tombstone('a'), tombstone('b')]), {
      kind: 'restored',
      entryCount: 2,
    });
  });
});

describe('the sync status surface', () => {
  it('tells the person their copy was restored, in words, not a code', () => {
    const markup = render({ kind: 'restored', entryCount: 2 });
    // The RENDERED sentence, from the real bundle. Pinning the key instead
    // would pass against a key nobody translated.
    assert.ok(markup.includes('This device lost its local copy'), 'the restore notice was not drawn');
    assert.ok(markup.includes('Nothing was deleted.'), 'the reassurance was not drawn');
  });

  it('THE CONTROL: draws nothing of the sort on an ordinary healthy sync', () => {
    const markup = render({ kind: 'none' });
    assert.ok(!markup.includes('This device lost its local copy'), 'a healthy device was told it lost its data');
  });
});
